// Crown Browser — Core Application Controller
import { shield } from './shield.js';
import { searchManager } from './search.js';
import { Storage } from './storage.js';
import { TabEngine } from './tabs.js';
import { InternalViews } from './internal-views.js';
import { downloadManager } from './downloads.js';

class CrownApp {
  constructor() {
    this.tabEngine = new TabEngine(this);
    this.frames = new Map(); // tabId -> iframe
  }

  async init() {
    searchManager.init();
    await shield.init();
    downloadManager.init();
    this.tabEngine.init();

    this.bindEvents();
    this.applyCustomBackground();
    this.applyAccentColor();
    this.renderShortcuts();
    this.renderDefenseHub();
    this.updateProfileUI();

    // Create default first tab
    this.tabEngine.createTab('crown://newtab');
  }

  // Frame creation for tabs
  createFrame(tabId) {
    const contentArea = document.getElementById('crown-content-area');
    const iframe = document.createElement('iframe');
    iframe.id = `iframe-${tabId}`;
    iframe.className = 'webview-frame';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    contentArea.appendChild(iframe);
    this.frames.set(tabId, iframe);
    return iframe;
  }

  removeFrame(tabId) {
    const iframe = this.frames.get(tabId) || document.getElementById(`iframe-${tabId}`);
    if (iframe) iframe.remove();
    this.frames.delete(tabId);
  }

  // Switch Active Tab
  syncActiveTab(tab) {
    if (!tab) return;

    const appEl = document.getElementById('crown-app');
    const dashboard = document.getElementById('new-tab-dashboard');
    const internalMount = document.getElementById('internal-views-mount');
    const omnibox = document.getElementById('omnibox-input');
    const incognitoBadge = document.getElementById('incognito-badge');

    // Toggle Incognito Theme class on app
    appEl.classList.toggle('theme-incognito', !!tab.isIncognito);
    if (incognitoBadge) {
      incognitoBadge.style.display = tab.isIncognito ? 'flex' : 'none';
    }

    // Toggle frames: only active when visiting an external webpage
    const isNormalWebpage = (tab.url !== 'crown://newtab' && !InternalViews.isInternalUrl(tab.url));
    document.querySelectorAll('.webview-frame').forEach(f => {
      f.classList.toggle('active', f.id === `iframe-${tab.id}` && isNormalWebpage);
    });

    // Handle internal views vs NTP vs external iframe
    if (tab.url === 'crown://newtab') {
      dashboard.style.display = 'flex';
      internalMount.style.display = 'none';
      omnibox.value = '';
      this.renderDefenseHub();
    } else if (InternalViews.isInternalUrl(tab.url)) {
      dashboard.style.display = 'none';
      internalMount.style.display = 'block';
      omnibox.value = tab.url;
      InternalViews.render(internalMount, tab.url, (navUrl) => this.navigateTo(navUrl, tab.id));
    } else {
      dashboard.style.display = 'none';
      internalMount.style.display = 'none';
      omnibox.value = tab.url;
    }

    this.updateShieldButton();
  }

