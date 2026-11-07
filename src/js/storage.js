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
      language: 'en-US',
      spellcheck: true,
      highContrast: false,
      reducedMotion: false,
      minFontSize: 13,
      showBookmarksBar: true,
      customBackground: '',
      tabPosition: 'top', // 'top' | 'left'
      verticalCollapsed: false,
      accentColor: '#e6ca85', // Crown Gold
      pageZoom: 100 // Zoom percentage (50% to 200%)
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
      if (!['maximum', 'balanced', 'moderate'].includes(sanitized.memorySaverLevel)) {
        sanitized.memorySaverLevel = 'maximum';
      }
      sanitized.maxLiveTabs = sanitized.memorySaverLevel === 'moderate'
        ? 5
        : (sanitized.memorySaverLevel === 'balanced' ? 2 : 1);
      if (!['battery_20', 'unplugged', 'always'].includes(sanitized.energySaverMode)) {
        sanitized.energySaverMode = 'battery_20';
      }
      if (!/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/.test(sanitized.language)) {
        sanitized.language = 'en-US';
      }
      sanitized.minFontSize = Math.max(10, Math.min(24, Number(sanitized.minFontSize) || 13));
      sanitized.pageZoom = Math.max(50, Math.min(200, Number(sanitized.pageZoom) || 100));
      return sanitized;
    } catch {
      return defaults;
    }
  },

  saveSettings(settings) {
    if (this.isIncognitoWindow) return;
    try {
      localStorage.setItem(this._profileKey('crown_settings'), JSON.stringify(settings));
      window.dispatchEvent(new CustomEvent('crown:settings-updated'));
    } catch (e) {
      console.error('Failed to persist settings', e);
    }
  },

  resetSettingsToDefaults() {
    if (this.isIncognitoWindow) return;
    try {
      localStorage.removeItem(this._profileKey('crown_settings'));
      localStorage.removeItem(this._profileKey('crown_extensions'));
      localStorage.removeItem('crown_custom_bg');
      window.dispatchEvent(new CustomEvent('crown:settings-updated'));
    } catch (e) {
      console.error('Failed to reset settings', e);
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

  // Featherweight Sandboxed Extensions Engine (0 MB Idle RAM Overhead)
  getDefaultExtensions() {
    return [
      {
        id: 'ext-dark-reader',
        name: 'Universal Dark Reader',
        version: '1.2.0',
        description: 'Applies an intelligent dark theme to bright websites without slowing down page rendering.',
        builtin: true,
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
        enabled: true,
        css: `pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; line-height: 1.55 !important; }`,
        js: ''
      },
      {
        id: 'ext-focus- typography',
        name: 'ClearType Reading Boost',
        version: '1.0.2',
        description: 'Improves subpixel text legibility, line height, and kerning across dense documentation sites.',
        builtin: true,
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

      // Append user-installed custom sandboxed extensions (capped at 20 for low memory)
      parsed.forEach(item => {
        if (item && !item.builtin && item.id && item.name && merged.length < 25) {
          merged.push({
            id: String(item.id).slice(0, 60),
            name: String(item.name).slice(0, 50),
            version: String(item.version || '1.0.0').slice(0, 16),
            description: String(item.description || 'Custom user extension').slice(0, 180),
            builtin: false,
            enabled: Boolean(item.enabled),
            css: String(item.css || '').slice(0, 16000),
            js: String(item.js || '').slice(0, 16000)
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

  // Build combined CSS and JS for active extensions + Accessibility settings (injected inside sandboxed iframe)
  buildActiveExtensionPayload() {
    const exts = this.getExtensions().filter(e => e.enabled);
    const settings = this.getSettings();
    const cssParts = [];
    const jsParts = [];

    if (settings.minFontSize && settings.minFontSize > 13) {
      cssParts.push(`body, p, li, article { font-size: max(${Number(settings.minFontSize)}px, 1em) !important; }`);
    }
    if (settings.highContrast) {
      cssParts.push(`body { contrast: 1.25 !important; } a { text-decoration: underline !important; }`);
    }
    if (settings.reducedMotion || settings.energySaver) {
      cssParts.push(`*, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }`);
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
