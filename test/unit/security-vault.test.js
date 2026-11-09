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
});