  // Navigation
  navigateTo(inputUrl, tabId = this.tabEngine.activeTabId) {
    const tab = this.tabEngine.tabs.find(t => t.id === tabId);
    if (!tab) return;

    const parsed = searchManager.parseInput(inputUrl);
    const evaluation = shield.evaluateUrl(parsed, tab.url);
    const finalUrl = evaluation.cleanUrl || parsed;

    tab.url = finalUrl;
    tab.title = this._getTitleForUrl(finalUrl);
    tab.favicon = this.tabEngine._getFaviconSvg(finalUrl, tab.isIncognito);

    // Save to history (gated: never saves if incognito or internal newtab)
    if (finalUrl !== 'crown://newtab' && !tab.isIncognito) {
      Storage.addHistory({ title: tab.title, url: finalUrl, isIncognito: false });
    }

    const iframe = document.getElementById(`iframe-${tab.id}`);
    const dashboard = document.getElementById('new-tab-dashboard');
    const internalMount = document.getElementById('internal-views-mount');
    const isCurrent = (tabId === this.tabEngine.activeTabId);

    if (finalUrl === 'crown://newtab') {
      if (isCurrent) {
        dashboard.style.display = 'flex';
        internalMount.style.display = 'none';
        this.renderDefenseHub();
      }
      if (iframe) {
        iframe.classList.remove('active');
        iframe.src = 'about:blank';
      }
    } else if (InternalViews.isInternalUrl(finalUrl)) {
      if (isCurrent) {
        dashboard.style.display = 'none';
        internalMount.style.display = 'block';
        InternalViews.render(internalMount, finalUrl, (navUrl) => this.navigateTo(navUrl, tabId));
      }
      if (iframe) {
        iframe.classList.remove('active');
        iframe.src = 'about:blank';
      }
    } else {
      if (isCurrent) {
        dashboard.style.display = 'none';
        internalMount.style.display = 'none';
      }
      if (iframe) {
        if (isCurrent) iframe.classList.add('active');
        iframe.src = finalUrl;
      }
    }

    if (isCurrent) {
      const omnibox = document.getElementById('omnibox-input');
      omnibox.value = finalUrl === 'crown://newtab' ? '' : finalUrl;
      this.updateShieldButton();
    }

    this.tabEngine.render();
  }

  goBack() {
    const iframe = document.getElementById(`iframe-${this.tabEngine.activeTabId}`);
    try { if (iframe) iframe.contentWindow.history.back(); } catch(e){}
  }

  goForward() {
    const iframe = document.getElementById(`iframe-${this.tabEngine.activeTabId}`);
    try { if (iframe) iframe.contentWindow.history.forward(); } catch(e){}
  }

  reload() {
    const tab = this.tabEngine.getActiveTab();
    if (tab) this.navigateTo(tab.url);
  }

  // Render Shortcuts with official brand vectors
  renderShortcuts() {
    const grid = document.getElementById('ntp-shortcuts-grid');
    if (!grid) return;

    const shortcuts = [
      {
        title: 'Google',
        url: 'https://www.google.com',
        svg: `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>`
      },
      {
        title: 'YouTube',
        url: 'https://www.youtube.com',
        svg: `<svg viewBox="0 0 24 24" width="22" height="22" fill="#FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`
      },
      {
        title: 'GitHub',
        url: 'https://github.com',
        svg: `<svg viewBox="0 0 24 24" width="22" height="22" fill="#ffffff"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>`
      },
      {
        title: 'Reddit',
        url: 'https://reddit.com',
        svg: `<svg viewBox="0 0 24 24" width="22" height="22" fill="#FF4500"><circle cx="12" cy="12" r="10"/><path fill="#FFF" d="M12 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm5.5 6.5a1.5 1.5 0 0 0-2.4-.9c-.9-.4-2-.7-3.1-.7v-3l2.2.5a1 1 0 1 0 .2-.9l-2.8-.6a.5.5 0 0 0-.6.4l-.4 3.6c-1.2 0-2.3.3-3.2.7a1.5 1.5 0 1 0-1.4 2.4c0 .3 0 .6.1.9 0 2.2 2.7 4 6 4s6-1.8 6-4c0-.3 0-.6-.1-.9a1.5 1.5 0 0 0 1.5-1.4zM9.5 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm5 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm-4.8 2.2a.5.5 0 0 1 .7 0c.5.5 1.2.7 1.6.7s1.1-.2 1.6-.7a.5.5 0 1 1 .7.7c-.7.7-1.5 1-2.3 1s-1.6-.3-2.3-1a.5.5 0 0 1 0-.7z"/></svg>`
      },
      {
        title: 'Wikipedia',
        url: 'https://wikipedia.org',
        svg: `<svg viewBox="0 0 24 24" width="22" height="22" fill="#ffffff"><path d="M12.09 13.12 9.5 5H7.13L3 17.58h2.09l1.15-3.5h4.16l.95 3.5h2.17l4.08-12.58h-2.12l-3.39 8.12zm-4.14-1.68L9.5 6.94l1.55 4.5H7.95zm11.23-6.44h-2.09L21.2 17.58h2.09L19.18 5z"/></svg>`
      }
    ];

    grid.innerHTML = '';
    shortcuts.forEach(s => {
      const tile = document.createElement('div');
      tile.className = 'shortcut-tile';
      tile.innerHTML = `
        <div class="shortcut-icon-circle">${s.svg}</div>
        <div class="shortcut-title">${this._escape(s.title)}</div>
      `;
      tile.onclick = () => this.navigateTo(s.url);
      grid.appendChild(tile);
    });
  }

