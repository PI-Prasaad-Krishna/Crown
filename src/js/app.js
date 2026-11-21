// Crown Browser — Core Application Controller
import { shield } from './shield.js';
import { searchManager } from './search.js';
import { Storage } from './storage.js';
import { TabEngine } from './tabs.js';
import { InternalViews } from './internal-views.js';
import { downloadManager } from './downloads.js';

class CrownApp {
  constructor() {
    this.isIncognitoWindow = Storage.isIncognitoWindow;
    this.shield = shield;
    this.searchManager = searchManager;
    this.downloadManager = downloadManager;
    this.tabEngine = new TabEngine(this);
    this.frames = new Map(); // tabId -> iframe
    this.overflowBookmarks = [];
    this.bookmarksResizeObserver = null;
    this.currentZoom = Storage.getSettings().pageZoom || 100;

    // Side-by-Side Split View State
    this.splitViewActive = false;
    this.splitPrimaryTabId = null;
    this.splitSecondaryTabId = null;
    this.splitRatio = 50; // percentage width of left pane
    this.splitFocusedPane = 'left'; // 'left' | 'right'

    // Built-in Developer Tools Inspector State
    this.devToolsOpen = false;
    this.devToolsLogs = [];
    this.devToolsNetLogs = [];

    // Auto-Updater State
    this.updateState = {
      status: 'idle',
      currentVersion: '1.0.0',
      latestVersion: '1.0.0',
      body: '',
      date: '',
      downloadedBytes: 0,
      totalBytes: null,
      percent: 0,
      error: '',
      lastCheckedAt: 0
    };
  }

