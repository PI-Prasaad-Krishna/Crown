// Crown Search & Omnibox Parser
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
  }
};

export class SearchManager {
  constructor() {
    this.currentProvider = 'google';
    this.customUrl = '';
    this.suggestionCache = new Map(); // query -> string[]
    this._jsonpCounter = 0;
  }

  init() {
    const settings = Storage.getSettings();
    this.currentProvider = settings.searchEngine || 'google';
    this.customUrl = settings.customSearchUrl || '';
  }

  setProvider(providerId) {
    if (SearchProviders[providerId] || providerId === 'custom') {
      this.currentProvider = providerId;
      const settings = Storage.getSettings();
      settings.searchEngine = providerId;
      Storage.saveSettings(settings);
    }
  }

  // Fetch live search engine query suggestions (Native Rust Tauri command + JSONP & smart fallback)
  async getSuggestions(rawQuery) {
    const q = (rawQuery || '').trim();
    if (!q || q.length > 140) return [];

    const key = q.toLowerCase();
    if (this.suggestionCache.has(key)) {
      return this.suggestionCache.get(key);
    }

    let results = [];

    // 1. Native Tauri Rust command (CORS-free, 1.5s timeout)
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      try {
        const res = await window.__TAURI_INTERNALS__.invoke('fetch_search_suggestions', { query: q });
        if (Array.isArray(res) && res.length > 0) {
          results = res.slice(0, 6);
        }
      } catch {
        // Fallback below
      }
    }

    // 2. Web mode JSONP suggest fallback (if not in Incognito window)
    if (results.length === 0 && !Storage.isIncognitoWindow) {
      try {
        results = await this._fetchJsonpSuggestions(q);
      } catch {
        // Fallback below
      }
    }

    // 3. Smart contextual completions if offline or in strict mode
    if (results.length === 0) {
      results = this._buildSmartFallbackSuggestions(q);
    }

    if (this.suggestionCache.size > 80) {
      const oldestKey = this.suggestionCache.keys().next().value;
      this.suggestionCache.delete(oldestKey);
    }
    this.suggestionCache.set(key, results);
    return results;
  }

  _fetchJsonpSuggestions(query) {
    return new Promise((resolve) => {
      const cbName = `__crownSuggestCb_${++this._jsonpCounter}_${Date.now()}`;
      const script = document.createElement('script');
      let settled = false;

      const cleanup = () => {
        try { delete window[cbName]; } catch { window[cbName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve([]);
        }
      }, 900);

      window[cbName] = (data) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        const list = Array.isArray(data?.[1])
          ? data[1].filter(x => typeof x === 'string' && x.trim()).slice(0, 6)
          : [];
        resolve(list);
      };

      script.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve([]);
        }
      };

      script.src = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}&callback=${cbName}`;
      document.head.appendChild(script);
    });
  }

  _buildSmartFallbackSuggestions(query) {
    const q = query.trim();
    const lower = q.toLowerCase();
    const commonSites = [
      'github.com', 'youtube.com', 'google.com', 'reddit.com', 'wikipedia.org',
      'stackoverflow.com', 'developer.mozilla.org', 'news.ycombinator.com', 'duckduckgo.com'
    ];
    const siteMatches = commonSites
      .filter(s => s.startsWith(lower) || s.includes(lower))
      .map(s => `https://${s}`);

    if (!q.includes(' ') && siteMatches.length > 0) {
      return [...siteMatches.slice(0, 2), `${q} documentation`, `${q} tutorial`, `${q} latest news`].slice(0, 5);
    }
    return [
      q,
      `${q} guide`,
      `${q} tutorial`,
      `${q} reddit`,
      `${q} vs alternatives`
    ].slice(0, 5);
  }

  parseInput(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) return 'about:blank';

    // Block dangerous URI schemes (treat as plain search query)
    if (/^(javascript|data|vbscript|file|blob):/i.test(trimmed)) {
      return this.getSearchUrl(trimmed);
    }

    if (trimmed.startsWith('crown://') || trimmed === 'about:blank') {
      return trimmed === 'about:blank' ? 'crown://newtab' : trimmed;
    }

    // Direct localhost or IP address
    if (/^(http:\/\/|https:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(trimmed)) {
      return trimmed.startsWith('http') ? trimmed : `http://${trimmed}`;
    }

    // Standard URL format check (e.g. domain.com, sub.domain.org/path)
    const hasTldRegex = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/;
    if (hasTldRegex.test(trimmed) && !trimmed.includes(' ')) {
      return trimmed.startsWith('http://') || trimmed.startsWith('https://') 
        ? trimmed 
        : `https://${trimmed}`;
    }

    // Default to search query
    return this.getSearchUrl(trimmed);
  }

  getSearchUrl(query) {
    const encoded = encodeURIComponent(query);
    if (this.currentProvider === 'custom' && this.customUrl) {
      return this.customUrl.replace('%s', encoded);
    }
    const provider = SearchProviders[this.currentProvider] || SearchProviders.google;
    return provider.url.replace('%s', encoded);
  }
}

export const searchManager = new SearchManager();
