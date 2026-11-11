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
});
