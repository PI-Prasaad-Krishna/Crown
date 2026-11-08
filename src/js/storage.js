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

  getDefaultSettings() {
    return {
      searchEngine: 'google',
      customSearchUrl: '',
      shieldsEnabled: true,
      blockAds: true,
      blockTrackers: true,
      stripQueryParams: true,
      blockCookieNotices: true,
      httpsEverywhere: true,
      sendGpc: true,         // Global Privacy Control (Sec-GPC: 1 & DNT: 1)
      memorySaverMode: true, // Ultra-Low RAM mode: hibernates inactive background tabs
      memorySaverLevel: 'maximum', // 'maximum' (1 tab) | 'balanced' (2 tabs) | 'moderate' (5 tabs)
      maxLiveTabs: 1,        // Single-Active Renderer (~80-100 MB target)
      memoryWhitelist: [],   // Domains that never hibernate
      energySaver: false,    // Conserves battery by limiting animations & background frame activity
      energySaverMode: 'battery_20', // 'battery_20' | 'unplugged' | 'always'
      hardwareAcceleration: true,
      language: 'en-US,en;q=0.9',
      spellcheck: true,
      highContrast: false,
      reducedMotion: false,
      minFontSize: 0,        // 0 = Default (none), or 12..24 px
      showBookmarksBar: true,
      wallpaper: 'obsidian', // 'obsidian' | 'midnight' | 'aurora' | 'crimson' | 'minimal' | 'custom'
      customBackground: '',
      tabPosition: 'top', // 'top' | 'left'
      verticalCollapsed: false,
      accentColor: '#e6ca85', // Crown Gold
      pageZoom: 100, // Zoom percentage (50% to 200%)
      cookiePolicy: 'block-third-party', // 'block-third-party' (default, recommended) | 'block-all' | 'allow-all'
      clearCookiesOnExit: false,
      startupBehavior: 'newtab', // 'newtab' (default) | 'continue' | 'custom'
      startupCustomUrl: '',
      downloadAskLocation: false,
      downloadLocation: '',
      defaultPermissions: {
        camera: 'ask',
        microphone: 'ask',
        location: 'ask',
        notifications: 'ask',
        javascript: 'allow',
        popups: 'block',
        sound: 'allow'
      }
    };
  },

  getSettings() {
    const defaults = this.getDefaultSettings();
    try {
      const saved = localStorage.getItem(this._profileKey('crown_settings'));
      if (!saved) return defaults;
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;

      const sanitized = { ...defaults };
      for (const key of Object.keys(defaults)) {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
          if (Array.isArray(defaults[key])) {
            if (Array.isArray(parsed[key])) {
              sanitized[key] = parsed[key].map(x => String(x || '').trim().toLowerCase()).filter(Boolean).slice(0, 50);
            }
          } else if (typeof parsed[key] === typeof defaults[key]) {
            sanitized[key] = parsed[key];
          }
        }
      }
      sanitized.accentColor = this.sanitizeColor(sanitized.accentColor, defaults.accentColor);
      if (sanitized.tabPosition !== 'top' && sanitized.tabPosition !== 'left') {
        sanitized.tabPosition = 'top';
      }
      if (!['obsidian', 'midnight', 'aurora', 'crimson', 'minimal', 'custom'].includes(sanitized.wallpaper)) {
        sanitized.wallpaper = 'obsidian';
      }
      if (!['maximum', 'balanced', 'moderate'].includes(sanitized.memorySaverLevel)) {
        sanitized.memorySaverLevel = 'maximum';
      }
      sanitized.maxLiveTabs = sanitized.memorySaverLevel === 'moderate'
        ? 5
        : (sanitized.memorySaverLevel === 'balanced' ? 2 : 1);
      if (!['battery_20', 'unplugged', 'always'].includes(sanitized.energySaverMode)) {
        sanitized.energySaverMode = 'battery_20';
      }
      if (!['block-third-party', 'block-all', 'allow-all'].includes(sanitized.cookiePolicy)) {
        sanitized.cookiePolicy = 'block-third-party';
      }
      if (!['newtab', 'continue', 'custom'].includes(sanitized.startupBehavior)) {
        sanitized.startupBehavior = 'newtab';
      }
      if (
        typeof sanitized.language !== 'string' ||
        !sanitized.language.trim() ||
        sanitized.language.length > 48 ||
        !/^[a-zA-Z0-9-,;=._]+$/.test(sanitized.language)
      ) {
        sanitized.language = 'en-US,en;q=0.9';
      }
      const rawFont = Number(sanitized.minFontSize) || 0;
      sanitized.minFontSize = rawFont <= 0 ? 0 : Math.max(10, Math.min(24, rawFont));
      sanitized.pageZoom = Math.max(50, Math.min(200, Number(sanitized.pageZoom) || 100));
      return sanitized;
    } catch {
      return defaults;
    }
  },

  // Always merges partial or full settings patches into existing profile settings so no key (like accentColor) is ever wiped
  saveSettings(patchOrFull) {
    const current = this.getSettings();
    const merged = {
      ...current,
      ...(patchOrFull && typeof patchOrFull === 'object' ? patchOrFull : {})
    };
    if (!this.isIncognitoWindow) {
      try {
        localStorage.setItem(this._profileKey('crown_settings'), JSON.stringify(merged));
      } catch (e) {
        console.error('Failed to persist settings', e);
      }
    }
    const clean = this.getSettings();
    window.dispatchEvent(new CustomEvent('crown:settings-updated', { detail: clean }));
    return clean;
  },

  resetSettingsToDefaults() {
    const defaults = this.getDefaultSettings();
    if (!this.isIncognitoWindow) {
      try {
        localStorage.setItem(this._profileKey('crown_settings'), JSON.stringify(defaults));
        localStorage.removeItem(this._profileKey('crown_extensions'));
        localStorage.removeItem('crown_custom_bg');
      } catch (e) {
        console.error('Failed to reset settings', e);
      }
    }
    window.dispatchEvent(new CustomEvent('crown:settings-updated', { detail: defaults }));
    return defaults;
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

  // Extract base apex domain (e.g. "en.wikipedia.org" -> "wikipedia.org", "m.youtube.com" -> "youtube.com")
  extractBaseDomain(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      const parsed = new URL(url.includes('://') ? url : `https://${url}`);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (!host) return '';
      // IP addresses (IPv4 or IPv6) have no base domain
      if (/^[\d.]+$|^\[.*\]$/.test(host)) return host;

      const parts = host.split('.');
      if (parts.length <= 2) return host;

      // Handle multi-part ccTLDs (.co.uk, .com.au, .org.uk, .edu.sg, .gov.in, etc.)
      const knownSecondLevelTlds = new Set(['co', 'com', 'org', 'net', 'edu', 'gov', 'mil', 'ac']);
      const secondLast = parts[parts.length - 2];
      const last = parts[parts.length - 1];
      if (parts.length >= 3 && knownSecondLevelTlds.has(secondLast) && last.length === 2) {
        return parts.slice(-3).join('.');
      }
      return parts.slice(-2).join('.');
    } catch {
      return '';
    }
  },

  // --- Site Permissions & Device Access ---
  _normalizeOrigin(urlOrOrigin) {
    if (!urlOrOrigin || typeof urlOrOrigin !== 'string') return '';
    try {
      const u = new URL(urlOrOrigin.includes('://') ? urlOrOrigin : `https://${urlOrOrigin}`);
      return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? ':' + u.port : ''}`;
    } catch {
      return '';
    }
  },

  getSitePermissions(urlOrOrigin) {
    const origin = this._normalizeOrigin(urlOrOrigin);
    const defaults = {
      camera: 'ask',
      microphone: 'ask',
      location: 'ask',
      notifications: 'ask',
      javascript: 'allow',
      popups: 'block',
      sound: 'allow'
    };
    if (!origin) return defaults;
    try {
      const saved = localStorage.getItem(this._profileKey('crown_site_permissions'));
      if (!saved) return defaults;
      const parsed = JSON.parse(saved);
      const siteOverrides = parsed && parsed[origin] ? parsed[origin] : {};
      return { ...defaults, ...siteOverrides };
    } catch {
      return defaults;
    }
  },

  getRawSitePermissions(urlOrOrigin) {
    const origin = this._normalizeOrigin(urlOrOrigin);
    if (!origin) return {};
    try {
      const saved = localStorage.getItem(this._profileKey('crown_site_permissions'));
      if (!saved) return {};
      const parsed = JSON.parse(saved);
      return parsed && parsed[origin] ? parsed[origin] : {};
    } catch {
      return {};
    }
  },

  setSitePermission(urlOrOrigin, permKey, state) {
    const origin = this._normalizeOrigin(urlOrOrigin);
    if (!origin || !permKey) return;
    if (this.isIncognitoWindow) return; // Incognito permissions are ephemeral and not persisted
    try {
      const saved = localStorage.getItem(this._profileKey('crown_site_permissions'));
      const parsed = saved ? JSON.parse(saved) : {};
      if (!parsed[origin]) parsed[origin] = {};
      parsed[origin][permKey] = state; // 'ask' | 'allow' | 'block'
      localStorage.setItem(this._profileKey('crown_site_permissions'), JSON.stringify(parsed));
    } catch (e) {
      console.error('Failed to save site permission', e);
    }
  },

  getAllSitePermissions() {
    try {
      const saved = localStorage.getItem(this._profileKey('crown_site_permissions'));
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  },

  resetSitePermissions(urlOrOrigin) {
    const origin = this._normalizeOrigin(urlOrOrigin);
    if (!origin) return;
    try {
      const saved = localStorage.getItem(this._profileKey('crown_site_permissions'));
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed[origin]) {
        delete parsed[origin];
        localStorage.setItem(this._profileKey('crown_site_permissions'), JSON.stringify(parsed));
      }
    } catch (e) {
      console.error('Failed to reset site permissions', e);
    }
  },

  resetAllSitePermissions() {
    try {
      localStorage.removeItem(this._profileKey('crown_site_permissions'));
    } catch (e) {
      console.error('Failed to reset all site permissions', e);
    }
  },

  // --- Cookie & Site Storage Management ---
  _normalizeDomain(urlOrHost) {
    if (!urlOrHost || typeof urlOrHost !== 'string') return '';
    try {
      const u = new URL(urlOrHost.includes('://') ? urlOrHost : `https://${urlOrHost}`);
      return u.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return urlOrHost.toLowerCase().replace(/^www\./, '').split('/')[0];
    }
  },

  recordSiteCookie(urlOrHost, name = 'session', value = '', isSecure = true) {
    const domain = this._normalizeDomain(urlOrHost);
    if (!domain || this.isIncognitoWindow) return;
    try {
      const saved = localStorage.getItem(this._profileKey('crown_cookies'));
      const parsed = saved ? JSON.parse(saved) : {};
      if (!parsed[domain]) {
        parsed[domain] = { cookies: [], lastAccessed: Date.now() };
      }
      const existingIdx = parsed[domain].cookies.findIndex(c => c.name === name);
      const cookieObj = { name, value: String(value || '').slice(0, 100), secure: isSecure, updated: Date.now() };
      if (existingIdx >= 0) {
        parsed[domain].cookies[existingIdx] = cookieObj;
      } else {
        parsed[domain].cookies.push(cookieObj);
      }
      parsed[domain].lastAccessed = Date.now();
      localStorage.setItem(this._profileKey('crown_cookies'), JSON.stringify(parsed));
    } catch (e) {
      console.error('Failed to record site cookie', e);
    }
  },

  getStoredCookies(urlOrHost) {
    const domain = this._normalizeDomain(urlOrHost);
    if (!domain) return [];
    try {
      const saved = localStorage.getItem(this._profileKey('crown_cookies'));
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return (parsed[domain] && parsed[domain].cookies) || [];
    } catch {
      return [];
    }
  },

  getAllCookieDomains() {
    try {
      const saved = localStorage.getItem(this._profileKey('crown_cookies'));
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Object.keys(parsed)
        .map(domain => ({
          domain,
          count: parsed[domain].cookies ? parsed[domain].cookies.length : 0,
          lastAccessed: parsed[domain].lastAccessed || Date.now()
        }))
        .sort((a, b) => a.domain.localeCompare(b.domain));
    } catch {
      return [];
    }
  },

  clearCookiesForSite(urlOrHost) {
    const domain = this._normalizeDomain(urlOrHost);
    if (!domain) return;
    try {
      const saved = localStorage.getItem(this._profileKey('crown_cookies'));
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed[domain]) {
        delete parsed[domain];
        localStorage.setItem(this._profileKey('crown_cookies'), JSON.stringify(parsed));
      }
    } catch (e) {
      console.error('Failed to clear cookies for site', e);
    }
  },

  clearAllCookies() {
    try {
      localStorage.removeItem(this._profileKey('crown_cookies'));
    } catch (e) {
      console.error('Failed to clear all cookies', e);
    }
  },

  // --- Granular Clear Browsing Data ---
  clearBrowsingData({
    timeRange = 'all',
    history = true,
    cookies = true,
    cache = true,
    downloads = false,
    sitePermissions = false
  } = {}) {
    const now = Date.now();
    let cutoff = 0;
    if (timeRange === 'hour') cutoff = now - 3600000;
    else if (timeRange === 'day') cutoff = now - 86400000;
    else if (timeRange === 'week') cutoff = now - 604800000;
    else if (timeRange === 'month') cutoff = now - 2592000000;

    let clearedCount = 0;

    // 1. History
    if (history) {
      if (cutoff === 0) {
        this.clearHistory();
      } else {
        const h = this.getHistory().filter(item => (item.timestamp || 0) < cutoff);
        try {
          localStorage.setItem(this._profileKey('crown_history'), JSON.stringify(h));
        } catch {}
      }
      clearedCount++;
    }

    // 2. Cookies & Site Data
    if (cookies) {
      if (cutoff === 0) {
        this.clearAllCookies();
      } else {
        try {
          const saved = localStorage.getItem(this._profileKey('crown_cookies'));
          if (saved) {
            const parsed = JSON.parse(saved);
            for (const d of Object.keys(parsed)) {
              if ((parsed[d].lastAccessed || 0) >= cutoff) {
                delete parsed[d];
              }
            }
            localStorage.setItem(this._profileKey('crown_cookies'), JSON.stringify(parsed));
          }
        } catch {}
      }
      clearedCount++;
    }

    // 3. Cache (Suggestions & temporary caches)
    if (cache) {
      try {
        sessionStorage.clear();
      } catch {}
      clearedCount++;
    }

    // 4. Downloads
    if (downloads) {
      try {
        if (cutoff === 0) {
          localStorage.removeItem(this._profileKey('crown_downloads'));
        } else {
          const d = JSON.parse(localStorage.getItem(this._profileKey('crown_downloads')) || '[]')
            .filter(item => (item.timestamp || 0) < cutoff);
          localStorage.setItem(this._profileKey('crown_downloads'), JSON.stringify(d));
        }
      } catch {}
      clearedCount++;
    }

    // 5. Site Permissions
    if (sitePermissions) {
      this.resetAllSitePermissions();
      clearedCount++;
    }

    return clearedCount;
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
    const base = this.extractBaseDomain(clean);
    const list = this.getDismissedShortcuts();
    let modified = false;
    for (const h of [clean, base]) {
      if (h && !list.includes(h)) {
        list.push(h);
        modified = true;
      }
    }
    if (modified) {
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
    const base = this.extractBaseDomain(clean);
    const toRemove = new Set([clean, base].filter(Boolean));
    const list = this.getDismissedShortcuts().filter(h => !toRemove.has(h));
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

    // Extract both full hosts and base domains of pinned sites to strictly prevent subdomains (e.g. en.wikipedia.org) duplicating pinned sites
    const pinnedHosts = new Set();
    const pinnedBaseDomains = new Set();
    for (const s of pinned) {
      if (!s || !s.url) continue;
      try {
        const h = new URL(s.url).hostname.toLowerCase().replace(/^www\./, '');
        if (h) pinnedHosts.add(h);
      } catch {}
      const base = this.extractBaseDomain(s.url);
      if (base) pinnedBaseDomains.add(base);
    }

    const counts = new Map(); // baseDomain -> { count, title, url, lastVisit, host, baseDomain }

    for (const item of history) {
      if (!item || !item.url || item.isIncognito) continue;
      if (item.url.startsWith('crown://')) continue;

      let host = '';
      try {
        host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        continue;
      }
      if (!host) continue;

      const baseDomain = this.extractBaseDomain(item.url) || host;

      // Skip if host or base domain is pinned, or if dismissed by user
      if (
        pinnedHosts.has(host) ||
        pinnedBaseDomains.has(baseDomain) ||
        dismissed.has(host) ||
        dismissed.has(baseDomain)
      ) {
        continue;
      }

      let originUrl = item.url;
      try {
        const parsed = new URL(item.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
        if (parsed.username || parsed.password) continue;
        originUrl = `${parsed.protocol}//${parsed.hostname}`;
      } catch {
        continue;
      }

      const existing = counts.get(baseDomain);
      if (existing) {
        existing.count += 1;
      } else {
        const cleanTitle = baseDomain.split('.')[0];
        const formattedTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
        counts.set(baseDomain, {
          id: `freq-${baseDomain}`,
          host,
          baseDomain,
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

  deleteHistoryItem(timestamp) {
    if (this.isIncognitoWindow) return;
    try {
      const history = this.getHistory().filter(h => h.timestamp !== timestamp);
      localStorage.setItem(this._profileKey('crown_history'), JSON.stringify(history));
    } catch (e) {
      console.error('Failed to delete history item', e);
    }
  },

  clearHistory(maxAgeMs = null) {
    try {
      if (!maxAgeMs || maxAgeMs <= 0) {
        localStorage.removeItem(this._profileKey('crown_history'));
      } else {
        const cutoff = Date.now() - maxAgeMs;
        const remaining = this.getHistory().filter(h => (h.timestamp || 0) < cutoff);
        localStorage.setItem(this._profileKey('crown_history'), JSON.stringify(remaining));
      }
    } catch (e) {
      console.error('Failed to clear history', e);
    }
  },

  // Local Profiles
  getProfiles() {
    const defaults = [
      { id: 'default', name: 'Personal', avatar: 'P', color: '#e6ca85' }
    ];
    try {
      const saved = localStorage.getItem('crown_profiles');
      if (!saved) return defaults;
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : defaults;
    } catch {
      return defaults;
    }
  },

  saveProfiles(profiles) {
    if (this.isIncognitoWindow || !Array.isArray(profiles)) return;
    try {
      localStorage.setItem('crown_profiles', JSON.stringify(profiles));
    } catch (e) {
      console.error('Failed to persist profiles', e);
    }
  },

  deleteProfileData(profileId) {
    if (!profileId || profileId === 'default') return;
    const safeId = String(profileId).replace(/[^a-zA-Z0-9_-]/g, '');
    const prefix = `crown_prof_${safeId}_`;
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) {
      console.error('Failed to clean up profile data', e);
    }
  },

  getActiveProfileId() {
    return localStorage.getItem('crown_active_profile_id') || 'default';
  },

  setActiveProfileId(id) {
    if (this.isIncognitoWindow) return;
    localStorage.setItem('crown_active_profile_id', id);
  },

  getShowProfilePickerOnStartup() {
    return localStorage.getItem('crown_show_profile_picker_startup') !== 'false';
  },

  setShowProfilePickerOnStartup(show) {
    if (this.isIncognitoWindow) return;
    localStorage.setItem('crown_show_profile_picker_startup', show ? 'true' : 'false');
  },

  // Per-Profile Saved Tab Sessions
  getSessionTabs() {
    if (this.isIncognitoWindow) return [];
    try {
      const saved = localStorage.getItem(this._profileKey('crown_session_tabs'));
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  saveSessionTabs(tabsData) {
    if (this.isIncognitoWindow || !Array.isArray(tabsData)) return;
    try {
      localStorage.setItem(this._profileKey('crown_session_tabs'), JSON.stringify(tabsData));
    } catch (e) {
      console.error('Failed to persist session tabs', e);
    }
  },

  // Featherweight Sandboxed Extensions Engine (0 MB Idle RAM Overhead + Chrome Web Store CRX3 Unpacker)
  getDefaultExtensions() {
    return [
      {
        id: 'ext-dark-reader',
        name: 'Universal Dark Reader',
        version: '1.2.0',
        description: 'Applies an intelligent dark theme to bright websites without slowing down page rendering.',
        builtin: true,
        builtIn: true,
        source: 'builtin',
        enabled: false,
        css: `html { background-color: #121316 !important; filter: invert(0.92) hue-rotate(180deg) !important; } img, video, picture, canvas, iframe, svg { filter: invert(1) hue-rotate(180deg) !important; }`,
        js: ''
      },
      {
        id: 'ext-annoyance-guard',
        name: 'Popup & Annoyance Skipper',
        version: '1.4.0',
        description: 'Automatically hides newsletter modals, sticky signup bars, and floating page overlays.',
        builtin: true,
        builtIn: true,
        source: 'builtin',
        enabled: true,
        css: `[class*="newsletter-popup"], [class*="paywall-modal"], [id*="cookie-banner"], [class*="subscribe-modal"], [class*="floating-ad"] { display: none !important; }`,
        js: ''
      },
      {
        id: 'ext-media-enhancer',
        name: 'Media & Cinema Enhancer',
        version: '1.1.0',
        description: 'Enhances HTML5 video players with clean theatre framing and disables unsolicited autoplay.',
        builtin: true,
        builtIn: true,
        source: 'builtin',
        enabled: false,
        css: `video { outline: none !important; }`,
        js: `document.querySelectorAll('video[autoplay]').forEach(v => { try { v.autoplay = false; v.pause(); } catch(e){} });`
      },
      {
        id: 'ext-json-formatter',
        name: 'JSON & Code Prettifier',
        version: '1.0.5',
        description: 'Formats raw JSON responses and code blocks with clean dark-mode typography.',
        builtin: true,
        builtIn: true,
        source: 'builtin',
        enabled: true,
        css: `pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; line-height: 1.55 !important; }`,
        js: ''
      },
      {
        id: 'ext-focus-typography',
        name: 'ClearType Reading Boost',
        version: '1.0.2',
        description: 'Improves subpixel text legibility, line height, and kerning across dense documentation sites.',
        builtin: true,
        builtIn: true,
        source: 'builtin',
        enabled: false,
        css: `body { -webkit-font-smoothing: antialiased !important; text-rendering: optimizeLegibility !important; }`,
        js: ''
      }
    ];
  },

  getExtensions() {
    const builtins = this.getDefaultExtensions();
    try {
      const saved = localStorage.getItem(this._profileKey('crown_extensions'));
      if (!saved) return builtins;
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return builtins;

      const savedMap = new Map(parsed.map(item => [String(item.id || ''), item]));
      const merged = builtins.map(b => {
        const s = savedMap.get(b.id);
        return s ? { ...b, enabled: Boolean(s.enabled) } : b;
      });

      // Append user-installed Chrome Web Store & custom sandboxed extensions (capped at 25 for low memory)
      parsed.forEach(item => {
        const isBuiltin = Boolean(item && (item.builtin || item.builtIn));
        if (item && !isBuiltin && item.id && item.name && merged.length < 30) {
          merged.push({
            id: String(item.id).slice(0, 64),
            name: String(item.name).slice(0, 60),
            version: String(item.version || '1.0.0').slice(0, 20),
            description: String(item.description || 'Sandboxed extension').slice(0, 220),
            builtin: false,
            builtIn: false,
            source: item.source === 'webstore' ? 'webstore' : 'custom',
            storeId: item.storeId ? String(item.storeId).slice(0, 32) : '',
            enabled: Boolean(item.enabled),
            css: String(item.css || '').slice(0, 64000),
            js: String(item.js || '').slice(0, 64000)
          });
        }
      });

      return merged;
    } catch {
      return builtins;
    }
  },

  saveExtensions(extensions) {
    if (this.isIncognitoWindow || !Array.isArray(extensions)) return;
    try {
      localStorage.setItem(this._profileKey('crown_extensions'), JSON.stringify(extensions));
      window.dispatchEvent(new CustomEvent('crown:extensions-updated'));
    } catch (e) {
      console.error('Failed to persist extensions', e);
    }
  },

  // Extract 32-char Chrome Extension ID ([a-p]{32}) from any Chrome Web Store URL or raw ID
  extractChromeId(input) {
    const raw = String(input || '').trim().toLowerCase();
    if (/^[a-p]{32}$/.test(raw)) return raw;
    const match = raw.match(/\/([a-p]{32})(?:[/?#]|$)/);
    return match ? match[1] : null;
  },

  // Unpack a Chrome Web Store .crx (CRX2 / CRX3) or .zip byte array in memory using Web DecompressionStream
  async unpackCrxOrZipBytes(rawBytes, extIdHint = '') {
    const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
    if (bytes.length < 22) {
      throw new Error('Package is empty or not a valid CRX/ZIP archive.');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let zipOffset = 0;

    // Check for 'Cr24' magic bytes (0x43, 0x72, 0x32, 0x34)
    if (bytes[0] === 0x43 && bytes[1] === 0x72 && bytes[2] === 0x32 && bytes[3] === 0x34) {
      const version = view.getUint32(4, true);
      if (version === 3) {
        const headerLen = view.getUint32(8, true);
        zipOffset = 12 + headerLen;
      } else if (version === 2) {
        const pubKeyLen = view.getUint32(8, true);
        const sigLen = view.getUint32(12, true);
        zipOffset = 16 + pubKeyLen + sigLen;
      } else {
        throw new Error(`Unsupported CRX version (${version})`);
      }
    }

    if (zipOffset >= bytes.length || bytes[zipOffset] !== 0x50 || bytes[zipOffset + 1] !== 0x4b) {
      // Fallback: scan for first PK\x03\x04 local file header
      let foundPk = -1;
      for (let i = 0; i < Math.min(bytes.length - 4, 32768); i++) {
        if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
          foundPk = i;
          break;
        }
      }
      if (foundPk === -1) {
        throw new Error('Could not locate embedded ZIP archive inside package.');
      }
      zipOffset = foundPk;
    }

    const zipBytes = bytes.subarray(zipOffset);
    const files = await this._readZipTextFiles(zipBytes);

    const manifestRaw = files.get('manifest.json');
    if (!manifestRaw) {
      throw new Error('Package does not contain a manifest.json file.');
    }

    let manifest;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      throw new Error('Invalid JSON in extension manifest.json.');
    }

    // Resolve __MSG_...__ placeholders from _locales/en/messages.json if present
    let localeMessages = null;
    for (const [pathKey, content] of files.entries()) {
      if (/^_locales\/en(-|_)?[a-z]*\/messages\.json$/i.test(pathKey) || (!localeMessages && /^_locales\/[^/]+\/messages\.json$/i.test(pathKey))) {
        try {
          localeMessages = JSON.parse(content);
          if (pathKey.toLowerCase().startsWith('_locales/en')) break;
        } catch {}
      }
    }

    const resolveI18n = (val) => {
      const str = String(val || '').trim();
      if (!str.startsWith('__MSG_') || !localeMessages) return str;
      const key = str.replace(/^__MSG_/, '').replace(/__$/, '');
      const entry = localeMessages[key] || localeMessages[key.toLowerCase()] || localeMessages[key.toUpperCase()];
      return (entry && entry.message) ? String(entry.message) : str;
    };

    const name = resolveI18n(manifest.name || manifest.short_name || 'Chrome Extension');
    const version = String(manifest.version || '1.0.0');
    const description = resolveI18n(manifest.description || 'Installed from Chrome Web Store.');

    const cssCollected = [];
    const jsCollected = [];

    if (Array.isArray(manifest.content_scripts)) {
      for (const cs of manifest.content_scripts) {
        if (Array.isArray(cs.css)) {
          for (const cssPath of cs.css) {
            const cleanPath = String(cssPath).replace(/^\.?\//, '');
            if (files.has(cleanPath)) cssCollected.push(files.get(cleanPath));
          }
        }
        if (Array.isArray(cs.js)) {
          for (const jsPath of cs.js) {
            const cleanPath = String(jsPath).replace(/^\.?\//, '');
            if (files.has(cleanPath)) jsCollected.push(files.get(cleanPath));
          }
        }
      }
    }

    // If extension uses declarative/popup styles or root scripts without content_scripts, also check common files
    if (cssCollected.length === 0 && jsCollected.length === 0) {
      for (const [p, text] of files.entries()) {
        if (p.endsWith('.css') && !p.includes('popup') && !p.includes('options') && cssCollected.length < 3) {
          cssCollected.push(text);
        } else if ((p.includes('content') || p.includes('inject')) && p.endsWith('.js') && jsCollected.length < 3) {
          jsCollected.push(text);
        }
      }
    }

    return {
      id: extIdHint ? `ext-cws-${extIdHint}` : `ext-pkg-${Date.now()}`,
      name: name.slice(0, 60),
      version: version.slice(0, 20),
      description: description.slice(0, 220),
      builtin: false,
      builtIn: false,
      source: 'webstore',
      storeId: extIdHint || '',
      enabled: true,
      css: cssCollected.join('\n').slice(0, 64000),
      js: jsCollected.join('\n;\n').slice(0, 64000)
    };
  },

  async _readZipTextFiles(zipBytes) {
    const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
    const out = new Map();
    const decoder = new TextDecoder('utf-8');

    // Locate End of Central Directory (EOCD: 0x06054b50) from the end of the buffer
    let eocdPos = -1;
    const minEocdSearch = Math.max(0, zipBytes.length - 65557);
    for (let i = zipBytes.length - 22; i >= minEocdSearch; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdPos = i;
        break;
      }
    }
    if (eocdPos === -1) {
      throw new Error('Invalid ZIP Central Directory.');
    }

    const totalEntries = view.getUint16(eocdPos + 10, true);
    const cdSize = view.getUint32(eocdPos + 12, true);
    const cdOffset = view.getUint32(eocdPos + 16, true);

    let ptr = cdOffset;
    const maxPtr = Math.min(zipBytes.length, cdOffset + cdSize);

    for (let idx = 0; idx < totalEntries && ptr + 46 <= maxPtr; idx++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;

      const compressionMethod = view.getUint16(ptr + 10, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const uncompressedSize = view.getUint32(ptr + 24, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);

      const fileName = decoder.decode(zipBytes.subarray(ptr + 46, ptr + 46 + nameLen)).replace(/\\/g, '/');
      ptr += 46 + nameLen + extraLen + commentLen;

      // Cloudflare-grade Zip-Slip path traversal defense
      if (fileName.includes('..') || fileName.startsWith('/') || fileName.includes('\0')) {
        continue;
      }

      // Only extract text files needed for extensions (manifest.json, messages.json, .js, .css) under 512 KB each
      if (
        uncompressedSize > 524288 ||
        !(fileName === 'manifest.json' || fileName.endsWith('.js') || fileName.endsWith('.css') || fileName.endsWith('messages.json'))
      ) {
        continue;
      }

      if (localHeaderOffset + 30 > zipBytes.length) continue;
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;

      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > zipBytes.length) continue;

      const rawSlice = zipBytes.subarray(dataStart, dataEnd);
      try {
        if (compressionMethod === 0) {
          out.set(fileName, decoder.decode(rawSlice));
        } else if (compressionMethod === 8 && typeof DecompressionStream !== 'undefined') {
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          writer.write(rawSlice);
          writer.close();
          const decompressedBuf = await new Response(ds.readable).arrayBuffer();
          out.set(fileName, decoder.decode(new Uint8Array(decompressedBuf)));
        }
      } catch {}
    }

    return out;
  },

  // Download & Install an extension directly from the Chrome Web Store by URL or 32-char ID
  async installFromChromeWebStore(urlOrId) {
    const extId = this.extractChromeId(urlOrId);
    if (!extId) {
      throw new Error('Please enter a valid Chrome Web Store URL or 32-character Extension ID.');
    }

    let crxBytes = null;

    // 1. Native Tauri Rust fetcher (CORS-free, connection-pooled)
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      const byteArray = await window.__TAURI_INTERNALS__.invoke('fetch_chrome_crx', {
        extensionId: extId
      });
      if (Array.isArray(byteArray) || byteArray instanceof Uint8Array) {
        crxBytes = new Uint8Array(byteArray);
      }
    } else {
      // 2. Web Dev Server Proxy (/api/crx?id=<extId>)
      const resp = await fetch(`/api/crx?id=${encodeURIComponent(extId)}`);
      if (!resp.ok) {
        throw new Error(`Chrome Web Store returned HTTP ${resp.status}`);
      }
      const buf = await resp.arrayBuffer();
      crxBytes = new Uint8Array(buf);
    }

    if (!crxBytes || crxBytes.length < 22) {
      throw new Error('Could not download extension package from Chrome Web Store.');
    }

    const extObj = await this.unpackCrxOrZipBytes(crxBytes, extId);
    const list = this.getExtensions().filter(x => x.id !== extObj.id);
    list.push(extObj);
    this.saveExtensions(list);
    return extObj;
  },

  // Build combined CSS and JS for active extensions + Accessibility settings (injected inside sandboxed iframe)
  buildActiveExtensionPayload() {
    const exts = this.getExtensions().filter(e => e.enabled);
    const settings = this.getSettings();
    const cssParts = [];
    const jsParts = [];

    if (settings.minFontSize && Number(settings.minFontSize) > 0) {
      cssParts.push(`body, p, li, article, span, a, td { font-size: max(${Number(settings.minFontSize)}px, 1em) !important; }`);
    }
    if (settings.highContrast) {
      cssParts.push(`html { filter: contrast(1.22) !important; } a { text-decoration: underline !important; }`);
    }
    if (settings.reducedMotion || settings.energySaver) {
      cssParts.push(`*, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }`);
    }
    if (settings.spellcheck === false) {
      jsParts.push(`try { if (document.body) document.body.spellcheck = false; } catch(e){}`);
    }

    exts.forEach(ext => {
      if (ext.css) cssParts.push(ext.css);
      if (ext.js) jsParts.push(`try { ${ext.js} } catch (err) {}`);
    });

    return {
      css: cssParts.join('\n'),
      js: jsParts.join('\n')
    };
  }
};
