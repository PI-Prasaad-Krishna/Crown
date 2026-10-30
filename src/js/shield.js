// Crown Shield Engine — High-performance native ad, tracker & privacy guard
import { Storage } from './storage.js';

export class CrownShield {
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

    this.siteShields = new Map(); // domain -> boolean
    this.siteStats = new Map(); // domain -> { ads: 0, trackers: 0, params: 0 }
    this.siteBlockedList = new Map(); // domain -> Array<{ target: string, type: 'ad'|'tracker'|'param', time: number }>

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

      console.log(`Crown Shield active: ${this.adDomains.size} ad rules, ${this.trackerDomains.size} tracker rules loaded.`);
    } catch (e) {
      console.warn('Crown Shield init fallback:', e);
    }
  }

  isShieldEnabledForSite(hostname) {
    if (!this.enabled) return false;
    const cleanHost = this._cleanHostname(hostname);
    if (this.siteShields.has(cleanHost)) {
      return this.siteShields.get(cleanHost);
    }
    return true; // enabled by default
  }

  setShieldForSite(hostname, isEnabled) {
    const cleanHost = this._cleanHostname(hostname);
    this.siteShields.set(cleanHost, isEnabled);
  }

  // Intercept and evaluate a network request URL
  evaluateUrl(urlStr, originHost, isIncognito = false) {
    if (!urlStr) return { blocked: false };

    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch {
      return { blocked: false };
    }

    const host = parsed.hostname.toLowerCase();
    const cleanOrigin = this._cleanHostname(originHost || host);
    const siteEnabled = this.isShieldEnabledForSite(cleanOrigin);
    const ephemeral = Boolean(isIncognito || Storage.isIncognitoWindow);

    // 1. URL Query Parameter Stripping
    let cleanUrl = urlStr;
    if (this.stripQueryParams && parsed.search) {
      let modified = false;
      const searchParams = new URLSearchParams(parsed.search);
      for (const key of Array.from(searchParams.keys())) {
        if (this.stripParams.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_') || key.toLowerCase() === 'fbclid') {
          searchParams.delete(key);
          modified = true;
          this._recordBlock(cleanOrigin, 'param', key, ephemeral);
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
      this._recordBlock(cleanOrigin, 'ad', host, ephemeral);
      return { blocked: true, reason: 'ad', cleanUrl };
    }

    // 3. Tracker & Telemetry check
    if (this.blockTrackers && this._matchesList(host, this.trackerDomains)) {
      this._recordBlock(cleanOrigin, 'tracker', host, ephemeral);
      return { blocked: true, reason: 'tracker', cleanUrl };
    }

    return { blocked: false, cleanUrl };
  }

  // Get cosmetic CSS injection to hide ads & cookie banners
  getCosmeticCss(hostname) {
    if (!this.isShieldEnabledForSite(hostname) || !this.blockCookieNotices) return '';
    return `${this.cosmeticSelectors.join(', ')} { display: none !important; visibility: hidden !important; height: 0 !important; }`;
  }

  getSiteStats(hostname) {
    const cleanHost = this._cleanHostname(hostname);
    return this.siteStats.get(cleanHost) || { ads: 0, trackers: 0, params: 0 };
  }

  getSiteBlockedList(hostname) {
    const cleanHost = this._cleanHostname(hostname);
    return this.siteBlockedList.get(cleanHost) || [];
  }

  getGlobalStats() {
    return this.globalStats;
  }

  _recordBlock(originHost, type, target, ephemeral = false) {
    const cleanHost = this._cleanHostname(originHost);
    const stats = this.siteStats.get(cleanHost) || { ads: 0, trackers: 0, params: 0 };

    if (type === 'ad') {
      stats.ads++;
      this.globalStats.adsBlockedTotal++;
      this.globalStats.bandwidthSavedMB = +(this.globalStats.bandwidthSavedMB + 0.15).toFixed(1);
    } else if (type === 'tracker') {
      stats.trackers++;
      this.globalStats.trackersBlockedTotal++;
      this.globalStats.timeSavedSec = +(this.globalStats.timeSavedSec + 0.05).toFixed(2);
    } else if (type === 'param') {
      stats.params++;
      this.globalStats.paramsCleanedTotal = (this.globalStats.paramsCleanedTotal || 0) + 1;
    }

    this.siteStats.set(cleanHost, stats);

    // Save up to 50 blocked records for this site in memory
    const list = this.siteBlockedList.get(cleanHost) || [];
    list.unshift({ target, type, time: Date.now() });
    if (list.length > 50) list.pop();
    this.siteBlockedList.set(cleanHost, list);

    // Never persist telemetry to localStorage when browsing in Incognito
    if (!ephemeral && !Storage.isIncognitoWindow) {
      Storage.saveShieldStats(this.globalStats);
    }
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
        return new URL(host).hostname.toLowerCase().replace('www.', '');
      }
      return host.toLowerCase().replace('www.', '');
    } catch {
      return host.toLowerCase().replace('www.', '');
    }
  }
}

export const shield = new CrownShield();
