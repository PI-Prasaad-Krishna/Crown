import { suite, test, assert, assertEqual, assertTrue, assertFalse } from '../runner.js';
import { Storage } from '../../src/js/storage.js';

suite('Feature: Selective Ephemeral Cookie Policy', () => {
  test('Defaults to COMPROMISE mode for selective ephemeral RAM retention', () => {
    localStorage.clear();
    assertEqual(Storage.getCookieMode(), 'COMPROMISE');
  });

  test('Updates and validates cookie persistence modes', async () => {
    localStorage.clear();
    await Storage.setCookieMode('TOTAL_WIPE');
    assertEqual(Storage.getCookieMode(), 'TOTAL_WIPE');

    await Storage.setCookieMode('PERSIST_ALL');
    assertEqual(Storage.getCookieMode(), 'PERSIST_ALL');

    await Storage.setCookieMode('invalid_mode');
    assertEqual(Storage.getCookieMode(), 'COMPROMISE', 'Invalid mode must fall back to COMPROMISE');
  });

  test('Adds, normalizes, and removes domains from the cookie whitelist', async () => {
    localStorage.clear();
    assertEqual(Storage.getCookieWhitelist().length, 0);

    await Storage.addCookieWhitelist('https://www.github.com/login');
    let wl = Storage.getCookieWhitelist();
    assertEqual(wl.length, 1);
    assertEqual(wl[0], 'github.com', 'Domain must be normalized (stripped of https://, www, paths)');

    await Storage.addCookieWhitelist('google.com');
    wl = Storage.getCookieWhitelist();
    assertEqual(wl.length, 2);

    // Prevent duplicates
    await Storage.addCookieWhitelist('github.com');
    assertEqual(Storage.getCookieWhitelist().length, 2);

    await Storage.removeCookieWhitelist('github.com');
    wl = Storage.getCookieWhitelist();
    assertEqual(wl.length, 1);
    assertEqual(wl[0], 'google.com');
  });
});

suite('Feature: Hardware-Backed Hybrid Local Vault', () => {
  test('Defaults to HARDWARE_ONLY security level', () => {
    localStorage.clear();
    assertEqual(Storage.getVaultSecurityLevel(), 'HARDWARE_ONLY');
  });

  test('Toggles to HARDWARE_WITH_BIOMETRIC verification level', async () => {
    localStorage.clear();
    await Storage.setVaultSecurityLevel('HARDWARE_WITH_BIOMETRIC');
    assertEqual(Storage.getVaultSecurityLevel(), 'HARDWARE_WITH_BIOMETRIC');

    await Storage.setVaultSecurityLevel('invalid_level');
    assertEqual(Storage.getVaultSecurityLevel(), 'HARDWARE_ONLY', 'Invalid level must fall back to HARDWARE_ONLY');
  });

  test('Saves, retrieves, and deletes vault credentials', async () => {
    localStorage.clear();
    const cred = await Storage.saveVaultCredential({
      origin: 'https://github.com',
      username: 'crown-user',
      secret: 'SuperSecret123!'
    });

    assert(cred !== null && cred.id, 'Credential must be returned with ID');
    assertEqual(cred.origin, 'https://github.com');
    assertEqual(cred.username, 'crown-user');

    const entries = await Storage.getVaultCredentials();
    assertEqual(entries.length, 1);
    assertEqual(entries[0].id, cred.id);

    await Storage.deleteVaultCredential(cred.id);
    const updated = await Storage.getVaultCredentials();
    assertEqual(updated.length, 0);
  });

  test('Refuses plaintext localStorage fallback when native Tauri IPC is active', async () => {
    localStorage.clear();
    const prevTauri = window.__TAURI_INTERNALS__;
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => {
        if (cmd === 'vault_get_entries' || cmd === 'vault_save_entry') {
          throw new Error('vault locked');
        }
      }
    };
    try {
      let threw = false;
      try {
        await Storage.saveVaultCredential({
          origin: 'https://example.com',
          username: 'alice',
          secret: 'TopSecret!'
        });
      } catch {
        threw = true;
      }
      assertTrue(threw, 'saveVaultCredential must reject instead of writing plaintext cache in Tauri runtime');
      assertEqual(localStorage.getItem(Storage._profileKey('crown_vault_cache')), null, 'Must never write plaintext crown_vault_cache in Tauri runtime');

      const entries = await Storage.getVaultCredentials();
      assertEqual(entries.length, 0);
    } finally {
      if (prevTauri === undefined) {
        delete window.__TAURI_INTERNALS__;
      } else {
        window.__TAURI_INTERNALS__ = prevTauri;
      }
    }
  });

  test('Sanitizes prototype pollution and validates image/ZIP security helpers', () => {
    const dirty = JSON.parse('{"__proto__":{"polluted":true},"nested":{"constructor":{"x":1}},"ok":"yes"}');
    const clean = Storage.sanitizeParsedJson(dirty);
    assertEqual(({}).polluted, undefined, 'Object.prototype must not be polluted');
    assertFalse(Object.prototype.hasOwnProperty.call(clean, '__proto__'), '__proto__ key must be stripped');
    assertFalse(Object.prototype.hasOwnProperty.call(clean.nested, 'constructor'), 'constructor key must be stripped');
    assertEqual(clean.ok, 'yes');

    assertTrue(Storage.isSafeImageUrl('https://example.com/favicon.png'));
    assertTrue(Storage.isSafeImageUrl('data:image/png;base64,iVBORw0KGgo='));
    assertFalse(Storage.isSafeImageUrl('data:image/svg+xml;base64,PHN2Zz4='));
    assertFalse(Storage.isSafeImageUrl('javascript:alert(1)'));
    assertFalse(Storage.isSafeImageUrl('https://user:pass@example.com/a.png'));
  });

  test('Passes active profileId to native vault and clear_profile_browsing_data IPC commands', async () => {
    localStorage.clear();
    Storage.setActiveProfileId('profile-work');
    const calls = [];
    const prevTauri = window.__TAURI_INTERNALS__;
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, payload) => {
        calls.push({ cmd, payload });
        return [];
      }
    };
    try {
      await Storage.getVaultCredentials();
      await Storage.saveVaultCredential({ origin: 'https://work.com', username: 'w', secret: 'pw' });
      await Storage.clearProfileBrowsingData({
        timeRange: 'hour',
        history: true,
        cookies: true,
        cache: true,
        downloads: false
      });

      const vaultRead = calls.find(c => c.cmd === 'vault_get_entries');
      const vaultSave = calls.find(c => c.cmd === 'vault_save_entry');
      const clearNative = calls.find(c => c.cmd === 'clear_profile_browsing_data');

      assertEqual(vaultRead?.payload?.profileId, 'profile-work');
      assertEqual(vaultSave?.payload?.profileId, 'profile-work');
      assertEqual(clearNative?.payload?.profileId, 'profile-work');
      assertEqual(clearNative?.payload?.timeRange, 'hour');
      assertTrue(clearNative?.payload?.cookies, 'clear_profile_browsing_data must propagate cookies flag');
      assertTrue(clearNative?.payload?.cache, 'clear_profile_browsing_data must propagate cache flag');
    } finally {
      Storage.setActiveProfileId('default');
      if (prevTauri === undefined) {
        delete window.__TAURI_INTERNALS__;
      } else {
        window.__TAURI_INTERNALS__ = prevTauri;
      }
    }
  });
});

