// Crown Search & Omnibox Parser (Live Multi-Provider OpenSearch Autocomplete + HTTPS-Everywhere)
import { Storage } from './storage.js';

export const SearchProviders = {
  google: {
    name: 'Google',
    url: 'https://www.google.com/search?q=%s'
  },
  brave: {
    name: 'Brave Search',
    url: 'https://search.brave.com/search?q=%s'
  },
  duckduckgo: {
    name: 'DuckDuckGo',
    url: 'https://duckduckgo.com/?q=%s'
  },
  bing: {
    name: 'Bing',
    url: 'https://www.bing.com/search?q=%s'
  },
  startpage: {
    name: 'Startpage',
    url: 'https://www.startpage.com/do/dsearch?query=%s'
  },
  ecosia: {
    name: 'Ecosia',
    url: 'https://www.ecosia.org/search?q=%s'
  }
};

export class SearchManager {
  constructor() {
    this.currentProvider = 'duckduckgo';
    this.customUrl = '';
    this.suggestionCache = new Map(); // provider:query -> string[]
  }

  _sanitizeCustomSearchUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return '';
    try {
      const parsed = new URL(trimmed.replace('%s', 'query'));
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return trimmed;
      }
    } catch {
      // Ignore malformed custom URL
    }
    return '';
  }

  init() {
    const settings = Storage.getSettings();
    this.currentProvider = settings.searchEngine || settings.defaultEngine || 'duckduckgo';
    this.customUrl = this._sanitizeCustomSearchUrl(settings.customSearchUrl || settings.customEngineUrl || '');
  }

  setProvider(providerId, customUrl = '') {
    if (SearchProviders[providerId] || providerId === 'custom') {
      this.currentProvider = providerId;
      const settings = Storage.getSettings();
      settings.searchEngine = providerId;
      settings.defaultEngine = providerId;
      if (customUrl) {
        const safeCustom = this._sanitizeCustomSearchUrl(customUrl);
        if (safeCustom) {
          this.customUrl = safeCustom;
          settings.customSearchUrl = safeCustom;
          settings.customEngineUrl = safeCustom;
        }
      }
      Storage.saveSettings(settings);
    }
  }

  setEngine(providerId, customUrl = '') {
    this.setProvider(providerId, customUrl);
  }

  getCurrentEngine() {
    return SearchProviders[this.currentProvider] || { name: 'Custom Search', url: this.customUrl };
  }

  // Parse both OpenSearch [query, ["s1", "s2"]] and DuckDuckGo [{"phrase": "s1"}] payloads
  _extractSuggestionsFromPayload(data) {
    if (!data) return [];
    const out = [];

    if (Array.isArray(data[1])) {
      for (const item of data[1]) {
        if (typeof item === 'string' && item.trim()) {
          out.push(item.trim());
          if (out.length >= 6) return out;
        }
      }
    } else if (Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item.phrase === 'string' && item.phrase.trim()) {
          out.push(item.phrase.trim());
          if (out.length >= 6) return out;
        }
      }
    }
    return out;
  }

  // Fetch 100% real, live search engine query suggestions (Zero hardcoded suffix templates)
  async getSuggestions(rawQuery) {
    const q = (rawQuery || '').trim();
    if (!q || q.length > 140) return [];

    const cacheKey = `${this.currentProvider}:${q.toLowerCase()}`;
    if (this.suggestionCache.has(cacheKey)) {
      return this.suggestionCache.get(cacheKey);
    }

    let results = [];

    // 1. Native Tauri Rust command (Connection-pooled, CORS-free, supports Google/DDG/Brave/Bing OpenSearch)
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      try {
        const res = await window.__TAURI_INTERNALS__.invoke('fetch_search_suggestions', {
          query: q,
          provider: this.currentProvider
        });
        if (Array.isArray(res) && res.length > 0) {
          results = res.slice(0, 6);
        }
      } catch {
        // Fall through to web suggest endpoints
      }
    }

    // 2. Web Dev Server Proxy (/api/suggest -> Google OpenSearch, /api/ddg-suggest -> DuckDuckGo AC)
    if (results.length === 0) {
      results = await this._fetchWebLiveSuggestions(q);
    }

    // Only cache genuine non-empty live suggestions so transient network blips don't stick
    if (results.length > 0) {
      if (this.suggestionCache.size > 100) {
        const oldestKey = this.suggestionCache.keys().next().value;
        this.suggestionCache.delete(oldestKey);
      }
      this.suggestionCache.set(cacheKey, results);
    }

    return results;
  }

  async _fetchWebLiveSuggestions(query) {
    const encoded = encodeURIComponent(query);
    const endpoints = [
      `/api/suggest?client=firefox&q=${encoded}`,
      `/api/ddg-suggest?q=${encoded}&type=list`,
      `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&limit=6&search=${encoded}`
    ];

    for (const url of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1100);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) continue;

        const contentType = resp.headers.get('content-type') || '';
        if (!contentType.includes('json') && !contentType.includes('javascript')) continue;

        const data = await resp.json();
        const extracted = this._extractSuggestionsFromPayload(data);
        if (extracted.length > 0) {
          return extracted;
        }
      } catch {
        // Try next live endpoint
      }
    }
    return [];
  }

  parseInput(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) return 'about:blank';

    // Block dangerous URI schemes (treat as plain search query)
    if (/^(javascript|data|vbscript|file|blob):/i.test(trimmed)) {
      return this.getSearchUrl(trimmed);
    }

    // DuckDuckGo-style Bang syntax shortcuts (!g, !yt, !gh, !w, !d, !b, !bing, !r)
    const bangMatch = trimmed.match(/^!([a-zA-Z0-9]+)\s+(.+)$/);
    if (bangMatch) {
      const bang = bangMatch[1].toLowerCase();
      const q = encodeURIComponent(bangMatch[2].trim());
      switch (bang) {
        case 'g': return `https://www.google.com/search?q=${q}`;
        case 'd':
        case 'ddg': return `https://duckduckgo.com/?q=${q}`;
        case 'b':
        case 'brave': return `https://search.brave.com/search?q=${q}`;
        case 'bing': return `https://www.bing.com/search?q=${q}`;
        case 'yt': return `https://www.youtube.com/results?search_query=${q}`;
        case 'gh': return `https://github.com/search?q=${q}`;
        case 'w':
        case 'wiki': return `https://en.wikipedia.org/wiki/Special:Search?search=${q}`;
        case 'r':
        case 'reddit': return `https://www.reddit.com/search/?q=${q}`;
      }
    }

    if (trimmed.startsWith('crown://') || trimmed === 'about:blank') {
      return trimmed === 'about:blank' ? 'crown://newtab' : trimmed;
    }

    // Direct localhost or loopback IP address (preserve http:// for local dev servers)
    if (/^(http:\/\/|https:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(trimmed)) {
      return trimmed.startsWith('http') ? trimmed : `http://${trimmed}`;
    }

    // Standard URL format check (e.g. domain.com, sub.domain.org/path)
    const hasTldRegex = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/;
    if (hasTldRegex.test(trimmed) && !trimmed.includes(' ')) {
      const httpsEverywhere = Storage.getSettings().httpsEverywhere !== false;
      if (/^http:\/\//i.test(trimmed)) {
        return httpsEverywhere ? trimmed.replace(/^http:\/\//i, 'https://') : trimmed;
      }
      return /^https:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    }

    // Default to search query
    return this.getSearchUrl(trimmed);
  }

  getSearchUrl(query) {
    const encoded = encodeURIComponent(query);
    if (this.currentProvider === 'custom') {
      const safeCustom = this._sanitizeCustomSearchUrl(this.customUrl);
      if (safeCustom) {
        return safeCustom.replace('%s', encoded);
      }
    }
    const provider = SearchProviders[this.currentProvider] || SearchProviders.google;
    return provider.url.replace('%s', encoded);
  }
}

export const searchManager = new SearchManager();
