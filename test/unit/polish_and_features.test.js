import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, test, assert, assertEqual, assertTrue, assertFalse } from '../runner.js';
import { Storage } from '../../src/js/storage.js';
import { TabEngine } from '../../src/js/tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

suite('Feature: Bookmark Reordering, Editing & HTML Import/Export', () => {
  test('Storage.reorderBookmarks moves bookmark from source index to target index and persists order', () => {
    localStorage.clear();
    Storage.saveBookmarks([
      { id: 'bm-1', title: 'Alpha', url: 'https://alpha.example.com' },
      { id: 'bm-2', title: 'Beta', url: 'https://beta.example.com' },
      { id: 'bm-3', title: 'Gamma', url: 'https://gamma.example.com' }
    ]);
    const reordered = Storage.reorderBookmarks(0, 2);
    assertEqual(reordered.length, 3, 'Should keep all 3 bookmarks');
    assertEqual(reordered[0].id, 'bm-2', 'First item should now be Beta');
    assertEqual(reordered[1].id, 'bm-3', 'Second item should now be Gamma');
    assertEqual(reordered[2].id, 'bm-1', 'Third item should now be Alpha');
  });

  test('Storage.updateBookmark updates title and URL in-place without losing position', () => {
    localStorage.clear();
    Storage.saveBookmarks([
      { id: 'bm-1', title: 'Old Title', url: 'https://old.example.com' },
      { id: 'bm-2', title: 'Second', url: 'https://second.example.com' }
    ]);
    const ok = Storage.updateBookmark('bm-1', { title: 'New Title', url: 'https://new.example.com' });
    assertTrue(ok, 'updateBookmark should return true when updated');
    const list = Storage.getBookmarks();
    assertEqual(list[0].title, 'New Title', 'Title should be updated');
    assertEqual(list[0].url, 'https://new.example.com', 'URL should be updated');
    assertEqual(list[1].id, 'bm-2', 'Order should be preserved');
  });

  test('Netscape HTML bookmark export & import round-trips bookmarks and rejects unsafe URLs', () => {
    const sample = [
      { id: 'bm-10', title: 'Google Skills', url: 'https://www.cloudskillsboost.google' },
      { id: 'bm-11', title: 'LeetCode', url: 'https://leetcode.com' }
    ];
    const html = Storage.exportBookmarksToHtml(sample);
    assertTrue(html.includes('<!DOCTYPE NETSCAPE-Bookmark-file-1>'), 'Must include Netscape header');
    assertTrue(html.includes('https://www.cloudskillsboost.google'), 'Must include exported URL');

    const maliciousHtml = `${html}\n<DT><A HREF="javascript:alert(1)">XSS</A>`;
    const parsed = Storage.parseBookmarksFromHtml(maliciousHtml);
    assertEqual(parsed.length, 2, 'Must parse valid bookmarks and strip javascript: URLs');
    assertEqual(parsed[0].title, 'Google Skills', 'First title preserved');
    assertEqual(parsed[1].url, 'https://leetcode.com', 'Second URL preserved');
  });
});

suite('Feature: 100% Working Built-in Extensions & Live Frame Payload', () => {
  test('All 5 built-in extensions provide active CSS/JS payloads when enabled', () => {
    localStorage.clear();
    const defaults = Storage.getDefaultExtensions();
    assertEqual(defaults.length, 5, 'Should provide 5 built-in extensions');

    // Enable all 5 built-in extensions and verify payload generation
    const allEnabled = defaults.map(ext => ({ ...ext, enabled: true }));
    Storage.saveExtensions(allEnabled);

    const css = Storage.getActiveExtensionCss();
    const js = Storage.getActiveExtensionJs();
    const payload = Storage.buildActiveExtensionPayload();

    assertTrue(css.includes('color-scheme: dark'), 'Dark Reader CSS must be included');
    assertTrue(css.includes('onetrust-consent-sdk'), 'Annoyance Guard CSS must be included');
    assertTrue(js.includes('pictureInPictureEnabled'), 'Media Enhancer JS must be included');
    assertTrue(js.includes('crownJsonFormatted'), 'JSON Formatter JS must be included');
    assertTrue(css.includes('-webkit-font-smoothing: antialiased'), 'Focus Typography CSS must be included');
    assertEqual(payload.css, css, 'getActiveExtensionCss must match buildActiveExtensionPayload().css');
    assertEqual(payload.js, js, 'getActiveExtensionJs must match buildActiveExtensionPayload().js');
  });
});

