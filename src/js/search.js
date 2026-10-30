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