  // Render Crown Defense Hub (Real, dynamic telemetry)
  renderDefenseHub() {
    const stats = shield.getGlobalStats();
    const adsEl = document.getElementById('metric-ads-blocked');
    const trackersEl = document.getElementById('metric-trackers-blocked');
    const paramsEl = document.getElementById('metric-params-cleaned');
    const dataEl = document.getElementById('metric-data-saved');

    if (adsEl) adsEl.textContent = (stats.adsBlockedTotal || 0).toLocaleString();
    if (trackersEl) trackersEl.textContent = (stats.trackersBlockedTotal || 0).toLocaleString();
    if (paramsEl) paramsEl.textContent = (stats.paramsCleanedTotal || 0).toLocaleString();
    if (dataEl) dataEl.textContent = `${(stats.bandwidthSavedMB || 0.0).toFixed(1)} MB`;
  }

  updateShieldButton() {
    const tab = this.tabEngine.getActiveTab();
    const domain = tab ? shield._cleanHostname(tab.url) : 'newtab';
    const isEnabled = shield.isShieldEnabledForSite(domain);
    const stats = shield.getSiteStats(domain);
    const blockedList = shield.getSiteBlockedList(domain);

    const btn = document.getElementById('shield-toggle-btn');
    const badge = document.getElementById('shield-badge-count');

    if (btn) btn.classList.toggle('shield-off', !isEnabled);
    const totalCount = (stats.ads + stats.trackers + stats.params);
    if (badge) badge.textContent = isEnabled ? totalCount : 'OFF';

    const domainEl = document.getElementById('shield-site-domain');
    const adsEl = document.getElementById('site-ads-count');
    const trackersEl = document.getElementById('site-trackers-count');
    const paramsEl = document.getElementById('site-params-count');
    const siteSwitch = document.getElementById('site-shield-switch');
    const statusText = document.getElementById('shield-site-status');
    const listContainer = document.getElementById('shield-blocked-domains-list');

    if (domainEl) domainEl.textContent = domain;
    if (adsEl) adsEl.textContent = stats.ads || 0;
    if (trackersEl) trackersEl.textContent = stats.trackers || 0;
    if (paramsEl) paramsEl.textContent = stats.params || 0;
    if (siteSwitch) siteSwitch.checked = isEnabled;
    if (statusText) statusText.textContent = isEnabled ? 'Shields Active' : 'Shields Paused';

    // Render intercepted domains list
    if (listContainer) {
      if (blockedList.length === 0) {
        listContainer.innerHTML = '<span class="no-intercepts-text">No trackers on this page</span>';
      } else {
        listContainer.innerHTML = blockedList.slice(0, 15).map(item => `
          <div class="blocked-item-chip">
            <span class="chip-type type-${item.type}">${item.type}</span>
            <span class="chip-target" title="${this._escape(item.target)}">${this._escape(item.target)}</span>
          </div>
        `).join('');
      }
    }
  }

  // Appearance & Themes
  applyCustomBackground() {
    const ntp = document.getElementById('new-tab-dashboard');
    if (!ntp) return;
    const customBg = localStorage.getItem('crown_custom_bg');
    if (customBg) {
      ntp.style.backgroundImage = `url('${customBg}')`;
      ntp.style.backgroundColor = 'transparent';
    } else {
      ntp.style.backgroundImage = 'none';
      ntp.style.backgroundColor = 'var(--cr-ntp-bg)';
    }
  }

  applyAccentColor() {
    const accent = Storage.getSettings().accentColor || '#e6ca85';
    document.documentElement.style.setProperty('--cr-accent-gold', accent);
  }