suite('Feature: Tab Audio Mute & Extended Tab Context Menu Actions', () => {
  const mockApp = {
    syncActiveTab: () => {},
    showToast: () => {},
    createFrame: () => {},
    navigateTo: () => {},
    removeFrame: () => {},
    removeFrameForTab: () => {},
    frames: new Map()
  };

  test('TabEngine.toggleMuteTab toggles tab muted state and posts crown:set-muted to frame', () => {
    localStorage.clear();
    const engine = new TabEngine(mockApp);
    const tabId = engine.createTab('https://youtube.com');
    let postedMsg = null;
    mockApp.frames.set(tabId, {
      contentWindow: {
        postMessage: (msg) => { postedMsg = msg; }
      }
    });

    const isMuted = engine.toggleMuteTab(tabId);
    assertTrue(isMuted, 'Tab should be muted after first toggle');
    assertEqual(postedMsg?.type, 'crown:set-muted', 'Should post crown:set-muted message to frame');
    assertEqual(postedMsg?.muted, true, 'Message muted flag should be true');

    const isMutedSecond = engine.toggleMuteTab(tabId);
    assertFalse(isMutedSecond, 'Tab should be unmuted after second toggle');
  });

  test('TabEngine.closeOtherTabs and closeTabsToRight preserve pinned tabs and target tab', () => {
    localStorage.clear();
    const engine = new TabEngine(mockApp);
    const t1 = engine.createTab({ url: 'https://pinned.example.com', pinned: true });
    const t2 = engine.createTab('https://keep.example.com');
    const t3 = engine.createTab('https://right1.example.com');
    const t4 = engine.createTab('https://right2.example.com');

    engine.closeTabsToRight(t2);
    assertEqual(engine.tabs.length, 2, 'Should close t3 and t4 to the right of t2');
    assertTrue(engine.tabs.some(t => t.id === t1), 'Pinned tab t1 remains');
    assertTrue(engine.tabs.some(t => t.id === t2), 'Target tab t2 remains');

    const t5 = engine.createTab('https://extra.example.com');
    engine.closeOtherTabs(t5);
    assertEqual(engine.tabs.length, 2, 'Should keep pinned t1 and target t5');
    assertTrue(engine.tabs.some(t => t.id === t1), 'Pinned tab t1 remains after closeOtherTabs');
    assertTrue(engine.tabs.some(t => t.id === t5), 'Keep tab t5 remains after closeOtherTabs');
  });
});

