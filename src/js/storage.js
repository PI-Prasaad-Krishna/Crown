// Storage Manager for Crown Browser: persists profile-isolated settings, tab groups, bookmarks, history, shield stats & profiles
const isIncognitoWindowMode = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('incognito') === '1';

export const Storage = {
  isIncognitoWindow: isIncognitoWindowMode,

  // Resolve storage key scoped to the active profile (0 MB RAM overhead multi-profile isolation)
  _profileKey(baseKey) {
    const profileId = this.getActiveProfileId();
    if (!profileId || profileId === 'default') {
      return baseKey;
    }
    const safeId = String(profileId).replace(/[^a-zA-Z0-9_-]/g, '');
    return `crown_prof_${safeId}_${baseKey}`;
  },

  sanitizeColor(color, fallback = '#e6ca85') {
    if (typeof color !== 'string') return fallback;
    const trimmed = color.trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed) ? trimmed : fallback;
  },

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
      memorySaverMode: true, // Ultra-Low RAM mode: hibernates inactive background tabs
      maxLiveTabs: 1,        // Single-Active Renderer (~80-100 MB target)
      customBackground: '',
      tabPosition: 'top', // 'top' | 'left'
      verticalCollapsed: false,
      accentColor: '#e6ca85' // Crown Gold
    };
    try {
      const saved = localStorage.getItem(this._profileKey('crown_settings'));
      if (!saved) return defaults;
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;

      const sanitized = { ...defaults };
      for (const key of Object.keys(defaults)) {
        if (Object.prototype.hasOwnProperty.call(parsed, key) && typeof parsed[key] === typeof defaults[key]) {
          sanitized[key] = parsed[key];
        }
      }
      sanitized.accentColor = this.sanitizeColor(sanitized.accentColor, defaults.accentColor);
      if (sanitized.tabPosition !== 'top' && sanitized.tabPosition !== 'left') {
        sanitized.tabPosition = 'top';
      }
      sanitized.maxLiveTabs = Math.max(1, Math.min(5, Number(sanitized.maxLiveTabs) || 1));
      return sanitized;
    } catch {
      return defaults;
    }
  },

  saveSettings(settings) {
    if (this.isIncognitoWindow) return;
    try {
      localStorage.setItem(this._profileKey('crown_settings'), JSON.stringify(settings));
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
    if (this.isIncognitoWindow) {
      return { ...defaults };
    }
    try {
      const saved = localStorage.getItem('crown_shield_stats');
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch {
      return defaults;
    }
  },

  saveShieldStats(stats) {
    if (this.isIncognitoWindow) return;
    try {
      localStorage.setItem('crown_shield_stats', JSON.stringify(stats));
    } catch (e) {
      console.error('Failed to persist shield stats', e);
    }
  },

  getTabGroups() {
    if (this.isIncognitoWindow) return [];
    try {
      const saved = localStorage.getItem(this._profileKey('crown_tab_groups'));
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(g => ({
        id: String(g.id || ''),
        name: String(g.name || 'Group'),
        color: this.sanitizeColor(g.color, '#e6ca85'),
        collapsed: !!g.collapsed
      }));
    } catch {
      return [];
    }
  },

  saveTabGroups(groups) {
    if (this.isIncognitoWindow) return;
    try {
      localStorage.setItem(this._profileKey('crown_tab_groups'), JSON.stringify(groups));
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
      const saved = localStorage.getItem(this._profileKey('crown_bookmarks'));
      return saved ? JSON.parse(saved) : defaults;
    } catch {
      return defaults;
    }
  },

  saveBookmarks(bookmarks) {
    try {
      localStorage.setItem(this._profileKey('crown_bookmarks'), JSON.stringify(bookmarks));
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
      const saved = localStorage.getItem(this._profileKey('crown_shortcuts'));
      return saved ? JSON.parse(saved) : defaults;
    } catch {
      return defaults;
    }
  },

  saveShortcuts(shortcuts) {
    if (this.isIncognitoWindow) return;
    try {
      localStorage.setItem(this._profileKey('crown_shortcuts'), JSON.stringify(shortcuts));
    } catch (e) {
      console.error('Failed to persist shortcuts', e);
    }
  },

  getDismissedShortcuts() {
    try {
      const saved = localStorage.getItem(this._profileKey('crown_dismissed_shortcuts'));
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  },

  addDismissedShortcut(hostname) {
    if (!hostname || this.isIncognitoWindow) return;
    const clean = hostname.toLowerCase().replace(/^www\./, '');
    const list = this.getDismissedShortcuts();
    if (!list.includes(clean)) {
      list.push(clean);
      try {
        localStorage.setItem(this._profileKey('crown_dismissed_shortcuts'), JSON.stringify(list));
      } catch (e) {
        console.error('Failed to persist dismissed shortcuts', e);
      }
    }
  },

  removeDismissedShortcut(hostname) {
    if (!hostname || this.isIncognitoWindow) return;
    const clean = hostname.toLowerCase().replace(/^www\./, '');
    const list = this.getDismissedShortcuts().filter(h => h !== clean);
    try {
      localStorage.setItem(this._profileKey('crown_dismissed_shortcuts'), JSON.stringify(list));
    } catch (e) {
      console.error('Failed to update dismissed shortcuts', e);
    }
  },

  getFrequentSites(maxCount = 5) {
    // Never auto-populate frequent sites inside an Incognito window
    if (this.isIncognitoWindow) return [];

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
      if (item.url.startsWith('crown://')) continue;
      const host = extractHost(item.url);
      if (!host || pinnedHosts.has(host) || dismissed.has(host)) continue;

      let originUrl = item.url;
      try {
        const parsed = new URL(item.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
        if (parsed.username || parsed.password) continue;
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
    if (allowInternal && (trimmed.startsWith('crown://') || trimmed === 'about:blank')) {
      return true;
    }
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return false;
      }
      // Reject credential-embedded phishing URLs (e.g. https://google.com@attacker.com)
      if (parsed.username !== '' || parsed.password !== '') {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  },

  getHistory() {
    if (this.isIncognitoWindow) return [];
    try {
      const saved = localStorage.getItem(this._profileKey('crown_history'));
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  },

  addHistory(item) {
    // Strictly prevent persisting any incognito visit or activity inside an Incognito window
    if (!item || item.isIncognito || this.isIncognitoWindow) return;
    try {
      const history = this.getHistory();
      history.unshift({ ...item, timestamp: Date.now() });
      if (history.length > 500) history.pop();
      localStorage.setItem(this._profileKey('crown_history'), JSON.stringify(history));
    } catch (e) {
      console.error('Failed to persist history item', e);
    }
  },

  clearHistory() {
    try {
      localStorage.removeItem(this._profileKey('crown_history'));
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
    if (this.isIncognitoWindow) return;
    localStorage.setItem('crown_active_profile_id', id);
  }
};