  // Profile Management UI
  updateProfileUI() {
    const activeId = Storage.getActiveProfileId();
    const profiles = Storage.getProfiles();
    const current = profiles.find(p => p.id === activeId) || profiles[0];
    const chip = document.getElementById('profile-avatar-chip');
    if (chip && current) {
      chip.textContent = current.avatar;
    }
  }

  // Event Bindings
  bindEvents() {
    // Omnibox
    const omnibox = document.getElementById('omnibox-input');
    omnibox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.navigateTo(omnibox.value);
        omnibox.blur();
      }
    });

    // NTP Search box
    const ntpSearch = document.getElementById('ntp-search-input');
    ntpSearch?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.navigateTo(ntpSearch.value);
      }
    });

    // Nav controls
    document.getElementById('nav-back-btn')?.addEventListener('click', () => this.goBack());
    document.getElementById('nav-forward-btn')?.addEventListener('click', () => this.goForward());
    document.getElementById('nav-reload-btn')?.addEventListener('click', () => this.reload());
    document.getElementById('nav-home-btn')?.addEventListener('click', () => this.navigateTo('crown://newtab'));

    // Tab Orientation toggle button in toolbar
    document.getElementById('toggle-tab-orientation-btn')?.addEventListener('click', () => {
      this.tabEngine.toggleLayout();
    });

    // Sidebar collapse toggle in left tabs mode
    document.getElementById('sidebar-collapse-btn')?.addEventListener('click', () => {
      this.tabEngine.toggleSidebarCollapse();
    });

    // Incognito toggle button
    document.getElementById('incognito-toggle-btn')?.addEventListener('click', () => {
      this.tabEngine.createTab('crown://newtab', true);
    });

    // Bookmarks Bar internal links
    document.getElementById('bm-history-shortcut')?.addEventListener('click', () => {
      this.navigateTo('crown://history');
    });
    document.getElementById('bm-bookmarks-shortcut')?.addEventListener('click', () => {
      this.navigateTo('crown://bookmarks');
    });
    document.querySelectorAll('.bookmark-item[data-url]').forEach(el => {
      el.addEventListener('click', () => this.navigateTo(el.dataset.url));
    });

    // Shield Panel popover
    const shieldBtn = document.getElementById('shield-toggle-btn');
    const shieldPanel = document.getElementById('shield-panel');
    shieldBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      shieldPanel.classList.toggle('open');
    });

    document.getElementById('site-shield-switch')?.addEventListener('change', (e) => {
      const tab = this.tabEngine.getActiveTab();
      if (tab) {
        const domain = shield._cleanHostname(tab.url);
        shield.setShieldForSite(domain, e.target.checked);
        this.updateShieldButton();
        this.reload();
      }
    });

    // Profiles Modal
    const profileBtn = document.getElementById('profile-switcher-btn');
    const profileModal = document.getElementById('profile-modal-overlay');
    const profileCloseBtn = document.getElementById('profile-modal-close-btn');

    profileBtn?.addEventListener('click', () => {
      this._renderProfilesList();
      profileModal.classList.add('open');
    });
    profileCloseBtn?.addEventListener('click', () => profileModal.classList.remove('open'));

    document.getElementById('add-profile-btn')?.addEventListener('click', () => {
      const input = document.getElementById('new-profile-name-input');
      const name = input.value.trim();
      const initial = name.charAt(0).toUpperCase();
      const newP = { id: `profile-${Date.now()}`, name, avatar: initial, color: '#e6ca85' };
      profiles.push(newP);
      try { localStorage.setItem('crown_profiles', JSON.stringify(profiles)); } catch(e){}
      input.value = '';
      this._renderProfilesList();
    });

    // Customize Modal
    const custBtn = document.getElementById('customize-btn');
    const menuBtn = document.getElementById('settings-menu-btn');
    const custModal = document.getElementById('customize-modal-overlay');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const saveBtn = document.getElementById('save-customize-btn');
    const resetBgBtn = document.getElementById('reset-bg-btn');
    const bgUrlInput = document.getElementById('bg-url-input');
    const bgFileInput = document.getElementById('bg-file-input');

    const openCustomize = () => {
      custModal.classList.add('open');
      bgUrlInput.value = localStorage.getItem('crown_custom_bg') || '';
      const searchSelect = document.getElementById('search-engine-select');
      if (searchSelect) searchSelect.value = searchManager.currentProvider;
    };

    custBtn?.addEventListener('click', openCustomize);
    menuBtn?.addEventListener('click', openCustomize);
    modalCloseBtn?.addEventListener('click', () => custModal.classList.remove('open'));

    // Modal tabs navigation
    document.querySelectorAll('.modal-tab-btn').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.customize-tab-pane').forEach(p => p.classList.remove('active'));
        tabBtn.classList.add('active');
        document.getElementById(`pane-${tabBtn.dataset.tab}`)?.classList.add('active');
      });
    });

    // Orientation selector inside modal
    document.getElementById('choose-top-tabs')?.addEventListener('click', () => {
      this.tabEngine.setLayout('top');
    });
    document.getElementById('choose-left-tabs')?.addEventListener('click', () => {
      this.tabEngine.setLayout('left');
    });

    // Accent palette clicks
    document.querySelectorAll('.palette-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        const color = swatch.dataset.accent;
        const settings = Storage.getSettings();
        settings.accentColor = color;
        Storage.saveSettings(settings);
        this.applyAccentColor();
      });
    });

    // Search Provider select
    document.getElementById('search-engine-select')?.addEventListener('change', (e) => {
      searchManager.setProvider(e.target.value);
    });

    // Save Customize
    saveBtn?.addEventListener('click', () => {
      const url = bgUrlInput.value.trim();
      if (url) localStorage.setItem('crown_custom_bg', url);
      this.applyCustomBackground();
      custModal.classList.remove('open');
    });

    // File upload wallpaper
    bgFileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          localStorage.setItem('crown_custom_bg', event.target.result);
          this.applyCustomBackground();
          custModal.classList.remove('open');
        };
        reader.readAsDataURL(file);
      }
    });

    // Reset Wallpaper
    resetBgBtn?.addEventListener('click', () => {
      localStorage.removeItem('crown_custom_bg');
      this.applyCustomBackground();
      bgUrlInput.value = '';
      custModal.classList.remove('open');
    });

    // Close overlays on outside click
    document.addEventListener('click', (e) => {
      if (!shieldPanel?.contains(e.target) && e.target !== shieldBtn) {
        shieldPanel?.classList.remove('open');
      }
      if (e.target === custModal) custModal.classList.remove('open');
      if (e.target === profileModal) profileModal.classList.remove('open');
    });

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        this.tabEngine.createTab('crown://newtab');
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.tabEngine.createTab('crown://newtab', true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (this.tabEngine.activeTabId) this.tabEngine.closeTab(this.tabEngine.activeTabId);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        document.getElementById('omnibox-input')?.select();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        this.reload();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        document.getElementById('downloads-drawer')?.classList.toggle('open');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        this.navigateTo('crown://history');
      }
    });
  }

  _renderProfilesList() {
    const container = document.getElementById('profiles-list-container');
    if (!container) return;
    const activeId = Storage.getActiveProfileId();
    const profiles = Storage.getProfiles();

    container.innerHTML = profiles.map(p => `
      <div class="profile-card ${p.id === activeId ? 'active' : ''}" data-profile-id="${p.id}">
        <div class="profile-avatar">${p.avatar}</div>
        <div class="profile-name">${this._escape(p.name)}</div>
        ${p.id === activeId ? '<span class="active-badge">Active</span>' : ''}
      </div>
    `).join('');

    container.querySelectorAll('.profile-card').forEach(card => {
      card.addEventListener('click', () => {
        Storage.setActiveProfileId(card.dataset.profileId);
        this.updateProfileUI();
        document.getElementById('profile-modal-overlay')?.classList.remove('open');
      });
    });
  }

  _getTitleForUrl(url) {
    if (url === 'crown://newtab') return 'New Tab';
    if (url === 'crown://history') return 'History - Crown';
    if (url === 'crown://bookmarks') return 'Bookmarks - Crown';
    return this.tabEngine._extractDomain(url);
  }

  _escape(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
}

window.crown = new CrownApp();
window.addEventListener('DOMContentLoaded', () => {
  window.crown.init();
});