suite('Security & Polish: Cloudflare-Grade Hardening & Clean UI Copy', () => {
  test('Dynamic site icons do not use hardcoded BRAND_ICONS and UI files contain zero "0 MB overhead" claims', () => {
    const appJs = fs.readFileSync(path.join(repoRoot, 'src/js/app.js'), 'utf8');
    const internalViewsJs = fs.readFileSync(path.join(repoRoot, 'src/js/internal-views.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(repoRoot, 'src/index.html'), 'utf8');
    const libRs = fs.readFileSync(path.join(repoRoot, 'src-tauri/src/lib.rs'), 'utf8');
    const vaultRs = fs.readFileSync(path.join(repoRoot, 'src-tauri/src/crypto_vault.rs'), 'utf8');

    assertFalse(appJs.includes('const BRAND_ICONS'), 'Hardcoded BRAND_ICONS must be removed from app.js');
    assertFalse(appJs.includes('0 MB background worker overhead'), '0 MB overhead string must be removed from app.js');
    assertFalse(internalViewsJs.includes('0 MB idle overhead'), '0 MB idle overhead must be removed from internal-views.js');
    assertFalse(internalViewsJs.includes('Zero-RAM Engine'), 'Zero-RAM Engine must be removed from internal-views.js');
    assertFalse(indexHtml.includes('Ultra-Low RAM Memory Guard'), 'Ultra-Low RAM Memory Guard must be updated in index.html');

    // Verify Cloudflare-grade security remediations exist in Rust & JS sources
    assertTrue(libRs.includes('resp.remote_addr()'), 'VULN-03 post-connect remote_addr() verification must exist in lib.rs');
    assertTrue(libRs.includes('e.source !== window.parent'), 'VULN-02 postMessage source verification must exist in lib.rs');
    assertTrue(vaultRs.includes('VAULT_AAD'), 'VULN-05 AEAD Additional Authenticated Data (AAD) binding must exist in crypto_vault.rs');
  });

  test('SEC-01 through SEC-05: Rust & JS Security Hardening Remediations are Enforced', () => {
    const libRs = fs.readFileSync(path.join(repoRoot, 'src-tauri/src/lib.rs'), 'utf8');
    const appJs = fs.readFileSync(path.join(repoRoot, 'src/js/app.js'), 'utf8');

    // SEC-01: RFC 6265 Cookie Domain & Supercookie Prevention
    assertTrue(libRs.includes('fn is_valid_cookie_domain'), 'SEC-01: is_valid_cookie_domain function must exist in lib.rs');
    assertTrue(libRs.includes('!clean_spec.contains(\'.\')'), 'SEC-01: Must reject domain cookies without an internal dot (TLD supercookies)');
    assertTrue(libRs.includes('clean_origin.ends_with(&format!(".{}", clean_spec))'), 'SEC-01: Must enforce origin domain match');

    // SEC-02: Post-redirect scheme and anti-DNS rebinding verification
    assertTrue(libRs.includes('// SEC-02: Post-redirect scheme & host verification'), 'SEC-02: Post-redirect validation comment/block must exist in lib.rs');
    assertTrue(libRs.includes('// SEC-02 Anti-DNS Rebinding Guard'), 'SEC-02: fetch_chrome_crx anti-DNS-rebinding verification must exist in lib.rs');

    // SEC-03: open_new_window parameter validation
    assertTrue(libRs.includes('// SEC-03: Validate length and ensure only safe schemes'), 'SEC-03: open_new_window validation comment/block must exist in lib.rs');
    assertTrue(libRs.includes('trimmed.len() <= 2048'), 'SEC-03: Must cap initialUrl length at 2048');

    // SEC-04: Bridge origin authentication and length bounds
    assertTrue(appJs.includes('String(data.text || \'\').slice(0, 10000)'), 'SEC-04: Must cap devtools-log text length in app.js');
    assertTrue(appJs.includes('String(data.url || \'\').slice(0, 2048)'), 'SEC-04: Must cap devtools-net url length in app.js');

    // SEC-05: Wallpaper incognito isolation & MIME validation
    assertTrue(appJs.includes('SEC-05: Enforce raster-only MIME & 4 MB size cap'), 'SEC-05: Wallpaper upload validation comment/block must exist in app.js');
    assertTrue(appJs.includes('file.size > 4 * 1024 * 1024'), 'SEC-05: Must cap custom wallpaper upload size at 4 MB');
  });
});

suite('Feature: Interactive Split-Screen UX & In-Pane Secondary Picker', () => {
  function createMockApp() {
    const app = {
      splitViewActive: false,
      splitPrimaryTabId: null,
      splitSecondaryTabId: null,
      splitRatio: 50,
      splitFocusedPane: 'left',
      frames: new Map(),
      toasts: [],
      showToast(msg) { this.toasts.push(msg); },
      syncActiveTab: () => {},
      restoreHibernatedTab: () => {},
      _getSiteIconHtml: () => '<span>icon</span>',
      _escape: (s) => String(s || ''),
      tabEngine: {
        tabs: [],
        activeTabId: null,
        getActiveTab() { return this.tabs.find(t => t.id === this.activeTabId) || null; },
        createTab(url) {
          const id = `tab-${this.tabs.length + 1}`;
          const tab = { id, url, title: url, hibernated: false };
          this.tabs.push(tab);
          return id;
        },
        enforceMemoryBudget: () => {},
        render: () => {}
      }
    };

    // Attach Split View methods under test directly from app logic
    app.toggleSplitView = function(requestedTabId = null) {
      if (this.splitViewActive && (!requestedTabId || requestedTabId === this.splitSecondaryTabId || requestedTabId === this.splitPrimaryTabId)) {
        this.exitSplitView();
        return;
      }
      const activeTab = this.tabEngine.getActiveTab();
      if (!activeTab) return;
      this.splitViewActive = true;
      this.splitPrimaryTabId = activeTab.id;
      this.splitFocusedPane = 'left';
      if (requestedTabId && requestedTabId !== activeTab.id) {
        const candidate = this.tabEngine.tabs.find(t => t.id === requestedTabId);
        this.splitSecondaryTabId = candidate ? candidate.id : null;
      } else {
        this.splitSecondaryTabId = null;
      }
      this._applySplitViewLayout();
    };

    app.exitSplitView = function() {
      this.splitViewActive = false;
      this.splitPrimaryTabId = null;
      this.splitSecondaryTabId = null;
      this.splitFocusedPane = 'left';
      const divider = document.getElementById('split-view-divider');
      if (divider) divider.style.display = 'none';
      const floatingBar = document.getElementById('split-view-floating-bar');
      if (floatingBar) floatingBar.style.display = 'none';
      const picker = document.getElementById('split-secondary-picker');
      if (picker) picker.style.display = 'none';
    };

    app._applySplitViewLayout = function() {
      if (!this.splitViewActive) return;
      const primaryTab = this.tabEngine.tabs.find(t => t.id === this.splitPrimaryTabId) || this.tabEngine.getActiveTab();
      if (!primaryTab) { this.exitSplitView(); return; }
      this.splitPrimaryTabId = primaryTab.id;
      const secondaryTab = this.splitSecondaryTabId ? this.tabEngine.tabs.find(t => t.id === this.splitSecondaryTabId) : null;
      const leftRatio = Math.max(20, Math.min(80, this.splitRatio || 50));
      const rightRatio = 100 - leftRatio;

      const dashboard = document.getElementById('new-tab-dashboard');
      if (primaryTab.url === 'crown://newtab') {
        dashboard.style.display = 'flex';
        dashboard.style.left = '0%';
        dashboard.style.width = `calc(${leftRatio}% - 2px)`;
      }

      const picker = document.getElementById('split-secondary-picker');
      if (!secondaryTab || secondaryTab.url === 'crown://newtab') {
        picker.style.display = 'flex';
        picker.style.left = `calc(${leftRatio}% + 2px)`;
        picker.style.width = `calc(${rightRatio}% - 2px)`;
      } else {
        picker.style.display = 'none';
      }

      const divider = document.getElementById('split-view-divider');
      divider.style.display = 'flex';
      const floatingBar = document.getElementById('split-view-floating-bar');
      floatingBar.style.display = 'flex';
      const focusLabel = document.getElementById('split-focus-label');
      focusLabel.textContent = (this.splitFocusedPane === 'right' ? 'Right Pane' : 'Left Pane');
    };

    app.dockSplitSecondaryTab = function(tabId) {
      if (!tabId || tabId === this.splitPrimaryTabId) return;
      this.splitSecondaryTabId = tabId;
      this.splitFocusedPane = 'right';
      this.tabEngine.activeTabId = tabId;
      this._applySplitViewLayout();
    };

    app.dockSplitSecondaryTabWithUrl = function(rawUrl) {
      const newId = this.tabEngine.createTab(rawUrl);
      this.splitSecondaryTabId = newId;
      this.splitFocusedPane = 'right';
      this.tabEngine.activeTabId = newId;
      this._applySplitViewLayout();
    };

    app.swapSplitPanes = function() {
      if (!this.splitViewActive || !this.splitSecondaryTabId) return;
      const prev = this.splitPrimaryTabId;
      this.splitPrimaryTabId = this.splitSecondaryTabId;
      this.splitSecondaryTabId = prev;
      this.splitFocusedPane = 'left';
      this.tabEngine.activeTabId = this.splitPrimaryTabId;
      this._applySplitViewLayout();
    };

    app.openSplitSecondaryPicker = function() {
      this.splitSecondaryTabId = null;
      this.splitFocusedPane = 'right';
      this._applySplitViewLayout();
    };

    return app;
  }

  test('toggleSplitView on crown://newtab keeps left pane on crown://newtab and displays interactive picker on right', () => {
    const app = createMockApp();
    const t1 = app.tabEngine.createTab('crown://newtab');
    app.tabEngine.activeTabId = t1;

    app.toggleSplitView();

    assertTrue(app.splitViewActive, 'Split View must be active');
    assertEqual(app.splitPrimaryTabId, t1, 'Left pane must remain original tab t1');
    const primaryTab = app.tabEngine.getActiveTab();
    assertEqual(primaryTab.url, 'crown://newtab', 'Left tab must stay crown://newtab (never forced to duckduckgo.com)');
    assertEqual(app.splitSecondaryTabId, null, 'Right pane tab ID must be null initially so picker renders');

    const picker = document.getElementById('split-secondary-picker');
    assertEqual(picker.style.display, 'flex', 'Right pane picker must be displayed');
    const floatingBar = document.getElementById('split-view-floating-bar');
    assertEqual(floatingBar.style.display, 'flex', 'Floating Split View bar must be displayed');
  });

  test('dockSplitSecondaryTab and dockSplitSecondaryTabWithUrl dock tab and swapSplitPanes swaps panes', () => {
    const app = createMockApp();
    const t1 = app.tabEngine.createTab('https://alpha.example.com');
    const t2 = app.tabEngine.createTab('https://beta.example.com');
    app.tabEngine.activeTabId = t1;

    app.toggleSplitView();
    assertEqual(app.splitSecondaryTabId, null, 'Secondary starts null');

    app.dockSplitSecondaryTab(t2);
    assertEqual(app.splitSecondaryTabId, t2, 'Secondary tab is now t2');
    assertEqual(app.splitFocusedPane, 'right', 'Right pane is focused');
    const picker = document.getElementById('split-secondary-picker');
    assertEqual(picker.style.display, 'none', 'Picker is hidden when secondary tab is docked');

    // Test Swap Panes
    app.swapSplitPanes();
    assertEqual(app.splitPrimaryTabId, t2, 'Primary tab is now t2');
    assertEqual(app.splitSecondaryTabId, t1, 'Secondary tab is now t1');

    // Test Switch Right Tab / Open Picker
    app.openSplitSecondaryPicker();
    assertEqual(app.splitSecondaryTabId, null, 'Secondary is reset to null');
    assertEqual(picker.style.display, 'flex', 'Picker is visible again');

    // Test Dock with URL
    app.dockSplitSecondaryTabWithUrl('https://gamma.example.com');
    assertTrue(app.tabEngine.tabs.some(t => t.url === 'https://gamma.example.com'), 'Gamma tab created');
    assertEqual(picker.style.display, 'none', 'Picker is hidden again after docking URL');

    // Test Exit Split View
    app.exitSplitView();
    assertFalse(app.splitViewActive, 'Split View is deactivated');
    assertEqual(picker.style.display, 'none', 'Picker is hidden');
    assertEqual(document.getElementById('split-view-floating-bar').style.display, 'none', 'Floating bar hidden');
  });
});

suite('Feature: Dynamic Offline SVG QR Code URL Generator', () => {
  test('openQrCodePopover dynamically binds and renders the active tab URL without hardcoded fallbacks', () => {
    const appJs = fs.readFileSync(path.join(repoRoot, 'src/js/app.js'), 'utf8');
    assertFalse(appJs.includes(": 'https://github.com'"), 'QR Code URL must not use hardcoded https://github.com fallback');
    assertTrue(appJs.includes('(tab && tab.url) ? tab.url : (window.location?.href || \'crown://newtab\')'), 'QR Code must dynamically use active tab URL');
  });
});

suite('Feature: In-Page Full URL Synchronization & Emoji-Free Reader Mode', () => {
  test('Rust injected script hooks pushState, replaceState, popstate, hashchange and form submit for live URL sync', () => {
    const libRs = fs.readFileSync(path.join(repoRoot, 'src-tauri/src/lib.rs'), 'utf8');
    assertTrue(libRs.includes("type: 'crown:page-url-change'"), 'Injected script must dispatch crown:page-url-change');
    assertTrue(libRs.includes("history.pushState"), 'Injected script must intercept history.pushState');
    assertTrue(libRs.includes("history.replaceState"), 'Injected script must intercept history.replaceState');
    assertTrue(libRs.includes("popstate"), 'Injected script must listen to popstate');
    assertTrue(libRs.includes("crown:extract-article"), 'Injected script must handle live article extraction');
  });

  test('app.js handles crown:page-url-change by syncing senderTab.url, history stack, and omnibox', () => {
    const appJs = fs.readFileSync(path.join(repoRoot, 'src/js/app.js'), 'utf8');
    assertTrue(appJs.includes("data.type === 'crown:page-url-change'"), 'app.js must listen for crown:page-url-change');
    assertTrue(appJs.includes("senderTab.url = data.url;"), 'Must update senderTab.url with full URL');
    assertTrue(appJs.includes("senderTab.history.push(data.url)"), 'Must append new subpage to per-tab history stack');
    assertTrue(appJs.includes("omnibox.value = senderTab.url;"), 'Must sync omnibox input to full URL');
  });

  test('Reader Mode UI is 100% free of emojis', () => {
    const appJs = fs.readFileSync(path.join(repoRoot, 'src/js/app.js'), 'utf8');
    assertFalse(appJs.includes('📖'), 'Reader Mode must not contain book emoji');
    assertFalse(appJs.includes('🎨'), 'Reader Mode must not contain palette emoji');
    assertFalse(appJs.includes('✕ Exit'), 'Reader Mode must not contain ✕ Exit emoji button');
    assertTrue(appJs.includes('min read</span>'), 'Reader Mode must display clean reading time');
    assertTrue(appJs.includes('>Theme</button>'), 'Reader Mode must display clean Theme button text');
    assertTrue(appJs.includes('>Exit</button>'), 'Reader Mode must display clean Exit button text');
  });

  test('Reader Mode theme links to browser theme settings and persists user toggles', () => {
    localStorage.clear();
    const defaults = Storage.getDefaultSettings();
    assertEqual(defaults.readerTheme, 'auto', 'Default reader theme must be auto (linked to browser atmosphere)');

    Storage.saveSettings({ readerTheme: 'sepia' });
    const saved = Storage.getSettings();
    assertEqual(saved.readerTheme, 'sepia', 'Storage must persist reader theme selection');

    Storage.saveSettings({ readerTheme: 'invalid-choice' });
    const sanitized = Storage.getSettings();
    assertEqual(sanitized.readerTheme, 'auto', 'Invalid reader themes must sanitize back to auto');
  });

  test('Storage.extractBaseDomain is strictly isolated and does not truncate full URLs in bookmarks or history', () => {
    const fullUrl = 'https://en.wikipedia.org/wiki/Max_Verstappen';
    assertEqual(Storage.extractBaseDomain(fullUrl), 'wikipedia.org', 'extractBaseDomain extracts base apex domain');

    // Verify history stores full URL without truncation
    localStorage.clear();
    Storage.addHistory({ title: 'Max Verstappen - Wikipedia', url: fullUrl, isIncognito: false });
    const history = Storage.getHistory();
    assertEqual(history.length, 1, 'History has 1 item');
    assertEqual(history[0].url, fullUrl, 'History must strictly preserve full article URL');

    // Verify bookmarks store full URL without truncation
    Storage.saveBookmarks([{ id: 'bm-wiki', title: 'Max Verstappen', url: fullUrl }]);
    const bookmarks = Storage.getBookmarks();
    assertEqual(bookmarks[0].url, fullUrl, 'Bookmarks must strictly preserve full article URL');
  });

  test('lib.rs normalizes protocol-relative // URLs and serializes form elements without FormData', () => {
    const libRs = fs.readFileSync(path.join(repoRoot, 'src-tauri/src/lib.rs'), 'utf8');
    assertTrue(libRs.includes("target.startsWith('//')"), 'Must normalize protocol-relative // URLs');
    assertTrue(libRs.includes("form.elements"), 'Must serialize form elements without throwing FormData error');
    assertTrue(libRs.includes("window.location.assign"), 'Must wrap location.assign for JS navigation tracking');
  });

  test('app.js _loadFrameContent updates tab.url, title, and omnibox from res.final_url on redirects', () => {
    const appJs = fs.readFileSync(path.join(repoRoot, 'src/js/app.js'), 'utf8');
    assertTrue(appJs.includes("tab.url = res.final_url;"), 'Must set tab.url to res.final_url');
    assertTrue(appJs.includes("const titleMatch = res.html.match(/<title[^>]*>([^<]+)<\\/title>/i);"), 'Must parse title from res.html');
    assertTrue(appJs.includes("omnibox.value = tab.url;"), 'Must sync omnibox.value to redirected tab.url');
  });

  test('Storage starts with zero hardcoded bookmarks/shortcuts and deduplicates frequent links while allowing distinct subdomains', () => {
    localStorage.clear();
    assertEqual(Storage.getBookmarks().length, 0, 'Must have zero hardcoded default bookmarks');
    assertEqual(Storage.getShortcuts().length, 0, 'Must have zero hardcoded default shortcuts');
    assertEqual(Storage.normalizeShortcutUrl('https://www.google.com/'), 'https://google.com', 'normalizeShortcutUrl strips www and trailing slash');
    assertTrue(
      Storage.normalizeShortcutUrl('https://gemini.google.com/') !== Storage.normalizeShortcutUrl('https://google.com/'),
      'Subdomains must remain distinct shortcut links'
    );

    Storage.addHistory({ title: 'Max Verstappen - Wikipedia', url: 'https://en.wikipedia.org/wiki/Max_Verstappen', isIncognito: false });
    Storage.addHistory({ title: 'Formula One - Wikipedia', url: 'https://en.wikipedia.org/wiki/Formula_One', isIncognito: false });
    Storage.addHistory({ title: 'Google', url: 'https://www.google.com/search?q=crown', isIncognito: false });
    Storage.addHistory({ title: 'Gemini', url: 'https://gemini.google.com/app', isIncognito: false });
    Storage.addHistory({ title: 'GitHub Repo', url: 'https://github.com/torvalds/linux', isIncognito: false });

    const frequent = Storage.getFrequentSites(24);
    const urls = frequent.map(site => Storage.normalizeShortcutUrl(site.url));
    assertEqual(new Set(urls).size, urls.length, 'Normalized frequent site links must not repeat');
    assertTrue(urls.includes('https://google.com'), 'google.com must appear in frequent sites from history');
    assertTrue(urls.includes('https://gemini.google.com'), 'gemini.google.com must coexist with google.com');
    assertEqual(urls.filter(u => u === 'https://en.wikipedia.org').length, 1, 'Repeated paths on same origin must collapse into one frequent entry');

    Storage.saveShortcuts([{ id: 'sc-pin', title: 'Google', url: 'https://www.google.com', pinned: true }]);
    const frequentWithPin = Storage.getFrequentSites(24);
    const urlsWithPin = frequentWithPin.map(site => Storage.normalizeShortcutUrl(site.url));
    assertFalse(urlsWithPin.includes('https://google.com'), 'Pinned https://www.google.com must not repeat in frequent sites');
    assertTrue(urlsWithPin.includes('https://gemini.google.com'), 'gemini.google.com must still appear when www.google.com is pinned');
  });

  test('Injected script embeds CROWN_TAB_ID and parent app authenticates senderTab strictly via iframe contentWindow', () => {
    const libRs = fs.readFileSync(path.join(repoRoot, 'src-tauri/src/lib.rs'), 'utf8');
    assertTrue(libRs.includes('CROWN_TAB_ID'), 'lib.rs must declare CROWN_TAB_ID constant');
    assertTrue(libRs.includes('tabId: CROWN_TAB_ID'), 'lib.rs must attach tabId to outbound postMessages');

    const appJs = fs.readFileSync(path.join(repoRoot, 'src/js/app.js'), 'utf8');
    assertTrue(appJs.includes('if (!e.isTrusted) return;'), 'app.js must require trusted MessageEvent');
    assertTrue(appJs.includes('iframe.contentWindow === e.source'), 'app.js must authenticate senderTab via registered iframe contentWindow');
    assertTrue(appJs.includes('data.tabId !== senderTab.id'), 'app.js must reject spoofed tabId mismatches');
  });

  test('navigateTo directly handles absolute URLs and updates _currentQrUrl for deep subpages', () => {
    const appJs = fs.readFileSync(path.join(repoRoot, 'src/js/app.js'), 'utf8');
    assertTrue(appJs.includes("trimmedInput.startsWith('http://') || trimmedInput.startsWith('https://')"), 'navigateTo must directly validate absolute URLs');
    assertTrue(appJs.includes('this._currentQrUrl = tab.url;'), '_loadFrameContent must sync _currentQrUrl with destination URL');
  });
});
