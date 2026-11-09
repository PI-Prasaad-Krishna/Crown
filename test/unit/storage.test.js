import { suite, test, assert, assertEqual, assertTrue, assertFalse } from '../runner.js';
import { Storage } from '../../src/js/storage.js';

suite('Setting: Settings Defaults & Sanitization', () => {
  test('Returns complete default settings model with all required keys', () => {
    localStorage.clear();
    const s = Storage.getDefaultSettings();
    assertEqual(s.searchEngine, 'google');
    assertEqual(s.tabPosition, 'top');
    assertEqual(s.accentColor, '#e6ca85');
    assertEqual(s.pageZoom, 100);
    assertEqual(s.shieldsEnabled, true);
    assertEqual(s.blockAds, true);
    assertEqual(s.blockTrackers, true);
    assertEqual(s.stripQueryParams, true);
    assertEqual(s.cookieMode, 'COMPROMISE');
    assertEqual(s.vaultSecurityLevel, 'HARDWARE_ONLY');
  });

  test('Sanitizes invalid accent colors to fallback gold', () => {
    assertEqual(Storage.sanitizeColor('invalid-color'), '#e6ca85');
    assertEqual(Storage.sanitizeColor('#38bdf8'), '#38bdf8');
    assertEqual(Storage.sanitizeColor('#000000'), '#000000');
  });

  test('Clamps pageZoom to valid range 50% - 200%', () => {
    localStorage.clear();
    Storage.saveSettings({ pageZoom: 350 });
    assertEqual(Storage.getSettings().pageZoom, 200);

    Storage.saveSettings({ pageZoom: 20 });
    assertEqual(Storage.getSettings().pageZoom, 50);
  });
});

suite('Setting: Profile Isolation & State Scoping', () => {
  test('Isolates settings per profile key without crosstalk', () => {
    localStorage.clear();
    Storage.setActiveProfileId('default');
    Storage.saveSettings({ accentColor: '#e6ca85' });

    Storage.setActiveProfileId('work-profile');
    Storage.saveSettings({ accentColor: '#38bdf8' });

    Storage.setActiveProfileId('default');
    assertEqual(Storage.getSettings().accentColor, '#e6ca85');

    Storage.setActiveProfileId('work-profile');
    assertEqual(Storage.getSettings().accentColor, '#38bdf8');

    Storage.setActiveProfileId('default'); // reset
  });
});

suite('Setting: Bookmarks & History Management', () => {
  test('Adds and retrieves bookmarks', () => {
    localStorage.clear();
    const initial = Storage.getBookmarks();
    const newBm = { id: 'test-bm-1', title: 'Rust Lang', url: 'https://rust-lang.org' };
    Storage.saveBookmarks([newBm, ...initial]);

    const updated = Storage.getBookmarks();
    assertEqual(updated[0].title, 'Rust Lang');
    assertEqual(updated[0].url, 'https://rust-lang.org');
  });

  test('Records history entries with timestamp', () => {
    localStorage.clear();
    Storage.addHistory({ title: 'Crown Documentation', url: 'https://crown.dev/docs' });
    const hist = Storage.getHistory();
    assertEqual(hist.length, 1);
    assertEqual(hist[0].title, 'Crown Documentation');
    assertTrue(hist[0].timestamp > 0);
  });
});

suite('Setting: Site Permissions', () => {
  test('Sets and retrieves per-origin device permissions', () => {
    localStorage.clear();
    const origin = 'https://meet.google.com';
    Storage.setSitePermission(origin, 'camera', 'allow');
    Storage.setSitePermission(origin, 'microphone', 'allow');

    const perms = Storage.getSitePermissions(origin);
    assertEqual(perms.camera, 'allow');
    assertEqual(perms.microphone, 'allow');
    assertEqual(perms.location, 'ask', 'Unmodified permissions must retain defaults');
  });

  test('Resets permissions for specific site', () => {
    const origin = 'https://meet.google.com';
    Storage.resetSitePermissions(origin);
    const perms = Storage.getSitePermissions(origin);
    assertEqual(perms.camera, 'ask');
  });
});

