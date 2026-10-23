// Crisp Shield Engine — Brave-inspired high performance ad, tracker & privacy shield
import { Storage } from './storage.js';

export class CrispShield {
  constructor() {
    this.enabled = true;
    this.blockAds = true;
    this.blockTrackers = true;
    this.stripQueryParams = true;
    this.blockCookieNotices = true;

    this.adDomains = new Set();
    this.trackerDomains = new Set();
    this.cosmeticSelectors = [];
    this.stripParams = new Set();

    this.siteShields = new Map(); // domain -> boolean (enabled/disabled)
    this.siteStats = new Map(); // domain -> { ads: 0, trackers: 0 }
    
    this.globalStats = Storage.getShieldStats();
  }

  async init() {
    try {
      // Load rules from bundled assets
      const [adRes, privRes, queryRes] = await Promise.all([
        fetch('./assets/rules/adblock-rules.json').then(r => r.json()).catch(() => null),
        fetch('./assets/rules/privacy-rules.json').then(r => r.json()).catch(() => null),
        fetch('./assets/rules/query-filter.json').then(r => r.json()).catch(() => null)
      ]);

      if (adRes) {
        adRes.domains.forEach(d => this.adDomains.add(d.toLowerCase()));
        this.cosmeticSelectors = adRes.cosmeticSelectors || [];
      }
      if (privRes) {
        privRes.domains.forEach(d => this.trackerDomains.add(d.toLowerCase()));
      }
      if (queryRes) {
        queryRes.stripped_params.forEach(p => this.stripParams.add(p.toLowerCase()));
      }

      const settings = Storage.getSettings();
      this.enabled = settings.shieldsEnabled !== false;
      this.blockAds = settings.blockAds !== false;
      this.blockTrackers = settings.blockTrackers !== false;
      this.stripQueryParams = settings.stripQueryParams !== false;
      this.blockCookieNotices = settings.blockCookieNotices !== false;

      console.log(`Crisp Shield active: ${this.adDomains.size} ad rules, ${this.trackerDomains.size} tracker rules loaded.`);
    } catch (e) {
      console.warn('Crisp Shield init fallback:', e);
    }
  }

  isShieldEnabledForSite(hostname) {
    if (!this.enabled) return false;
    const cleanHost = this._cleanHostname(hostname);
    if (this.siteShields.has(cleanHost)) {
      return this.siteShields.get(cleanHost);
    }
    return true; // default enabled
  }

  setShieldForSite(hostname, isEnabled) {
    const cleanHost = this._cleanHostname(hostname);
    this.siteShields.set(cleanHost, isEnabled);
  }

  // Intercept and evaluate a network request URL
  // Returns: { blocked: boolean, reason?: 'ad' | 'tracker', cleanUrl?: string }
  evaluateUrl(urlStr, originHost) {
    if (!urlStr) return { blocked: false };

    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch {
      return { blocked: false };
    }

    const host = parsed.hostname.toLowerCase();
    const siteEnabled = this.isShieldEnabledForSite(originHost || host);

    // 1. URL Query Parameter Stripping (like Brave's debouncing)
    let cleanUrl = urlStr;
    if (this.stripQueryParams && parsed.search) {
      let modified = false;
      const searchParams = new URLSearchParams(parsed.search);
      for (const key of Array.from(searchParams.keys())) {
        if (this.stripParams.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
          searchParams.delete(key);
          modified = true;
        }
      }
      if (modified) {
        parsed.search = searchParams.toString();
        cleanUrl = parsed.toString();
      }
    }

    if (!siteEnabled) {
      return { blocked: false, cleanUrl };
    }

    // 2. Ad-blocking check
    if (this.blockAds && this._matchesList(host, this.adDomains)) {
      this._recordBlock(originHost || host, 'ad');
      return { blocked: true, reason: 'ad', cleanUrl };
    }

    // 3. Tracker & Telemetry check
    if (this.blockTrackers && this._matchesList(host, this.trackerDomains)) {
      this._recordBlock(originHost || host, 'tracker');
      return { blocked: true, reason: 'tracker', cleanUrl };
    }

    return { blocked: false, cleanUrl };
  }

  // Get cosmetic CSS injection to hide ads & cookie banners
  getCosmeticCss(hostname) {
    if (!this.isShieldEnabledForSite(hostname)) return '';
    return `${this.cosmeticSelectors.join(', ')} { display: none !important; visibility: hidden !important; height: 0 !important; }`;
  }

  getSiteStats(hostname) {
    const cleanHost = this._cleanHostname(hostname);
    return this.siteStats.get(cleanHost) || { ads: 0, trackers: 0 };
  }

  getGlobalStats() {
    return this.globalStats;
  }

  _recordBlock(hostname, type) {
    const cleanHost = this._cleanHostname(hostname);
    const stats = this.siteStats.get(cleanHost) || { ads: 0, trackers: 0 };
    if (type === 'ad') {
      stats.ads++;
      this.globalStats.adsBlockedTotal++;
      this.globalStats.bandwidthSavedMB = +(this.globalStats.bandwidthSavedMB + 0.15).toFixed(1);
    } else if (type === 'tracker') {
      stats.trackers++;
      this.globalStats.trackersBlockedTotal++;
      this.globalStats.timeSavedSec = +(this.globalStats.timeSavedSec + 0.05).toFixed(2);
    }
    this.siteStats.set(cleanHost, stats);
    Storage.saveShieldStats(this.globalStats);
  }

  _matchesList(host, set) {
    if (set.has(host)) return true;
    const parts = host.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parentDomain = parts.slice(i).join('.');
      if (set.has(parentDomain)) return true;
    }
    return false;
  }

  _cleanHostname(host) {
    if (!host) return 'newtab';
    try {
      if (host.includes('://')) {
        return new URL(host).hostname.toLowerCase();
      }
      return host.toLowerCase();
    } catch {
      return host.toLowerCase();
    }
  }
}

export const shield = new CrispShield();
