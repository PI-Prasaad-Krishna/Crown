// Crown Browser — Core Application Controller
import { shield } from './shield.js';
import { searchManager } from './search.js';
import { Storage } from './storage.js';
import { TabEngine } from './tabs.js';
import { InternalViews } from './internal-views.js';
import { downloadManager } from './downloads.js';

const BRAND_ICONS = {
  'google.com': (size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>`,
  'youtube.com': (size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="#FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  'github.com': (size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="#ffffff"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>`,
  'reddit.com': (size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="#FF4500"><circle cx="12" cy="12" r="10"/><path fill="#FFF" d="M12 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm5.5 6.5a1.5 1.5 0 0 0-2.4-.9c-.9-.4-2-.7-3.1-.7v-3l2.2.5a1 1 0 1 0 .2-.9l-2.8-.6a.5.5 0 0 0-.6.4l-.4 3.6c-1.2 0-2.3.3-3.2.7a1.5 1.5 0 1 0-1.4 2.4c0 .3 0 .6.1.9 0 2.2 2.7 4 6 4s6-1.8 6-4c0-.3 0-.6-.1-.9a1.5 1.5 0 0 0 1.5-1.4zM9.5 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm5 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm-4.8 2.2a.5.5 0 0 1 .7 0c.5.5 1.2.7 1.6.7s1.1-.2 1.6-.7a.5.5 0 1 1 .7.7c-.7.7-1.5 1-2.3 1s-1.6-.3-2.3-1a.5.5 0 0 1 0-.7z"/></svg>`,
  'wikipedia.org': (size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="#ffffff"><path d="M12.09 13.12 9.5 5H7.13L3 17.58h2.09l1.15-3.5h4.16l.95 3.5h2.17l4.08-12.58h-2.12l-3.39 8.12zm-4.14-1.68L9.5 6.94l1.55 4.5H7.95zm11.23-6.44h-2.09L21.2 17.58h2.09L19.18 5z"/></svg>`
};

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
    this.splitSecondaryTabId = null;
    this.splitRatio = 50; // percentage width of left pane

    // Built-in Developer Tools Inspector State
    this.devToolsOpen = false;
    this.devToolsLogs = [];
    this.devToolsNetLogs = [];
  }

  async init() {
    searchManager.init();
    await shield.init();
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
    this._initBatteryAndEnergySaver();
    this._initSplitViewResizer();
    this._initDevToolsEvents();
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
        Storage.clearAllCookies();
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
    if (!this.isIncognitoWindow && !tornOffUrl && profiles.length >= 2 && Storage.getShowProfilePickerOnStartup()) {
      this.openProfilePicker(true);
    }
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
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      try {
        await window.__TAURI_INTERNALS__.invoke('open_incognito_window');
        return;
      } catch (e) {
        console.warn('Native incognito window fallback:', e);
      }
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

    if (perms.javascript === 'block') {
      iframe.setAttribute('sandbox', 'allow-forms');
    } else {
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
    }
  }

  removeFrame(tabId) {
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

    if (this.splitViewActive && this.splitSecondaryTabId && this.splitSecondaryTabId !== tab.id && isNormalWebpage) {
      this._applySplitViewLayout();
    } else {
      document.querySelectorAll('.webview-frame').forEach(f => {
        f.classList.remove('split-left', 'split-right', 'split-focused');
        f.style.width = '';
        f.style.left = '';
        f.classList.toggle('active', f.id === `iframe-${tab.id}` && isNormalWebpage);
      });
      const divider = document.getElementById('split-view-divider');
      if (divider) divider.style.display = 'none';
    }

    if (tab.url === 'crown://newtab') {
      if (dashboard.style.display !== 'flex') dashboard.style.display = 'flex';
      if (internalMount.style.display !== 'none') internalMount.style.display = 'none';
      omnibox.value = '';
      this.renderShortcuts();
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
    this.updateBookmarkStarUI();
    this.updateSecurityIndicatorUI(tab);
    this.updateReaderModeButtonUI(tab);
    this.updateNavButtonsUI();
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
      this._loadFrameContent(iframe, tab.url, tab);
      this.showToast('Exited Reader Mode');
      return;
    }

    let rawHtml = '';
    try {
      if (iframe.srcdoc) {
        rawHtml = iframe.srcdoc;
      } else if (window.__TAURI_INTERNALS__?.invoke) {
        const res = await window.__TAURI_INTERNALS__.invoke('fetch_page_with_shield', {
          url: tab.url,
          shieldEnabled: true,
          cosmeticCss: ''
        });
        rawHtml = res?.html || '';
      }
    } catch {}

    const parser = new DOMParser();
    const doc = rawHtml ? parser.parseFromString(rawHtml, 'text/html') : null;
    let articleTitle = tab.title || this._getTitleForUrl(tab.url);
    const blocks = [];

    if (doc) {
      doc.querySelectorAll('script, style, nav, footer, header, aside, iframe, noscript, svg, form').forEach(el => el.remove());
      const h1 = doc.querySelector('article h1, main h1, h1');
      if (h1 && h1.textContent.trim()) {
        articleTitle = h1.textContent.trim();
      }
      const root = doc.querySelector('article, main, [role="main"]') || doc.body;
      if (root) {
        root.querySelectorAll('h2, h3, p, blockquote, pre, li').forEach(node => {
          const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length < 28 && node.tagName !== 'H2' && node.tagName !== 'H3') return;
          const tag = node.tagName.toLowerCase();
          const safeText = this._escape(text);
          if (tag === 'h2' || tag === 'h3') {
            blocks.push(`<${tag}>${safeText}</${tag}>`);
          } else if (tag === 'blockquote') {
            blocks.push(`<blockquote>${safeText}</blockquote>`);
          } else if (tag === 'pre') {
            blocks.push(`<pre>${safeText}</pre>`);
          } else {
            blocks.push(`<p>${safeText}</p>`);
          }
        });
      }
    }

    const host = this.tabEngine._extractDomain(tab.url);
    const bodyContent = blocks.length > 0
      ? blocks.slice(0, 180).join('\n')
      : `<p>Clean Reader View active for <strong>${this._escape(host)}</strong>. All page scripts, trackers, and third-party layout frames have been unloaded from memory.</p><p><a href="${this._escape(tab.url)}">${this._escape(tab.url)}</a></p>`;

    const readerDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    margin: 0;
    padding: 56px 24px 80px;
    background: #121316;
    color: #e4e6eb;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Georgia, serif;
    line-height: 1.75;
    font-size: 18px;
  }
  .reader-wrap {
    max-width: 680px;
    margin: 0 auto;
  }
  .reader-meta {
    font-family: system-ui, sans-serif;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #e6ca85;
    margin-bottom: 10px;
  }
  h1 {
    font-size: 30px;
    line-height: 1.28;
    color: #f5f6f8;
    margin: 0 0 24px;
    padding-bottom: 18px;
    border-bottom: 1px solid #262830;
  }
  h2, h3 {
    color: #f0f2f5;
    margin-top: 32px;
    margin-bottom: 12px;
    line-height: 1.35;
  }
  p {
    margin: 0 0 18px;
    color: #cfd3dc;
  }
  blockquote {
    margin: 20px 0;
    padding: 10px 18px;
    border-left: 3px solid #e6ca85;
    background: #18191e;
    color: #dcdfe6;
  }
  pre {
    background: #18191e;
    padding: 14px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 14px;
    border: 1px solid #262830;
  }
  a { color: #e6ca85; }
</style>
</head>
<body>
  <article class="reader-wrap">
    <div class="reader-meta">Crown Reader Mode • ${this._escape(host)}</div>
    <h1>${this._escape(articleTitle)}</h1>
    ${bodyContent}
  </article>
</body>
</html>`;

    tab.readerMode = true;
    iframe.srcdoc = readerDoc;
    this.updateReaderModeButtonUI(tab);
    this.showToast('Reader Mode enabled');
  }

  _startLoadingBar() {
    const bar = document.getElementById('page-load-progress');
    if (!bar) return;
    clearTimeout(this._loadBarTimer);
    bar.classList.add('loading');
    bar.style.width = '35%';
    this._loadBarTimer = setTimeout(() => {
      bar.style.width = '78%';
    }, 120);
  }

  _finishLoadingBar() {
    const bar = document.getElementById('page-load-progress');
    if (!bar) return;
    clearTimeout(this._loadBarTimer);
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

    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      try {
        const res = await window.__TAURI_INTERNALS__.invoke('fetch_page_with_shield', {
          url: finalUrl,
          shieldEnabled,
          cosmeticCss,
          acceptLanguage: s.language || 'en-US,en;q=0.9',
          sendGpc: s.sendGpc !== false,
          extensionJs: extPayload.js || '',
          cookiePolicy: s.cookiePolicy || 'block-third-party'
        });
        if (res && res.html) {
          iframe.srcdoc = res.html;
          if (res.final_url && Storage.isSafeUrl(res.final_url, false)) {
            tab.url = res.final_url;
          }
          this._finishLoadingBar();
          if (this.devToolsOpen && tab.id === this.tabEngine.activeTabId) {
            setTimeout(() => this.refreshDevTools(), 160);
          }
          return;
        }
      } catch (err) {
        console.warn('Shield gateway fallback to direct frame:', err);
      }
    }

    iframe.removeAttribute('srcdoc');
    iframe.onload = () => {
      this._finishLoadingBar();
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

    const parsed = searchManager.parseInput(inputUrl);
    const evaluation = shield.evaluateUrl(parsed, tab.url, tab.isIncognito);
    const candidateUrl = evaluation.cleanUrl || parsed;
    const finalUrl = Storage.isSafeUrl(candidateUrl) ? candidateUrl : 'crown://newtab';

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
      this._loadFrameContent(iframe, finalUrl, tab);
    }

    if (isCurrent) {
      this.syncActiveTab(tab);
    } else if (this.splitViewActive && tabId === this.splitSecondaryTabId) {
      this._applySplitViewLayout();
    }

    this.tabEngine.enforceMemoryBudget();
    this.tabEngine.render();
  }

  goBack() {
    const tab = this.tabEngine.getActiveTab();
    if (!tab || !Array.isArray(tab.history) || tab.historyIndex <= 0) return;
    tab.historyIndex -= 1;
    const prevUrl = tab.history[tab.historyIndex];
    this.navigateTo(prevUrl, tab.id, { pushHistory: false });
  }

  goForward() {
    const tab = this.tabEngine.getActiveTab();
    if (!tab || !Array.isArray(tab.history) || tab.historyIndex >= tab.history.length - 1) return;
    tab.historyIndex += 1;
    const nextUrl = tab.history[tab.historyIndex];
    this.navigateTo(nextUrl, tab.id, { pushHistory: false });
  }

  reload() {
    const tab = this.tabEngine.getActiveTab();
    if (tab) this.navigateTo(tab.url, tab.id, { pushHistory: false });
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

  // Brand / Monogram Icon Helper for Shortcuts & Bookmarks
  _getSiteIconHtml(url, title, size = 22) {
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      host = '';
    }

    for (const [domain, renderSvg] of Object.entries(BRAND_ICONS)) {
      if (host === domain || host.endsWith(`.${domain}`)) {
        return renderSvg(size);
      }
    }

    if (size <= 16) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    }

    const letter = this._escape(((title || host || 'W').trim().charAt(0) || 'W').toUpperCase());
    return `<span>${letter}</span>`;
  }

  // Render Shortcuts (User-Pinned + Auto-Added Frequent Sites + Add Button)
  renderShortcuts(force = false) {
    const grid = document.getElementById('ntp-shortcuts-grid');
    if (!grid) return;

    const pinned = Storage.getShortcuts();
    const maxAutoTotal = 8;
    const remainingAutoSlots = Math.max(0, maxAutoTotal - pinned.length);
    const frequent = Storage.getFrequentSites(remainingAutoSlots);

    // Two-tier deduplication: prevent any duplicate URLs or base domains (e.g. en.wikipedia.org duplicating wikipedia.org)
    const seenUrls = new Set();
    const seenDomains = new Set();
    const combined = [];

    for (const s of [...pinned, ...frequent]) {
      if (!s || !s.url) continue;
      const normalizedUrl = s.url.toLowerCase().replace(/\/+$/, '');
      const baseDomain = Storage.extractBaseDomain(s.url);

      if (seenUrls.has(normalizedUrl)) continue;
      if (baseDomain && seenDomains.has(baseDomain)) continue;

      seenUrls.add(normalizedUrl);
      if (baseDomain) seenDomains.add(baseDomain);
      combined.push(s);
      if (combined.length >= 10) break;
    }

    // Avoid tearing down DOM if shortcuts haven't changed (prevents CPU rasterization flicker on tab switch)
    const stateSignature = JSON.stringify(combined.map(s => `${s.id}:${s.title}:${s.url}`));
    if (!force && this._lastShortcutsSignature === stateSignature && grid.children.length > 0) {
      return;
    }
    this._lastShortcutsSignature = stateSignature;

    grid.innerHTML = '';

    combined.forEach(s => {
      const tile = document.createElement('div');
      tile.className = 'shortcut-tile';
      const iconHtml = this._getSiteIconHtml(s.url, s.title, 22);

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

    // Append "+ Add shortcut" tile if fewer than 10 tiles
    if (combined.length < 10) {
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
    }
  }

  removeShortcut(shortcut) {
    try {
      const host = new URL(shortcut.url).hostname.toLowerCase().replace(/^www\./, '');
      const baseDomain = Storage.extractBaseDomain(shortcut.url);
      Storage.addDismissedShortcut(host);
      if (baseDomain) Storage.addDismissedShortcut(baseDomain);
    } catch {}

    if (shortcut.pinned !== false) {
      const updated = Storage.getShortcuts().filter(item => item.id !== shortcut.id && item.url !== shortcut.url);
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

    const title = nameInput.value.trim() || (host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1));
    Storage.removeDismissedShortcut(host);

    const list = Storage.getShortcuts();
    list.push({
      id: `sc-${Date.now()}`,
      title,
      url: rawUrl,
      pinned: true
    });
    Storage.saveShortcuts(list);
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
    const leftWidth = leftFixed ? leftFixed.offsetWidth : 165;
    const rightWidth = rightControls ? Math.max(rightControls.offsetWidth, 145) : 145;
    const availableWidth = Math.max(80, barWidth - leftWidth - rightWidth - 36);

    const visible = [];
    const overflowed = [];
    let usedWidth = 0;

    allBookmarks.forEach((bm) => {
      // Estimate pill width from title length + icon + padding (or measure directly)
      const labelLen = Math.min((bm.title || '').length, 20);
      const estimatedItemWidth = Math.min(170, 34 + labelLen * 6.8);

      if (overflowed.length === 0 && (usedWidth + estimatedItemWidth <= availableWidth || visible.length === 0)) {
        visible.push(bm);
        usedWidth += estimatedItemWidth + 4;
      } else {
        overflowed.push(bm);
      }
    });

    this.overflowBookmarks = overflowed;

    // Render visible bookmark pills on the bar
    visible.forEach(bm => {
      const el = document.createElement('div');
      el.className = 'bookmark-item';
      el.title = `${bm.title}\n${bm.url}`;
      el.innerHTML = `
        ${this._getSiteIconHtml(bm.url, bm.title, 14)}
        <span>${this._escape(bm.title)}</span>
      `;
      el.onclick = (e) => {
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
      itemsContainer.appendChild(el);
    });

    // Toggle '»' overflow button and populate dropdown menu
    if (overflowed.length > 0) {
      overflowBtn.style.display = 'flex';
      overflowBtn.title = `Hidden bookmarks (${overflowed.length})`;

      overflowed.forEach(bm => {
        const row = document.createElement('div');
        row.className = 'overflow-bookmark-item';
        row.setAttribute('role', 'menuitem');
        row.title = bm.url;
        row.innerHTML = `
          <span class="overflow-bm-icon">${this._getSiteIconHtml(bm.url, bm.title, 15)}</span>
          <span class="overflow-bm-title">${this._escape(bm.title)}</span>
          <button class="overflow-bm-delete" title="Remove bookmark">✕</button>
        `;
        row.onclick = (e) => {
          overflowMenu.classList.remove('open');
          overflowBtn.classList.remove('active');
          if (e.ctrlKey || e.metaKey) {
            this.tabEngine.createTab(bm.url, this.isIncognitoWindow);
          } else {
            this.navigateTo(bm.url);
          }
        };
        row.addEventListener('auxclick', (e) => {
          if (e.button === 1 && !e.target.closest('.overflow-bm-delete')) {
            e.preventDefault();
            e.stopPropagation();
            overflowMenu.classList.remove('open');
            overflowBtn.classList.remove('active');
            this.tabEngine.createTab(bm.url, this.isIncognitoWindow);
          }
        });
        row.querySelector('.overflow-bm-delete').onclick = (e) => {
          e.stopPropagation();
          const updated = Storage.getBookmarks().filter(item => item.id !== bm.id && item.url !== bm.url);
          Storage.saveBookmarks(updated);
          this.updateBookmarkStarUI();
        };
        overflowMenu.appendChild(row);
      });
    } else {
      overflowBtn.style.display = 'none';
      overflowBtn.classList.remove('active');
      overflowMenu.classList.remove('open');
    }
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
        url: tab.url
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

  // Live broadcast of page settings & active extensions to all open child <iframe> tabs
  broadcastPageSettingsToFrames() {
    const s = Storage.getSettings();
    const minFontNum = Number(s.minFontSize) || 0;
    const minFontCss = minFontNum >= 10
      ? `html, body, p, li, a, span, div { font-size: max(${minFontNum}px, 1em) !important; }`
      : '';
    const cosmeticCss = (s.shieldsEnabled !== false && s.blockCookieNotices !== false)
      ? shield.getCosmeticStyles()
      : '';
    const extCss = Storage.getActiveExtensionCss();
    const extJs = Storage.getActiveExtensionJs();
    const combinedCss = [cosmeticCss, minFontCss, extCss].filter(Boolean).join('\n');

    this.frames.forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage({
          type: 'crown:apply-page-settings',
          css: combinedCss,
          extJs,
          spellcheck: s.spellcheck !== false
        }, '*');
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

  // In-App Add Bookmark Modal (Replaces browser prompt/alert popups)
  openBookmarkModal(initialTitle = '', initialUrl = 'https://', onSaved = null) {
    const modal = document.getElementById('bookmark-modal-overlay');
    const nameInput = document.getElementById('bookmark-name-input');
    const urlInput = document.getElementById('bookmark-url-input');
    const errEl = document.getElementById('bookmark-error-text');
    if (!modal || !nameInput || !urlInput) return;

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

  confirmClearBrowsingData() {
    const modal = document.getElementById('clear-data-modal-overlay');
    const rangeVal = document.getElementById('clear-data-range-select')?.value || 'all';
    const clearHist = document.getElementById('clear-opt-history')?.checked !== false;
    const clearCookies = document.getElementById('clear-opt-cookies')?.checked !== false;
    const clearCache = document.getElementById('clear-opt-cache')?.checked !== false;
    const clearDownloads = document.getElementById('clear-opt-downloads')?.checked === true;
    const clearPerms = document.getElementById('clear-opt-perms')?.checked === true;
    const clearShield = document.getElementById('clear-opt-shield')?.checked === true;

    Storage.clearBrowsingData({
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

    // Native Window Controls (Minimize, Maximize, Close)
    document.getElementById('win-min-btn')?.addEventListener('click', () => {
      window.__TAURI_INTERNALS__?.invoke?.('window_minimize').catch(() => {});
    });
    document.getElementById('win-max-btn')?.addEventListener('click', () => {
      window.__TAURI_INTERNALS__?.invoke?.('window_toggle_maximize').catch(() => {});
    });
    document.getElementById('win-close-btn')?.addEventListener('click', () => {
      if (window.__TAURI_INTERNALS__?.invoke) {
        window.__TAURI_INTERNALS__.invoke('window_close').catch(() => {});
      } else {
        window.close();
      }
    });

    // Listen for in-page Crown Shield Gateway events (blocked sub-resources, link clicks & page titles)
    window.addEventListener('message', (e) => {
      const data = e.data;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

      // SEC-04: Strictly verify e.source matches a registered top-level tab iframe (never fallback to active tab)
      let senderTab = null;
      for (const [tabId, iframe] of this.frames.entries()) {
        if (iframe.contentWindow && iframe.contentWindow === e.source) {
          senderTab = this.tabEngine.tabs.find(t => t.id === tabId) || null;
          break;
        }
      }
      if (!senderTab) return;

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
        if (Storage.isSafeUrl(data.url, false)) {
          this.tabEngine.createTab(data.url, senderTab.isIncognito, senderTab.groupId);
        }
      } else if (data.type === 'crown:page-title' && typeof data.title === 'string') {
        const cleanTitle = data.title.trim().slice(0, 80);
        if (cleanTitle) {
          senderTab.title = cleanTitle;
          this.tabEngine.render();
        }
      } else if (data.type === 'crown:devtools-log') {
        this._appendDevToolsConsoleLog(data.level || 'log', String(data.text || ''), senderTab.title);
      } else if (data.type === 'crown:devtools-net') {
        this._appendDevToolsNetLog({
          method: String(data.method || 'GET'),
          url: String(data.url || ''),
          status: String(data.status || 'ALLOW'),
          kind: String(data.kind || 'request')
        });
      } else if (data.type === 'crown:devtools-dom') {
        this._renderDevToolsDomTree(data.tree, data.metrics);
      } else if (data.type === 'crown:toggle-devtools') {
        this.toggleDevTools();
      } else if (data.type === 'crown:frame-focus') {
        if (this.splitViewActive && senderTab.id !== this.tabEngine.activeTabId) {
          // Swap active focus to the clicked split pane while keeping the other pane as secondary
          const prevActiveId = this.tabEngine.activeTabId;
          this.splitSecondaryTabId = prevActiveId;
          this.tabEngine.switchTab(senderTab.id);
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

    // Omnibox Reader Mode & Bookmark Star Buttons
    document.getElementById('omnibox-reader-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleReaderMode();
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

    // Extensions toolbar shortcut (crown://extensions)
    document.getElementById('toolbar-extensions-btn')?.addEventListener('click', () => {
      this.navigateTo('crown://extensions');
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
      overflowMenu.style.right = `${Math.max(8, window.innerWidth - rect.right - 20)}px`;
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
      const appMenu = document.getElementById('crown-app-menu');
      if (appMenu && !appMenu.classList.contains('hidden') && !appMenu.contains(e.target) && !menuBtn?.contains(e.target)) {
        appMenu.classList.add('hidden');
        menuBtn?.classList.remove('active');
      }
    });

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
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
    screen.style.display = 'flex';
  }

  closeProfilePicker() {
    const screen = document.getElementById('profile-picker-screen');
    if (screen) screen.style.display = 'none';
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

  selectProfile(profileId) {
    if (!profileId) return;
    const currentId = Storage.getActiveProfileId();
    if (profileId !== currentId) {
      Storage.setActiveProfileId(profileId);
      this.applyAccentColor();
      this.renderBookmarksBar();
      this.renderShortcuts(true);
      this.tabEngine.resetForProfileSwitch();
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
      this.tabEngine.resetForProfileSwitch();
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
  applyZoom() {
    const factor = (this.currentZoom || 100) / 100;
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
    if (this.splitViewActive && (!requestedTabId || requestedTabId === this.splitSecondaryTabId || requestedTabId === this.tabEngine.activeTabId)) {
      this.exitSplitView();
      return;
    }

    const activeTab = this.tabEngine.getActiveTab();
    if (!activeTab) return;

    // Ensure primary tab is a web page so its frame can sit in the left pane
    if (activeTab.url === 'crown://newtab' || InternalViews.isInternalUrl(activeTab.url)) {
      this.navigateTo('https://duckduckgo.com', activeTab.id);
    }

    let secondaryTab = null;
    if (requestedTabId && requestedTabId !== activeTab.id) {
      secondaryTab = this.tabEngine.tabs.find(t => t.id === requestedTabId) || null;
    }
    if (!secondaryTab) {
      secondaryTab = this.tabEngine.tabs.find(t => t.id !== activeTab.id && !t.url.startsWith('crown://'))
        || this.tabEngine.tabs.find(t => t.id !== activeTab.id)
        || null;
    }

    if (!secondaryTab) {
      // Create a companion tab automatically if only 1 tab is open
      const primaryId = activeTab.id;
      const newId = this.tabEngine.createTab('https://en.wikipedia.org', activeTab.isIncognito, activeTab.groupId);
      secondaryTab = this.tabEngine.tabs.find(t => t.id === newId);
      this.tabEngine.activeTabId = primaryId;
    } else if (secondaryTab.url === 'crown://newtab' || InternalViews.isInternalUrl(secondaryTab.url)) {
      this.navigateTo('https://en.wikipedia.org', secondaryTab.id);
    } else if (secondaryTab.hibernated || !this.frames.has(secondaryTab.id)) {
      secondaryTab.hibernated = false;
      this.restoreHibernatedTab(secondaryTab);
    }

    this.splitViewActive = true;
    this.splitSecondaryTabId = secondaryTab.id;
    document.getElementById('split-view-btn')?.classList.add('active');
    document.getElementById('crown-content-area')?.classList.add('split-view-mode');

    this.syncActiveTab(this.tabEngine.getActiveTab());
    this.tabEngine.enforceMemoryBudget();
    this.tabEngine.render();
    this.showToast('Split View active — drag center divider to resize');
  }

  exitSplitView() {
    if (!this.splitViewActive) return;
    this.splitViewActive = false;
    this.splitSecondaryTabId = null;
    document.getElementById('split-view-btn')?.classList.remove('active');
    document.getElementById('crown-content-area')?.classList.remove('split-view-mode');
    const divider = document.getElementById('split-view-divider');
    if (divider) divider.style.display = 'none';

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
    if (closedTabId === this.splitSecondaryTabId || closedTabId === this.tabEngine.activeTabId) {
      this.exitSplitView();
    }
  }

  _applySplitViewLayout() {
    const primaryTab = this.tabEngine.getActiveTab();
    const secondaryTab = this.tabEngine.tabs.find(t => t.id === this.splitSecondaryTabId);
    if (!primaryTab || !secondaryTab || primaryTab.id === secondaryTab.id) {
      this.exitSplitView();
      return;
    }

    if (secondaryTab.hibernated || !this.frames.has(secondaryTab.id)) {
      secondaryTab.hibernated = false;
      this.restoreHibernatedTab(secondaryTab);
    }

    const leftRatio = Math.max(20, Math.min(80, this.splitRatio || 50));
    const rightRatio = 100 - leftRatio;

    document.querySelectorAll('.webview-frame').forEach(f => {
      if (f.id === `iframe-${primaryTab.id}`) {
        f.classList.add('active', 'split-left', 'split-focused');
        f.classList.remove('split-right');
        f.style.left = '0%';
        f.style.width = `calc(${leftRatio}% - 2px)`;
      } else if (f.id === `iframe-${secondaryTab.id}`) {
        f.classList.add('active', 'split-right');
        f.classList.remove('split-left', 'split-focused');
        f.style.left = `calc(${leftRatio}% + 2px)`;
        f.style.width = `calc(${rightRatio}% - 2px)`;
      } else {
        f.classList.remove('active', 'split-left', 'split-right', 'split-focused');
        f.style.left = '';
        f.style.width = '';
      }
    });

    const divider = document.getElementById('split-view-divider');
    if (divider) {
      divider.style.display = 'flex';
      divider.style.left = `${leftRatio}%`;
    }
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
        <div class="dt-mem-label">MemoryGuard Policy</div>
        <div class="dt-mem-val">${s.memorySaverMode !== false ? (s.memorySaverLevel || 'maximum').toUpperCase() : 'PAUSED'}</div>
        <div class="dt-mem-sub">Target: &lt;100 MB Active Footprint</div>
      </div>
      <div class="dt-mem-card">
        <div class="dt-mem-label">Tab Frames in RAM</div>
        <div class="dt-mem-val">${liveTabs} Live / ${sleepingTabs} Hibernated</div>
        <div class="dt-mem-sub">${totalTabs} total open tab${totalTabs === 1 ? '' : 's'}</div>
      </div>
      <div class="dt-mem-card">
        <div class="dt-mem-label">Sandboxed Extensions</div>
        <div class="dt-mem-val">${activeExts} Active</div>
        <div class="dt-mem-sub">0 MB background worker overhead</div>
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