  async init() {
    // CSP-safe capture-phase fallback for any favicon <img> that fails to load
    window.addEventListener('error', (e) => {
      const target = e.target;
      if (target && target.tagName === 'IMG' && (target.classList.contains('crown-site-favicon') || target.classList.contains('tab-favicon-img'))) {
        target.style.display = 'none';
        const fallback = target.nextElementSibling;
        if (fallback && (fallback.classList.contains('crown-site-globe') || fallback.classList.contains('tab-favicon-globe'))) {
          fallback.style.display = 'inline-block';
        }
      }
    }, true);

    searchManager.init();
    await shield.init();
    this._syncNativeShieldConfig();
    downloadManager.init();
    this.tabEngine.init();

    if (this.isIncognitoWindow) {
      document.title = 'Crown Browser (Incognito)';
      document.getElementById('crown-app')?.classList.add('theme-incognito');
      const incognitoBadge = document.getElementById('incognito-badge');
      if (incognitoBadge) incognitoBadge.style.display = 'flex';
      const profileBtn = document.getElementById('profile-switcher-btn');
      if (profileBtn) profileBtn.style.display = 'none';
    }

    this.bindEvents();
    this.applyCustomBackground();
    this.applyAccessibilityAndAppearanceSettings();
    this.applyZoom();
    document.getElementById('omnibox-zoom-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleZoomPopover();
    });
    document.getElementById('zoom-out-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.changeZoom(-10);
    });
    document.getElementById('zoom-in-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.changeZoom(10);
    });
    document.getElementById('zoom-reset-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resetZoom();
    });
    document.addEventListener('click', (e) => {
      const pop = document.getElementById('zoom-popover');
      const btn = document.getElementById('omnibox-zoom-btn');
      if (pop && pop.style.display !== 'none' && !pop.contains(e.target) && (!btn || !btn.contains(e.target))) {
        pop.style.display = 'none';
        this._syncNativeWebviews();
      }
    });
    this._initBatteryAndEnergySaver();
    this._initSplitViewResizer();
    this._initDevToolsEvents();
    this._initNativeWebviewObservers();
    this.renderShortcuts();
    this.renderBookmarksBar();
    this.initBookmarksResizeObserver();
    this.renderDefenseHub();
    this.updateProfileUI();

    // Check if this window was spawned via Tab Tear-Off or "New Window" with ?initialUrl=...
    const urlParams = new URLSearchParams(window.location.search);
    const tornOffUrl = urlParams.get('initialUrl');

    // Clear cookies on exit handler if configured in settings
    window.addEventListener('beforeunload', () => {
      const s = Storage.getSettings();
      if (s.clearCookiesOnExit && !this.isIncognitoWindow) {
        Storage.clearAllCookiesNative().catch(() => {});
      }
    });

    // Restore saved session tabs for active profile or create default first tab based on Startup Behavior setting
    if (tornOffUrl && Storage.isSafeUrl(tornOffUrl)) {
      this.tabEngine.createTab(tornOffUrl, this.isIncognitoWindow);
    } else if (this.isIncognitoWindow) {
      this.tabEngine.createTab('crown://newtab', true);
    } else {
      const s = Storage.getSettings();
      if (s.startupBehavior === 'continue') {
        if (!this.tabEngine.restoreSession()) {
          this.tabEngine.createTab('crown://newtab', false);
        }
      } else if (s.startupBehavior === 'custom' && s.startupCustomUrl && Storage.isSafeUrl(s.startupCustomUrl)) {
        this.tabEngine.createTab(s.startupCustomUrl, false);
      } else {
        this.tabEngine.createTab('crown://newtab', false);
      }
    }

    // Startup Profile Picker check (skip if spawned from a tab tear-off):
    // If only 1 profile -> opens directly without picker.
    // If 2+ profiles -> check if "Show on startup" is enabled. If enabled, show picker. If disabled, opens directly into last active profile.
    const profiles = Storage.getProfiles();
    this.renderProfilePickerCards();
    const showPicker = !this.isIncognitoWindow && !tornOffUrl && profiles.length >= 2 && Storage.getShowProfilePickerOnStartup();
    if (showPicker) {
      this.openProfilePicker(true);
    } else {
      this.closeProfilePicker();
      const activeTab = this.tabEngine.getActiveTab();
      if (activeTab && activeTab.url === 'crown://newtab') {
        requestAnimationFrame(() => {
          const omnibox = document.getElementById('omnibox-input');
          if (omnibox) {
            omnibox.focus();
            omnibox.select();
          }
        });
      }
    }

    window.addEventListener('wheel', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.deltaY !== 0) {
        e.preventDefault();
        this.changeZoom(e.deltaY < 0 ? 10 : -10);
      }
    }, { passive: false });

    this.initAutoUpdateChecker();
  }

  // Open a New Standard Crown Window (optionally at screenX, screenY for Tab Tear-Off)
  async openNewWindow(initialUrl = 'crown://newtab', screenX = null, screenY = null) {
    const safeTarget = Storage.isSafeUrl(initialUrl) ? initialUrl : 'crown://newtab';
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      try {
        await window.__TAURI_INTERNALS__.invoke('open_new_window', {
          initialUrl: safeTarget,
          x: typeof screenX === 'number' ? Math.round(screenX) : null,
          y: typeof screenY === 'number' ? Math.round(screenY) : null
        });
        return;
      } catch (e) {
        console.warn('Native new window fallback:', e);
      }
    }

    const winUrl = new URL(window.location.origin + window.location.pathname);
    winUrl.searchParams.set('initialUrl', safeTarget);
    const features = [
      'width=1240',
      'height=820',
      typeof screenX === 'number' ? `left=${Math.max(0, Math.round(screenX - 100))}` : '',
      typeof screenY === 'number' ? `top=${Math.max(0, Math.round(screenY - 20))}` : ''
    ].filter(Boolean).join(',');
    window.open(winUrl.toString(), '_blank', features);
  }

  // Open a Dedicated Incognito Window (all tabs inside that window will be Incognito)
  async openIncognitoWindow() {
    if (this._isNativeWebviewMode()) {
      try {
        await window.__TAURI_INTERNALS__.invoke('open_incognito_window');
      } catch (e) {
        console.warn('Native incognito window failed:', e);
        this.showToast('Unable to open Incognito window');
      }
      return;
    }

    const incognitoUrl = new URL(window.location.href);
    incognitoUrl.searchParams.set('incognito', '1');
    window.open(incognitoUrl.toString(), '_blank', 'noopener,noreferrer,width=1200,height=800');
  }

  // Frame creation for tabs (hardened sandbox & credentialless isolation)
  createFrame(tabId) {
    let existing = this.frames.get(tabId) || document.getElementById(`iframe-${tabId}`);
    if (existing) return existing;

    const contentArea = document.getElementById('crown-content-area');
    const iframe = document.createElement('iframe');
    iframe.id = `iframe-${tabId}`;
    iframe.className = 'webview-frame';
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('credentialless', 'true');
    contentArea.appendChild(iframe);
    this.frames.set(tabId, iframe);
    return iframe;
  }

  // Dynamically enforce site-specific device permissions & JavaScript execution on tab iframes
  _applyPermissionsToFrame(iframe, url) {
    if (!iframe || !url || url.startsWith('crown://')) return;
    const perms = Storage.getSitePermissions(url);
    const allowDirectives = [];
    if (perms.camera !== 'block') allowDirectives.push("camera 'src'");
    if (perms.microphone !== 'block') allowDirectives.push("microphone 'src'");
    if (perms.location !== 'block') allowDirectives.push("geolocation 'src'");
    if (perms.notifications !== 'block') allowDirectives.push("notifications 'src'");
    allowDirectives.push("clipboard-read 'src'", "clipboard-write 'src'", "fullscreen 'src'");
    iframe.setAttribute('allow', allowDirectives.join('; '));

    if (/\.pdf(\?.*|#.*)?$/i.test(url)) {
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-downloads');
      return;
    }

    if (perms.javascript === 'block') {
      iframe.setAttribute('sandbox', 'allow-forms allow-same-origin');
    } else {
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads');
    }
  }

  _isNativeWebviewMode() {
    if (/Android/i.test(navigator.userAgent)) return false;
    return Boolean(window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function');
  }

  _syncNativeShieldConfig() {
    if (!this._isNativeWebviewMode()) return;
    const s = Storage.getSettings();
    window.__TAURI_INTERNALS__.invoke('sync_shield_config', {
      shieldsEnabled: s.shieldsEnabled !== false,
      blockAds: s.blockAds !== false,
      blockTrackers: s.blockTrackers !== false,
      sendGpc: s.sendGpc !== false,
      adDomains: Array.from(shield.adDomains || []),
      trackerDomains: Array.from(shield.trackerDomains || []),
      perSiteShields: shield.siteShields || {}
    }).catch(() => {});
  }

  _syncTabUrlFromNative(tab, nextUrl) {
    if (!tab || !nextUrl || !Storage.isSafeUrl(nextUrl, false) || tab.url === nextUrl) return;
    tab.url = nextUrl;
    if (!Array.isArray(tab.history)) {
      tab.history = [nextUrl];
      tab.historyIndex = 0;
    } else if (tab.history[tab.historyIndex] !== nextUrl) {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
      tab.history.push(nextUrl);
      tab.historyIndex = tab.history.length - 1;
    }
    tab.favicon = this.tabEngine._getFaviconSvg(nextUrl, tab.isIncognito);
    if (!tab.isIncognito && nextUrl !== 'crown://newtab' && !InternalViews.isInternalUrl(nextUrl)) {
      Storage.addHistory({ title: tab.title || nextUrl, url: nextUrl, isIncognito: false });
    }
    if (tab.id === this.tabEngine.activeTabId) {
      const omnibox = document.getElementById('omnibox-input');
      if (omnibox && document.activeElement !== omnibox) {
        omnibox.value = nextUrl;
      }
      this._currentQrUrl = nextUrl;
      this.updateSecurityIndicatorUI(tab);
      this.updateBookmarkStarUI();
      this.updateReaderModeButtonUI(tab);
      this.updateNavButtonsUI();
    }
    this.tabEngine.render();
  }

  _hasFullScreenOverlay() {
    if (document.querySelector('.modal-overlay.open')) {
      return true;
    }
    const picker = document.getElementById('profile-picker-screen');
    if (picker && picker.style.display !== 'none' && picker.style.display !== '') return true;
    return false;
  }

  _hasActiveOverlay() {
    return this._hasFullScreenOverlay();
  }

  _getFloatingOverlayCutouts(bounds) {
    const dpr = window.devicePixelRatio || 1;
    const candidates = Array.from(document.querySelectorAll(
      '.context-menu.open, .omnibox-suggestions.open, .downloads-drawer.open, .app-menu-dropdown.open, .shield-popover.open, .shield-panel.open, .profile-popover.open, .extensions-popover.open, .bookmarks-overflow-menu.open, #crown-app-menu:not(.hidden), .crown-toast-action'
    ));
    for (const id of ['site-info-popover', 'qr-code-popover', 'split-secondary-picker', 'zoom-popover']) {
      const el = document.getElementById(id);
      if (el && el.style.display !== 'none' && el.style.display !== '') {
        candidates.push(el);
      }
    }
    const cutouts = [];
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const relLeft = r.left - bounds.x;
      const relTop = r.top - bounds.y;
      const relRight = r.right - bounds.x;
      const relBottom = r.bottom - bounds.y;
      if (relRight <= 0 || relBottom <= 0 || relLeft >= bounds.width || relTop >= bounds.height) {
        continue;
      }
      const x = Math.max(0, Math.floor(relLeft * dpr));
      const y = Math.max(0, Math.floor(relTop * dpr));
      const right = Math.min(Math.ceil(bounds.width * dpr), Math.ceil(relRight * dpr));
      const bottom = Math.min(Math.ceil(bounds.height * dpr), Math.ceil(relBottom * dpr));
      if (right > x && bottom > y) {
        cutouts.push({ x, y, width: right - x, height: bottom - y });
      }
    }
    return cutouts;
  }

  _initNativeWebviewObservers() {
    if (!this._isNativeWebviewMode()) return;
    const scheduleSync = () => {
      if (this._nativeSyncRaf) return;
      this._nativeSyncRaf = requestAnimationFrame(() => {
        this._nativeSyncRaf = null;
        this._syncNativeWebviews();
      });
    };

    const contentArea = document.getElementById('crown-content-area');
    if (contentArea && typeof ResizeObserver !== 'undefined') {
      this._nativeResizeObserver = new ResizeObserver(scheduleSync);
      this._nativeResizeObserver.observe(contentArea);
    }
    window.addEventListener('resize', scheduleSync, { passive: true });

    if (typeof MutationObserver !== 'undefined' && document.body) {
      this._nativeOverlayObserver = new MutationObserver((mutations) => {
        for (let i = 0; i < mutations.length; i++) {
          const t = mutations[i].target;
          if (t && t.id !== 'page-load-progress') {
            scheduleSync();
            break;
          }
        }
      });
      this._nativeOverlayObserver.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
    }
  }

  _getNativeViewportBounds(pane = 'full') {
    const contentArea = document.getElementById('crown-content-area');
    if (!contentArea) return { x: 0, y: 80, width: 1200, height: 700 };
    const r = contentArea.getBoundingClientRect();
    const baseW = Math.max(1, Math.round(r.width));
    const baseH = Math.max(1, Math.round(r.height));
    const baseX = Math.max(0, Math.round(r.left));
    const baseY = Math.max(0, Math.round(r.top));

    if (pane === 'left' && this.splitViewActive) {
      const ratio = this.splitRatio || 0.5;
      const w = Math.max(100, Math.round(baseW * ratio) - 3);
      return { x: baseX, y: baseY, width: w, height: baseH };
    }
    if (pane === 'right' && this.splitViewActive) {
      const ratio = this.splitRatio || 0.5;
      const leftW = Math.max(100, Math.round(baseW * ratio));
      const x = baseX + leftW + 3;
      const w = Math.max(100, baseW - leftW - 3);
      return { x, y: baseY, width: w, height: baseH };
    }
    return { x: baseX, y: baseY, width: baseW, height: baseH };
  }

  _syncNativeWebviews() {
    if (!this._isNativeWebviewMode()) return;
    if (!this._lastNativeWebviewSyncState) {
      this._lastNativeWebviewSyncState = new Map();
    }
    const overlayOpen = this._hasActiveOverlay();
    const activeTab = this.tabEngine.getActiveTab();
    const fullBounds = this._getNativeViewportBounds('full');

    for (const tab of this.tabEngine.tabs) {
      const isWeb = tab.url && tab.url !== 'crown://newtab' && !InternalViews.isInternalUrl(tab.url) && Storage.isSafeUrl(tab.url, false);
      let visible = false;
      let bounds = fullBounds;

      if (isWeb && !overlayOpen && !tab.readerMode) {
        if (this.splitViewActive) {
          if (tab.id === this.splitPrimaryTabId) {
            visible = true;
            bounds = this._getNativeViewportBounds('left');
          } else if (tab.id === this.splitSecondaryTabId) {
            visible = true;
            bounds = this._getNativeViewportBounds('right');
          }
        } else if (activeTab && tab.id === activeTab.id) {
          visible = true;
          bounds = fullBounds;
        }
      }

      const cutouts = visible ? this._getFloatingOverlayCutouts(bounds) : [];
      const cutoutsKey = cutouts.length > 0
        ? cutouts.map(c => `${c.x}:${c.y}:${c.width}:${c.height}`).join('|')
        : '';
      const stateKey = `${bounds.x},${bounds.y},${bounds.width},${bounds.height},${visible ? 1 : 0},${cutoutsKey}`;
      if (this._lastNativeWebviewSyncState.get(tab.id) === stateKey) {
        continue;
      }
      this._lastNativeWebviewSyncState.set(tab.id, stateKey);

      window.__TAURI_INTERNALS__.invoke('sync_tab_webview', {
        tabId: tab.id,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        visible,
        cutouts,
        profileId: Storage.getActiveProfileId()
      }).then((liveUrl) => {
        if (visible && typeof liveUrl === 'string' && liveUrl) {
          this._syncTabUrlFromNative(tab, liveUrl);
        }
      }).catch(() => {});
    }
  }

  _onNativeWebviewEvent(evt) {
    if (!evt || typeof evt !== 'object') return;
    if (evt.type === 'window-maximized') {
      this._syncMaximizeButton(Boolean(evt.maximized));
      return;
    }
    if (evt.type === 'new-tab' && typeof evt.url === 'string' && Storage.isSafeUrl(evt.url, false)) {
      // Frontend backstop: never let a popup storm flood the tab engine / native webviews
      const now = Date.now();
      if (!this._newTabEventLog) this._newTabEventLog = [];
      this._newTabEventLog = this._newTabEventLog.filter(t => now - t < 10000);
      const lastAt = this._newTabEventLog.length ? this._newTabEventLog[this._newTabEventLog.length - 1] : 0;
      if ((lastAt && now - lastAt < 800) || this._newTabEventLog.length >= 5) {
        return;
      }
      this._newTabEventLog.push(now);
      const srcTab = this.tabEngine.tabs.find(t => t.id === evt.sourceTabId);
      this.tabEngine.createTab(evt.url, srcTab ? srcTab.isIncognito : this.isIncognitoWindow, srcTab ? srcTab.groupId : null);
      return;
    }

    if (evt.type === 'popup-blocked') {
      this._onPopupBlocked(evt);
      return;
    }

    if (evt.type === 'update-progress') {
      this.updateState.status = evt.stage || 'downloading';
      if (typeof evt.downloadedBytes === 'number') this.updateState.downloadedBytes = evt.downloadedBytes;
      if (evt.totalBytes !== undefined) this.updateState.totalBytes = evt.totalBytes;
      if (typeof evt.percent === 'number') this.updateState.percent = evt.percent;
      this._notifyUpdateUi();
      return;
    }

    const tab = this.tabEngine.tabs.find(t => t.id === evt.tabId);
    if (!tab) return;

    if (evt.type === 'child-pointerdown') {
      document.querySelectorAll('.context-menu.open, .omnibox-suggestions.open, .downloads-drawer.open, .app-menu-dropdown.open, .shield-popover.open, .shield-panel.open, .profile-popover.open, .extensions-popover.open, .bookmarks-overflow-menu.open').forEach(el => {
        el.classList.remove('open');
      });
      const appMenu = document.getElementById('crown-app-menu');
      if (appMenu && !appMenu.classList.contains('hidden')) {
        appMenu.classList.add('hidden');
      }
      for (const id of ['site-info-popover', 'qr-code-popover', 'split-secondary-picker', 'zoom-popover']) {
        const el = document.getElementById(id);
        if (el && el.style.display !== 'none' && el.style.display !== '') {
          el.style.display = 'none';
        }
      }
      return;
    }

    if (evt.type === 'zoom') {
      if (evt.dir === 'in') this.changeZoom(10);
      else if (evt.dir === 'out') this.changeZoom(-10);
      else if (evt.dir === 'reset') this.resetZoom();
      return;
    }

    if (evt.type === 'shield-block') {
      const kind = evt.kind === 'tracker' ? 'tracker' : 'ad';
      const topDomain = shield._cleanHostname(tab.url || '');
      if (topDomain) {
        shield._recordBlock(topDomain, kind, evt.host || evt.url || '', tab.isIncognito);
        if (tab.id === this.tabEngine.activeTabId && !this._shieldUiRafPending) {
          if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            this._shieldUiRafPending = true;
            window.requestAnimationFrame(() => {
              this._shieldUiRafPending = false;
              this.updateShieldButton();
              this.renderDefenseHub();
            });
          } else {
            this.updateShieldButton();
            this.renderDefenseHub();
          }
        }
      }
      return;
    }

    if (evt.type === 'page-load') {
      if (evt.state === 'started') {
        if (tab.id === this.tabEngine.activeTabId) {
          this._startLoadingBar();
        }
        if (evt.url && Storage.isSafeUrl(evt.url, false) && tab.url !== evt.url) {
          tab.url = evt.url;
          if (tab.id === this.tabEngine.activeTabId) {
            const omnibox = document.getElementById('omnibox-input');
            if (omnibox && document.activeElement !== omnibox) {
              omnibox.value = evt.url;
            }
            this._currentQrUrl = evt.url;
            this.updateSecurityIndicatorUI(tab);
          }
        }
      } else if (evt.state === 'finished') {
        if (tab.id === this.tabEngine.activeTabId) {
          this._finishLoadingBar();
        }
        if (evt.url && Storage.isSafeUrl(evt.url, false)) {
          const changed = tab.url !== evt.url;
          tab.url = evt.url;
          if (!Array.isArray(tab.history)) {
            tab.history = [evt.url];
            tab.historyIndex = 0;
          } else if (tab.history[tab.historyIndex] !== evt.url) {
            tab.history = tab.history.slice(0, tab.historyIndex + 1);
            tab.history.push(evt.url);
            tab.historyIndex = tab.history.length - 1;
          }
          tab.favicon = this.tabEngine._getFaviconSvg(evt.url, tab.isIncognito);
          if (changed && !tab.isIncognito && evt.url !== 'crown://newtab' && !InternalViews.isInternalUrl(evt.url)) {
            Storage.addHistory({ title: tab.title || evt.url, url: evt.url, isIncognito: false });
          }
          if (tab.id === this.tabEngine.activeTabId) {
            const omnibox = document.getElementById('omnibox-input');
            if (omnibox && document.activeElement !== omnibox) {
              omnibox.value = evt.url;
            }
            this._currentQrUrl = evt.url;
            this.updateSecurityIndicatorUI(tab);
            this.updateBookmarkStarUI();
            this.updateReaderModeButtonUI(tab);
            this.updateNavButtonsUI();
          }
          this.tabEngine.render();
        }
      }
    } else if (evt.type === 'url-changed' && typeof evt.url === 'string') {
      this._syncTabUrlFromNative(tab, evt.url);
    } else if (evt.type === 'title-changed' && typeof evt.title === 'string') {
      if (typeof evt.url === 'string' && evt.url) {
        this._syncTabUrlFromNative(tab, evt.url);
      }
      const cleanTitle = evt.title.trim().slice(0, 80);
      if (cleanTitle && tab.title !== cleanTitle) {
        tab.title = cleanTitle;
        this.tabEngine.render();
      }
    }
  }

  // Popup / pop-under blocked by the native guard: count it and offer a one-click "Allow once"
  _onPopupBlocked(evt) {
    const tab = this.tabEngine.tabs.find(t => t.id === evt.tabId);
    if (!tab) return;
    const url = typeof evt.url === 'string' ? evt.url : '';
    let host = 'popup';
    try { host = new URL(url).hostname || 'popup'; } catch {}

    const topDomain = shield._cleanHostname(tab.url || '');
    if (topDomain) {
      shield._recordBlock(topDomain, 'ad', `popup: ${host}`, tab.isIncognito);
      if (tab.id === this.tabEngine.activeTabId) {
        this.updateShieldButton();
        this.renderDefenseHub();
      }
    }

    if (tab.id !== this.tabEngine.activeTabId) return;
    const now = Date.now();
    if (this._lastPopupToastAt && now - this._lastPopupToastAt < 3000) return;
    this._lastPopupToastAt = now;
    this._showPopupBlockedToast(tab, url, host, evt.reason);
  }

  _showPopupBlockedToast(tab, url, host, reason) {
    const container = document.getElementById('crown-toast-container');
    if (!container) return;
    const canOverride = reason !== 'shield';
    const toast = document.createElement('div');
    toast.className = 'crown-toast crown-toast-action';
    toast.innerHTML = `<span class="crown-toast-dot"></span><span>Popup blocked</span>`;

    const dismiss = () => {
      toast.remove();
      this._syncNativeWebviews();
    };

    if (canOverride) {
      const btn = document.createElement('button');
      btn.className = 'crown-toast-btn';
      btn.type = 'button';
      btn.textContent = 'Allow once';
      btn.addEventListener('click', () => {
        window.__TAURI_INTERNALS__?.invoke('allow_popup_once', {
          tabId: tab.id,
          profileId: Storage.getActiveProfileId()
        }).catch(() => {});
        if (url && Storage.isSafeUrl(url, false) && !shield.evaluateUrl(url, tab.url, tab.isIncognito).blocked) {
          this.tabEngine.createTab(url, tab.isIncognito, tab.groupId);
        } else {
          this.showToast('Allowed — click the button again');
        }
        dismiss();
      });
      toast.appendChild(btn);
    }

    container.appendChild(toast);
    this._syncNativeWebviews();
    setTimeout(dismiss, 6000);
  }

  // Auto-Updater Controller (checks GitHub Releases on demand or politely at startup)
  getUpdateState() {
    return this.updateState;
  }

  _notifyUpdateUi() {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('crown:update-state', { detail: { ...this.updateState } }));
    }
  }

  initAutoUpdateChecker() {
    if (this.isIncognitoWindow || !this._isNativeWebviewMode()) return;
    const settings = Storage.getSettings();
    if (settings.autoCheckUpdates === false) return;
    if (this._autoUpdateTimer) clearTimeout(this._autoUpdateTimer);
    this._autoUpdateTimer = setTimeout(() => {
      this.checkForUpdates({ silent: true });
    }, 8000);
  }

  async checkForUpdates({ silent = false } = {}) {
    if (this.updateState.status === 'checking' || this.updateState.status === 'downloading' || this.updateState.status === 'verifying') {
      return this.updateState;
    }

    if (!window.__TAURI_INTERNALS__?.invoke) {
      this.updateState = {
        ...this.updateState,
        status: silent ? 'idle' : 'up-to-date',
        error: '',
        lastCheckedAt: Date.now()
      };
      this._notifyUpdateUi();
      return this.updateState;
    }

    this.updateState = {
      ...this.updateState,
      status: 'checking',
      error: ''
    };
    this._notifyUpdateUi();

    try {
      const res = await window.__TAURI_INTERNALS__.invoke('check_for_updates');
      this.updateState = {
        ...this.updateState,
        status: res.available ? 'available' : 'up-to-date',
        currentVersion: res.currentVersion || '1.0.0',
        latestVersion: res.latestVersion || res.currentVersion || '1.0.0',
        body: res.body || '',
        date: res.date || '',
        error: '',
        lastCheckedAt: Date.now()
      };
      this._notifyUpdateUi();

      if (res.available && silent) {
        this._showUpdateAvailableToast(this.updateState.latestVersion);
      }
    } catch (err) {
      const rawMsg = String(err || 'Unable to check for updates');
      if (silent) {
        this.updateState = { ...this.updateState, status: 'idle', error: '' };
      } else {
        const friendly = /release|404|not found|status/i.test(rawMsg)
          ? 'No public release found yet for this repository.'
          : rawMsg;
        this.updateState = {
          ...this.updateState,
          status: 'error',
          error: friendly,
          lastCheckedAt: Date.now()
        };
      }
      this._notifyUpdateUi();
    }
    return this.updateState;
  }

  async installPendingUpdate() {
    if (!window.__TAURI_INTERNALS__?.invoke) return;
    this.updateState = {
      ...this.updateState,
      status: 'downloading',
      downloadedBytes: 0,
      totalBytes: null,
      percent: 0,
      error: ''
    };
    this._notifyUpdateUi();

    try {
      await window.__TAURI_INTERNALS__.invoke('install_update');
    } catch (err) {
      const msg = String(err || 'Update download failed');
      this.updateState = {
        ...this.updateState,
        status: 'error',
        error: msg
      };
      this._notifyUpdateUi();
      this.showToast(`Update failed: ${msg}`, 'error');
    }
  }

  async relaunchForUpdate() {
    if (!window.__TAURI_INTERNALS__?.invoke) return;
    try {
      await window.__TAURI_INTERNALS__.invoke('relaunch_app');
    } catch (err) {
      this.showToast(`Relaunch failed: ${String(err || 'unknown error')}`, 'error');
    }
  }

  _showUpdateAvailableToast(version) {
    const container = document.getElementById('crown-toast-container');
    if (!container || this._updateToastShownFor === version) return;
    this._updateToastShownFor = version;

    const toast = document.createElement('div');
    toast.className = 'crown-toast crown-toast-action';
    toast.innerHTML = `<span class="crown-toast-dot"></span><span>Crown v${this._escape(version)} is available</span>`;

    const dismiss = () => {
      toast.remove();
      this._syncNativeWebviews();
    };

    const updateBtn = document.createElement('button');
    updateBtn.className = 'crown-toast-btn';
    updateBtn.type = 'button';
    updateBtn.textContent = 'Update Now';
    updateBtn.addEventListener('click', () => {
      dismiss();
      this.navigateTo('crown://settings#about');
    });

    const laterBtn = document.createElement('button');
    laterBtn.className = 'crown-toast-btn';
    laterBtn.type = 'button';
    laterBtn.textContent = 'Later';
    laterBtn.addEventListener('click', dismiss);

    toast.appendChild(updateBtn);
    toast.appendChild(laterBtn);
    container.appendChild(toast);
    this._syncNativeWebviews();
    setTimeout(() => {
      if (toast.isConnected) dismiss();
    }, 12000);
  }

  removeFrame(tabId, profileId = null) {
    if (this._lastNativeWebviewSyncState) {
      this._lastNativeWebviewSyncState.delete(tabId);
    }
    if (this._isNativeWebviewMode()) {
      window.__TAURI_INTERNALS__.invoke('close_tab_webview', {
        tabId,
        profileId: profileId || Storage.getActiveProfileId()
      }).catch(() => {});
    }
    const iframe = this.frames.get(tabId) || document.getElementById(`iframe-${tabId}`);
    if (iframe) {
      try {
        iframe.removeAttribute('srcdoc');
        iframe.src = 'about:blank';
      } catch {}
      iframe.remove();
    }
    this.frames.delete(tabId);
  }

  // Restore a hibernated tab when switched back into focus
  restoreHibernatedTab(tab) {
    if (!tab) return;
    const iframe = this.createFrame(tab.id);
    if (tab.url !== 'crown://newtab' && !InternalViews.isInternalUrl(tab.url) && Storage.isSafeUrl(tab.url, false)) {
      this._loadFrameContent(iframe, tab.url, tab);
    }
  }

  // Switch Active Tab (Stationary viewport — zero flicker on CPU & GPU systems)
  syncActiveTab(tab) {
    if (!tab) return;

    const appEl = document.getElementById('crown-app');
    const dashboard = document.getElementById('new-tab-dashboard');
    const internalMount = document.getElementById('internal-views-mount');
    const omnibox = document.getElementById('omnibox-input');
    const incognitoBadge = document.getElementById('incognito-badge');

    // Toggle Incognito Theme class on app (always active in a dedicated Incognito window)
    const isIncognitoActive = Boolean(this.isIncognitoWindow || tab.isIncognito);
    appEl.classList.toggle('theme-incognito', isIncognitoActive);
    if (incognitoBadge) {
      incognitoBadge.style.display = isIncognitoActive ? 'flex' : 'none';
    }

    // Handle internal views vs NTP vs external iframe
    const isNormalWebpage = (tab.url !== 'crown://newtab' && !InternalViews.isInternalUrl(tab.url));

    if (this.splitViewActive) {
      if (this.splitSecondaryTabId && tab.id === this.splitSecondaryTabId) {
        this.splitFocusedPane = 'right';
      } else {
        this.splitPrimaryTabId = tab.id;
        this.splitFocusedPane = 'left';
      }
      this._applySplitViewLayout();
      omnibox.value = (tab.url === 'crown://newtab') ? '' : tab.url;
      if (tab.url === 'crown://newtab') {
        this.renderShortcuts();
        this.renderDefenseHub();
      }
    } else {
      document.querySelectorAll('.webview-frame').forEach(f => {
        f.classList.remove('split-left', 'split-right', 'split-focused');
        f.style.width = '';
        f.style.left = '';
        f.classList.toggle('active', f.id === `iframe-${tab.id}` && isNormalWebpage);
      });
      const divider = document.getElementById('split-view-divider');
      if (divider) divider.style.display = 'none';
      const floatingBar = document.getElementById('split-view-floating-bar');
      if (floatingBar) floatingBar.style.display = 'none';
      const picker = document.getElementById('split-secondary-picker');
      if (picker) picker.style.display = 'none';

      if (tab.url === 'crown://newtab') {
        if (dashboard.style.display !== 'flex') dashboard.style.display = 'flex';
        dashboard.classList.remove('split-left');
        dashboard.style.left = '';
        dashboard.style.width = '';
        if (internalMount.style.display !== 'none') internalMount.style.display = 'none';
        internalMount.classList.remove('split-left');
        internalMount.style.left = '';
        internalMount.style.width = '';
        omnibox.value = '';
        this.renderShortcuts();
        this.renderDefenseHub();
      } else if (InternalViews.isInternalUrl(tab.url)) {
        dashboard.style.display = 'none';
        dashboard.classList.remove('split-left');
        dashboard.style.left = '';
        dashboard.style.width = '';
        internalMount.style.display = 'block';
        internalMount.classList.remove('split-left');
        internalMount.style.left = '';
        internalMount.style.width = '';
        omnibox.value = tab.url;
        InternalViews.render(internalMount, tab.url, (navUrl) => this.navigateTo(navUrl, tab.id), {
          onSectionChange: (section) => this._syncInternalSettingsSection(tab, section)
        });
      } else {
        dashboard.style.display = 'none';
        dashboard.classList.remove('split-left');
        dashboard.style.left = '';
        dashboard.style.width = '';
        internalMount.style.display = 'none';
        internalMount.classList.remove('split-left');
        internalMount.style.left = '';
        internalMount.style.width = '';
        omnibox.value = tab.url;
      }
    }

    this.updateShieldButton();
    this.updateBookmarkStarUI();
    this.updateSecurityIndicatorUI(tab);
    this.updateReaderModeButtonUI(tab);
    this.updateNavButtonsUI();
    this._syncNativeWebviews();
    if (this.devToolsOpen) {
      this.refreshDevTools();
    }
  }

  // Dynamic Omnibox Security Padlock Indicator (HTTPS / HTTP Warning / Internal crown://)
  updateSecurityIndicatorUI(tab) {
    const iconEl = document.getElementById('site-security-icon');
    if (!iconEl || !tab) return;

    const url = (tab.url || '').trim().toLowerCase();
    iconEl.classList.remove('sec-https', 'sec-http-warn', 'sec-internal');

    if (url.startsWith('crown://') || url === 'about:blank') {
      iconEl.classList.add('sec-internal');
      iconEl.title = 'Crown Internal Page';
      iconEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z"/></svg>`;
    } else if (url.startsWith('https://')) {
      iconEl.classList.add('sec-https');
      iconEl.title = 'Connection is secure (HTTPS)';
      iconEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    } else {
      iconEl.classList.add('sec-http-warn');
      iconEl.title = 'Not secure — Unencrypted HTTP connection';
      iconEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    }
  }

  updateReaderModeButtonUI(tab) {
    const readerBtn = document.getElementById('omnibox-reader-btn');
    if (!readerBtn || !tab) return;
    const isExternal = tab.url !== 'crown://newtab' && !InternalViews.isInternalUrl(tab.url);
    readerBtn.style.display = isExternal ? 'flex' : 'none';
    readerBtn.classList.toggle('reader-active', Boolean(tab.readerMode));
  }

  // Distraction-Free Reader Mode (Alt+R) — Strips scripts & heavy DOM to present clean article text
  async toggleReaderMode() {
    const tab = this.tabEngine.getActiveTab();
    if (!tab || tab.url === 'crown://newtab' || InternalViews.isInternalUrl(tab.url)) {
      this.showToast('Reader Mode is available on web articles');
      return;
    }

    const iframe = this.frames.get(tab.id) || document.getElementById(`iframe-${tab.id}`);
    if (!iframe) return;

    if (tab.readerMode) {
      tab.readerMode = false;
      this.updateReaderModeButtonUI(tab);
      if (this._isNativeWebviewMode()) {
        iframe.removeAttribute('srcdoc');
        this._syncNativeWebviews();
      } else {
        this._loadFrameContent(iframe, tab.url, tab);
      }
      this.showToast('Exited Reader Mode');
      return;
    }

    let articleTitle = tab.title || this._getTitleForUrl(tab.url);
    let blocks = [];
    let wordCount = 0;

    // 1. Attempt live in-frame DOM extraction via crown:extract-article
    try {
      const extracted = await new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            window.removeEventListener('message', onExtractMsg);
            resolve(null);
          }
        }, 800);

        const onExtractMsg = (ev) => {
          if (!ev.data || ev.data.type !== 'crown:article-extracted') return;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            window.removeEventListener('message', onExtractMsg);
            resolve(ev.data);
          }
        };

        window.addEventListener('message', onExtractMsg);
        try {
          iframe.contentWindow?.postMessage({ type: 'crown:extract-article' }, '*');
        } catch {
          settled = true;
          clearTimeout(timer);
          window.removeEventListener('message', onExtractMsg);
          resolve(null);
        }
      });

      if (extracted && Array.isArray(extracted.blocks) && extracted.blocks.length >= 2) {
        blocks = extracted.blocks;
        wordCount = extracted.wordCount || 0;
        if (extracted.title) articleTitle = extracted.title;
        if (extracted.url && Storage.isSafeUrl(extracted.url, false)) {
          tab.url = extracted.url;
          const omnibox = document.getElementById('omnibox-input');
          if (omnibox && tab.id === this.tabEngine.activeTabId) {
            omnibox.value = tab.url;
          }
          this._currentQrUrl = tab.url;
          this.tabEngine.render();
        }
      }
    } catch {}

    // 2. Fallback: If live extraction yielded insufficient blocks, fetch current tab.url via shield proxy or parse srcdoc
    if (blocks.length < 2) {
      let rawHtml = '';
      try {
        if (window.__TAURI_INTERNALS__?.invoke) {
          const res = await window.__TAURI_INTERNALS__.invoke('fetch_page_with_shield', {
            url: tab.url,
            shieldEnabled: true,
            cosmeticCss: '',
            tabId: tab.id
          });
          rawHtml = res?.html || '';
        } else if (iframe.srcdoc) {
          rawHtml = iframe.srcdoc;
        }
      } catch {}

      if (rawHtml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(rawHtml, 'text/html');
        doc.querySelectorAll('script, style, nav, footer, header, aside, iframe, noscript, svg, form, .mw-editsection, .navbox, .sidebar, .reference, .reflist, .catlinks, .thumbcaption .magnify, [role="navigation"], [role="banner"], [role="contentinfo"]').forEach(el => el.remove());
        const h1 = doc.querySelector('article h1, main h1, h1, .mw-first-heading');
        if (h1 && h1.textContent.trim()) {
          articleTitle = h1.textContent.trim();
        }
        const root = doc.querySelector('article, [itemprop="articleBody"], .mw-parser-output, .article-content, .article-body, .post-content, .entry-content, #content, main, [role="main"]') || doc.body;
        if (root) {
          root.querySelectorAll('h2, h3, h4, p, blockquote, pre, ul, ol, figure').forEach(node => {
            const tag = node.tagName.toLowerCase();
            if (tag === 'p') {
              const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
              if (text.length >= 20) {
                wordCount += text.split(/\s+/).length;
                blocks.push(`<p>${this._escape(text)}</p>`);
              }
            } else if (tag === 'h2' || tag === 'h3' || tag === 'h4') {
              const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
              if (text && text.length < 140) {
                blocks.push(`<${tag}>${this._escape(text)}</${tag}>`);
              }
            } else if (tag === 'blockquote') {
              const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
              if (text) {
                wordCount += text.split(/\s+/).length;
                blocks.push(`<blockquote>${this._escape(text)}</blockquote>`);
              }
            } else if (tag === 'pre') {
              const text = node.textContent || '';
              if (text.trim()) {
                blocks.push(`<pre><code>${this._escape(text)}</code></pre>`);
              }
            } else if (tag === 'ul' || tag === 'ol') {
              const items = [];
              node.querySelectorAll(':scope > li').forEach(li => {
                const liText = (li.textContent || '').replace(/\s+/g, ' ').trim();
                if (liText) {
                  wordCount += liText.split(/\s+/).length;
                  items.push(`<li>${this._escape(liText)}</li>`);
                }
              });
              if (items.length > 0 && items.length <= 30) {
                blocks.push(`<${tag}>${items.join('')}</${tag}>`);
              }
            } else if (tag === 'figure') {
              const img = node.querySelector('img[src]');
              if (img) {
                const src = img.getAttribute('src');
                const alt = img.getAttribute('alt') || '';
                if (src && (/^https?:\/\//i.test(src) || /^data:image\//i.test(src))) {
                  const caption = node.querySelector('figcaption')?.textContent?.trim() || alt;
                  blocks.push(`
                    <figure class="reader-figure">
                      <img src="${this._escape(src)}" alt="${this._escape(alt)}" loading="lazy" />
                      ${caption ? `<figcaption>${this._escape(caption)}</figcaption>` : ''}
                    </figure>
                  `);
                }
              }
            }
          });
        }
      }
    }

    const s = Storage.getSettings();
    let initialThemeClass = 'theme-dark';
    if (s.readerTheme === 'light' || s.readerTheme === 'sepia' || s.readerTheme === 'dark') {
      initialThemeClass = `theme-${s.readerTheme}`;
    } else {
      if (s.wallpaper === 'minimal' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        initialThemeClass = 'theme-light';
      } else {
        initialThemeClass = 'theme-dark';
      }
    }

    const host = this.tabEngine._extractDomain(tab.url);
    const readingTimeMin = Math.max(1, Math.round(wordCount / 200));
    const hasArticle = blocks.length >= 2;

    const bodyContent = hasArticle
      ? blocks.slice(0, 250).join('\n')
      : `
        <div class="reader-no-article-box">
          <div class="reader-notice-badge">Notice</div>
          <h2>No Article Detected on This Page</h2>
          <p>Reader Mode is designed for news articles, blog posts, Wikipedia entries, and documentation. <strong>${this._escape(host)}</strong> is a homepage or navigation portal without an article body.</p>
          <div class="reader-empty-actions">
            <button class="reader-btn-primary" onclick="window.parent.postMessage({ type: 'crown:exit-reader' }, '*')">Return to Webpage</button>
          </div>
        </div>
      `;

    const readerDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    margin: 0;
    padding: 0 24px 80px;
    background: #121316;
    color: #e4e6eb;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.75;
    font-size: 18px;
    transition: background 0.15s ease, color 0.15s ease;
  }
  body.font-serif {
    font-family: Georgia, Cambria, "Times New Roman", serif;
  }
  body.font-sans {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  body.theme-dark {
    background: #121316;
    color: #e4e6eb;
  }
  body.theme-sepia {
    background: #fbf0d9;
    color: #382c1e;
  }
  body.theme-sepia h1, body.theme-sepia h2, body.theme-sepia h3 {
    color: #241c12;
  }
  body.theme-sepia blockquote {
    background: #f4e5c3;
    border-color: #8b6834;
    color: #382c1e;
  }
  body.theme-sepia pre {
    background: #f4e5c3;
    border-color: #dbcbb0;
    color: #241c12;
  }
  body.theme-light {
    background: #ffffff;
    color: #1c1e21;
  }
  body.theme-light h1, body.theme-light h2, body.theme-light h3 {
    color: #0b0c0e;
  }
  body.theme-light blockquote {
    background: #f0f2f5;
    border-color: #d1d5db;
    color: #1f2937;
  }
  body.theme-light pre {
    background: #f3f4f6;
    border-color: #e5e7eb;
    color: #111827;
  }
  .reader-sticky-bar {
    position: sticky;
    top: 0;
    background: inherit;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding: 12px 0;
    margin-bottom: 36px;
    z-index: 100;
  }
  body.theme-sepia .reader-sticky-bar {
    border-bottom-color: rgba(56, 44, 30, 0.15);
  }
  body.theme-light .reader-sticky-bar {
    border-bottom-color: rgba(0, 0, 0, 0.1);
  }
  .reader-toolbar {
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
  }
  .reader-meta-group {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: system-ui, sans-serif;
    color: #9ca3af;
  }
  .reader-badge {
    background: rgba(230, 202, 133, 0.15);
    color: #e6ca85;
    border: 1px solid rgba(230, 202, 133, 0.3);
    padding: 2px 7px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .reader-tools {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .reader-tool-btn {
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: inherit;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .reader-tool-btn:hover {
    background: rgba(255, 255, 255, 0.14);
  }
  .reader-tool-btn.exit-btn {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.3);
    font-weight: 600;
  }
  .reader-tool-btn.exit-btn:hover {
    background: rgba(239, 68, 68, 0.25);
  }
  .reader-wrap {
    max-width: 720px;
    margin: 0 auto;
  }
  h1 {
    font-size: 32px;
    line-height: 1.25;
    color: #f5f6f8;
    margin: 0 0 28px;
    padding-bottom: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  h2, h3, h4 {
    color: #f0f2f5;
    margin-top: 36px;
    margin-bottom: 14px;
    line-height: 1.35;
  }
  p {
    margin: 0 0 20px;
    color: inherit;
  }
  blockquote {
    margin: 24px 0;
    padding: 12px 20px;
    border-left: 3px solid #e6ca85;
    background: #18191e;
    color: #dcdfe6;
    border-radius: 0 6px 6px 0;
  }
  pre {
    background: #18191e;
    padding: 16px;
    border-radius: 8px;
    overflow-x: auto;
    font-size: 14px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .reader-figure {
    margin: 28px 0;
    text-align: center;
  }
  .reader-figure img {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
  }
  .reader-figure figcaption {
    font-size: 13px;
    color: #9ca3af;
    margin-top: 8px;
  }
  a { color: #e6ca85; }
  .reader-no-article-box {
    text-align: center;
    padding: 60px 20px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px dashed rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    margin: 40px auto;
    max-width: 580px;
  }
  .reader-notice-badge {
    display: inline-block;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 999px;
    background: rgba(230, 202, 133, 0.14);
    color: #e6ca85;
    border: 1px solid rgba(230, 202, 133, 0.28);
    margin-bottom: 12px;
  }
  .reader-btn-primary {
    background: #e6ca85;
    color: #121316;
    border: none;
    padding: 10px 22px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    margin-top: 14px;
    transition: filter 0.15s ease;
  }
  .reader-btn-primary:hover {
    filter: brightness(1.1);
  }
</style>
</head>
<body class="${initialThemeClass} font-sans">
  <div class="reader-sticky-bar">
    <div class="reader-toolbar">
      <div class="reader-meta-group">
        <span class="reader-badge">Crown Reader</span>
        <span>•</span>
        <span>${this._escape(host)}</span>
        ${hasArticle ? `<span>•</span><span>${readingTimeMin} min read</span>` : ''}
      </div>
      <div class="reader-tools">
        <button class="reader-tool-btn" id="font-toggle" title="Toggle Serif / Sans Font">Serif</button>
        <button class="reader-tool-btn" id="size-down" title="Decrease Font Size">A−</button>
        <button class="reader-tool-btn" id="size-up" title="Increase Font Size">A+</button>
        <button class="reader-tool-btn" id="theme-toggle" title="Cycle Themes (Dark, Sepia, Light)">Theme</button>
        <button class="reader-tool-btn exit-btn" onclick="window.parent.postMessage({ type: 'crown:exit-reader' }, '*')" title="Exit Reader Mode (Alt+R)">Exit</button>
      </div>
    </div>
  </div>

  <article class="reader-wrap">
    <h1>${this._escape(articleTitle)}</h1>
    ${bodyContent}
  </article>

  <script>
    let fontSize = 18;
    const themes = ['theme-dark', 'theme-sepia', 'theme-light'];
    let currentThemeIdx = themes.indexOf('${initialThemeClass}');
    if (currentThemeIdx === -1) currentThemeIdx = 0;
    let isSerif = false;

    document.getElementById('size-up')?.addEventListener('click', () => {
      fontSize = Math.min(32, fontSize + 2);
      document.body.style.fontSize = fontSize + 'px';
    });
    document.getElementById('size-down')?.addEventListener('click', () => {
      fontSize = Math.max(14, fontSize - 2);
      document.body.style.fontSize = fontSize + 'px';
    });
    document.getElementById('font-toggle')?.addEventListener('click', (e) => {
      isSerif = !isSerif;
      document.body.classList.toggle('font-serif', isSerif);
      document.body.classList.toggle('font-sans', !isSerif);
      e.target.textContent = isSerif ? 'Sans' : 'Serif';
    });
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      document.body.classList.remove(themes[currentThemeIdx]);
      currentThemeIdx = (currentThemeIdx + 1) % themes.length;
      const nextTheme = themes[currentThemeIdx];
      document.body.classList.add(nextTheme);
      try {
        window.parent.postMessage({ type: 'crown:save-reader-theme', theme: nextTheme }, '*');
      } catch (e) {}
    });
  </script>
</body>
</html>`;

    tab.readerMode = true;
    iframe.srcdoc = readerDoc;
    this.updateReaderModeButtonUI(tab);
    this._syncNativeWebviews();
    this.showToast('Reader Mode enabled');
  }

  _startLoadingBar() {
    const bar = document.getElementById('page-load-progress');
    if (!bar) return;
    clearTimeout(this._loadBarTimer);
    clearTimeout(this._loadBarSafetyTimer);
    bar.classList.add('loading');
    bar.style.width = '35%';
    this._loadBarTimer = setTimeout(() => {
      bar.style.width = '78%';
    }, 120);
    this._loadBarSafetyTimer = setTimeout(() => {
      this._finishLoadingBar();
    }, 10000);
  }

  _finishLoadingBar() {
    const bar = document.getElementById('page-load-progress');
    if (!bar) return;
    clearTimeout(this._loadBarTimer);
    clearTimeout(this._loadBarSafetyTimer);
    bar.style.width = '100%';
    this._loadBarTimer = setTimeout(() => {
      bar.classList.remove('loading');
      bar.style.width = '0%';
    }, 240);
  }

  // Load external webpage through Native Rust Shield Gateway (with automatic fallback)
  async _loadFrameContent(iframe, finalUrl, tab) {
    if (!iframe || !Storage.isSafeUrl(finalUrl, false)) return;

    this._applyPermissionsToFrame(iframe, finalUrl);
    Storage.recordSiteCookie(finalUrl, 'session', 'active', finalUrl.startsWith('https:'));
    this._startLoadingBar();
    const s = Storage.getSettings();
    const domain = shield._cleanHostname(finalUrl);
    const shieldEnabled = shield.isShieldEnabledForSite(domain);
    const extPayload = Storage.buildActiveExtensionPayload();
    const minFontCss = (Number(s.minFontSize) || 0) > 0
      ? `p, li, span, a, td, div { font-size: max(1em, ${Number(s.minFontSize)}px) !important; }`
      : '';
    const cosmeticCss = [shield.getCosmeticCss(domain), extPayload.css, minFontCss]
      .filter(Boolean)
      .join('\n');

    this._appendDevToolsNetLog({
      method: 'GET',
      url: finalUrl,
      status: '200 OK',
      kind: 'document'
    });

    // Native Tauri Child Webview path (full Chromium/WebView2 rendering, TLS, cookies, PDF & URL sync)
    if (this._isNativeWebviewMode()) {
      let pane = 'full';
      let isTabVisible = (tab.id === this.tabEngine.activeTabId);
      if (this.splitViewActive) {
        if (tab.id === this.splitPrimaryTabId) {
          pane = 'left';
          isTabVisible = true;
        } else if (tab.id === this.splitSecondaryTabId) {
          pane = 'right';
          isTabVisible = true;
        } else {
          isTabVisible = false;
        }
      }
      const bounds = this._getNativeViewportBounds(pane);
      const visible = Boolean(isTabVisible && !this._hasActiveOverlay() && !tab.readerMode);
      try {
        await window.__TAURI_INTERNALS__.invoke('open_or_navigate_tab_webview', {
          tabId: tab.id,
          url: finalUrl,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          visible,
          shieldEnabled,
          cosmeticCss,
          extensionJs: extPayload.js || '',
          spellcheck: Storage.getSettings().spellcheck !== false,
          zoom: (this.currentZoom || 100) / 100,
          isIncognito: Boolean(tab.isIncognito || this.isIncognitoWindow),
          profileId: Storage.getActiveProfileId()
        });
        return;
      } catch (err) {
        console.warn('Native tab webview error:', err);
        this._finishLoadingBar();
        const errText = this._escape(String(err || 'Unable to reach site'));
        const safeRetryUrl = this._escape(finalUrl);
        iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
          body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#121318;color:#e5e7eb;font-family:system-ui,-apple-system,sans-serif;}
          .card{max-width:460px;padding:32px;background:#1a1c24;border:1px solid rgba(255,255,255,0.08);border-radius:14px;text-align:center;box-shadow:0 16px 40px rgba(0,0,0,0.45);}
          h2{margin:0 0 10px;font-size:19px;color:#f3f4f6;}
          p{margin:0 0 18px;font-size:13.5px;color:#9ca3af;line-height:1.5;word-break:break-word;}
          button{padding:9px 18px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;background:#e6ca85;color:#111;}
        </style></head><body><div class="card">
          <h2>This page couldn't be loaded</h2>
          <p>${safeRetryUrl}<br><br>${errText}</p>
          <button id="crown-retry-btn">Retry</button>
        </div>
        <script>
          document.getElementById('crown-retry-btn').addEventListener('click', function() {
            window.parent.postMessage({ type: 'crown:page-nav', tabId: ${JSON.stringify(tab.id)}, url: ${JSON.stringify(finalUrl)} }, '*');
          });
        </script>
        </body></html>`;
        return;
      }
    }

    // Web Preview PDF fallback
    if (/\.pdf(\?.*|#.*)?$/i.test(finalUrl)) {
      iframe.removeAttribute('srcdoc');
      iframe.removeAttribute('sandbox');
      iframe.onload = () => this._finishLoadingBar();
      iframe.src = finalUrl;
      tab.url = finalUrl;
      try {
        const pdfName = decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || 'PDF Document');
        if (pdfName) tab.title = pdfName.slice(0, 80);
      } catch {}
      if (tab.id === this.tabEngine.activeTabId) {
        const omnibox = document.getElementById('omnibox-input');
        if (omnibox && document.activeElement !== omnibox) {
          omnibox.value = tab.url;
        }
        this._currentQrUrl = tab.url;
        this.updateSecurityIndicatorUI(tab);
        this.updateBookmarkStarUI();
        this.updateReaderModeButtonUI(tab);
        this.updateNavButtonsUI();
      }
      this.tabEngine.render();
      return;
    }

    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      try {
        const res = await window.__TAURI_INTERNALS__.invoke('fetch_page_with_shield', {
          url: finalUrl,
          shieldEnabled,
          cosmeticCss,
          acceptLanguage: s.language || 'en-US,en;q=0.9',
          sendGpc: s.sendGpc !== false,
          extensionJs: extPayload.js || '',
          tabId: tab.id
        });
        if (res && res.html) {
          iframe.srcdoc = res.html;
          if (res.final_url && Storage.isSafeUrl(res.final_url, false)) {
            tab.url = res.final_url;
            if (Array.isArray(tab.history)) {
              tab.history[tab.historyIndex] = res.final_url;
            }
          }
          // Parse HTML for real document <title>
          const titleMatch = res.html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (titleMatch && titleMatch[1]) {
            const cleanTitle = titleMatch[1]
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#039;/g, "'")
              .trim()
              .slice(0, 80);
            if (cleanTitle) {
              tab.title = cleanTitle;
            }
          }
          // Immediately sync Omnibox, QR code, security lock, bookmark star and reader mode for active tab
          if (tab.id === this.tabEngine.activeTabId) {
            const omnibox = document.getElementById('omnibox-input');
            if (omnibox && document.activeElement !== omnibox) {
              omnibox.value = tab.url;
            }
            this._currentQrUrl = tab.url;
            this.updateSecurityIndicatorUI(tab);
            this.updateBookmarkStarUI();
            this.updateReaderModeButtonUI(tab);
            this.updateNavButtonsUI();
          }
          // Parse HTML for site-specified custom favicon
          const iconMatch = res.html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/i)
            || res.html.match(/<link[^>]+rel=["']icon["'][^>]*>/i)
            || res.html.match(/<link[^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*>/i);
          if (iconMatch) {
            const hrefMatch = iconMatch[0].match(/href=["']([^"']+)["']/i);
            if (hrefMatch && hrefMatch[1]) {
              try {
                const resolvedIcon = new URL(hrefMatch[1], res.final_url || finalUrl).href;
                if (Storage.isSafeImageUrl(resolvedIcon)) {
                  tab.favicon = this.tabEngine._getFaviconSvg(tab.url, tab.isIncognito, resolvedIcon);
                }
              } catch {}
            }
          }
          this.tabEngine.render();
          // Record visit in history if not incognito
          if (!tab.isIncognito && tab.url !== 'crown://newtab' && !InternalViews.isInternalUrl(tab.url)) {
            Storage.addHistory({ title: tab.title, url: tab.url, isIncognito: false });
          }
          this._finishLoadingBar();
          if (this.devToolsOpen && tab.id === this.tabEngine.activeTabId) {
            setTimeout(() => this.refreshDevTools(), 160);
          }
          return;
        }
      } catch (err) {
        console.warn('Shield gateway error:', err);
        this._finishLoadingBar();
        const errText = this._escape(String(err || 'Unable to reach site'));
        const safeRetryUrl = this._escape(finalUrl);
        iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
          body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#121318;color:#e5e7eb;font-family:system-ui,-apple-system,sans-serif;}
          .card{max-width:460px;padding:32px;background:#1a1c24;border:1px solid rgba(255,255,255,0.08);border-radius:14px;text-align:center;box-shadow:0 16px 40px rgba(0,0,0,0.45);}
          h2{margin:0 0 10px;font-size:19px;color:#f3f4f6;}
          p{margin:0 0 18px;font-size:13.5px;color:#9ca3af;line-height:1.5;word-break:break-word;}
          .actions{display:flex;gap:10px;justify-content:center;}
          button{padding:9px 18px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;}
          .primary{background:#e6ca85;color:#111;}
          .secondary{background:rgba(255,255,255,0.08);color:#e5e7eb;}
        </style></head><body><div class="card">
          <h2>This page couldn't be loaded</h2>
          <p>${safeRetryUrl}<br><br>${errText}</p>
          <div class="actions">
            <button class="primary" id="crown-retry-btn">Retry</button>
          </div>
        </div>
        <script>
          document.getElementById('crown-retry-btn').addEventListener('click', function() {
            window.parent.postMessage({ type: 'crown:page-nav', tabId: ${JSON.stringify(tab.id)}, url: ${JSON.stringify(finalUrl)} }, '*');
          });
        </script>
        </body></html>`;
        return;
      }
    }

    iframe.removeAttribute('srcdoc');
    iframe.onload = () => {
      this._finishLoadingBar();
      try {
        const frameUrl = iframe.contentWindow?.location?.href;
        if (frameUrl && frameUrl !== 'about:blank' && frameUrl !== 'about:srcdoc' && Storage.isSafeUrl(frameUrl, false)) {
          if (tab.url !== frameUrl) {
            tab.url = frameUrl;
            try {
              if (iframe.contentDocument?.title) {
                tab.title = iframe.contentDocument.title.slice(0, 80);
              }
            } catch {}
            if (tab.id === this.tabEngine.activeTabId) {
              const omnibox = document.getElementById('omnibox-input');
              if (omnibox && document.activeElement !== omnibox) {
                omnibox.value = tab.url;
              }
              this.updateSecurityIndicatorUI(tab);
              this.updateBookmarkStarUI();
              this.updateReaderModeButtonUI(tab);
              this.updateNavButtonsUI();
            }
            this.tabEngine.render();
          }
        }
      } catch (err) {}
      if (this.devToolsOpen && tab.id === this.tabEngine.activeTabId) {
        this.refreshDevTools();
      }
    };
    if (iframe.src !== finalUrl) {
      iframe.src = finalUrl;
    } else {
      this._finishLoadingBar();
    }
  }

  // Navigation (Maintains True Per-Tab Back/Forward History Stack)
  navigateTo(inputUrl, tabId = this.tabEngine.activeTabId, options = { pushHistory: true }) {
    const tab = this.tabEngine.tabs.find(t => t.id === tabId);
    if (!tab) return;

    const trimmedInput = String(inputUrl || '').trim();
    let finalUrl = 'crown://newtab';
    if (trimmedInput.startsWith('http://') || trimmedInput.startsWith('https://') || trimmedInput.startsWith('crown://')) {
      const evaluation = shield.evaluateUrl(trimmedInput, tab.url, tab.isIncognito);
      const cleanCandidate = evaluation.cleanUrl || trimmedInput;
      finalUrl = Storage.isSafeUrl(cleanCandidate) ? cleanCandidate : 'crown://newtab';
    } else {
      const parsed = searchManager.parseInput(trimmedInput);
      const evaluation = shield.evaluateUrl(parsed, tab.url, tab.isIncognito);
      const candidateUrl = evaluation.cleanUrl || parsed;
      finalUrl = Storage.isSafeUrl(candidateUrl) ? candidateUrl : 'crown://newtab';
    }

    // Auto-detect downloadable file URLs and hand off to OS Download Manager
    if (Storage.isSafeUrl(finalUrl, false) && downloadManager.isDownloadableUrl(finalUrl)) {
      downloadManager.startDownload(finalUrl);
      this.syncActiveTab(tab);
      return;
    }

    // Maintain per-tab history stack
    if (!Array.isArray(tab.history)) {
      tab.history = [tab.url || 'crown://newtab'];
      tab.historyIndex = 0;
    }
    if (options.pushHistory !== false && tab.history[tab.historyIndex] !== finalUrl) {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
      tab.history.push(finalUrl);
      tab.historyIndex = tab.history.length - 1;
    }

    tab.url = finalUrl;
    tab.hibernated = false;
    tab.readerMode = false;
    tab.lastActiveAt = Date.now();
    tab.title = this._getTitleForUrl(finalUrl);
    tab.favicon = this.tabEngine._getFaviconSvg(finalUrl, tab.isIncognito);

    // Save to history (gated: never saves if incognito or internal newtab)
    if (finalUrl !== 'crown://newtab' && !InternalViews.isInternalUrl(finalUrl) && !tab.isIncognito) {
      Storage.addHistory({ title: tab.title, url: finalUrl, isIncognito: false });
    }

    let iframe = this.frames.get(tab.id) || document.getElementById(`iframe-${tab.id}`);
    const isCurrent = (tabId === this.tabEngine.activeTabId);

    let loadPromise = null;
    if (finalUrl === 'crown://newtab' || InternalViews.isInternalUrl(finalUrl)) {
      if (iframe) {
        iframe.classList.remove('active');
        iframe.removeAttribute('srcdoc');
        if (iframe.src && iframe.src !== 'about:blank') {
          iframe.src = 'about:blank';
        }
      }
    } else if (Storage.isSafeUrl(finalUrl, false)) {
      if (!iframe) {
        iframe = this.createFrame(tab.id);
      }
      loadPromise = this._loadFrameContent(iframe, finalUrl, tab);
    }

    if (isCurrent) {
      this.syncActiveTab(tab);
    } else if (this.splitViewActive && (tabId === this.splitSecondaryTabId || tabId === this.splitPrimaryTabId)) {
      this._applySplitViewLayout();
    }

    if (loadPromise && typeof loadPromise.finally === 'function') {
      loadPromise.finally(() => {
        this.tabEngine.enforceMemoryBudget();
      });
    } else {
      this.tabEngine.enforceMemoryBudget();
    }
    this.tabEngine.render();
  }

  goBack() {
    const tab = this.tabEngine.getActiveTab();
    if (!tab || !Array.isArray(tab.history) || tab.historyIndex <= 0) return;
    tab.historyIndex -= 1;
    const prevUrl = tab.history[tab.historyIndex];
    if (this._isNativeWebviewMode() && tab.url !== 'crown://newtab' && !InternalViews.isInternalUrl(tab.url) && prevUrl !== 'crown://newtab' && !InternalViews.isInternalUrl(prevUrl)) {
      window.__TAURI_INTERNALS__.invoke('tab_webview_action', {
        tabId: tab.id,
        action: 'back',
        profileId: Storage.getActiveProfileId()
      }).catch(() => {});
      this.updateNavButtonsUI();
      return;
    }
    this.navigateTo(prevUrl, tab.id, { pushHistory: false });
  }

  goForward() {
    const tab = this.tabEngine.getActiveTab();
    if (!tab || !Array.isArray(tab.history) || tab.historyIndex >= tab.history.length - 1) return;
    tab.historyIndex += 1;
    const nextUrl = tab.history[tab.historyIndex];
    if (this._isNativeWebviewMode() && tab.url !== 'crown://newtab' && !InternalViews.isInternalUrl(tab.url) && nextUrl !== 'crown://newtab' && !InternalViews.isInternalUrl(nextUrl)) {
      window.__TAURI_INTERNALS__.invoke('tab_webview_action', {
        tabId: tab.id,
        action: 'forward',
        profileId: Storage.getActiveProfileId()
      }).catch(() => {});
      this.updateNavButtonsUI();
      return;
    }
    this.navigateTo(nextUrl, tab.id, { pushHistory: false });
  }

  reload() {
    const tab = this.tabEngine.getActiveTab();
    if (!tab) return;
    if (this._isNativeWebviewMode() && tab.url !== 'crown://newtab' && !InternalViews.isInternalUrl(tab.url)) {
      window.__TAURI_INTERNALS__.invoke('tab_webview_action', {
        tabId: tab.id,
        action: 'reload',
        profileId: Storage.getActiveProfileId()
      }).catch(() => {});
      return;
    }
    this.navigateTo(tab.url, tab.id, { pushHistory: false });
  }

  updateNavButtonsUI() {
    const tab = this.tabEngine.getActiveTab();
    const backBtn = document.getElementById('nav-back-btn');
    const fwdBtn = document.getElementById('nav-forward-btn');
    const canBack = Boolean(tab && Array.isArray(tab.history) && tab.historyIndex > 0);
    const canFwd = Boolean(tab && Array.isArray(tab.history) && tab.historyIndex < tab.history.length - 1);

    if (backBtn) {
      backBtn.disabled = !canBack;
      backBtn.classList.toggle('disabled', !canBack);
    }
    if (fwdBtn) {
      fwdBtn.disabled = !canFwd;
      fwdBtn.classList.toggle('disabled', !canFwd);
    }
  }

  // Dynamic Website Favicon Helper for Shortcuts, Bookmarks & History
  _getSiteIconHtml(url, title, size = 22, customFavicon = null) {
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      host = '';
    }

    const globeSvg = `<svg class="crown-site-globe" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

    if (host && (url.startsWith('http://') || url.startsWith('https://'))) {
      let iconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size > 16 ? 64 : 32}`;
      if (Storage.isSafeImageUrl(customFavicon)) {
        iconUrl = customFavicon;
      }
      return `<img class="crown-site-favicon" src="${this._escape(iconUrl)}" width="${size}" height="${size}" alt="" loading="lazy" style="border-radius:3px;vertical-align:middle;object-fit:contain;" />${globeSvg}`;
    }

    if (size <= 18) {
      return globeSvg;
    }

    const letter = this._escape(((title || host || 'W').trim().charAt(0) || 'W').toUpperCase());
    return `<span>${letter}</span>`;
  }

  // Render Shortcuts (Brave-style 8-per-page Frequents Carousel: Pinned + Frequent + Add Button)
  renderShortcuts(force = false) {
    const grid = document.getElementById('ntp-shortcuts-grid');
    if (!grid) return;

    const PAGE_SIZE = 8;
    const MAX_AUTO_FREQUENT = 24;
    const pinned = Storage.getShortcuts();
    const frequent = Storage.getFrequentSites(MAX_AUTO_FREQUENT);

    // Link-only deduplication: prevent repeating the exact same normalized link while allowing subdomains (e.g. gemini.google.com + google.com)
    const seenUrls = new Set();
    const combined = [];

    for (const s of [...pinned, ...frequent]) {
      if (!s || !s.url) continue;
      const normalizedUrl = Storage.normalizeShortcutUrl(s.url);
      if (!normalizedUrl || seenUrls.has(normalizedUrl)) continue;

      seenUrls.add(normalizedUrl);
      combined.push(s);
    }

    const allSlots = [...combined, { __isAddTile: true }];
    const totalPages = Math.max(1, Math.ceil(allSlots.length / PAGE_SIZE));
    const currentPage = Math.max(0, Math.min(this._ntpShortcutsPage || 0, totalPages - 1));
    this._ntpShortcutsPage = currentPage;

    // Avoid tearing down DOM if shortcuts and page haven't changed
    const stateSignature = JSON.stringify({
      page: currentPage,
      items: combined.map(s => `${s.id}:${s.title}:${s.url}:${s.favicon || ''}`)
    });
    if (!force && this._lastShortcutsSignature === stateSignature && grid.children.length > 0) {
      return;
    }
    this._lastShortcutsSignature = stateSignature;

    grid.innerHTML = '';

    const pageSlots = allSlots.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
    pageSlots.forEach(s => {
      if (s.__isAddTile) {
        const addTile = document.createElement('div');
        addTile.className = 'shortcut-tile add-shortcut-tile';
        addTile.title = 'Add shortcut';
        addTile.innerHTML = `
          <div class="shortcut-icon-circle">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </div>
          <div class="shortcut-title">Add shortcut</div>
        `;
        addTile.onclick = () => this.openAddShortcutModal();
        grid.appendChild(addTile);
        return;
      }

      const tile = document.createElement('div');
      tile.className = 'shortcut-tile';
      tile.draggable = true;
      tile.addEventListener('dragstart', (e) => {
        if (e.dataTransfer && Storage.isSafeUrl(s.url, false)) {
          e.dataTransfer.effectAllowed = 'copyLink';
          e.dataTransfer.setData('text/uri-list', s.url);
          e.dataTransfer.setData('text/plain', s.url);
        }
      });
      const iconHtml = this._getSiteIconHtml(s.url, s.title, 22, s.favicon || null);

      tile.innerHTML = `
        <button class="shortcut-remove-btn" title="Remove ${this._escape(s.title)}" aria-label="Remove shortcut">✕</button>
        <div class="shortcut-icon-circle">${iconHtml}</div>
        <div class="shortcut-title">${this._escape(s.title)}</div>
      `;

      tile.onclick = (e) => {
        if (e.ctrlKey || e.metaKey) {
          this.tabEngine.createTab(s.url, this.isIncognitoWindow);
        } else {
          this.navigateTo(s.url);
        }
      };
      tile.addEventListener('auxclick', (e) => {
        if (e.button === 1 && !e.target.closest('.shortcut-remove-btn')) {
          e.preventDefault();
          e.stopPropagation();
          this.tabEngine.createTab(s.url, this.isIncognitoWindow);
        }
      });

      const removeBtn = tile.querySelector('.shortcut-remove-btn');
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        this.removeShortcut(s);
      };

      grid.appendChild(tile);
    });

    const pagination = document.getElementById('ntp-shortcuts-pagination');
    if (pagination) {
      if (totalPages > 1) {
        pagination.classList.add('visible');
        pagination.innerHTML = `
          <button type="button" class="ntp-page-arrow" id="ntp-page-prev" title="Previous page" aria-label="Previous shortcuts page" ${currentPage === 0 ? 'disabled' : ''}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="ntp-page-dots">
            ${Array.from({ length: totalPages }, (_, idx) => `
              <button type="button" class="ntp-page-dot ${idx === currentPage ? 'active' : ''}" data-page="${idx}" title="Page ${idx + 1} of ${totalPages}" aria-label="Shortcuts page ${idx + 1}" aria-current="${idx === currentPage ? 'page' : 'false'}"></button>
            `).join('')}
          </div>
          <button type="button" class="ntp-page-arrow" id="ntp-page-next" title="Next page" aria-label="Next shortcuts page" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        `;
        pagination.querySelector('#ntp-page-prev')?.addEventListener('click', () => {
          if (this._ntpShortcutsPage > 0) {
            this._ntpShortcutsPage -= 1;
            this.renderShortcuts(true);
          }
        });
        pagination.querySelector('#ntp-page-next')?.addEventListener('click', () => {
          if (this._ntpShortcutsPage < totalPages - 1) {
            this._ntpShortcutsPage += 1;
            this.renderShortcuts(true);
          }
        });
        pagination.querySelectorAll('.ntp-page-dot').forEach(dot => {
          dot.addEventListener('click', () => {
            const target = parseInt(dot.getAttribute('data-page') || '0', 10);
            if (!Number.isNaN(target) && target !== this._ntpShortcutsPage) {
              this._ntpShortcutsPage = target;
              this.renderShortcuts(true);
            }
          });
        });
      } else {
        pagination.classList.remove('visible');
        pagination.innerHTML = '';
      }
    }
  }

  removeShortcut(shortcut) {
    try {
      const host = new URL(shortcut.url).hostname.toLowerCase().replace(/^www\./, '');
      Storage.addDismissedShortcut(host);
    } catch {}

    if (shortcut.pinned !== false) {
      const targetNorm = Storage.normalizeShortcutUrl(shortcut.url);
      const updated = Storage.getShortcuts().filter(
        item => item.id !== shortcut.id && Storage.normalizeShortcutUrl(item.url) !== targetNorm
      );
      Storage.saveShortcuts(updated);
    }
    this.renderShortcuts(true);
  }

  openAddShortcutModal() {
    const modal = document.getElementById('shortcut-modal-overlay');
    const nameInput = document.getElementById('shortcut-name-input');
    const urlInput = document.getElementById('shortcut-url-input');
    const errEl = document.getElementById('shortcut-error-text');
    if (!modal || !nameInput || !urlInput) return;

    nameInput.value = '';
    urlInput.value = '';
    if (errEl) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    }
    modal.classList.add('open');
    setTimeout(() => nameInput.focus(), 40);
  }

  saveNewShortcut() {
    const modal = document.getElementById('shortcut-modal-overlay');
    const nameInput = document.getElementById('shortcut-name-input');
    const urlInput = document.getElementById('shortcut-url-input');
    const errEl = document.getElementById('shortcut-error-text');
    if (!nameInput || !urlInput) return;

    let rawUrl = urlInput.value.trim();
    if (!rawUrl) {
      if (errEl) {
        errEl.textContent = 'Please enter a website URL.';
        errEl.style.display = 'block';
      }
      return;
    }
    if (!/^https?:\/\//i.test(rawUrl)) {
      rawUrl = `https://${rawUrl}`;
    }

    if (!Storage.isSafeUrl(rawUrl, false)) {
      if (errEl) {
        errEl.textContent = 'Please enter a valid http:// or https:// website URL.';
        errEl.style.display = 'block';
      }
      return;
    }

    let host = '';
    try {
      host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return;
    }

    const normalizedNew = Storage.normalizeShortcutUrl(rawUrl);
    const list = Storage.getShortcuts();
    if (normalizedNew && list.some(item => Storage.normalizeShortcutUrl(item.url) === normalizedNew)) {
      if (errEl) {
        errEl.textContent = 'This shortcut link already exists.';
        errEl.style.display = 'block';
      }
      return;
    }

    const title = nameInput.value.trim() || (host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1));
    Storage.removeDismissedShortcut(host);

    list.push({
      id: `sc-${Date.now()}`,
      title,
      url: rawUrl,
      pinned: true
    });
    Storage.saveShortcuts(list);
    this._ntpShortcutsPage = Math.max(0, Math.floor((list.length - 1) / 8));
    modal?.classList.remove('open');
    this.renderShortcuts(true);
    this.showToast(`Added "${title}" shortcut`);
  }

  // Chrome/Brave-Style Dynamic Bookmarks Bar with Automatic Overflow ('»' Menu)
  initBookmarksResizeObserver() {
    const bar = document.getElementById('crown-bookmarks-bar');
    if (!bar || typeof ResizeObserver === 'undefined') return;

    this.bookmarksResizeObserver = new ResizeObserver(() => {
      this.renderBookmarksBar();
    });
    this.bookmarksResizeObserver.observe(bar);
  }

  renderBookmarksBar() {
    const bar = document.getElementById('crown-bookmarks-bar');
    const itemsContainer = document.getElementById('bookmarks-bar-items');
    const overflowBtn = document.getElementById('bookmarks-overflow-btn');
    const overflowMenu = document.getElementById('bookmarks-overflow-menu');
    const leftFixed = bar?.querySelector('.bookmarks-bar-left-fixed');
    const rightControls = bar?.querySelector('.bookmarks-bar-right-controls');

    if (!bar || !itemsContainer || !overflowBtn || !overflowMenu) return;

    const allBookmarks = Storage.getBookmarks().filter(bm => Storage.isSafeUrl(bm.url));
    itemsContainer.innerHTML = '';
    overflowMenu.innerHTML = '';

    // Calculate available horizontal space for bookmark items
    const barWidth = bar.clientWidth || window.innerWidth || 1000;
    const leftWidth = leftFixed ? (leftFixed.offsetWidth || 165) : 165;
    const rightWidth = rightControls ? Math.max(rightControls.offsetWidth || 0, 145) : 145;
    const availableWidth = Math.max(80, barWidth - leftWidth - rightWidth - 36);

    const visible = [];
    const overflowed = [];
    let usedWidth = 0;

    allBookmarks.forEach((bm, idx) => {
      const el = document.createElement('div');
      el.className = 'bookmark-item';
      el.dataset.bmId = bm.id || '';
      el.dataset.bmIndex = String(idx);
      el.title = `${bm.title}\n${bm.url}`;
      el.innerHTML = `
        ${this._getSiteIconHtml(bm.url, bm.title, 14, bm.favicon)}
        <span>${this._escape(bm.title)}</span>
      `;
      itemsContainer.appendChild(el);

      const measuredWidth = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect().width : 0;
      const labelLen = Math.min((bm.title || '').length, 20);
      const itemWidth = measuredWidth > 10 ? measuredWidth : Math.min(170, 34 + labelLen * 6.8);

      if (overflowed.length === 0 && (usedWidth + itemWidth <= availableWidth || visible.length === 0)) {
        visible.push({ bm, idx, el });
        usedWidth += itemWidth + 4;
      } else {
        el.remove();
        overflowed.push({ bm, idx });
      }
    });

    this.overflowBookmarks = overflowed.map(x => x.bm);

    // Bind click, middle-click, right-click context menu & pointer drag-and-slide on visible bar pills
    visible.forEach(({ bm, idx, el }) => {
      el.onclick = (e) => {
        if (el.dataset.justDragged === '1') return;
        if (e.ctrlKey || e.metaKey) {
          this.tabEngine.createTab(bm.url, this.isIncognitoWindow);
        } else {
          this.navigateTo(bm.url);
        }
      };
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          this.tabEngine.createTab(bm.url, this.isIncognitoWindow);
        }
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._showBookmarkContextMenu(e.clientX, e.clientY, bm);
      });
      this._bindBookmarkBarDragReorder(el, idx, itemsContainer);
    });

    // Toggle '»' overflow button and populate dropdown menu
    if (overflowed.length > 0) {
      overflowBtn.style.display = 'flex';
      overflowBtn.title = `Hidden bookmarks (${overflowed.length})`;

      overflowed.forEach(({ bm, idx }) => {
        const row = document.createElement('div');
        row.className = 'overflow-bookmark-item';
        row.dataset.bmId = bm.id || '';
        row.dataset.bmIndex = String(idx);
        row.setAttribute('role', 'menuitem');
        row.title = `${bm.title}\n${bm.url}`;
        row.innerHTML = `
          <span class="overflow-bm-icon">${this._getSiteIconHtml(bm.url, bm.title, 15, bm.favicon)}</span>
          <span class="overflow-bm-title">${this._escape(bm.title)}</span>
          <button class="overflow-bm-edit" title="Edit bookmark" aria-label="Edit bookmark">✎</button>
          <button class="overflow-bm-delete" title="Remove bookmark" aria-label="Remove bookmark">✕</button>
        `;
        row.onclick = (e) => {
          if (row.dataset.justDragged === '1') return;
          if (e.target.closest('.overflow-bm-delete, .overflow-bm-edit')) return;
          overflowMenu.classList.remove('open');
          overflowBtn.classList.remove('active');
          if (e.ctrlKey || e.metaKey) {
            this.tabEngine.createTab(bm.url, this.isIncognitoWindow);
          } else {
            this.navigateTo(bm.url);
          }
        };
        row.addEventListener('auxclick', (e) => {
          if (e.button === 1 && !e.target.closest('.overflow-bm-delete, .overflow-bm-edit')) {
            e.preventDefault();
            e.stopPropagation();
            overflowMenu.classList.remove('open');
            overflowBtn.classList.remove('active');
            this.tabEngine.createTab(bm.url, this.isIncognitoWindow);
          }
        });
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._showBookmarkContextMenu(e.clientX, e.clientY, bm);
        });
        row.querySelector('.overflow-bm-edit').onclick = (e) => {
          e.stopPropagation();
          overflowMenu.classList.remove('open');
          overflowBtn.classList.remove('active');
          this.openBookmarkModal(bm.title, bm.url, () => this.renderBookmarksBar(), bm.id);
        };
        row.querySelector('.overflow-bm-delete').onclick = (e) => {
          e.stopPropagation();
          const updated = Storage.getBookmarks().filter(item => item.id !== bm.id && item.url !== bm.url);
          Storage.saveBookmarks(updated);
          this.updateBookmarkStarUI();
        };
        this._bindOverflowBookmarkDragReorder(row, idx, overflowMenu);
        overflowMenu.appendChild(row);
      });
    } else {
      overflowBtn.style.display = 'none';
      overflowBtn.classList.remove('active');
      overflowMenu.classList.remove('open');
    }
  }

  // Pointer-based Drag-and-Slide Reordering with FLIP animation on Bookmarks Bar
  _bindBookmarkBarDragReorder(el, initialIndex, container) {
    el.addEventListener('pointerdown', (downEvent) => {
      if (downEvent.button !== 0) return;
      const startX = downEvent.clientX;
      const startY = downEvent.clientY;
      let dragging = false;

      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!dragging) {
          if (Math.hypot(dx, dy) < 5) return;
          dragging = true;
          el.classList.add('bm-dragging');
          el.dataset.justDragged = '1';
        }

        const siblings = [...container.querySelectorAll('.bookmark-item')];
        for (const sib of siblings) {
          if (sib === el) continue;
          const rect = sib.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          if (moveEvent.clientX >= rect.left && moveEvent.clientX <= rect.right) {
            const firstRects = new Map(siblings.map(node => [node, node.getBoundingClientRect()]));
            if (moveEvent.clientX < centerX) {
              container.insertBefore(el, sib);
            } else {
              container.insertBefore(el, sib.nextSibling);
            }
            // FLIP smooth slide transition on shifted neighbours
            siblings.forEach(node => {
              if (node === el) return;
              const prev = firstRects.get(node);
              const next = node.getBoundingClientRect();
              const deltaX = prev ? (prev.left - next.left) : 0;
              if (Math.abs(deltaX) > 1) {
                node.style.transition = 'none';
                node.style.transform = `translateX(${deltaX}px)`;
                requestAnimationFrame(() => {
                  node.style.transition = 'transform 150ms cubic-bezier(0.22, 1, 0.36, 1)';
                  node.style.transform = '';
                });
              }
            });
            break;
          }
        }
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (!dragging) return;
        el.classList.remove('bm-dragging');
        const orderedEls = [...container.querySelectorAll('.bookmark-item')];
        const newPos = orderedEls.indexOf(el);
        if (newPos !== -1 && newPos !== initialIndex) {
          Storage.reorderBookmarks(initialIndex, newPos);
        }
        setTimeout(() => { delete el.dataset.justDragged; }, 80);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  // Vertical Pointer-based Drag-and-Slide Reordering inside '»' Overflow Dropdown
  _bindOverflowBookmarkDragReorder(row, initialIndex, menuContainer) {
    row.addEventListener('pointerdown', (downEvent) => {
      if (downEvent.button !== 0 || downEvent.target.closest('button')) return;
      const startY = downEvent.clientY;
      let dragging = false;

      const onMove = (moveEvent) => {
        if (!dragging) {
          if (Math.abs(moveEvent.clientY - startY) < 5) return;
          dragging = true;
          row.classList.add('bm-dragging');
          row.dataset.justDragged = '1';
        }
        const rows = [...menuContainer.querySelectorAll('.overflow-bookmark-item')];
        for (const sib of rows) {
          if (sib === row) continue;
          const rect = sib.getBoundingClientRect();
          const centerY = rect.top + rect.height / 2;
          if (moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom) {
            if (moveEvent.clientY < centerY) {
              menuContainer.insertBefore(row, sib);
            } else {
              menuContainer.insertBefore(row, sib.nextSibling);
            }
            break;
          }
        }
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (!dragging) return;
        row.classList.remove('bm-dragging');
        const rows = [...menuContainer.querySelectorAll('.overflow-bookmark-item')];
        const visibleCount = document.querySelectorAll('#bookmarks-bar-items .bookmark-item').length;
        const newIdxInMenu = rows.indexOf(row);
        if (newIdxInMenu !== -1) {
          const targetGlobalIdx = visibleCount + newIdxInMenu;
          if (targetGlobalIdx !== initialIndex) {
            Storage.reorderBookmarks(initialIndex, targetGlobalIdx);
          }
        }
        setTimeout(() => { delete row.dataset.justDragged; }, 80);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  // Right-Click Context Menu for Bookmarks (Bar & Overflow Menu)
  _showBookmarkContextMenu(x, y, bm) {
    const menu = document.getElementById('bookmark-context-menu');
    if (!menu || !bm) return;

    menu.innerHTML = `
      <div class="menu-item" data-bm-action="open-new-tab">Open in New Tab</div>
      <div class="menu-item" data-bm-action="open-incognito">Open in Incognito Window</div>
      <div class="menu-item" data-bm-action="open-split">Open in Split View</div>
      <div class="menu-divider"></div>
      <div class="menu-item" data-bm-action="edit">Edit Bookmark...</div>
      <div class="menu-item danger" data-bm-action="delete">Remove Bookmark</div>
    `;

    menu.style.left = `${Math.min(x, (window.innerWidth || 1000) - 210)}px`;
    menu.style.top = `${Math.min(y, (window.innerHeight || 700) - 210)}px`;
    menu.classList.add('open');

    menu.onclick = (e) => {
      const item = e.target.closest('.menu-item');
      if (!item) return;
      const action = item.dataset.bmAction;
      menu.classList.remove('open');

      if (action === 'open-new-tab') {
        this.tabEngine.createTab(bm.url, this.isIncognitoWindow);
      } else if (action === 'open-incognito') {
        this.openIncognitoWindow(bm.url);
      } else if (action === 'open-split') {
        const newId = this.tabEngine.createTab(bm.url, this.isIncognitoWindow);
        this.toggleSplitView(newId);
      } else if (action === 'edit') {
        this.openBookmarkModal(bm.title, bm.url, () => {
          this.renderBookmarksBar();
          this.updateBookmarkStarUI();
        }, bm.id);
      } else if (action === 'delete') {
        const updated = Storage.getBookmarks().filter(b => b.id !== bm.id && b.url !== bm.url);
        Storage.saveBookmarks(updated);
        this.updateBookmarkStarUI();
        this.showToast('Bookmark removed');
      }
    };
  }

  toggleBookmarkCurrentTab() {
    const tab = this.tabEngine.getActiveTab();
    if (!tab) return;

    // If on New Tab or internal page, open the in-app Add Bookmark modal
    if (tab.url === 'crown://newtab' || InternalViews.isInternalUrl(tab.url)) {
      this.openBookmarkModal('', 'https://', () => {
        this.updateBookmarkStarUI();
      });
      return;
    }

    const list = Storage.getBookmarks();
    const existingIdx = list.findIndex(b => b.url === tab.url);

    if (existingIdx !== -1) {
      list.splice(existingIdx, 1);
      Storage.saveBookmarks(list);
      this.updateBookmarkStarUI();
      this.showToast('Bookmark removed');
    } else {
      const bmTitle = tab.title || this._getTitleForUrl(tab.url);
      list.push({
        id: `bm-${Date.now()}`,
        title: bmTitle,
        url: tab.url,
        favicon: tab.favicon || ''
      });
      Storage.saveBookmarks(list);
      this.updateBookmarkStarUI();
      this.showToast(`Bookmarked "${bmTitle}"`);
    }
  }

  updateBookmarkStarUI() {
    const starBtn = document.getElementById('omnibox-bookmark-btn');
    const tab = this.tabEngine.getActiveTab();
    if (!starBtn || !tab) return;

    const isBookmarked = Storage.getBookmarks().some(b => b.url === tab.url);
    starBtn.classList.toggle('bookmarked', isBookmarked);
    starBtn.title = isBookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this tab (Ctrl+D)';
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
            <span class="chip-type type-${this._escape(item.type)}">${this._escape(item.type)}</span>
            <span class="chip-target" title="${this._escape(item.target)}">${this._escape(item.target)}</span>
          </div>
        `).join('');
      }
    }
  }

  updateShieldBadge() {
    this.updateShieldButton();
  }

  // Appearance & Themes (Hardened against CSS injection & SVG script payloads)
  applyCustomBackground(overrideBg = null) {
    const ntp = document.getElementById('new-tab-dashboard');
    if (!ntp) return;
    if (this.isIncognitoWindow) {
      ntp.style.backgroundImage = 'none';
      ntp.style.backgroundColor = 'var(--cr-ntp-bg)';
      return;
    }
    const s = Storage.getSettings();
    const customBg = (overrideBg !== null ? overrideBg : (s.customBackground || localStorage.getItem('crown_custom_bg') || '')).trim();
    const isSafeWallpaper = /^(https:\/\/[^\s"'()\\]+|data:image\/(png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=]+)$/i.test(customBg);

    if (customBg && isSafeWallpaper && (!s.wallpaper || s.wallpaper === 'custom')) {
      ntp.dataset.wallpaper = 'custom';
      ntp.style.backgroundImage = `url("${encodeURI(customBg)}")`;
      ntp.style.backgroundSize = 'cover';
      ntp.style.backgroundPosition = 'center';
      ntp.style.backgroundColor = 'transparent';
    } else {
      ntp.style.backgroundImage = '';
      ntp.style.backgroundColor = '';
      ntp.dataset.wallpaper = s.wallpaper || 'obsidian';
    }
  }

  applyAccentColor() {
    const accent = Storage.sanitizeColor(Storage.getSettings().accentColor, '#e6ca85');
    const root = document.documentElement;
    root.style.setProperty('--cr-accent-gold', accent);
    root.style.setProperty('--cr-accent-gold-hover', accent);
    // Parse #rrggbb to compute translucent dim and border-accent variables
    const hex = accent.replace('#', '');
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        root.style.setProperty('--cr-accent-gold-dim', `rgba(${r}, ${g}, ${b}, 0.14)`);
        root.style.setProperty('--cr-border-accent', `rgba(${r}, ${g}, ${b}, 0.32)`);
      }
    }
  }

  // Live broadcast of page settings & active extensions to all open child <iframe> tabs & native child webviews
  broadcastPageSettingsToFrames() {
    this._syncNativeShieldConfig();
    const s = Storage.getSettings();
    const minFontNum = Number(s.minFontSize) || 0;
    const minFontCss = minFontNum >= 10
      ? `html, body, p, li, a, span, div { font-size: max(${minFontNum}px, 1em) !important; }`
      : '';
    const extPayload = Storage.buildActiveExtensionPayload();

    if (this._isNativeWebviewMode()) {
      for (const tab of this.tabEngine.tabs) {
        if (!tab.url || tab.url === 'crown://newtab' || InternalViews.isInternalUrl(tab.url)) continue;
        const domain = shield._cleanHostname(tab.url);
        const cosmeticCss = (s.shieldsEnabled !== false && s.blockCookieNotices !== false)
          ? shield.getCosmeticCss(domain)
          : '';
        const combinedCss = [cosmeticCss, minFontCss, extPayload.css].filter(Boolean).join('\n');
        window.__TAURI_INTERNALS__.invoke('update_tab_webview_settings', {
          tabId: tab.id,
          cosmeticCss: combinedCss,
          extensionJs: extPayload.js || '',
          spellcheck: s.spellcheck !== false,
          profileId: Storage.getActiveProfileId()
        }).catch(() => {});
      }
    }

    this.frames.forEach((iframe, tabId) => {
      try {
        const tab = this.tabEngine.tabs.find(t => t.id === tabId);
        const domain = shield._cleanHostname(tab?.url || '');
        const cosmeticCss = (s.shieldsEnabled !== false && s.blockCookieNotices !== false)
          ? shield.getCosmeticCss(domain)
          : '';
        const combinedCss = [cosmeticCss, minFontCss, extPayload.css].filter(Boolean).join('\n');

        iframe.contentWindow?.postMessage({
          type: 'crown:apply-page-settings',
          css: combinedCss,
          js: extPayload.js,
          extJs: extPayload.js,
          spellcheck: s.spellcheck !== false
        }, '*');

        // Direct DOM fallback for same-origin / srcdoc frames
        const doc = iframe.contentDocument;
        if (doc && doc.head) {
          let styleEl = doc.getElementById('crown-shield-cosmetic');
          if (!styleEl) {
            styleEl = doc.createElement('style');
            styleEl.id = 'crown-shield-cosmetic';
            doc.head.appendChild(styleEl);
          }
          styleEl.textContent = combinedCss;
          if (doc.body) {
            doc.body.spellcheck = s.spellcheck !== false;
          }
        }
      } catch {}
    });
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

  // In-App Toast Notification System
  showToast(message, type = 'info') {
    const container = document.getElementById('crown-toast-container');
    if (!container || !message) return;

    const toast = document.createElement('div');
    toast.className = `crown-toast ${type === 'error' ? 'toast-error' : ''}`.trim();
    toast.innerHTML = `
      <span class="crown-toast-dot"></span>
      <span>${this._escape(message)}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
      toast.style.transition = 'opacity 0.16s ease, transform 0.16s ease';
      setTimeout(() => toast.remove(), 180);
    }, 2600);
  }

  // In-App Add / Edit Bookmark Modal (Replaces browser prompt/alert popups)
  openBookmarkModal(initialTitle = '', initialUrl = 'https://', onSaved = null, editingBookmarkId = null) {
    const modal = document.getElementById('bookmark-modal-overlay');
    const titleEl = document.getElementById('bookmark-modal-title');
    const nameInput = document.getElementById('bookmark-name-input');
    const urlInput = document.getElementById('bookmark-url-input');
    const errEl = document.getElementById('bookmark-error-text');
    if (!modal || !nameInput || !urlInput) return;

    this._editingBookmarkId = editingBookmarkId || null;
    if (titleEl) {
      titleEl.textContent = editingBookmarkId ? 'Edit Bookmark' : 'Add Bookmark';
    }
    nameInput.value = initialTitle || '';
    urlInput.value = initialUrl || 'https://';
    if (errEl) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    }
    this._onBookmarkModalSaved = onSaved;
    modal.classList.add('open');
    setTimeout(() => nameInput.focus(), 40);
  }

  saveBookmarkFromModal() {
    const modal = document.getElementById('bookmark-modal-overlay');
    const nameInput = document.getElementById('bookmark-name-input');
    const urlInput = document.getElementById('bookmark-url-input');
    const errEl = document.getElementById('bookmark-error-text');
    if (!nameInput || !urlInput) return;

    let rawUrl = urlInput.value.trim();
    if (!rawUrl || rawUrl === 'https://') {
      if (errEl) {
        errEl.textContent = 'Please enter a valid website URL.';
        errEl.style.display = 'block';
      }
      return;
    }
    if (!/^https?:\/\//i.test(rawUrl) && !InternalViews.isInternalUrl(rawUrl)) {
      rawUrl = `https://${rawUrl}`;
    }

    if (!Storage.isSafeUrl(rawUrl)) {
      if (errEl) {
        errEl.textContent = 'Invalid or unsafe URL. Only http(s) and crown:// URLs are allowed.';
        errEl.style.display = 'block';
      }
      return;
    }

    let fallbackTitle = rawUrl;
    try {
      fallbackTitle = new URL(rawUrl).hostname.replace(/^www\./, '');
    } catch {}

    const title = nameInput.value.trim() || fallbackTitle;
    if (this._editingBookmarkId) {
      Storage.updateBookmark(this._editingBookmarkId, { title, url: rawUrl, favicon: '' });
      this._editingBookmarkId = null;
      this.updateBookmarkStarUI();
      modal?.classList.remove('open');
      if (typeof this._onBookmarkModalSaved === 'function') {
        this._onBookmarkModalSaved();
      }
      this.showToast(`Updated "${title}"`);
    } else {
      const list = Storage.getBookmarks();
      list.push({ id: `bm-${Date.now()}`, title, url: rawUrl });
      Storage.saveBookmarks(list);
      this.updateBookmarkStarUI();
      modal?.classList.remove('open');
      if (typeof this._onBookmarkModalSaved === 'function') {
        this._onBookmarkModalSaved();
      }
      this.showToast(`Bookmarked "${title}"`);
    }
  }

  // In-App Tab Group Creator / Editor Modal (Replaces browser prompt popups)
  openTabGroupModal({ title = 'New Tab Group', initialName = '', initialColor = '#e6ca85', onSave = null }) {
    const modal = document.getElementById('tab-group-modal-overlay');
    const titleEl = document.getElementById('tab-group-modal-title');
    const nameInput = document.getElementById('tab-group-name-input');
    const swatches = document.querySelectorAll('#tab-group-color-row .group-color-swatch');
    if (!modal || !nameInput) return;

    if (titleEl) titleEl.textContent = title;
    nameInput.value = initialName || '';
    this._selectedGroupColor = Storage.sanitizeColor(initialColor, '#e6ca85');
    this._onTabGroupModalSave = onSave;

    swatches.forEach(s => {
      s.classList.toggle('selected', s.dataset.color === this._selectedGroupColor);
    });

    modal.classList.add('open');
    setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 40);
  }

  saveTabGroupFromModal() {
    const modal = document.getElementById('tab-group-modal-overlay');
    const nameInput = document.getElementById('tab-group-name-input');
    if (!nameInput) return;

    const name = nameInput.value.trim() || 'Group';
    const color = Storage.sanitizeColor(this._selectedGroupColor, '#e6ca85');
    modal?.classList.remove('open');
    if (typeof this._onTabGroupModalSave === 'function') {
      this._onTabGroupModalSave(name, color);
    }
  }

  // In-App Clear Browsing Data Modal (Replaces browser confirm popup)
  openClearDataModal(onCleared = null) {
    const modal = document.getElementById('clear-data-modal-overlay');
    if (!modal) return;
    this._onClearDataDone = onCleared;
    modal.classList.add('open');
  }

  async confirmClearBrowsingData() {
    const modal = document.getElementById('clear-data-modal-overlay');
    const rangeVal = document.getElementById('clear-data-range-select')?.value || 'all';
    const clearHist = document.getElementById('clear-opt-history')?.checked !== false;
    const clearCookies = document.getElementById('clear-opt-cookies')?.checked !== false;
    const clearCache = document.getElementById('clear-opt-cache')?.checked !== false;
    const clearDownloads = document.getElementById('clear-opt-downloads')?.checked === true;
    const clearPerms = document.getElementById('clear-opt-perms')?.checked === true;
    const clearShield = document.getElementById('clear-opt-shield')?.checked === true;

    const activeProfileId = Storage.getActiveProfileId();
    await Storage.clearProfileBrowsingData({
      profileId: activeProfileId,
      timeRange: rangeVal,
      history: clearHist,
      cookies: clearCookies,
      cache: clearCache,
      downloads: clearDownloads,
      sitePermissions: clearPerms
    });

    if (clearHist) {
      this.renderShortcuts(true);
    }

    if (clearShield) {
      shield.globalStats = {
        adsBlockedTotal: 0,
        trackersBlockedTotal: 0,
        paramsCleanedTotal: 0,
        bandwidthSavedMB: 0.0,
        timeSavedSec: 0.0
      };
      Storage.saveShieldStats(shield.globalStats);
      this.renderDefenseHub();
      this.updateShieldButton();
    }

    // Reload live open web tabs in the cleared profile so cached/signed-in DOM resets immediately
    if ((clearCookies || clearCache) && !this.isIncognitoWindow) {
      for (const tab of this.tabEngine.tabs) {
        if (!tab.isIncognito && !tab.hibernated && tab.url && tab.url !== 'crown://newtab' && !InternalViews.isInternalUrl(tab.url)) {
          if (this._isNativeWebviewMode()) {
            window.__TAURI_INTERNALS__.invoke('tab_webview_action', {
              tabId: tab.id,
              action: 'reload',
              profileId: activeProfileId
            }).catch(() => {});
          } else {
            this.navigateTo(tab.url, tab.id, { pushHistory: false });
          }
        }
      }
    }

    modal?.classList.remove('open');
    if (typeof this._onClearDataDone === 'function') {
      this._onClearDataDone();
    }
    this.showToast('Selected browsing data cleared');
  }

  // Omnibox Site Info & Permissions Popover
  toggleSiteInfoPopover() {
    const popover = document.getElementById('site-info-popover');
    if (!popover) return;
    if (popover.style.display === 'flex') {
      this.closeSiteInfoPopover();
    } else {
      this.openSiteInfoPopover();
    }
  }

  openSiteInfoPopover() {
    const popover = document.getElementById('site-info-popover');
    if (!popover) return;
    const activeTab = this.tabEngine.getActiveTab();
    const url = activeTab?.url || 'crown://newtab';
    const isInternal = url.startsWith('crown://') || url === 'about:blank';

    const domainEl = document.getElementById('site-info-domain');
    const statusEl = document.getElementById('site-info-security-status');
    const cookiesLabel = document.getElementById('site-info-cookies-label');
    const shieldToggle = document.getElementById('site-info-shield-toggle');

    if (isInternal) {
      if (domainEl) domainEl.textContent = 'Crown Internal Page';
      if (statusEl) {
        statusEl.textContent = 'Secure internal view';
        statusEl.className = 'site-info-subtitle';
      }
      if (cookiesLabel) cookiesLabel.textContent = 'Zero cookies stored';
      if (shieldToggle) shieldToggle.checked = true;
    } else {
      let host = '';
      try { host = new URL(url).hostname; } catch { host = url; }
      if (domainEl) domainEl.textContent = host;
      const isHttps = url.startsWith('https://');
      if (statusEl) {
        statusEl.textContent = isHttps ? 'Connection is secure (HTTPS)' : 'Connection is not secure (HTTP)';
        statusEl.className = `site-info-subtitle ${isHttps ? '' : 'warning'}`;
      }

      // Populate current site permissions
      const perms = Storage.getSitePermissions(url);
      ['camera', 'microphone', 'location', 'notifications'].forEach(key => {
        const select = document.getElementById(`perm-select-${key}`);
        if (select) select.value = perms[key] || 'ask';
      });

      // Cookies count
      const cookies = Storage.getStoredCookies(url);
      if (cookiesLabel) {
        cookiesLabel.textContent = `${cookies.length} cookie${cookies.length === 1 ? '' : 's'} stored`;
      }

      // Shield toggle
      const cleanHost = shield._cleanHostname(url);
      if (shieldToggle) {
        shieldToggle.checked = shield.isShieldEnabledForSite(cleanHost);
      }
    }

    popover.style.display = 'flex';
  }

  closeSiteInfoPopover() {
    const popover = document.getElementById('site-info-popover');
    if (popover) popover.style.display = 'none';
  }

  // Shared Suggestion Builder (Combines Bookmarks, History & Live Search Engine Autocomplete)
  async _buildSuggestionsList(rawQuery) {
    const trimmed = (rawQuery || '').trim();
    const q = trimmed.toLowerCase();
    if (!q) return [];

    const matches = [];
    const seen = new Set();

    // 1. Direct URL or Search action at top
    const isLikelyUrl = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/.test(trimmed) || /^https?:\/\//i.test(trimmed);
    const providerName = (searchManager.currentProvider || 'google').toUpperCase();
    if (isLikelyUrl) {
      const fullUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      seen.add(fullUrl.toLowerCase());
      matches.push({ title: trimmed, url: fullUrl, type: 'URL' });
    } else {
      seen.add(q);
      matches.push({
        title: `${trimmed} — Search ${providerName}`,
        url: trimmed,
        type: 'Search'
      });
    }

    // 2. Match Bookmarks
    Storage.getBookmarks().forEach(bm => {
      if (!bm.url || matches.length >= 4) return;
      const key = bm.url.toLowerCase();
      if (seen.has(key)) return;
      if ((bm.title || '').toLowerCase().includes(q) || key.includes(q)) {
        seen.add(key);
        matches.push({ title: bm.title || bm.url, url: bm.url, type: 'Bookmark' });
      }
    });

    // 3. Match History
    Storage.getHistory().forEach(h => {
      if (!h.url || matches.length >= 5) return;
      const key = h.url.toLowerCase();
      if (seen.has(key)) return;
      if ((h.title || '').toLowerCase().includes(q) || key.includes(q)) {
        seen.add(key);
        matches.push({ title: h.title || h.url, url: h.url, type: 'History' });
      }
    });

    // 4. Live Search Engine Autocomplete Queries
    const liveQueries = await searchManager.getSuggestions(trimmed);
    for (const phrase of liveQueries) {
      if (matches.length >= 8) break;
      const clean = (phrase || '').trim();
      const lowerPhrase = clean.toLowerCase();
      if (!clean || seen.has(lowerPhrase)) continue;
      seen.add(lowerPhrase);
      const isSiteSuggestion = /^https?:\/\//i.test(clean);
      matches.push({
        title: isSiteSuggestion ? clean.replace(/^https?:\/\//i, '') : clean,
        url: clean,
        type: isSiteSuggestion ? 'URL' : 'Suggest'
      });
    }

    return matches.slice(0, 7);
  }

  _renderSuggestionsDropdown(box, list, inputEl, stateKey) {
    if (!box) return;
    if (!list || list.length === 0) {
      box.classList.remove('open');
      box.innerHTML = '';
      this[stateKey] = { items: [], selectedIdx: -1 };
      return;
    }

    this[stateKey] = { items: list, selectedIdx: -1 };

    box.innerHTML = list.map((item, idx) => `
      <div class="omnibox-suggestion-item" role="option" data-idx="${idx}">
        <span class="suggestion-icon">${(item.type === 'Search' || item.type === 'Suggest')
          ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>'
          : this._getSiteIconHtml(item.url, item.title, 14)
        }</span>
        <div class="suggestion-body">
          <span class="suggestion-title">${this._escape(item.title)}</span>
          ${(item.type !== 'Search' && item.type !== 'Suggest') ? `<span class="suggestion-url">${this._escape(item.url)}</span>` : ''}
        </div>
        <span class="suggestion-type-badge">${this._escape(item.type)}</span>
      </div>
    `).join('');

    box.querySelectorAll('.omnibox-suggestion-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const chosen = list[Number(el.dataset.idx)];
        if (chosen) {
          box.classList.remove('open');
          this.navigateTo(chosen.url);
          inputEl?.blur();
        }
      });
    });

    box.classList.add('open');
    if (box.id === 'omnibox-suggestions') {
      this._syncNativeWebviews();
    }
  }

  // Live Omnibox Autocomplete (Matches Bookmarks, History & Live Search Suggestions)
  async _renderOmniboxSuggestions(query) {
    const box = document.getElementById('omnibox-suggestions');
    const omnibox = document.getElementById('omnibox-input');
    if (!box || !omnibox) return;

    const reqId = (this._omniSuggestSeq = (this._omniSuggestSeq || 0) + 1);
    if (!(query || '').trim()) {
      box.classList.remove('open');
      box.innerHTML = '';
      return;
    }

    const list = await this._buildSuggestionsList(query);
    if (reqId !== this._omniSuggestSeq || document.activeElement !== omnibox) return;
    this._renderSuggestionsDropdown(box, list, omnibox, '_omniboxSuggestState');
  }

  // Live New Tab Search Bar Autocomplete
  async _renderNtpSuggestions(query) {
    const box = document.getElementById('ntp-search-suggestions');
    const ntpInput = document.getElementById('ntp-search-input');
    if (!box || !ntpInput) return;

    const reqId = (this._ntpSuggestSeq = (this._ntpSuggestSeq || 0) + 1);
    if (!(query || '').trim()) {
      box.classList.remove('open');
      box.innerHTML = '';
      return;
    }

    const list = await this._buildSuggestionsList(query);
    if (reqId !== this._ntpSuggestSeq || document.activeElement !== ntpInput) return;
    this._renderSuggestionsDropdown(box, list, ntpInput, '_ntpSuggestState');
  }

  _handleSuggestionKeydown(e, inputEl, box, stateKey) {
    const state = this[stateKey];
    const domItems = box && box.classList.contains('open')
      ? Array.from(box.querySelectorAll('.omnibox-suggestion-item'))
      : [];

    if (e.key === 'ArrowDown' && domItems.length > 0 && state?.items?.length) {
      e.preventDefault();
      state.selectedIdx = (state.selectedIdx + 1) % domItems.length;
      domItems.forEach((el, i) => el.classList.toggle('selected', i === state.selectedIdx));
      const chosen = state.items[state.selectedIdx];
      if (chosen) inputEl.value = chosen.url;
    } else if (e.key === 'ArrowUp' && domItems.length > 0 && state?.items?.length) {
      e.preventDefault();
      state.selectedIdx = (state.selectedIdx - 1 + domItems.length) % domItems.length;
      domItems.forEach((el, i) => el.classList.toggle('selected', i === state.selectedIdx));
      const chosen = state.items[state.selectedIdx];
      if (chosen) inputEl.value = chosen.url;
    } else if (e.key === 'Escape') {
      box?.classList.remove('open');
    } else if (e.key === 'Enter') {
      box?.classList.remove('open');
      this.navigateTo(inputEl.value);
      inputEl.blur();
    }
  }

  // Event Bindings
  bindEvents() {
    // Listen for bookmark storage updates from internal views or star toggle
    window.addEventListener('crown:bookmarks-updated', () => {
      this.renderBookmarksBar();
      this.updateBookmarkStarUI();
    });

    // Listen for extension enable/disable/install updates and broadcast to live frames
    window.addEventListener('crown:extensions-updated', () => {
      this.broadcastPageSettingsToFrames();
    });

    // Native Window Controls (Minimize, Maximize / Restore Down, Close & Frameless Titlebar Dragging)
    window.__TAURI_INTERNALS__?.invoke?.('window_is_maximized')
      ?.then((isMax) => this._syncMaximizeButton(Boolean(isMax)))
      ?.catch(() => {});
    document.getElementById('win-min-btn')?.addEventListener('click', () => {
      window.__TAURI_INTERNALS__?.invoke?.('window_minimize').catch(() => {});
    });
    document.getElementById('win-max-btn')?.addEventListener('click', () => {
      window.__TAURI_INTERNALS__?.invoke?.('window_toggle_maximize')
        ?.then((isMax) => this._syncMaximizeButton(Boolean(isMax)))
        ?.catch(() => {});
    });
    document.getElementById('win-close-btn')?.addEventListener('click', () => {
      if (window.__TAURI_INTERNALS__?.invoke) {
        window.__TAURI_INTERNALS__.invoke('window_close').catch(() => {});
      } else {
        window.close();
      }
    });

    // CSP-safe delegated favicon fallback handler
    document.addEventListener('error', (e) => {
      const t = e.target;
      if (
        t &&
        t.tagName === 'IMG' &&
        t.classList &&
        (t.classList.contains('crown-site-favicon') || t.classList.contains('tab-favicon-img'))
      ) {
        t.classList.add('favicon-err');
      }
    }, true);

    // Frameless window drag (normal move + pull-down from maximized) & double-click maximize
    const isDragInteractive = (el) => Boolean(
      el?.closest?.('.browser-tab, .new-tab-btn, .window-controls, .window-ctrl-btn, .tab-group-header, .sidebar-collapse-btn, .picker-close-btn, button, input, select, textarea, a')
    );
    let winDragCandidate = null;
    const onHeaderMouseDown = (e) => {
      if (e.button !== 0 || isDragInteractive(e.target)) return;
      winDragCandidate = {
        startX: e.screenX,
        startY: e.screenY,
        clientX: e.clientX,
        width: window.innerWidth || 1200,
        started: false
      };
    };
    window.addEventListener('mousemove', (e) => {
      if (!winDragCandidate || winDragCandidate.started) return;
      if ((e.buttons & 1) === 0) {
        winDragCandidate = null;
        return;
      }
      const dist = Math.hypot(e.screenX - winDragCandidate.startX, e.screenY - winDragCandidate.startY);
      if (dist > 4) {
        winDragCandidate.started = true;
        const ratio = Math.max(0.05, Math.min(0.95, winDragCandidate.clientX / Math.max(1, winDragCandidate.width)));
        winDragCandidate = null;
        window.__TAURI_INTERNALS__?.invoke?.('window_start_dragging', { cursorRatio: ratio }).catch(() => {});
      }
    });
    window.addEventListener('mouseup', () => {
      winDragCandidate = null;
    });
    const onHeaderDblClick = (e) => {
      if (e.button !== 0 || isDragInteractive(e.target)) return;
      window.__TAURI_INTERNALS__?.invoke?.('window_toggle_maximize')
        ?.then((isMax) => this._syncMaximizeButton(Boolean(isMax)))
        ?.catch(() => {});
    };
    for (const sel of ['#crown-header', '#vertical-sidebar .vertical-sidebar-header', '.picker-top-bar']) {
      const hdr = document.querySelector(sel);
      hdr?.addEventListener('mousedown', onHeaderMouseDown);
      hdr?.addEventListener('dblclick', onHeaderDblClick);
    }

    // Listen for in-page Crown Shield Gateway events (blocked sub-resources, link clicks & page titles)
    let lastIframeNewTabAt = 0;
    window.addEventListener('message', (e) => {
      if (!e.isTrusted) return;
      const data = e.data;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

      // Authenticate message origin strictly via registered direct tab iframe contentWindow
      let senderTab = null;
      for (const [tabId, iframe] of this.frames.entries()) {
        try {
          if (iframe.contentWindow && iframe.contentWindow === e.source) {
            senderTab = this.tabEngine.tabs.find(t => t.id === tabId) || null;
            break;
          }
        } catch {}
      }
      if (!senderTab) return;
      if (typeof data.tabId === 'string' && data.tabId && data.tabId !== senderTab.id) return;

      if (data.type === 'crown:shield-block') {
        const domain = shield._cleanHostname(senderTab.url);
        const kind = data.kind === 'tracker' ? 'tracker' : 'ad';
        const target = String(data.target || data.url || domain).slice(0, 120);
        shield._recordBlock(domain, kind, target, senderTab.isIncognito);
        this.updateShieldButton();
        this.renderDefenseHub();
      } else if (data.type === 'crown:page-nav' && typeof data.url === 'string') {
        if (Storage.isSafeUrl(data.url, false)) {
          this.navigateTo(data.url, senderTab.id);
        }
      } else if (data.type === 'crown:page-open-new-tab' && typeof data.url === 'string') {
        const now = Date.now();
        if (
          now - lastIframeNewTabAt >= 750 &&
          Storage.isSafeUrl(data.url, false) &&
          !(shield.isShieldEnabledForSite(senderTab.url) && shield.evaluateUrl(data.url, senderTab.url).blocked)
        ) {
          lastIframeNewTabAt = now;
          this.tabEngine.createTab(data.url, senderTab.isIncognito, senderTab.groupId);
        }
      } else if ((data.type === 'crown:page-url-change' || data.type === 'crown:page-title') && (typeof data.url === 'string' || typeof data.title === 'string')) {
        let urlChanged = false;
        if (data.url && typeof data.url === 'string' && Storage.isSafeUrl(data.url, false)) {
          if (senderTab.url !== data.url) {
            senderTab.url = data.url;
            urlChanged = true;
            // Maintain per-tab history stack for back/forward
            if (!Array.isArray(senderTab.history)) {
              senderTab.history = [data.url];
              senderTab.historyIndex = 0;
            } else if (senderTab.history[senderTab.historyIndex] !== data.url) {
              senderTab.history = senderTab.history.slice(0, senderTab.historyIndex + 1);
              senderTab.history.push(data.url);
              senderTab.historyIndex = senderTab.history.length - 1;
            }
            // Record in browsing history if not incognito or internal
            if (!senderTab.isIncognito && !InternalViews.isInternalUrl(data.url) && data.url !== 'crown://newtab') {
              Storage.addHistory({
                title: (typeof data.title === 'string' && data.title.trim()) ? data.title.trim().slice(0, 80) : senderTab.title || data.url,
                url: data.url,
                isIncognito: false
              });
            }
          }
        }
        if (typeof data.title === 'string') {
          const cleanTitle = data.title.trim().slice(0, 80);
          if (cleanTitle) {
            senderTab.title = cleanTitle;
          }
        }
        const isActive = (senderTab.id === this.tabEngine.activeTabId);
        if (isActive) {
          const omnibox = document.getElementById('omnibox-input');
          if (omnibox && document.activeElement !== omnibox) {
            omnibox.value = senderTab.url;
          }
          this._currentQrUrl = senderTab.url;
          this.updateSecurityIndicatorUI(senderTab);
          this.updateBookmarkStarUI();
          this.updateReaderModeButtonUI(senderTab);
          this.updateNavButtonsUI();
        }
        this.tabEngine.render();
      } else if (data.type === 'crown:save-reader-theme' && typeof data.theme === 'string') {
        const cleanTheme = data.theme.replace('theme-', '');
        if (['dark', 'sepia', 'light'].includes(cleanTheme)) {
          Storage.saveSettings({ readerTheme: cleanTheme });
        }
      } else if (data.type === 'crown:devtools-log') {
        const text = String(data.text || '').slice(0, 10000);
        this._appendDevToolsConsoleLog(data.level || 'log', text, senderTab.title);
      } else if (data.type === 'crown:devtools-net') {
        this._appendDevToolsNetLog({
          method: String(data.method || 'GET').slice(0, 16),
          url: String(data.url || '').slice(0, 2048),
          status: String(data.status || 'ALLOW').slice(0, 32),
          kind: String(data.kind || 'request').slice(0, 32)
        });
      } else if (data.type === 'crown:devtools-dom') {
        this._renderDevToolsDomTree(data.tree, data.metrics);
      } else if (data.type === 'crown:toggle-devtools') {
        this.toggleDevTools();
      } else if (data.type === 'crown:media-state') {
        senderTab.audioPlaying = Boolean(data.playing);
        this.tabEngine.render();
      } else if (data.type === 'crown:frame-focus') {
        if (this.splitViewActive) {
          if (senderTab.id === this.splitPrimaryTabId) {
            this.splitFocusedPane = 'left';
            this.tabEngine.activeTabId = senderTab.id;
            this.syncActiveTab(senderTab);
          } else if (senderTab.id === this.splitSecondaryTabId) {
            this.splitFocusedPane = 'right';
            this.tabEngine.activeTabId = senderTab.id;
            this.syncActiveTab(senderTab);
          }
        }
      } else if (data.type === 'crown:exit-reader') {
        if (senderTab && senderTab.readerMode) {
          this.toggleReaderMode();
        }
      }
    });

    // Omnibox + Live Search & URL Autocomplete Dropdown
    const omnibox = document.getElementById('omnibox-input');
    const suggestionsBox = document.getElementById('omnibox-suggestions');

    omnibox.addEventListener('input', () => {
      clearTimeout(this._omniDebounce);
      this._omniDebounce = setTimeout(() => {
        this._renderOmniboxSuggestions(omnibox.value);
      }, 90);
    });

    omnibox.addEventListener('keydown', (e) => {
      this._handleSuggestionKeydown(e, omnibox, suggestionsBox, '_omniboxSuggestState');
    });

    omnibox.addEventListener('blur', () => {
      setTimeout(() => suggestionsBox?.classList.remove('open'), 160);
    });

    // Omnibox Reader Mode, QR Code & Bookmark Star Buttons
    document.getElementById('omnibox-reader-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleReaderMode();
    });

    document.getElementById('omnibox-qr-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleQrCodePopover();
    });

    document.getElementById('qr-popover-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeQrCodePopover();
    });

    document.getElementById('qr-copy-url-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = this.tabEngine.getActiveTab();
      const url = this._currentQrUrl || tab?.url || (window.location?.href || 'crown://newtab');
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).catch(() => {});
      }
      this.showToast('Link copied to clipboard');
    });

    document.getElementById('qr-download-svg-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.downloadCurrentQrSvg();
    });

    document.getElementById('omnibox-bookmark-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleBookmarkCurrentTab();
    });

    // NTP Search Box + Live Search & URL Autocomplete Dropdown
    const ntpSearch = document.getElementById('ntp-search-input');
    const ntpSuggestionsBox = document.getElementById('ntp-search-suggestions');

    ntpSearch?.addEventListener('input', () => {
      clearTimeout(this._ntpDebounce);
      this._ntpDebounce = setTimeout(() => {
        this._renderNtpSuggestions(ntpSearch.value);
      }, 90);
    });

    ntpSearch?.addEventListener('keydown', (e) => {
      this._handleSuggestionKeydown(e, ntpSearch, ntpSuggestionsBox, '_ntpSuggestState');
    });

    ntpSearch?.addEventListener('blur', () => {
      setTimeout(() => ntpSuggestionsBox?.classList.remove('open'), 160);
    });

    // Add Shortcut Modal bindings
    this._bindLinkDragAndDrop();
    const shortcutModal = document.getElementById('shortcut-modal-overlay');
    document.getElementById('shortcut-modal-close-btn')?.addEventListener('click', () => shortcutModal?.classList.remove('open'));
    document.getElementById('shortcut-cancel-btn')?.addEventListener('click', () => shortcutModal?.classList.remove('open'));
    document.getElementById('shortcut-save-btn')?.addEventListener('click', () => this.saveNewShortcut());
    document.getElementById('shortcut-url-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveNewShortcut();
    });

    // In-App Add Bookmark Modal bindings
    const bookmarkModal = document.getElementById('bookmark-modal-overlay');
    document.getElementById('bookmark-modal-close-btn')?.addEventListener('click', () => bookmarkModal?.classList.remove('open'));
    document.getElementById('bookmark-cancel-btn')?.addEventListener('click', () => bookmarkModal?.classList.remove('open'));
    document.getElementById('bookmark-save-btn')?.addEventListener('click', () => this.saveBookmarkFromModal());
    document.getElementById('bookmark-url-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveBookmarkFromModal();
    });

    // In-App Tab Group Modal bindings
    const tabGroupModal = document.getElementById('tab-group-modal-overlay');
    document.getElementById('tab-group-modal-close-btn')?.addEventListener('click', () => tabGroupModal?.classList.remove('open'));
    document.getElementById('tab-group-cancel-btn')?.addEventListener('click', () => tabGroupModal?.classList.remove('open'));
    document.getElementById('tab-group-save-btn')?.addEventListener('click', () => this.saveTabGroupFromModal());
    document.getElementById('tab-group-name-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveTabGroupFromModal();
    });
    document.querySelectorAll('#tab-group-color-row .group-color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        this._selectedGroupColor = swatch.dataset.color;
        document.querySelectorAll('#tab-group-color-row .group-color-swatch').forEach(s => {
          s.classList.toggle('selected', s === swatch);
        });
      });
    });

    // In-App Clear Browsing Data Modal bindings
    const clearDataModal = document.getElementById('clear-data-modal-overlay');
    document.getElementById('clear-data-modal-close-btn')?.addEventListener('click', () => clearDataModal?.classList.remove('open'));
    document.getElementById('clear-data-cancel-btn')?.addEventListener('click', () => clearDataModal?.classList.remove('open'));
    document.getElementById('clear-data-confirm-btn')?.addEventListener('click', () => this.confirmClearBrowsingData());

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

    // Incognito toggle button (launches a dedicated Incognito window)
    document.getElementById('incognito-toggle-btn')?.addEventListener('click', () => {
      this.openIncognitoWindow();
    });

    // Split View toolbar button (Ctrl+Shift+S)
    document.getElementById('split-view-btn')?.addEventListener('click', () => {
      this.toggleSplitView();
    });

    // Floating Split View Control Bar Buttons
    document.getElementById('split-swap-panes-btn')?.addEventListener('click', () => {
      this.swapSplitPanes();
    });
    document.getElementById('split-change-right-btn')?.addEventListener('click', () => {
      this.openSplitSecondaryPicker();
    });
    document.getElementById('split-close-view-btn')?.addEventListener('click', () => {
      this.exitSplitView();
    });

    // Interactive Right-Pane Split Picker Input & Open Button
    const splitPickerInput = document.getElementById('split-picker-url-input');
    const splitPickerOpenBtn = document.getElementById('split-picker-open-btn');
    const handleSplitPickerSubmit = () => {
      const val = (splitPickerInput?.value || '').trim();
      if (!val) return;
      if (splitPickerInput) splitPickerInput.value = '';
      this.dockSplitSecondaryTabWithUrl(val);
    };
    splitPickerOpenBtn?.addEventListener('click', handleSplitPickerSubmit);
    splitPickerInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSplitPickerSubmit();
      }
    });

    // Click inside dashboard, internalMount, or picker in Split View to update focused pane indicator
    document.getElementById('new-tab-dashboard')?.addEventListener('click', () => {
      if (this.splitViewActive && this.splitPrimaryTabId) {
        this.splitFocusedPane = 'left';
        this.tabEngine.activeTabId = this.splitPrimaryTabId;
        const fl = document.getElementById('split-focus-label');
        if (fl) fl.textContent = 'Left Pane';
      }
    });
    document.getElementById('internal-views-mount')?.addEventListener('click', () => {
      if (this.splitViewActive && this.splitPrimaryTabId) {
        this.splitFocusedPane = 'left';
        this.tabEngine.activeTabId = this.splitPrimaryTabId;
        const fl = document.getElementById('split-focus-label');
        if (fl) fl.textContent = 'Left Pane';
      }
    });
    document.getElementById('split-secondary-picker')?.addEventListener('click', () => {
      if (this.splitViewActive) {
        this.splitFocusedPane = 'right';
        const fl = document.getElementById('split-focus-label');
        if (fl) fl.textContent = 'Right Pane';
      }
    });

    // Extensions toolbar shortcut (crown://extensions)
    document.getElementById('toolbar-extensions-btn')?.addEventListener('click', () => {
      this.navigateTo('crown://extensions');
    });

    // Mobile Chrome/Brave-style tab switcher badge toggle
    document.getElementById('mobile-tab-switcher-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('crown-app')?.classList.toggle('mobile-tabs-open');
    });

    // Omnibox Site Info & Permissions Popover
    const secIcon = document.getElementById('site-security-icon');
    secIcon?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSiteInfoPopover();
    });

    document.getElementById('site-info-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeSiteInfoPopover();
    });

    document.getElementById('site-info-reset-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = this.tabEngine.getActiveTab();
      if (tab?.url) {
        Storage.resetSitePermissions(tab.url);
        this.openSiteInfoPopover();
        const iframe = this.frames.get(tab.id);
        if (iframe) this._applyPermissionsToFrame(iframe, tab.url);
        this.showToast('Reset permissions for this site');
      }
    });

    document.getElementById('site-info-settings-link')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeSiteInfoPopover();
      this.navigateTo('crown://settings?section=site-settings');
    });

    document.getElementById('site-info-clear-cookies-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = this.tabEngine.getActiveTab();
      if (tab?.url) {
        Storage.clearCookiesForSite(tab.url);
        const countEl = document.getElementById('site-info-cookies-label');
        if (countEl) countEl.textContent = '0 cookies stored';
        this.showToast('Cleared cookies for this site');
      }
    });

    document.getElementById('site-info-shield-toggle')?.addEventListener('change', (e) => {
      const tab = this.tabEngine.getActiveTab();
      if (tab?.url) {
        const domain = shield._cleanHostname(tab.url);
        shield.setShieldForSite(domain, e.target.checked);
        this._syncNativeShieldConfig();
        this.updateShieldButton();
        this.reload();
      }
    });

    document.querySelectorAll('.site-perm-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const permKey = sel.dataset.perm;
        const val = sel.value;
        const tab = this.tabEngine.getActiveTab();
        if (tab?.url && !tab.url.startsWith('crown://')) {
          Storage.setSitePermission(tab.url, permKey, val);
          const iframe = this.frames.get(tab.id);
          if (iframe) this._applyPermissionsToFrame(iframe, tab.url);
          this.showToast(`Updated ${permKey} to ${val}`);
        }
      });
    });

    // Bookmarks Bar internal links & Overflow menu button
    document.getElementById('bm-history-shortcut')?.addEventListener('click', () => {
      this.navigateTo('crown://history');
    });
    document.getElementById('bm-bookmarks-shortcut')?.addEventListener('click', () => {
      this.navigateTo('crown://bookmarks');
    });
    document.getElementById('bm-all-bookmarks-btn')?.addEventListener('click', () => {
      this.navigateTo('crown://bookmarks');
    });

    const overflowBtn = document.getElementById('bookmarks-overflow-btn');
    const overflowMenu = document.getElementById('bookmarks-overflow-menu');
    overflowBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!overflowMenu) return;
      const rect = overflowBtn.getBoundingClientRect();
      overflowMenu.style.top = `${rect.bottom + 6}px`;
      overflowMenu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
      overflowMenu.classList.toggle('open');
      overflowBtn.classList.toggle('active', overflowMenu.classList.contains('open'));
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
        this._syncNativeShieldConfig();
        this.updateShieldButton();
        this.reload();
      }
    });

    // Profile Switcher & "Who's using Crown?" Startup Screen
    document.getElementById('profile-switcher-btn')?.addEventListener('click', () => {
      this.openProfilePicker(false);
    });
    document.getElementById('picker-close-btn')?.addEventListener('click', () => {
      this.closeProfilePicker();
    });
    document.getElementById('picker-guest-mode-btn')?.addEventListener('click', () => {
      this.openIncognitoWindow();
      this.closeProfilePicker();
    });
    document.getElementById('picker-show-on-startup')?.addEventListener('change', (e) => {
      Storage.setShowProfilePickerOnStartup(e.target.checked);
    });
    document.getElementById('profile-editor-cancel-btn')?.addEventListener('click', () => {
      this._closeProfileEditor();
    });
    document.getElementById('profile-editor-save-btn')?.addEventListener('click', () => {
      this.saveProfileFromEditor();
    });
    document.getElementById('profile-editor-name-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveProfileFromEditor();
    });
    document.querySelectorAll('#picker-color-row .profile-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        this._selectedProfileColor = swatch.dataset.color;
        document.querySelectorAll('#picker-color-row .profile-swatch').forEach(s => {
          s.classList.toggle('selected', s === swatch);
        });
      });
    });

    // In-Page Find Bar Controls (Ctrl+F)
    document.getElementById('find-close-btn')?.addEventListener('click', () => {
      this.closeFindBar();
    });
    document.getElementById('find-prev-btn')?.addEventListener('click', () => {
      const q = document.getElementById('find-input')?.value;
      this.findInPage(q, false);
    });
    document.getElementById('find-next-btn')?.addEventListener('click', () => {
      const q = document.getElementById('find-input')?.value;
      this.findInPage(q, true);
    });
    const findInput = document.getElementById('find-input');
    findInput?.addEventListener('input', () => {
      this.findInPage(findInput.value, true);
    });
    findInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.findInPage(findInput.value, !e.shiftKey);
      } else if (e.key === 'Escape') {
        this.closeFindBar();
      }
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

      const s = Storage.getSettings();
      const adsCheck = document.getElementById('pref-block-ads');
      const trackersCheck = document.getElementById('pref-block-trackers');
      const paramsCheck = document.getElementById('pref-strip-params');
      const httpsCheck = document.getElementById('pref-https-upgrade');
      const memCheck = document.getElementById('pref-memory-saver');
      if (adsCheck) adsCheck.checked = s.blockAds !== false;
      if (trackersCheck) trackersCheck.checked = s.blockTrackers !== false;
      if (paramsCheck) paramsCheck.checked = s.stripQueryParams !== false;
      if (httpsCheck) httpsCheck.checked = s.httpsEverywhere !== false;
      if (memCheck) memCheck.checked = s.memorySaverMode !== false;
    };

    custBtn?.addEventListener('click', openCustomize);
    menuBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleAppMenu();
    });
    this._initAppMenuEvents();
    modalCloseBtn?.addEventListener('click', () => custModal.classList.remove('open'));

    // Privacy & Memory Guard toggles inside Customize Modal
    const updatePrivacyPref = () => {
      const s = Storage.getSettings();
      s.blockAds = document.getElementById('pref-block-ads')?.checked !== false;
      s.blockTrackers = document.getElementById('pref-block-trackers')?.checked !== false;
      s.stripQueryParams = document.getElementById('pref-strip-params')?.checked !== false;
      s.httpsEverywhere = document.getElementById('pref-https-upgrade')?.checked !== false;
      s.memorySaverMode = document.getElementById('pref-memory-saver')?.checked !== false;
      Storage.saveSettings(s);
      shield.blockAds = s.blockAds;
      shield.blockTrackers = s.blockTrackers;
      shield.stripQueryParams = s.stripQueryParams;
      if (s.memorySaverMode) {
        this.tabEngine.enforceMemoryBudget();
      }
      this.renderDefenseHub();
    };
    document.getElementById('pref-block-ads')?.addEventListener('change', updatePrivacyPref);
    document.getElementById('pref-block-trackers')?.addEventListener('change', updatePrivacyPref);
    document.getElementById('pref-strip-params')?.addEventListener('change', updatePrivacyPref);
    document.getElementById('pref-https-upgrade')?.addEventListener('change', updatePrivacyPref);
    document.getElementById('pref-memory-saver')?.addEventListener('change', updatePrivacyPref);

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
    document.querySelectorAll('#pane-tab-appearance .palette-swatch').forEach(swatch => {
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
      if (url && !this.isIncognitoWindow) {
        const isSafeWallpaper = /^(https:\/\/[^\s"'()\\]+|data:image\/(png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=]+)$/i.test(url);
        if (isSafeWallpaper) {
          localStorage.setItem('crown_custom_bg', url);
        } else {
          this.showToast('Invalid wallpaper URL (only HTTPS raster images supported)', 'error');
        }
      }
      this.applyCustomBackground();
      custModal.classList.remove('open');
    });

    // File upload wallpaper (SEC-05: Enforce raster-only MIME & 4 MB size cap)
    bgFileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        if (this.isIncognitoWindow) {
          this.showToast('Custom wallpaper cannot be saved in Incognito mode', 'error');
          return;
        }
        if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) {
          this.showToast('Please select a valid image (PNG, JPEG, WebP, GIF)', 'error');
          return;
        }
        if (file.size > 4 * 1024 * 1024) {
          this.showToast('Image exceeds 4 MB safety limit', 'error');
          return;
        }
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
      if (!this.isIncognitoWindow) {
        localStorage.removeItem('crown_custom_bg');
      }
      this.applyCustomBackground();
      bgUrlInput.value = '';
      custModal.classList.remove('open');
    });

    // Close overlays on outside click
    document.addEventListener('click', (e) => {
      if (!shieldPanel?.contains(e.target) && e.target !== shieldBtn) {
        shieldPanel?.classList.remove('open');
      }
      if (!overflowMenu?.contains(e.target) && e.target !== overflowBtn) {
        overflowMenu?.classList.remove('open');
        overflowBtn?.classList.remove('active');
      }
      if (e.target === custModal) custModal.classList.remove('open');
      if (e.target === shortcutModal) shortcutModal.classList.remove('open');
      if (e.target === bookmarkModal) bookmarkModal.classList.remove('open');
      if (e.target === tabGroupModal) tabGroupModal.classList.remove('open');
      if (e.target === clearDataModal) clearDataModal.classList.remove('open');
      const sitePopover = document.getElementById('site-info-popover');
      const secBtn = document.getElementById('site-security-icon');
      if (sitePopover && !sitePopover.contains(e.target) && !secBtn?.contains(e.target)) {
        sitePopover.style.display = 'none';
      }
      const profileMenu = document.getElementById('profile-card-context-menu');
      if (profileMenu && !profileMenu.contains(e.target)) {
        profileMenu.classList.remove('open');
      }
      const bmCtxMenu = document.getElementById('bookmark-context-menu');
      if (bmCtxMenu && !bmCtxMenu.contains(e.target)) {
        bmCtxMenu.classList.remove('open');
      }
      const qrPopover = document.getElementById('qr-code-popover');
      const qrBtn = document.getElementById('omnibox-qr-btn');
      if (qrPopover && qrPopover.style.display !== 'none' && !qrPopover.contains(e.target) && !qrBtn?.contains(e.target)) {
        this.closeQrCodePopover();
      }
      const cmdOverlay = document.getElementById('command-palette-overlay');
      if (e.target === cmdOverlay) {
        this.closeCommandPalette();
      }
      const appMenu = document.getElementById('crown-app-menu');
      if (appMenu && !appMenu.classList.contains('hidden') && !appMenu.contains(e.target) && !menuBtn?.contains(e.target)) {
        appMenu.classList.add('hidden');
        menuBtn?.classList.remove('active');
      }
    });

    this._initCommandPaletteEvents();

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.toggleCommandPalette();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        if (this.tabEngine.reopenLastClosedTab()) {
          this.showToast('Reopened closed tab');
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        this.tabEngine.createTab('crown://newtab');
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.openIncognitoWindow();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.openNewWindow('crown://newtab');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        this.printActivePage();
      } else if (e.key === 'F11') {
        e.preventDefault();
        this.toggleFullscreen();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Delete') {
        e.preventDefault();
        this.openClearDataModal();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
        e.preventDefault();
        this.tabEngine.cycleTab(e.shiftKey ? -1 : 1);
      } else if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        this.tabEngine.switchToTabIndex(Number(e.key));
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        const activeTab = this.tabEngine.getActiveTab();
        if (activeTab?.pinned) {
          this.showToast('Tab is pinned — right-click to unpin before closing');
        } else if (this.tabEngine.activeTabId) {
          this.tabEngine.closeTab(this.tabEngine.activeTabId);
        }
      } else if (e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        this.toggleReaderMode();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        this.openFindBar();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this.changeZoom(10);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        this.changeZoom(-10);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        this.resetZoom();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        this.toggleBookmarkCurrentTab();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        document.getElementById('omnibox-input')?.select();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        this.reload();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        document.getElementById('downloads-drawer')?.classList.toggle('open');
      } else if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i')) {
        e.preventDefault();
        this.toggleDevTools();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.toggleSplitView();
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        this.navigateTo('crown://settings');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        this.navigateTo('crown://history');
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        this.goBack();
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        this.goForward();
      } else if (e.key === 'Escape') {
        this.closeCommandPalette();
        this.closeQrCodePopover();
        document.getElementById('bookmark-context-menu')?.classList.remove('open');
        const pickerScreen = document.getElementById('profile-picker-screen');
        if (pickerScreen && pickerScreen.style.display !== 'none' && !this._isProfilePickerStartup) {
          this.closeProfilePicker();
        }
      }
    });

    this._initAutoScrollEngine();
  }

  // Middle-Click (Scroll-Click) Mouse-Movement Auto-Scroll Engine for Internal Views & Dashboard
  _initAutoScrollEngine() {
    let active = false;
    let originX = 0;
    let originY = 0;
    let curX = 0;
    let curY = 0;
    let rafId = null;
    let marker = null;
    let scrollTarget = null;

    const stop = () => {
      active = false;
      scrollTarget = null;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (marker) {
        marker.remove();
        marker = null;
      }
    };

    const step = () => {
      if (!active || !scrollTarget) return;
      const dx = curX - originX;
      const dy = curY - originY;
      const vx = Math.abs(dx) > 8 ? (dx - Math.sign(dx) * 8) * 0.14 : 0;
      const vy = Math.abs(dy) > 8 ? (dy - Math.sign(dy) * 8) * 0.16 : 0;
      if (vx !== 0 || vy !== 0) {
        scrollTarget.scrollBy(vx, vy);
      }
      rafId = requestAnimationFrame(step);
    };

    const contentArea = document.getElementById('crown-content-area');
    contentArea?.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        if (e.target.closest('a, button, input, textarea, select, .shortcut-tile, .bookmark-card, .history-item-info')) {
          return;
        }
        e.preventDefault();
        if (active) {
          stop();
          return;
        }
        const mount = document.getElementById('internal-views-mount');
        const dash = document.getElementById('new-tab-dashboard');
        scrollTarget = (mount && mount.style.display !== 'none') ? mount : dash;
        if (!scrollTarget) return;

        active = true;
        originX = e.clientX;
        originY = e.clientY;
        curX = e.clientX;
        curY = e.clientY;

        marker = document.createElement('div');
        marker.style.cssText = `position:fixed;z-index:9999;width:26px;height:26px;border-radius:50%;background:#141519;border:1.5px solid var(--cr-accent-gold);box-shadow:0 4px 12px rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;pointer-events:none;transform:translate(-50%,-50%);left:${originX}px;top:${originY}px;`;
        marker.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cr-accent-gold)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 9 5-5 5 5"/><path d="m7 15 5 5 5-5"/><circle cx="12" cy="12" r="1.5" fill="var(--cr-accent-gold)"/></svg>`;
        document.body.appendChild(marker);
        rafId = requestAnimationFrame(step);
      } else if (active) {
        stop();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!active) return;
      curX = e.clientX;
      curY = e.clientY;
    });

    window.addEventListener('wheel', () => {
      if (active) stop();
    }, { passive: true });

    window.addEventListener('keydown', (e) => {
      if (active && e.key === 'Escape') stop();
    });
  }

  // Profile Management & Startup Profile Picker
  openProfilePicker(isStartup = false) {
    const screen = document.getElementById('profile-picker-screen');
    const closeBtn = document.getElementById('picker-close-btn');
    const startupCheck = document.getElementById('picker-show-on-startup');
    if (!screen) return;

    this._isProfilePickerStartup = isStartup;
    if (closeBtn) {
      closeBtn.style.display = isStartup ? 'none' : 'block';
    }
    if (startupCheck) {
      startupCheck.checked = Storage.getShowProfilePickerOnStartup();
    }

    this._closeProfileEditor();
    this.renderProfilePickerCards();
    screen.classList.add('open');
    screen.style.display = 'flex';
  }

  closeProfilePicker() {
    const screen = document.getElementById('profile-picker-screen');
    if (screen) {
      screen.classList.remove('open');
      screen.style.display = 'none';
    }
    this._closeProfileCardContextMenu();
  }

  renderProfilePickerCards() {
    const grid = document.getElementById('profile-cards-grid');
    if (!grid) return;

    const profiles = Storage.getProfiles();
    const activeId = Storage.getActiveProfileId();

    grid.innerHTML = '';

    profiles.forEach(p => {
      const card = document.createElement('div');
      const isActive = (p.id === activeId);
      card.className = `profile-card-tile ${isActive ? 'active-profile' : ''}`.trim();
      card.dataset.id = p.id;

      const safeColor = Storage.sanitizeColor(p.color, '#e6ca85');
      const initial = (p.avatar || p.name || 'P').trim().charAt(0).toUpperCase();

      card.innerHTML = `
        <div class="profile-tile-header">
          <span class="profile-tile-name" title="${this._escape(p.name)}">${this._escape(p.name)}</span>
          <button class="profile-tile-menu-btn" title="Profile options" aria-label="Profile options">⋮</button>
        </div>
        <div class="profile-avatar-circle" style="background:${safeColor}18; border-color:${safeColor}; color:${safeColor};">
          <span>${this._escape(initial)}</span>
        </div>
        <span class="profile-tile-badge">${isActive ? 'Active' : ''}</span>
      `;

      card.onclick = (e) => {
        if (e.target.closest('.profile-tile-menu-btn')) return;
        this.selectProfile(p.id);
      };

      const menuBtn = card.querySelector('.profile-tile-menu-btn');
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        this._showProfileCardContextMenu(e.clientX, e.clientY, p);
      };

      grid.appendChild(card);
    });

    // Dashed "+ Add" Card
    const addCard = document.createElement('div');
    addCard.className = 'profile-card-tile add-card';
    addCard.title = 'Add new profile';
    addCard.innerHTML = `
      <div class="add-avatar-circle">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </div>
      <span class="add-card-label">Add</span>
    `;
    addCard.onclick = () => {
      this.openProfileEditor(null);
    };
    grid.appendChild(addCard);
  }

  _syncMaximizeButton(isMaximized) {
    const btn = document.getElementById('win-max-btn');
    if (!btn) return;
    const maximized = Boolean(isMaximized);
    const label = maximized ? 'Restore Down' : 'Maximize';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = maximized
      ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><rect x="0.5" y="2.5" width="7" height="7"/><path d="M2.5 2.5V0.5h7v7h-2"/></svg>'
      : '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0v10h10V0H0zm9 9H1V1h8v8z" fill="currentColor"/></svg>';
  }

  selectProfile(profileId) {
    if (!profileId) return;
    const currentId = Storage.getActiveProfileId();
    if (profileId !== currentId) {
      Storage.setActiveProfileId(profileId);
      this.applyAccentColor();
      this.renderBookmarksBar();
      this.renderShortcuts(true);
      this.tabEngine.resetForProfileSwitch(currentId);
      this.updateProfileUI();
      this.showToast('Switched profile');
    }
    this.closeProfilePicker();
  }

  openProfileEditor(profileToEdit = null) {
    const gridContainer = document.getElementById('picker-grid-container');
    const editor = document.getElementById('profile-inline-editor');
    const titleEl = document.getElementById('profile-editor-title');
    const nameInput = document.getElementById('profile-editor-name-input');
    const swatches = document.querySelectorAll('#picker-color-row .profile-swatch');

    if (!editor || !nameInput) return;
    this._editingProfileId = profileToEdit ? profileToEdit.id : null;

    if (titleEl) {
      titleEl.textContent = profileToEdit ? 'Edit Profile' : 'Add Profile';
    }
    nameInput.value = profileToEdit ? profileToEdit.name : '';
    this._selectedProfileColor = profileToEdit ? Storage.sanitizeColor(profileToEdit.color, '#e6ca85') : '#e6ca85';

    swatches.forEach(s => {
      s.classList.toggle('selected', s.dataset.color === this._selectedProfileColor);
    });

    if (gridContainer) gridContainer.style.display = 'none';
    editor.style.display = 'flex';
    setTimeout(() => {
      nameInput.focus();
      if (profileToEdit) nameInput.select();
    }, 40);
  }

  _closeProfileEditor() {
    const gridContainer = document.getElementById('picker-grid-container');
    const editor = document.getElementById('profile-inline-editor');
    if (editor) editor.style.display = 'none';
    if (gridContainer) gridContainer.style.display = 'flex';
    this._editingProfileId = null;
  }

  saveProfileFromEditor() {
    const nameInput = document.getElementById('profile-editor-name-input');
    if (!nameInput) return;
    const rawName = nameInput.value.trim();
    if (!rawName) {
      this.showToast('Please enter a profile name', 'error');
      nameInput.focus();
      return;
    }

    const profiles = Storage.getProfiles();
    const color = Storage.sanitizeColor(this._selectedProfileColor, '#e6ca85');
    const initial = rawName.charAt(0).toUpperCase();

    if (this._editingProfileId) {
      const p = profiles.find(item => item.id === this._editingProfileId);
      if (p) {
        p.name = rawName;
        p.color = color;
        p.avatar = initial;
      }
      Storage.saveProfiles(profiles);
      this.showToast(`Updated "${rawName}"`);
      if (this._editingProfileId === Storage.getActiveProfileId()) {
        this.updateProfileUI();
      }
    } else {
      const newId = `profile-${Date.now()}`;
      const newProfile = {
        id: newId,
        name: rawName,
        avatar: initial,
        color
      };
      profiles.push(newProfile);
      Storage.saveProfiles(profiles);
      this.showToast(`Created "${rawName}"`);
    }

    this._closeProfileEditor();
    this.renderProfilePickerCards();
  }

  deleteProfile(profileId) {
    if (!profileId) return;
    const profiles = Storage.getProfiles();
    if (profiles.length <= 1) {
      this.showToast('Cannot delete the only remaining profile', 'error');
      return;
    }

    const remaining = profiles.filter(p => p.id !== profileId);
    Storage.saveProfiles(remaining);
    Storage.deleteProfileData(profileId);

    if (Storage.getActiveProfileId() === profileId) {
      Storage.setActiveProfileId(remaining[0].id);
      this.applyAccentColor();
      this.renderBookmarksBar();
      this.renderShortcuts(true);
      this.tabEngine.resetForProfileSwitch(profileId);
      this.updateProfileUI();
    }

    this.showToast('Profile deleted');
    this.renderProfilePickerCards();
  }

  _showProfileCardContextMenu(x, y, profile) {
    const menu = document.getElementById('profile-card-context-menu');
    if (!menu) return;

    const profiles = Storage.getProfiles();
    const canDelete = profiles.length > 1;

    menu.innerHTML = `
      <div class="menu-item" data-action="edit">Edit Profile...</div>
      ${canDelete ? `
        <div class="menu-divider"></div>
        <div class="menu-item danger" data-action="delete">Delete Profile</div>
      ` : ''}
    `;

    menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 120)}px`;
    menu.classList.add('open');

    const handleAction = (e) => {
      const item = e.target.closest('.menu-item');
      if (!item) return;
      const action = item.dataset.action;
      if (action === 'edit') {
        this.openProfileEditor(profile);
      } else if (action === 'delete') {
        this.deleteProfile(profile.id);
      }
      this._closeProfileCardContextMenu();
    };

    menu.onclick = handleAction;
  }

  _closeProfileCardContextMenu() {
    const menu = document.getElementById('profile-card-context-menu');
    if (menu) menu.classList.remove('open');
  }

  // Page Zoom Controls (Ctrl++, Ctrl+-, Ctrl+0)
  toggleZoomPopover(forceState) {
    const pop = document.getElementById('zoom-popover');
    if (!pop) return;
    const isOpen = pop.style.display !== 'none' && pop.style.display !== '';
    const nextOpen = typeof forceState === 'boolean' ? forceState : !isOpen;
    pop.style.display = nextOpen ? 'block' : 'none';
    this._syncNativeWebviews();
  }

  applyZoom() {
    const zoomPct = this.currentZoom || 100;
    const factor = zoomPct / 100;
    const zoomBtn = document.getElementById('omnibox-zoom-btn');
    const zoomLabel = document.getElementById('omnibox-zoom-label');
    if (zoomLabel) zoomLabel.textContent = `${zoomPct}%`;
    if (zoomBtn) {
      zoomBtn.style.display = zoomPct === 100 ? 'none' : 'inline-flex';
      zoomBtn.classList.toggle('zoomed', zoomPct !== 100);
    }
    const popVal = document.getElementById('zoom-popover-value');
    if (popVal) popVal.textContent = `${zoomPct}%`;
    const outBtn = document.getElementById('zoom-out-btn');
    if (outBtn) outBtn.disabled = zoomPct <= 50;
    const inBtn = document.getElementById('zoom-in-btn');
    if (inBtn) inBtn.disabled = zoomPct >= 200;
    const resetBtn = document.getElementById('zoom-reset-btn');
    if (resetBtn) resetBtn.disabled = zoomPct === 100;
    if (this._isNativeWebviewMode()) {
      for (const tab of this.tabEngine.tabs) {
        if (tab.url && tab.url !== 'crown://newtab' && !InternalViews.isInternalUrl(tab.url)) {
          window.__TAURI_INTERNALS__.invoke('set_tab_webview_zoom', {
            tabId: tab.id,
            zoom: factor,
            profileId: Storage.getActiveProfileId()
          }).catch(() => {});
        }
      }
    }
    document.querySelectorAll('.webview-frame').forEach(f => {
      try {
        f.style.transform = factor === 1 ? '' : `scale(${factor})`;
        f.style.transformOrigin = 'top left';
        f.style.width = factor === 1 ? '100%' : `${(100 / factor).toFixed(2)}%`;
        f.style.height = factor === 1 ? '100%' : `${(100 / factor).toFixed(2)}%`;
      } catch {}
    });
    const dash = document.getElementById('new-tab-dashboard');
    if (dash) dash.style.zoom = factor === 1 ? '' : `${this.currentZoom}%`;
    const mount = document.getElementById('internal-views-mount');
    if (mount) mount.style.zoom = factor === 1 ? '' : `${this.currentZoom}%`;
  }

  changeZoom(delta) {
    this.currentZoom = Math.max(50, Math.min(200, (this.currentZoom || 100) + delta));
    const s = Storage.getSettings();
    s.pageZoom = this.currentZoom;
    Storage.saveSettings(s);
    this.applyZoom();
    this.showToast(`Zoom: ${this.currentZoom}%`);
  }

  resetZoom() {
    this.currentZoom = 100;
    const s = Storage.getSettings();
    s.pageZoom = 100;
    Storage.saveSettings(s);
    this.applyZoom();
    this.toggleZoomPopover(false);
    this.showToast('Zoom: 100%');
  }

  // In-Page Find Controls (Ctrl+F)
  openFindBar() {
    const bar = document.getElementById('find-in-page-bar');
    const input = document.getElementById('find-input');
    if (!bar || !input) return;
    bar.style.display = 'flex';
    input.focus();
    input.select();
    if (input.value.trim()) {
      this.findInPage(input.value.trim(), true);
    }
  }

  closeFindBar() {
    const bar = document.getElementById('find-in-page-bar');
    if (bar) bar.style.display = 'none';
    const activeFrame = this.frames.get(this.tabEngine.activeTabId);
    if (activeFrame) {
      try { activeFrame.contentWindow.focus(); } catch {}
    }
  }

  findInPage(query, forward = true) {
    const q = (query || '').trim();
    const countEl = document.getElementById('find-count');
    if (!q) {
      if (countEl) countEl.textContent = '0/0';
      return;
    }
    const activeTab = this.tabEngine.getActiveTab();
    const activeFrame = this.frames.get(this.tabEngine.activeTabId);

    let found = false;
    if (activeFrame && activeTab && !activeTab.url.startsWith('crown://') && activeFrame.contentWindow) {
      try {
        if (typeof activeFrame.contentWindow.find === 'function') {
          found = activeFrame.contentWindow.find(q, false, !forward, true, false, false, false);
        }
      } catch {}
    }
    if (!found && typeof window.find === 'function') {
      try {
        found = window.find(q, false, !forward, true, false, false, false);
      } catch {}
    }

    if (countEl) {
      countEl.textContent = found ? 'Found' : '0/0';
    }
  }

  // =========================================================================
  // Side-by-Side Split View Engine (Ctrl+Shift+S)
  // =========================================================================
  toggleSplitView(requestedTabId = null) {
    if (this.splitViewActive && (!requestedTabId || requestedTabId === this.splitSecondaryTabId || requestedTabId === this.splitPrimaryTabId)) {
      this.exitSplitView();
      return;
    }

    const activeTab = this.tabEngine.getActiveTab();
    if (!activeTab) return;

    this.splitViewActive = true;
    this.splitPrimaryTabId = activeTab.id;
    this.splitFocusedPane = 'left';

    // If a specific target tab was requested and it's not the primary tab
    if (requestedTabId && requestedTabId !== activeTab.id) {
      const candidate = this.tabEngine.tabs.find(t => t.id === requestedTabId);
      this.splitSecondaryTabId = candidate ? candidate.id : null;
    } else {
      // User clicked Split View toggle: keep secondaryTabId null so the interactive picker displays on the right
      this.splitSecondaryTabId = null;
    }

    document.getElementById('split-view-btn')?.classList.add('active');
    document.getElementById('crown-content-area')?.classList.add('split-view-mode');

    this._applySplitViewLayout();
    this.tabEngine.enforceMemoryBudget();
    this.tabEngine.render();
    this.showToast('Split View active — choose a tab or URL for the second screen');
  }

  exitSplitView() {
    if (!this.splitViewActive) return;
    this.splitViewActive = false;
    this.splitPrimaryTabId = null;
    this.splitSecondaryTabId = null;
    this.splitFocusedPane = 'left';

    document.getElementById('split-view-btn')?.classList.remove('active');
    document.getElementById('crown-content-area')?.classList.remove('split-view-mode');

    const divider = document.getElementById('split-view-divider');
    if (divider) divider.style.display = 'none';
    const floatingBar = document.getElementById('split-view-floating-bar');
    if (floatingBar) floatingBar.style.display = 'none';
    const picker = document.getElementById('split-secondary-picker');
    if (picker) picker.style.display = 'none';

    const dashboard = document.getElementById('new-tab-dashboard');
    if (dashboard) {
      dashboard.classList.remove('split-left');
      dashboard.style.left = '';
      dashboard.style.width = '';
    }
    const internalMount = document.getElementById('internal-views-mount');
    if (internalMount) {
      internalMount.classList.remove('split-left');
      internalMount.style.left = '';
      internalMount.style.width = '';
    }

    document.querySelectorAll('.webview-frame').forEach(f => {
      f.classList.remove('split-left', 'split-right', 'split-focused');
      f.style.width = '';
      f.style.left = '';
    });

    const activeTab = this.tabEngine.getActiveTab();
    if (activeTab) {
      this.syncActiveTab(activeTab);
    }
    this.tabEngine.enforceMemoryBudget();
    this.tabEngine.render();
    this.showToast('Exited Split View');
  }

  onTabClosedInSplitView(closedTabId) {
    if (!this.splitViewActive) return;
    if (closedTabId === this.splitPrimaryTabId) {
      if (this.splitSecondaryTabId) {
        this.splitPrimaryTabId = this.splitSecondaryTabId;
        this.splitSecondaryTabId = null;
        this.tabEngine.activeTabId = this.splitPrimaryTabId;
        this._applySplitViewLayout();
      } else {
        this.exitSplitView();
      }
    } else if (closedTabId === this.splitSecondaryTabId) {
      this.splitSecondaryTabId = null;
      this._applySplitViewLayout();
    }
  }

  _applySplitViewLayout() {
    if (!this.splitViewActive) return;

    const primaryTab = this.tabEngine.tabs.find(t => t.id === this.splitPrimaryTabId) || this.tabEngine.getActiveTab();
    if (!primaryTab) {
      this.exitSplitView();
      return;
    }
    this.splitPrimaryTabId = primaryTab.id;

    const secondaryTab = this.splitSecondaryTabId
      ? (this.tabEngine.tabs.find(t => t.id === this.splitSecondaryTabId) || null)
      : null;

    if (secondaryTab && secondaryTab.id === primaryTab.id) {
      this.splitSecondaryTabId = null;
    }

    const leftRatio = Math.max(20, Math.min(80, this.splitRatio || 50));
    const rightRatio = 100 - leftRatio;

    const dashboard = document.getElementById('new-tab-dashboard');
    const internalMount = document.getElementById('internal-views-mount');
    const picker = document.getElementById('split-secondary-picker');
    const divider = document.getElementById('split-view-divider');
    const floatingBar = document.getElementById('split-view-floating-bar');
    const focusLabel = document.getElementById('split-focus-label');

    // 1. Position Left Pane (Primary Tab)
    const isPrimaryNtp = (primaryTab.url === 'crown://newtab');
    const isPrimaryInternal = InternalViews.isInternalUrl(primaryTab.url);
    const isPrimaryWeb = !isPrimaryNtp && !isPrimaryInternal;

    if (isPrimaryNtp) {
      if (dashboard) {
        dashboard.classList.add('split-left');
        dashboard.style.left = '0%';
        dashboard.style.width = `calc(${leftRatio}% - 2px)`;
        dashboard.style.display = 'flex';
      }
      if (internalMount) {
        internalMount.style.display = 'none';
        internalMount.classList.remove('split-left');
      }
    } else if (isPrimaryInternal) {
      if (internalMount) {
        internalMount.classList.add('split-left');
        internalMount.style.left = '0%';
        internalMount.style.width = `calc(${leftRatio}% - 2px)`;
        internalMount.style.display = 'block';
        InternalViews.render(internalMount, primaryTab.url, (navUrl) => this.navigateTo(navUrl, primaryTab.id), {
          onSectionChange: (section) => this._syncInternalSettingsSection(primaryTab, section)
        });
      }
      if (dashboard) {
        dashboard.style.display = 'none';
        dashboard.classList.remove('split-left');
      }
    } else {
      if (dashboard) {
        dashboard.style.display = 'none';
        dashboard.classList.remove('split-left');
      }
      if (internalMount) {
        internalMount.style.display = 'none';
        internalMount.classList.remove('split-left');
      }
    }

    // 2. Position All Webview Iframes
    document.querySelectorAll('.webview-frame').forEach(f => {
      if (f.id === `iframe-${primaryTab.id}` && isPrimaryWeb) {
        f.classList.add('active', 'split-left');
        f.classList.remove('split-right');
        f.classList.toggle('split-focused', this.splitFocusedPane === 'left');
        f.style.left = '0%';
        f.style.width = `calc(${leftRatio}% - 2px)`;
        f.style.display = 'block';
      } else if (secondaryTab && f.id === `iframe-${secondaryTab.id}` && secondaryTab.url !== 'crown://newtab' && !InternalViews.isInternalUrl(secondaryTab.url)) {
        if (secondaryTab.hibernated || !this.frames.has(secondaryTab.id)) {
          secondaryTab.hibernated = false;
          this.restoreHibernatedTab(secondaryTab);
        }
        f.classList.add('active', 'split-right');
        f.classList.remove('split-left');
        f.classList.toggle('split-focused', this.splitFocusedPane === 'right');
        f.style.left = `calc(${leftRatio}% + 2px)`;
        f.style.width = `calc(${rightRatio}% - 2px)`;
        f.style.display = 'block';
      } else {
        f.classList.remove('active', 'split-left', 'split-right', 'split-focused');
        f.style.left = '';
        f.style.width = '';
      }
    });

    // 3. Position Right Pane Picker or Secondary Webview
    const showPicker = !secondaryTab || secondaryTab.url === 'crown://newtab';
    if (showPicker) {
      if (picker) {
        picker.style.display = 'flex';
        picker.style.left = `calc(${leftRatio}% + 2px)`;
        picker.style.width = `calc(${rightRatio}% - 2px)`;
        this._renderSplitSecondaryPicker(primaryTab.id);
      }
    } else {
      if (picker) picker.style.display = 'none';
    }

    // 4. Position Center Resizer Divider & Floating Control Bar
    if (divider) {
      divider.style.display = 'flex';
      divider.style.left = `${leftRatio}%`;
    }
    if (floatingBar) {
      floatingBar.style.display = 'flex';
    }
    if (focusLabel) {
      focusLabel.textContent = (this.splitFocusedPane === 'right' ? 'Right Pane' : 'Left Pane');
    }
  }

  _renderSplitSecondaryPicker(primaryTabId) {
    const listContainer = document.getElementById('split-picker-tabs-list');
    const countEl = document.getElementById('split-picker-tabs-count');
    const shortcutsGrid = document.getElementById('split-picker-shortcuts-grid');
    if (!listContainer || !shortcutsGrid) return;

    // 1. Open Tabs (excluding primaryTab and blank newtab)
    const openTabs = this.tabEngine.tabs.filter(t => t.id !== primaryTabId && t.url !== 'crown://newtab');
    if (countEl) countEl.textContent = openTabs.length;

    if (openTabs.length === 0) {
      listContainer.innerHTML = '<div class="split-picker-empty-note">No other web tabs open — search above or pick a shortcut below</div>';
    } else {
      listContainer.innerHTML = openTabs.map(t => `
        <div class="split-picker-tab-item" data-id="${t.id}" role="button" tabindex="0">
          <span class="split-picker-tab-icon">${this._getSiteIconHtml(t.url, t.title, 18, t.favicon)}</span>
          <div class="split-picker-tab-info">
            <span class="split-picker-tab-title">${this._escape(t.title || t.url)}</span>
            <span class="split-picker-tab-url">${this._escape(t.url)}</span>
          </div>
        </div>
      `).join('');

      listContainer.querySelectorAll('.split-picker-tab-item').forEach(item => {
        item.addEventListener('click', () => {
          const tabId = item.dataset.id;
          if (tabId) this.dockSplitSecondaryTab(tabId);
        });
      });
    }

    // 2. Quick Launch Grid (User shortcuts + Bookmarks)
    const pinned = Storage.getShortcuts();
    const bookmarks = Storage.getBookmarks().slice(0, 10);
    const seen = new Set();
    const items = [];

    [...pinned, ...bookmarks].forEach(b => {
      if (!b || !b.url) return;
      const lower = b.url.toLowerCase();
      if (seen.has(lower)) return;
      seen.add(lower);
      items.push(b);
    });

    if (items.length === 0) {
      shortcutsGrid.innerHTML = '<div class="split-picker-empty-note">No saved bookmarks or shortcuts yet</div>';
    } else {
      shortcutsGrid.innerHTML = items.slice(0, 12).map(b => `
        <div class="split-picker-shortcut-pill" data-url="${this._escape(b.url)}" role="button" tabindex="0">
          ${this._getSiteIconHtml(b.url, b.title, 14, b.favicon)}
          <span>${this._escape(b.title)}</span>
        </div>
      `).join('');

      shortcutsGrid.querySelectorAll('.split-picker-shortcut-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          const url = pill.dataset.url;
          if (url) this.dockSplitSecondaryTabWithUrl(url);
        });
      });
    }
  }

  dockSplitSecondaryTab(tabId) {
    if (!tabId || tabId === this.splitPrimaryTabId) return;
    this.splitSecondaryTabId = tabId;
    const tab = this.tabEngine.tabs.find(t => t.id === tabId);
    if (tab && tab.hibernated) {
      tab.hibernated = false;
      this.restoreHibernatedTab(tab);
    }
    this.splitFocusedPane = 'right';
    this.tabEngine.activeTabId = tabId;
    this._applySplitViewLayout();
    this.syncActiveTab(tab);
    this.tabEngine.enforceMemoryBudget();
    this.tabEngine.render();
    this.showToast('Docked tab into second screen');
  }

  dockSplitSecondaryTabWithUrl(rawUrl) {
    if (!rawUrl) return;
    const parsed = searchManager.parseInput(rawUrl);
    const targetUrl = Storage.isSafeUrl(parsed) ? parsed : 'https://www.google.com';
    const activeTab = this.tabEngine.getActiveTab();

    if (this.splitSecondaryTabId) {
      this.navigateTo(targetUrl, this.splitSecondaryTabId);
      this.splitFocusedPane = 'right';
      this.tabEngine.activeTabId = this.splitSecondaryTabId;
    } else {
      const newId = this.tabEngine.createTab(targetUrl, activeTab?.isIncognito || this.isIncognitoWindow, activeTab?.groupId);
      this.splitSecondaryTabId = newId;
      this.splitFocusedPane = 'right';
      this.tabEngine.activeTabId = newId;
    }

    this._applySplitViewLayout();
    const newTab = this.tabEngine.tabs.find(t => t.id === this.splitSecondaryTabId);
    if (newTab) this.syncActiveTab(newTab);
    this.tabEngine.render();
  }

  swapSplitPanes() {
    if (!this.splitViewActive) return;
    if (!this.splitSecondaryTabId) {
      this.showToast('Open a second tab before swapping');
      return;
    }

    const prevPrimary = this.splitPrimaryTabId;
    this.splitPrimaryTabId = this.splitSecondaryTabId;
    this.splitSecondaryTabId = prevPrimary;
    this.splitFocusedPane = 'left';
    this.tabEngine.activeTabId = this.splitPrimaryTabId;

    this._applySplitViewLayout();
    const activeTab = this.tabEngine.getActiveTab();
    if (activeTab) this.syncActiveTab(activeTab);
    this.tabEngine.render();
    this.showToast('Swapped split panes');
  }

  openSplitSecondaryPicker() {
    if (!this.splitViewActive) return;
    this.splitSecondaryTabId = null;
    this.splitFocusedPane = 'right';
    this._applySplitViewLayout();
    this.tabEngine.render();
  }

  _initSplitViewResizer() {
    const divider = document.getElementById('split-view-divider');
    const contentArea = document.getElementById('crown-content-area');
    if (!divider || !contentArea) return;

    divider.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { divider.setPointerCapture(e.pointerId); } catch {}
      divider.classList.add('dragging');

      const onMove = (moveEvent) => {
        const rect = contentArea.getBoundingClientRect();
        if (!rect.width) return;
        const pct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        this.splitRatio = Math.max(22, Math.min(78, pct));
        this._applySplitViewLayout();
      };

      const onUp = (upEvent) => {
        try { divider.releasePointerCapture(upEvent.pointerId); } catch {}
        divider.classList.remove('dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  // =========================================================================
  // Built-in Developer Tools Inspector (Ctrl+Shift+I / F12)
  // =========================================================================
  toggleDevTools(forceState = null) {
    const dock = document.getElementById('crown-devtools-dock');
    const contentArea = document.getElementById('crown-content-area');
    if (!dock) return;

    this.devToolsOpen = typeof forceState === 'boolean' ? forceState : !this.devToolsOpen;
    dock.classList.toggle('hidden', !this.devToolsOpen);
    contentArea?.classList.toggle('devtools-open', this.devToolsOpen);

    if (this.devToolsOpen) {
      this.refreshDevTools();
    }
  }

  refreshDevTools() {
    if (!this.devToolsOpen) return;
    const activeTab = this.tabEngine.getActiveTab();
    if (!activeTab) return;

    // 1. Request DOM snapshot from active frame or inspect internal view
    const iframe = this.frames.get(activeTab.id);
    if (iframe && activeTab.url !== 'crown://newtab' && !InternalViews.isInternalUrl(activeTab.url) && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage({ type: 'crown:devtools-request-dom' }, '*');
      } catch {}
    } else {
      // Inspect internal Crown page or New Tab Hub DOM directly
      const targetRoot = activeTab.url === 'crown://newtab'
        ? document.getElementById('new-tab-dashboard')
        : document.getElementById('internal-views-mount');
      const serializeInternal = (el, depth = 0) => {
        if (!el || depth > 4) return null;
        const children = [];
        for (let i = 0; i < Math.min(el.children.length, 15); i++) {
          const c = serializeInternal(el.children[i], depth + 1);
          if (c) children.push(c);
        }
        return {
          tag: (el.tagName || 'div').toLowerCase(),
          id: el.id || '',
          cls: typeof el.className === 'string' ? el.className.trim() : '',
          attrs: [],
          text: '',
          totalChildren: el.children.length,
          children
        };
      };
      this._renderDevToolsDomTree(serializeInternal(targetRoot, 0), {
        url: activeTab.url,
        title: activeTab.title,
        totalNodes: targetRoot ? targetRoot.getElementsByTagName('*').length : 0,
        scriptsCount: 0,
        stylesCount: document.styleSheets.length
      });
    }

    // 2. Refresh Memory & Storage tab
    this._renderDevToolsMemoryAndStorage();
  }

  _renderDevToolsDomTree(tree, metrics) {
    const metricsBar = document.getElementById('devtools-dom-metrics');
    const treeEl = document.getElementById('devtools-dom-tree');
    if (!treeEl) return;

    if (metricsBar && metrics) {
      metricsBar.textContent = `${metrics.url || ''} • ${metrics.totalNodes || 0} DOM nodes • ${metrics.scriptsCount || 0} scripts • ${metrics.stylesCount || 0} stylesheets`;
    }

    if (!tree) {
      treeEl.innerHTML = `<div class="devtools-empty">No DOM tree available for this view.</div>`;
      return;
    }

    const renderNode = (node, depth = 0) => {
      if (!node) return '';
      const indent = depth * 14;
      const idAttr = node.id ? ` <span class="dt-attr-name">id</span>=<span class="dt-attr-val">"${this._escape(node.id)}"</span>` : '';
      const clsAttr = node.cls ? ` <span class="dt-attr-name">class</span>=<span class="dt-attr-val">"${this._escape(node.cls.slice(0, 60))}"</span>` : '';
      const extraAttrs = (node.attrs || []).map(a => ` <span class="dt-attr-name">${this._escape(a.name)}</span>=<span class="dt-attr-val">"${this._escape(a.value)}"</span>`).join('');
      const textPart = node.text ? `<span class="dt-node-text">${this._escape(node.text)}</span>` : '';
      const childrenHtml = (node.children || []).map(c => renderNode(c, depth + 1)).join('');

      return `
        <div class="dt-dom-line" style="padding-left:${indent}px">
          <span class="dt-tag">&lt;${this._escape(node.tag)}${idAttr}${clsAttr}${extraAttrs}&gt;</span>
          ${textPart}
          ${!childrenHtml ? `<span class="dt-tag">&lt;/${this._escape(node.tag)}&gt;</span>` : ''}
        </div>
        ${childrenHtml}
        ${childrenHtml ? `<div class="dt-dom-line" style="padding-left:${indent}px"><span class="dt-tag">&lt;/${this._escape(node.tag)}&gt;</span></div>` : ''}
      `;
    };

    treeEl.innerHTML = renderNode(tree, 0);
  }

  _appendDevToolsConsoleLog(level, text, tabTitle = '') {
    this.devToolsLogs.push({
      level,
      text,
      tabTitle,
      time: new Date().toLocaleTimeString([], { hour12: false })
    });
    if (this.devToolsLogs.length > 120) this.devToolsLogs.shift();

    const logsEl = document.getElementById('devtools-console-logs');
    if (!logsEl) return;

    const row = document.createElement('div');
    row.className = `dt-console-row dt-level-${this._escape(level)}`;
    row.innerHTML = `
      <span class="dt-console-time">${this._escape(new Date().toLocaleTimeString([], { hour12: false }))}</span>
      <span class="dt-console-badge">${this._escape(level.toUpperCase())}</span>
      <span class="dt-console-msg">${this._escape(text)}</span>
    `;
    logsEl.appendChild(row);
    logsEl.scrollTop = logsEl.scrollHeight;
  }

  _appendDevToolsNetLog(entry) {
    this.devToolsNetLogs.unshift({
      ...entry,
      time: new Date().toLocaleTimeString([], { hour12: false })
    });
    if (this.devToolsNetLogs.length > 80) this.devToolsNetLogs.pop();

    const tbody = document.getElementById('devtools-network-tbody');
    if (!tbody) return;

    tbody.innerHTML = this.devToolsNetLogs.map(item => {
      const isBlocked = String(item.status || '').includes('BLOCK');
      return `
        <tr class="${isBlocked ? 'dt-net-blocked' : ''}">
          <td><span class="dt-status-pill ${isBlocked ? 'blocked' : 'allowed'}">${this._escape(item.status)}</span></td>
          <td>${this._escape(item.method)}</td>
          <td>${this._escape(item.kind)}</td>
          <td class="dt-url-cell" title="${this._escape(item.url)}">${this._escape(item.url)}</td>
        </tr>
      `;
    }).join('');
  }

  _renderDevToolsMemoryAndStorage() {
    const grid = document.getElementById('devtools-memory-grid');
    if (!grid) return;

    const s = Storage.getSettings();
    const totalTabs = this.tabEngine.tabs.length;
    const liveTabs = this.tabEngine.tabs.filter(t => !t.hibernated && this.frames.has(t.id)).length;
    const sleepingTabs = this.tabEngine.tabs.filter(t => t.hibernated).length;
    const activeExts = Storage.getExtensions().filter(x => x.enabled).length;

    let lsBytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        lsBytes += k.length + (localStorage.getItem(k) || '').length;
      }
    } catch {}

    grid.innerHTML = `
      <div class="dt-mem-card">
        <div class="dt-mem-label">Memory Saver Policy</div>
        <div class="dt-mem-val">${s.memorySaverMode !== false ? (s.memorySaverLevel || 'balanced').toUpperCase() : 'PAUSED'}</div>
        <div class="dt-mem-sub">Auto-hibernates inactive background tabs</div>
      </div>
      <div class="dt-mem-card">
        <div class="dt-mem-label">Tab Frames in Memory</div>
        <div class="dt-mem-val">${liveTabs} Live / ${sleepingTabs} Hibernated</div>
        <div class="dt-mem-sub">${totalTabs} total open tab${totalTabs === 1 ? '' : 's'}</div>
      </div>
      <div class="dt-mem-card">
        <div class="dt-mem-label">Sandboxed Extensions</div>
        <div class="dt-mem-val">${activeExts} Active</div>
        <div class="dt-mem-sub">Content scripts &amp; cosmetic filters</div>
      </div>
      <div class="dt-mem-card">
        <div class="dt-mem-label">Profile Storage Usage</div>
        <div class="dt-mem-val">${(lsBytes / 1024).toFixed(1)} KB</div>
        <div class="dt-mem-sub">Profile ID: ${this._escape(Storage.getActiveProfileId())}</div>
      </div>
    `;
  }

  _initDevToolsEvents() {
    document.querySelectorAll('#devtools-tabs .devtools-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.devtab;
        document.querySelectorAll('#devtools-tabs .devtools-tab').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('#crown-devtools-dock .devtools-pane').forEach(p => {
          p.classList.toggle('active', p.dataset.devpane === target);
        });
        if (target === 'memory') this._renderDevToolsMemoryAndStorage();
      });
    });

    document.getElementById('devtools-close-btn')?.addEventListener('click', () => {
      this.toggleDevTools(false);
    });

    document.getElementById('devtools-refresh-btn')?.addEventListener('click', () => {
      this.refreshDevTools();
    });

    document.getElementById('devtools-clear-btn')?.addEventListener('click', () => {
      this.devToolsLogs = [];
      this.devToolsNetLogs = [];
      const logsEl = document.getElementById('devtools-console-logs');
      if (logsEl) logsEl.innerHTML = '';
      const tbody = document.getElementById('devtools-network-tbody');
      if (tbody) tbody.innerHTML = '';
    });

    const runConsoleEval = () => {
      const input = document.getElementById('devtools-console-input');
      const code = (input?.value || '').trim();
      if (!code) return;
      input.value = '';
      this._appendDevToolsConsoleLog('cmd', `> ${code}`);

      const activeTab = this.tabEngine.getActiveTab();
      const iframe = activeTab ? this.frames.get(activeTab.id) : null;
      if (iframe && activeTab && !activeTab.url.startsWith('crown://') && iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({ type: 'crown:devtools-eval', code }, '*');
        } catch (err) {
          this._appendDevToolsConsoleLog('error', String(err));
        }
      } else {
        this._appendDevToolsConsoleLog('info', 'Console eval is isolated to external web frames for security.');
      }
    };

    document.getElementById('devtools-console-run-btn')?.addEventListener('click', runConsoleEval);
    document.getElementById('devtools-console-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runConsoleEval();
      }
    });
  }

  // =========================================================================
  // 3-Dots (⋮) Crown App Menu Dropdown
  // =========================================================================
  toggleAppMenu(forceState = null) {
    const menu = document.getElementById('crown-app-menu');
    const btn = document.getElementById('settings-menu-btn');
    if (!menu) return;

    const shouldOpen = typeof forceState === 'boolean' ? forceState : menu.classList.contains('hidden');
    if (shouldOpen) {
      this._syncAppMenuState();
      menu.classList.remove('hidden');
      btn?.classList.add('active');
    } else {
      menu.classList.add('hidden');
      btn?.classList.remove('active');
    }
  }

  _syncAppMenuState() {
    const zoomValEl = document.getElementById('app-menu-zoom-val');
    if (zoomValEl) zoomValEl.textContent = `${this.currentZoom || 100}%`;

    const splitBadge = document.getElementById('app-menu-split-badge');
    if (splitBadge) splitBadge.textContent = this.splitViewActive ? 'Active' : 'Ctrl+Shift+S';

    const seg = document.getElementById('app-menu-sidebar-seg');
    if (seg) {
      const isLeft = this.tabEngine.position === 'left';
      const isCompact = isLeft && this.tabEngine.sidebarCollapsed;
      const mode = !isLeft ? 'off' : (isCompact ? 'compact' : 'on');
      seg.querySelectorAll('.seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.sidebarMode === mode);
      });
    }
  }

  _initAppMenuEvents() {
    const menu = document.getElementById('crown-app-menu');
    if (!menu) return;

    // Sidebar segmented control (On | Compact | Off)
    menu.querySelectorAll('#app-menu-sidebar-seg .seg-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.sidebarMode;
        if (mode === 'off') {
          this.tabEngine.setLayout('top');
        } else if (mode === 'on') {
          this.tabEngine.setLayout('left');
          if (this.tabEngine.sidebarCollapsed) this.tabEngine.toggleSidebarCollapse();
        } else if (mode === 'compact') {
          this.tabEngine.setLayout('left');
          if (!this.tabEngine.sidebarCollapsed) this.tabEngine.toggleSidebarCollapse();
        }
        this._syncAppMenuState();
      });
    });

    // Inline Zoom Controls
    document.getElementById('app-menu-zoom-out')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.changeZoom(-10);
      this._syncAppMenuState();
    });
    document.getElementById('app-menu-zoom-in')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.changeZoom(10);
      this._syncAppMenuState();
    });
    document.getElementById('app-menu-zoom-val')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resetZoom();
      this._syncAppMenuState();
    });
    document.getElementById('app-menu-fullscreen-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleAppMenu(false);
      this.toggleFullscreen();
    });

    // Menu Action Rows
    menu.querySelectorAll('.app-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.menuAction;
        this.toggleAppMenu(false);

        switch (action) {
          case 'new-tab':
            this.tabEngine.createTab('crown://newtab');
            break;
          case 'new-window':
            this.openNewWindow('crown://newtab');
            break;
          case 'incognito':
            this.openIncognitoWindow();
            break;
          case 'split-view':
            this.toggleSplitView();
            break;
          case 'reload-page':
            this.reloadCurrentTab?.();
            break;
          case 'bookmark-page':
            document.getElementById('omnibox-bookmark-btn')?.click();
            break;
          case 'share-qr':
            this.toggleQrCodePopover();
            break;
          case 'history':
            this.navigateTo('crown://history');
            break;
          case 'bookmarks':
            this.navigateTo('crown://bookmarks');
            break;
          case 'downloads':
            document.getElementById('downloads-drawer')?.classList.add('open');
            this.downloadManager?.renderDrawer?.();
            break;
          case 'extensions':
            this.navigateTo('crown://extensions');
            break;
          case 'clear-data':
            this.openClearDataModal();
            break;
          case 'print':
            this.printActivePage();
            break;
          case 'find':
            this.openFindBar();
            break;
          case 'reader':
            this.toggleReaderMode();
            break;
          case 'devtools':
            this.toggleDevTools();
            break;
          case 'about':
            this.navigateTo('crown://settings#about');
            break;
          case 'settings':
            this.navigateTo('crown://settings');
            break;
          case 'exit':
            window.close();
            break;
        }
      });
    });
  }

  printActivePage() {
    const activeTab = this.tabEngine.getActiveTab();
    const iframe = activeTab ? this.frames.get(activeTab.id) : null;
    if (iframe && activeTab && !activeTab.url.startsWith('crown://') && iframe.contentWindow) {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        return;
      } catch {}
    }
    window.print();
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  // =========================================================================
  // Energy Saver, Battery Monitor & Accessibility / Appearance Sync
  // =========================================================================
  applyAccessibilityAndAppearanceSettings() {
    const s = Storage.getSettings();
    const appEl = document.getElementById('crown-app');

    // Bookmarks Bar visibility
    const bmBar = document.getElementById('crown-bookmarks-bar');
    if (bmBar) {
      bmBar.style.display = s.showBookmarksBar === false ? 'none' : 'flex';
    }

    // High-contrast & Reduced-motion classes
    appEl?.classList.toggle('high-contrast-mode', Boolean(s.highContrast));
    appEl?.classList.toggle('reduced-motion-mode', Boolean(s.reducedMotion || this._energySaverActiveNow));

    // Spellcheck attribute on inputs
    const spellOn = s.spellcheck !== false;
    document.querySelectorAll('input[type="text"], textarea').forEach(inp => {
      if (inp.id !== 'omnibox-input' && inp.id !== 'devtools-console-input') {
        inp.spellcheck = spellOn;
      }
    });

    this.applyAccentColor();
    this.applyWallpaper(s.wallpaper || 'obsidian');
    this.currentZoom = Number(s.pageZoom) || 100;
    this.applyZoom();
    this._evaluateEnergySaverPolicy();
  }

  applyWallpaper(wallpaperId) {
    const dash = document.getElementById('new-tab-dashboard');
    if (!dash) return;
    const wp = wallpaperId || Storage.getSettings().wallpaper || 'obsidian';
    dash.dataset.wallpaper = wp;
    if (wp !== 'custom') {
      dash.style.backgroundImage = '';
      dash.style.backgroundColor = '';
    } else {
      this.applyCustomBackground();
    }
  }

  setPageZoom(zoomNum) {
    this.currentZoom = Math.max(50, Math.min(200, Number(zoomNum) || 100));
    Storage.saveSettings({ pageZoom: this.currentZoom });
    this.applyZoom();
    this.showToast(`Zoom: ${this.currentZoom}%`);
  }

  _initBatteryAndEnergySaver() {
    this._batteryState = { level: 1, charging: true };
    if (typeof navigator.getBattery === 'function') {
      navigator.getBattery().then(battery => {
        const syncBattery = () => {
          this._batteryState = {
            level: typeof battery.level === 'number' ? battery.level : 1,
            charging: Boolean(battery.charging)
          };
          this._evaluateEnergySaverPolicy();
        };
        syncBattery();
        battery.addEventListener('levelchange', syncBattery);
        battery.addEventListener('chargingchange', syncBattery);
      }).catch(() => {});
    }
    this._evaluateEnergySaverPolicy();
  }

  _evaluateEnergySaverPolicy() {
    const s = Storage.getSettings();
    let shouldActivate = false;
    if (s.energySaver) {
      const mode = s.energySaverMode || 'battery_20';
      const bat = this._batteryState || { level: 1, charging: true };
      if (mode === 'always') {
        shouldActivate = true;
      } else if (mode === 'unplugged') {
        shouldActivate = !bat.charging;
      } else if (mode === 'battery_20') {
        shouldActivate = !bat.charging && bat.level <= 0.20;
      }
    }
    this._energySaverActiveNow = shouldActivate;
    const appEl = document.getElementById('crown-app');
    appEl?.classList.toggle('energy-saver-active', shouldActivate);
    appEl?.classList.toggle('reduced-motion-mode', Boolean(s.reducedMotion || shouldActivate));
  }

  _getTitleForUrl(url) {
    if (url === 'crown://newtab') return 'New Tab';
    if (url === 'crown://history') return 'History - Crown';
    if (url === 'crown://bookmarks') return 'Bookmarks - Crown';
    if (url === 'crown://settings' || url.startsWith('crown://settings')) return 'Settings - Crown';
    if (url === 'crown://extensions') return 'Extensions - Crown';
    return this.tabEngine._extractDomain(url);
  }

  _syncInternalSettingsSection(tab, section) {
    if (!tab) return;
    const cleanSection = String(section || 'system').trim().toLowerCase() || 'system';
    const nextUrl = (tab.url === 'crown://extensions' && cleanSection === 'extensions')
      ? 'crown://extensions'
      : `crown://settings#${cleanSection}`;
    if (tab.url === nextUrl) return;

    const prevRoute = InternalViews.getRoute(tab.url);
    const nextRoute = InternalViews.getRoute(nextUrl);
    tab.url = nextUrl;
    if (Array.isArray(tab.history) && tab.historyIndex >= 0 && tab.historyIndex < tab.history.length) {
      tab.history[tab.historyIndex] = nextUrl;
    }
    tab.title = this._getTitleForUrl(nextUrl);
    if (prevRoute !== nextRoute) {
      tab.favicon = this.tabEngine._getFaviconSvg(nextUrl, tab.isIncognito);
    }
    if (tab.id === this.tabEngine.activeTabId) {
      const omnibox = document.getElementById('omnibox-input');
      if (omnibox && document.activeElement !== omnibox) {
        omnibox.value = nextUrl;
      }
    }
    this.tabEngine.saveSession();
    if (prevRoute !== nextRoute) {
      this.tabEngine.render();
    }
  }

  // =========================================================================
  // Offline SVG QR Code Generator (100% Local ISO/IEC 18004 Matrix)
  // =========================================================================
  toggleQrCodePopover() {
    const popover = document.getElementById('qr-code-popover');
    if (!popover) return;
    if (popover.style.display === 'flex') {
      this.closeQrCodePopover();
    } else {
      this.openQrCodePopover();
    }
  }

  openQrCodePopover() {
    const popover = document.getElementById('qr-code-popover');
    const svgMount = document.getElementById('qr-code-svg-mount');
    const urlText = document.getElementById('qr-code-url-text');
    const btn = document.getElementById('omnibox-qr-btn');
    if (!popover || !svgMount) return;

    const tab = this.tabEngine.getActiveTab();
    const rawUrl = (tab && tab.url) ? tab.url : (window.location?.href || 'crown://newtab');
    this._currentQrUrl = rawUrl;
    this._currentQrSvg = this._generateQrCodeSvg(rawUrl);

    svgMount.innerHTML = this._currentQrSvg;
    if (urlText) {
      urlText.textContent = rawUrl;
      urlText.title = rawUrl;
    }
    popover.style.display = 'flex';
    btn?.classList.add('active');
  }

  closeQrCodePopover() {
    const popover = document.getElementById('qr-code-popover');
    const btn = document.getElementById('omnibox-qr-btn');
    if (popover) popover.style.display = 'none';
    btn?.classList.remove('active');
  }

  downloadCurrentQrSvg() {
    const tab = this.tabEngine.getActiveTab();
    const currentUrl = this._currentQrUrl || tab?.url || (window.location?.href || 'crown://newtab');
    const svgContent = this._currentQrSvg || this._generateQrCodeSvg(currentUrl);
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crown-qr-${Date.now()}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.showToast('QR Code SVG downloaded');
  }

  // Self-contained ISO/IEC 18004 Byte-mode QR Code SVG Generator (Versions 1-10, ECC L)
  _generateQrCodeSvg(text) {
    const dataBytes = Array.from(new TextEncoder().encode(String(text || 'https://crown.browser').slice(0, 260)));
    // Version table for ECC Level L: [version, totalCodewords, ecCodewordsPerBlock, numBlocks, alignCenters]
    const VERSIONS = [
      [1, 26, 7, 1, []],
      [2, 44, 10, 1, [6, 18]],
      [3, 70, 15, 1, [6, 22]],
      [4, 100, 20, 1, [6, 26]],
      [5, 134, 26, 1, [6, 30]],
      [6, 172, 18, 2, [6, 34]],
      [7, 196, 20, 2, [6, 22, 38]],
      [8, 242, 24, 2, [6, 24, 42]],
      [9, 292, 30, 2, [6, 26, 46]],
      [10, 346, 18, 4, [6, 28, 50]]
    ];
    let verSpec = VERSIONS[VERSIONS.length - 1];
    for (const spec of VERSIONS) {
      const dataCap = spec[1] - spec[2] * spec[3];
      const headerBytes = spec[0] >= 10 ? 3 : 2;
      if (dataBytes.length + headerBytes <= dataCap) {
        verSpec = spec;
        break;
      }
    }
    const [ver, totalCw, ecCw, numBlocks, align] = verSpec;
    const dataCwCount = totalCw - ecCw * numBlocks;

    // Encode bit stream (Mode 0100 = Byte)
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    pushBits(0b0100, 4);
    pushBits(dataBytes.length, ver >= 10 ? 16 : 8);
    for (const b of dataBytes) pushBits(b, 8);
    pushBits(0, Math.min(4, dataCwCount * 8 - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);
    const dataCodewords = [];
    for (let i = 0; i < bits.length && dataCodewords.length < dataCwCount; i += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b++) byte = (byte << 1) | (bits[i + b] || 0);
      dataCodewords.push(byte);
    }
    let padToggle = true;
    while (dataCodewords.length < dataCwCount) {
      dataCodewords.push(padToggle ? 0xEC : 0x11);
      padToggle = !padToggle;
    }

    // GF(256) Reed-Solomon Error Correction (primitive polynomial 0x11D)
    const gfExp = new Uint8Array(512);
    const gfLog = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) {
      gfExp[i] = x;
      gfLog[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];
    const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : gfExp[gfLog[a] + gfLog[b]];

    let gen = [1];
    for (let i = 0; i < ecCw; i++) {
      const next = new Array(gen.length + 1).fill(0);
      for (let j = 0; j < gen.length; j++) {
        next[j] ^= gen[j];
        next[j + 1] ^= gfMul(gen[j], gfExp[i]);
      }
      gen = next;
    }

    const blocksData = [];
    const blocksEc = [];
    let offset = 0;
    const baseDataLen = Math.floor(dataCwCount / numBlocks);
    const extraBlocks = dataCwCount % numBlocks;
    for (let b = 0; b < numBlocks; b++) {
      const len = baseDataLen + (b >= numBlocks - extraBlocks ? 1 : 0);
      const block = dataCodewords.slice(offset, offset + len);
      offset += len;
      blocksData.push(block);
      const rem = new Uint8Array(ecCw);
      for (const byte of block) {
        const factor = byte ^ rem[0];
        rem.copyWithin(0, 1);
        rem[ecCw - 1] = 0;
        for (let j = 0; j < ecCw; j++) rem[j] ^= gfMul(gen[j + 1], factor);
      }
      blocksEc.push(Array.from(rem));
    }

    const finalCodewords = [];
    const maxDataLen = baseDataLen + (extraBlocks > 0 ? 1 : 0);
    for (let i = 0; i < maxDataLen; i++) {
      for (let b = 0; b < numBlocks; b++) {
        if (i < blocksData[b].length) finalCodewords.push(blocksData[b][i]);
      }
    }
    for (let i = 0; i < ecCw; i++) {
      for (let b = 0; b < numBlocks; b++) finalCodewords.push(blocksEc[b][i]);
    }

    // Build Matrix
    const size = ver * 4 + 17;
    const grid = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
    const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

    const setFunc = (r, c, val) => {
      if (r >= 0 && r < size && c >= 0 && c < size) {
        grid[r][c] = val ? 1 : 0;
        isFunc[r][c] = 1;
      }
    };

    const drawFinder = (r0, c0) => {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const on = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6))
            || (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6))
            || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
          setFunc(r0 + dr, c0 + dc, on ? 1 : 0);
        }
      }
    };
    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    for (let i = 8; i < size - 8; i++) {
      setFunc(6, i, i % 2 === 0);
      setFunc(i, 6, i % 2 === 0);
    }

    for (const ar of align) {
      for (const ac of align) {
        if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            setFunc(ar + dr, ac + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
          }
        }
      }
    }

    // Reserve format info & dark module
    for (let i = 0; i <= 8; i++) {
      if (!isFunc[8][i]) setFunc(8, i, 0);
      if (!isFunc[i][8]) setFunc(i, 8, 0);
      if (i < 8) {
        if (!isFunc[8][size - 1 - i]) setFunc(8, size - 1 - i, 0);
        if (!isFunc[size - 1 - i][8]) setFunc(size - 1 - i, 8, 0);
      }
    }
    setFunc(size - 8, 8, 1);

    // Place data bits in upward/downward 2-column zig-zag
    let bitIdx = 0;
    const totalBits = finalCodewords.length * 8;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        const r = upward ? (size - 1 - vert) : vert;
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          if (!isFunc[r][c]) {
            let bit = 0;
            if (bitIdx < totalBits) {
              bit = (finalCodewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
              bitIdx++;
            }
            // Apply Mask 0: (r + c) % 2 === 0
            if ((r + c) % 2 === 0) bit ^= 1;
            grid[r][c] = bit;
          }
        }
      }
      upward = !upward;
    }

    // Write Format Info for ECC L (01) + Mask 0 (000) -> precomputed BCH 15-bit: 0x77C4
    const fmtBits = 0x77C4;
    const fmtCoordsA = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    for (let i = 0; i < 15; i++) {
      const bit = (fmtBits >>> i) & 1;
      const [r, c] = fmtCoordsA[i];
      grid[r][c] = bit;
      if (i < 8) grid[8][size - 1 - i] = bit;
      else grid[size - 15 + i][8] = bit;
    }

    // Render SVG path
    const quiet = 3;
    const viewSize = size + quiet * 2;
    let pathD = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === 1) {
          pathD += `M${c + quiet},${r + quiet}h1v1h-1z`;
        }
      }
    }
    return `<svg class="crown-qr-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" width="188" height="188" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff" rx="2"/><path d="${pathD}" fill="#0c0d10"/></svg>`;
  }

  // =========================================================================
  // Command Palette & Instant Tab/Bookmark Search (Ctrl+K)
  // =========================================================================
  _initCommandPaletteEvents() {
    const input = document.getElementById('command-palette-input');
    const resultsBox = document.getElementById('command-palette-results');
    if (!input || !resultsBox) return;

    input.addEventListener('input', () => {
      this._cmdActiveIndex = 0;
      this._renderCommandPaletteResults(input.value);
    });

    input.addEventListener('keydown', (e) => {
      const items = [...resultsBox.querySelectorAll('.cmd-palette-item')];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length > 0) {
          this._cmdActiveIndex = ((this._cmdActiveIndex || 0) + 1) % items.length;
          items.forEach((el, idx) => el.classList.toggle('active', idx === this._cmdActiveIndex));
          items[this._cmdActiveIndex]?.scrollIntoView?.({ block: 'nearest' });
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length > 0) {
          this._cmdActiveIndex = ((this._cmdActiveIndex || 0) - 1 + items.length) % items.length;
          items.forEach((el, idx) => el.classList.toggle('active', idx === this._cmdActiveIndex));
          items[this._cmdActiveIndex]?.scrollIntoView?.({ block: 'nearest' });
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const activeEl = items[this._cmdActiveIndex || 0];
        if (activeEl) activeEl.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeCommandPalette();
      }
    });
  }

  toggleCommandPalette() {
    const overlay = document.getElementById('command-palette-overlay');
    if (!overlay) return;
    if (overlay.classList.contains('open')) {
      this.closeCommandPalette();
    } else {
      this.openCommandPalette();
    }
  }

  openCommandPalette() {
    const overlay = document.getElementById('command-palette-overlay');
    const input = document.getElementById('command-palette-input');
    if (!overlay || !input) return;

    this._cmdActiveIndex = 0;
    input.value = '';
    this._renderCommandPaletteResults('');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => input.focus(), 20);
  }

  closeCommandPalette() {
    const overlay = document.getElementById('command-palette-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }

  _renderCommandPaletteResults(query = '') {
    const resultsBox = document.getElementById('command-palette-results');
    if (!resultsBox) return;

    const q = (query || '').trim().toLowerCase();
    const entries = [];

    // 1. Open & Hibernated Tabs
    for (const tab of this.tabEngine.tabs) {
      const title = tab.title || 'New Tab';
      const url = tab.url || '';
      if (!q || title.toLowerCase().includes(q) || url.toLowerCase().includes(q)) {
        entries.push({
          badge: tab.hibernated ? 'Sleeping Tab' : 'Open Tab',
          title,
          subtitle: url,
          iconHtml: this._getSiteIconHtml(url, title, 15, tab.favicon),
          run: () => {
            this.tabEngine.switchTab(tab.id);
          }
        });
      }
    }

    // 2. Bookmarks
    for (const bm of Storage.getBookmarks()) {
      const title = bm.title || bm.url;
      if (!q || title.toLowerCase().includes(q) || (bm.url || '').toLowerCase().includes(q)) {
        entries.push({
          badge: 'Bookmark',
          title,
          subtitle: bm.url,
          iconHtml: this._getSiteIconHtml(bm.url, title, 15, bm.favicon),
          run: () => {
            this.navigateTo(bm.url);
          }
        });
      }
    }

    // 3. Quick Browser Actions & Extensions
    const actions = [
      { title: 'New Tab', subtitle: 'Open a new tab (Ctrl+T)', run: () => this.tabEngine.createTab('crown://newtab') },
      { title: 'Toggle Split View', subtitle: 'Side-by-side dual pane browsing (Ctrl+Shift+S)', run: () => this.toggleSplitView() },
      { title: 'Share Current Page via QR Code', subtitle: 'Generate an offline SVG QR code for the active tab', run: () => this.openQrCodePopover() },
      { title: 'Manage Extensions', subtitle: 'Open crown://extensions to toggle or install extensions', run: () => this.navigateTo('crown://extensions') },
      { title: 'Manage Bookmarks', subtitle: 'Open crown://bookmarks to organize, import or export bookmarks', run: () => this.navigateTo('crown://bookmarks') },
      { title: 'Clear Browsing Data', subtitle: 'Open clear history & cookies dialog (Ctrl+Shift+Del)', run: () => this.openClearDataModal() },
      { title: 'Toggle Developer Tools', subtitle: 'Open DOM, Console, Network & Memory inspector (F12)', run: () => this.toggleDevTools() }
    ];
    for (const act of actions) {
      if (!q || act.title.toLowerCase().includes(q) || act.subtitle.toLowerCase().includes(q)) {
        entries.push({
          badge: 'Command',
          title: act.title,
          subtitle: act.subtitle,
          iconHtml: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
          run: act.run
        });
      }
    }

    // 4. Recent History (when searching)
    if (q) {
      for (const h of Storage.getHistory().slice(0, 30)) {
        const title = h.title || h.url;
        if (title.toLowerCase().includes(q) || (h.url || '').toLowerCase().includes(q)) {
          entries.push({
            badge: 'History',
            title,
            subtitle: h.url,
            iconHtml: this._getSiteIconHtml(h.url, title, 15, h.favicon),
            run: () => this.navigateTo(h.url)
          });
        }
      }
    }

    const limited = entries.slice(0, 14);
    resultsBox.innerHTML = '';

    if (limited.length === 0) {
      resultsBox.innerHTML = `<div class="cmd-palette-empty">No matching tabs, bookmarks, or commands found.</div>`;
      return;
    }

    limited.forEach((entry, idx) => {
      const row = document.createElement('div');
      row.className = `cmd-palette-item ${idx === (this._cmdActiveIndex || 0) ? 'active' : ''}`.trim();
      row.setAttribute('role', 'option');
      row.innerHTML = `
        <span class="cmd-item-icon">${entry.iconHtml}</span>
        <div class="cmd-item-text">
          <span class="cmd-item-title">${this._escape(entry.title)}</span>
          <span class="cmd-item-sub">${this._escape(entry.subtitle)}</span>
        </div>
        <span class="cmd-item-badge">${this._escape(entry.badge)}</span>
      `;
      row.onclick = () => {
        this.closeCommandPalette();
        entry.run();
      };
      resultsBox.appendChild(row);
    });
  }

  _hasLinkDragTypes(dt) {
    if (!dt || !dt.types) return false;
    const types = Array.from(dt.types);
    return types.includes('text/uri-list') || types.includes('text/plain');
  }

  _clearLinkDropHighlights() {
    document.querySelectorAll('.tab-link-drop-target, .link-drop-target').forEach(el => {
      el.classList.remove('tab-link-drop-target', 'link-drop-target');
    });
  }

  _bindLinkDragAndDrop() {
    const clearAll = () => this._clearLinkDropHighlights();

    const stripIds = ['tab-bar', 'sidebar-tab-list'];
    for (const id of stripIds) {
      const strip = document.getElementById(id);
      if (!strip) continue;

      strip.addEventListener('dragover', (e) => {
        if (!this._hasLinkDragTypes(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
        clearAll();

        const overTab = e.target.closest?.('.browser-tab');
        const overNewBtn = e.target.closest?.('#new-tab-btn');
        if (overTab) {
          overTab.classList.add('tab-link-drop-target');
        } else if (overNewBtn) {
          overNewBtn.classList.add('link-drop-target');
        } else {
          strip.classList.add('tab-link-drop-target');
        }
      });

      strip.addEventListener('dragleave', (e) => {
        if (!strip.contains(e.relatedTarget)) {
          clearAll();
        }
      });

      strip.addEventListener('drop', (e) => {
        const droppedUrl = Storage.extractDroppedSafeUrl(e.dataTransfer);
        clearAll();
        if (!droppedUrl) return;
        e.preventDefault();
        e.stopPropagation();

        const overTab = e.target.closest?.('.browser-tab');
        const overNewBtn = e.target.closest?.('#new-tab-btn');
        if (overTab && overTab.dataset.tabId) {
          this.navigateTo(droppedUrl, overTab.dataset.tabId);
          this.tabEngine.switchTab(overTab.dataset.tabId);
          return;
        }
        if (overNewBtn) {
          this.tabEngine.createTab(droppedUrl, this.isIncognitoWindow);
          return;
        }

        const isVertical = (id === 'sidebar-tab-list');
        let insertIndex = this.tabEngine.tabs.length;
        for (let i = 0; i < this.tabEngine.tabs.length; i++) {
          const el = this.tabEngine.tabElements.get(this.tabEngine.tabs[i].id);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const mid = isVertical ? (r.top + r.height / 2) : (r.left + r.width / 2);
          if ((isVertical ? e.clientY : e.clientX) < mid) {
            insertIndex = i;
            break;
          }
        }
        const newTabId = this.tabEngine.createTab(droppedUrl, this.isIncognitoWindow);
        const curIdx = this.tabEngine.tabs.findIndex(t => t.id === newTabId);
        if (curIdx !== -1 && insertIndex >= 0 && insertIndex < this.tabEngine.tabs.length && curIdx !== insertIndex) {
          const [moved] = this.tabEngine.tabs.splice(curIdx, 1);
          this.tabEngine.tabs.splice(insertIndex, 0, moved);
          this.tabEngine.render();
          this.tabEngine.saveSession();
        }
      });
    }

    const omniboxWrap = document.querySelector('.omnibox-container');
    const omnibox = document.getElementById('omnibox-input');
    if (omniboxWrap) {
      omniboxWrap.addEventListener('dragover', (e) => {
        if (!this._hasLinkDragTypes(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
        clearAll();
        omniboxWrap.classList.add('link-drop-target');
      });
      omniboxWrap.addEventListener('dragleave', (e) => {
        if (!omniboxWrap.contains(e.relatedTarget)) {
          omniboxWrap.classList.remove('link-drop-target');
        }
      });
      omniboxWrap.addEventListener('drop', (e) => {
        const droppedUrl = Storage.extractDroppedSafeUrl(e.dataTransfer);
        clearAll();
        if (!droppedUrl) return;
        e.preventDefault();
        e.stopPropagation();
        if (omnibox) omnibox.value = droppedUrl;
        this.navigateTo(droppedUrl);
      });
    }

    const contentArea = document.getElementById('crown-content-area');
    contentArea?.addEventListener('dragover', (e) => {
      const active = this.tabEngine.getActiveTab();
      if (active && active.url === 'crown://newtab' && this._hasLinkDragTypes(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
      }
    });
    contentArea?.addEventListener('drop', (e) => {
      const active = this.tabEngine.getActiveTab();
      if (!active || active.url !== 'crown://newtab') return;
      const droppedUrl = Storage.extractDroppedSafeUrl(e.dataTransfer);
      if (!droppedUrl) return;
      e.preventDefault();
      e.stopPropagation();
      this.navigateTo(droppedUrl, active.id);
    });

    document.addEventListener('dragover', (e) => {
      if (e.target?.closest?.('input, textarea')) return;
      if (this._hasLinkDragTypes(e.dataTransfer)) {
        e.preventDefault();
      }
    });
    document.addEventListener('drop', (e) => {
      clearAll();
      if (e.target?.closest?.('input, textarea')) return;
      if (this._hasLinkDragTypes(e.dataTransfer)) {
        e.preventDefault();
      }
    });
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
