// Storage Manager for Crown Browser: persists settings, tab groups, bookmarks, history, shield stats & profiles
export const Storage = {
  getSettings() {
    const defaults = {
      searchEngine: 'google',
      customSearchUrl: '',
      shieldsEnabled: true,
      blockAds: true,
      blockTrackers: true,
      stripQueryParams: true,
      blockCookieNotices: true,
      httpsEverywhere: true,
      customBackground: '',
      tabPosition: 'top', // 'top' | 'left'
      verticalCollapsed: false,
      accentColor: '#e6ca85' // Crown Gold
    };
    try {
      const saved = localStorage.getItem('crown_settings');
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch {
      return defaults;
    }
  },

  saveSettings(settings) {
    try {
      localStorage.setItem('crown_settings', JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to persist settings', e);
    }
  },

  getShieldStats() {
    const defaults = {
      adsBlockedTotal: 0,
      trackersBlockedTotal: 0,
      paramsCleanedTotal: 0,
      bandwidthSavedMB: 0.0,
      timeSavedSec: 0.0
    };
    try {
      const saved = localStorage.getItem('crown_shield_stats');
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch {
      return defaults;
    }
  },

  saveShieldStats(stats) {
    try {
      localStorage.setItem('crown_shield_stats', JSON.stringify(stats));
    } catch (e) {
      console.error('Failed to persist shield stats', e);
    }
  },

  getTabGroups() {
    try {
      const saved = localStorage.getItem('crown_tab_groups');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  },

  saveTabGroups(groups) {
    try {
      localStorage.setItem('crown_tab_groups', JSON.stringify(groups));
    } catch (e) {
      console.error('Failed to persist tab groups', e);
    }
  },

  getBookmarks() {
    const defaults = [
      { id: '1', title: 'Google', url: 'https://www.google.com' },
      { id: '2', title: 'YouTube', url: 'https://www.youtube.com' },
      { id: '3', title: 'GitHub', url: 'https://github.com' },
      { id: '4', title: 'Reddit', url: 'https://reddit.com' },
      { id: '5', title: 'Wikipedia', url: 'https://wikipedia.org' }
    ];
    try {
      const saved = localStorage.getItem('crown_bookmarks');
      return saved ? JSON.parse(saved) : defaults;
    } catch {
      return defaults;
    }
  },

  saveBookmarks(bookmarks) {
    try {
      localStorage.setItem('crown_bookmarks', JSON.stringify(bookmarks));
      window.dispatchEvent(new CustomEvent('crown:bookmarks-updated'));
    } catch (e) {
      console.error('Failed to persist bookmarks', e);
    }
  },

  // Pinned & Auto-Frequent Shortcuts for New Tab Page
  getShortcuts() {
    const defaults = [
      { id: 'sc-1', title: 'Google', url: 'https://www.google.com', pinned: true },
      { id: 'sc-2', title: 'YouTube', url: 'https://www.youtube.com', pinned: true },
      { id: 'sc-3', title: 'GitHub', url: 'https://github.com', pinned: true },
      { id: 'sc-4', title: 'Reddit', url: 'https://reddit.com', pinned: true },
      { id: 'sc-5', title: 'Wikipedia', url: 'https://wikipedia.org', pinned: true }
    ];
    try {
      const saved = localStorage.getItem('crown_shortcuts');
      return saved ? JSON.parse(saved) : defaults;
    } catch {
      return defaults;
    }
  },

  saveShortcuts(shortcuts) {
    try {
      localStorage.setItem('crown_shortcuts', JSON.stringify(shortcuts));
    } catch (e) {
      console.error('Failed to persist shortcuts', e);
    }
  },

  getDismissedShortcuts() {
    try {
      const saved = localStorage.getItem('crown_dismissed_shortcuts');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  },

  addDismissedShortcut(hostname) {
    if (!hostname) return;
    const clean = hostname.toLowerCase().replace(/^www\./, '');
    const list = this.getDismissedShortcuts();
    if (!list.includes(clean)) {
      list.push(clean);
      try {
        localStorage.setItem('crown_dismissed_shortcuts', JSON.stringify(list));
      } catch (e) {
        console.error('Failed to persist dismissed shortcuts', e);
      }
    }
  },

  removeDismissedShortcut(hostname) {
    if (!hostname) return;
    const clean = hostname.toLowerCase().replace(/^www\./, '');
    const list = this.getDismissedShortcuts().filter(h => h !== clean);
    try {
      localStorage.setItem('crown_dismissed_shortcuts', JSON.stringify(list));
    } catch (e) {
      console.error('Failed to update dismissed shortcuts', e);
    }
  },

  getFrequentSites(maxCount = 5) {
    const history = this.getHistory();
    const pinned = this.getShortcuts();
    const dismissed = new Set(this.getDismissedShortcuts());

    const extractHost = (u) => {
      try {
        return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        return '';
      }
    };

    const pinnedHosts = new Set(pinned.map(s => extractHost(s.url)).filter(Boolean));
    const counts = new Map(); // host -> { count, title, url, lastVisit }

    for (const item of history) {
      if (!item || !item.url || item.isIncognito) continue;
      if (item.url.startsWith('crown://') || item.url.startsWith('crisp://')) continue;
      const host = extractHost(item.url);
      if (!host || pinnedHosts.has(host) || dismissed.has(host)) continue;

      let originUrl = item.url;
      try {
        const parsed = new URL(item.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
        originUrl = `${parsed.protocol}//${parsed.hostname}`;
      } catch {
        continue;
      }

      const existing = counts.get(host);
      if (existing) {
        existing.count += 1;
      } else {
        const cleanTitle = host.split('.')[0];
        const formattedTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
        counts.set(host, {
          id: `freq-${host}`,
          host,
          title: item.title && !item.title.includes('://') ? item.title : formattedTitle,
          url: originUrl,
          count: 1,
          pinned: false,
          isFrequent: true
        });
      }
    }

    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, maxCount);
  },

  isSafeUrl(url, allowInternal = true) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (allowInternal && (trimmed.startsWith('crown://') || trimmed.startsWith('crisp://') || trimmed === 'about:blank')) {
      return true;
    }
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  },

  getHistory() {
    try {
      const saved = localStorage.getItem('crown_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  },

  addHistory(item) {
    // Strictly prevent persisting any incognito visit
    if (item.isIncognito) return;
    try {
      const history = this.getHistory();
      history.unshift({ ...item, timestamp: Date.now() });
      if (history.length > 500) history.pop();
      localStorage.setItem('crown_history', JSON.stringify(history));
    } catch (e) {
      console.error('Failed to persist history item', e);
    }
  },

  clearHistory() {
    try {
      localStorage.removeItem('crown_history');
    } catch (e) {
      console.error('Failed to clear history', e);
    }
  },

  // Local Profiles
  getProfiles() {
    const defaults = [
      { id: 'default', name: 'Personal', avatar: 'P', color: '#e6ca85' },
      { id: 'work', name: 'Work', avatar: 'W', color: '#8ab4f8' }
    ];
    try {
      const saved = localStorage.getItem('crown_profiles');
      return saved ? JSON.parse(saved) : defaults;
    } catch {
      return defaults;
    }
  },

  getActiveProfileId() {
    return localStorage.getItem('crown_active_profile_id') || 'default';
  },

  setActiveProfileId(id) {
    localStorage.setItem('crown_active_profile_id', id);
  }
};
