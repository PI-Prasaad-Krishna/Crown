import { suite, test, assert, assertEqual, assertTrue, assertFalse } from '../runner.js';
import { Storage } from '../../src/js/storage.js';
import { InternalViews } from '../../src/js/internal-views.js';
import fs from 'node:fs';
import path from 'node:path';

suite('Setting: Settings Defaults & Sanitization', () => {
  test('Returns complete default settings model with all required keys', () => {
    localStorage.clear();
    const s = Storage.getDefaultSettings();
    assertEqual(s.searchEngine, 'duckduckgo');
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

  test('Defaults Memory Saver to balanced and migrates legacy un-migrated profiles once', () => {
    localStorage.clear();
    assertEqual(Storage.getDefaultSettings().memorySaverLevel, 'balanced');
    assertEqual(Storage.getDefaultSettings().maxLiveTabs, 2);
    assertEqual(Storage.getSettings().memorySaverLevel, 'balanced');

    // Simulate legacy pre-upgrade profile saved as 'maximum' without migration flag
    localStorage.setItem(Storage._profileKey('crown_settings'), JSON.stringify({ memorySaverLevel: 'maximum' }));
    const migrated = Storage.getSettings();
    assertEqual(migrated.memorySaverLevel, 'balanced');
    assertEqual(migrated.maxLiveTabs, 2);

    // Explicit user override to 'maximum' afterwards must persist
    Storage.saveSettings({ memorySaverLevel: 'maximum', maxLiveTabs: 1 });
    assertEqual(Storage.getSettings().memorySaverLevel, 'maximum');
    assertEqual(Storage.getSettings().maxLiveTabs, 1);
  });

  test('Parses Settings sections cleanly from hash, query param, and extensions route', () => {
    assertEqual(InternalViews.parseSettingsSection('crown://settings'), 'system');
    assertEqual(InternalViews.parseSettingsSection('crown://settings#extensions'), 'extensions');
    assertEqual(InternalViews.parseSettingsSection('crown://settings?section=site-settings'), 'site-settings');
    assertEqual(InternalViews.parseSettingsSection('crown://extensions'), 'extensions');
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

suite('Feature: Auto-Updater Settings & State UI', () => {
  test('Defaults autoCheckUpdates to true and persists/sanitizes updates', () => {
    localStorage.clear();
    assertEqual(Storage.getDefaultSettings().autoCheckUpdates, true);
    assertEqual(Storage.getSettings().autoCheckUpdates, true);

    Storage.saveSettings({ autoCheckUpdates: false });
    assertEqual(Storage.getSettings().autoCheckUpdates, false);

    Storage.saveSettings({ autoCheckUpdates: 'invalid' });
    assertEqual(Storage.getSettings().autoCheckUpdates, true);
  });

  test('Renders About Crown updater state transitions safely', () => {
    const idleHtml = InternalViews._renderAboutUpdateMarkup({ status: 'idle', currentVersion: '1.0.0' });
    assertTrue(idleHtml.includes('about-check-updates-btn'), 'Idle state renders check button');

    const upToDateHtml = InternalViews._renderAboutUpdateMarkup({ status: 'up-to-date', currentVersion: '1.0.0' });
    assertTrue(upToDateHtml.includes('Up to date'), 'Up-to-date badge rendered');

    const availableHtml = InternalViews._renderAboutUpdateMarkup({
      status: 'available',
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      body: 'Fixed bugs <script>alert(1)</script>'
    });
    assertTrue(availableHtml.includes('about-install-update-btn'), 'Available state renders Update button');
    assertTrue(availableHtml.includes('&lt;script&gt;'), 'Release notes must be HTML-escaped');

    const downloadingHtml = InternalViews._renderAboutUpdateMarkup({
      status: 'downloading',
      latestVersion: '1.1.0',
      downloadedBytes: 5 * 1024 * 1024,
      totalBytes: 10 * 1024 * 1024,
      percent: 50
    });
    assertTrue(downloadingHtml.includes('width:50%'), 'Progress bar reflects download percent');
    assertTrue(downloadingHtml.includes('5.0 MB / 10.0 MB'), 'Downloaded MB ratio rendered');

    const readyHtml = InternalViews._renderAboutUpdateMarkup({
      status: 'ready',
      latestVersion: '1.1.0'
    });
    assertTrue(readyHtml.includes('about-relaunch-update-btn'), 'Ready state renders Relaunch button');
  });

  test('Configures GitHub Releases updater endpoint and Rust IPC commands', () => {
    const tauriConf = JSON.parse(fs.readFileSync(path.resolve('src-tauri/tauri.conf.json'), 'utf8'));
    const endpoints = tauriConf?.plugins?.updater?.endpoints || [];
    assertTrue(
      endpoints.includes('https://github.com/PI-Prasaad-Krishna/Crown/releases/latest/download/latest.json'),
      'tauri.conf.json must target PI-Prasaad-Krishna/Crown GitHub releases endpoint'
    );

    const rustSrc = fs.readFileSync(path.resolve('src-tauri/src/lib.rs'), 'utf8');
    assertTrue(rustSrc.includes('fn check_for_updates'), 'check_for_updates command must be defined');
    assertTrue(rustSrc.includes('fn install_update'), 'install_update command must be defined');
    assertTrue(rustSrc.includes('fn relaunch_app'), 'relaunch_app command must be defined');
  });
});

