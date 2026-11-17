import { suite, test, assert, assertEqual, assertTrue, assertFalse } from '../runner.js';
import { CrownShield } from '../../src/js/shield.js';
import { Storage } from '../../src/js/storage.js';
import fs from 'fs';
import path from 'path';

suite('Feature: Crown Shield Ad & Tracker Blocking', () => {
  test('Blocks known advertising network domains', () => {
    const shield = new CrownShield();
    shield.adDomains.add('doubleclick.net');
    shield.adDomains.add('pagead2.googlesyndication.com');

    const res1 = shield.evaluateUrl('https://ad.doubleclick.net/ad.js', 'example.com');
    assertTrue(res1.blocked, 'Subdomain of doubleclick.net must be blocked');
    assertEqual(res1.reason, 'ad');

    const res2 = shield.evaluateUrl('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'example.com');
    assertTrue(res2.blocked, 'AdSense script must be blocked');
  });

  test('Blocks known cross-site tracking and analytics domains', () => {
    const shield = new CrownShield();
    shield.trackerDomains.add('google-analytics.com');
    shield.trackerDomains.add('hotjar.com');

    const res1 = shield.evaluateUrl('https://www.google-analytics.com/analytics.js', 'example.com');
    assertTrue(res1.blocked, 'Analytics domain must be blocked');
    assertEqual(res1.reason, 'tracker');

    const res2 = shield.evaluateUrl('https://static.hotjar.com/c/hotjar-123.js', 'example.com');
    assertTrue(res2.blocked, 'Hotjar tracker must be blocked');
  });

  test('Permits benign first-party and standard content requests', () => {
    const shield = new CrownShield();
    const res = shield.evaluateUrl('https://cdn.example.com/images/hero.jpg', 'example.com');
    assertFalse(res.blocked, 'Benign image must be permitted');
  });
});

suite('Feature: URL Query Parameter Stripper', () => {
  test('Strips marketing tracking parameters from destination URLs', () => {
    const shield = new CrownShield();
    const dirtyUrl = 'https://shop.com/item?id=42&utm_source=newsletter&utm_medium=email&fbclid=IwAR123';
    const res = shield.evaluateUrl(dirtyUrl, 'shop.com');

    assertFalse(res.cleanUrl.includes('utm_source'), 'utm_source must be stripped');
    assertFalse(res.cleanUrl.includes('utm_medium'), 'utm_medium must be stripped');
    assertFalse(res.cleanUrl.includes('fbclid'), 'fbclid must be stripped');
    assertTrue(res.cleanUrl.includes('id=42'), 'Legitimate business query params must be preserved');
  });

  test('Preserves clean URLs without query modifications', () => {
    const shield = new CrownShield();
    const cleanUrl = 'https://docs.rs/serde/latest/serde/?search=derive';
    const res = shield.evaluateUrl(cleanUrl, 'docs.rs');
    assertEqual(res.cleanUrl, cleanUrl);
  });
});

suite('Feature: Safe URL & SSRF Validation', () => {
  test('Accepts valid https and http navigation URLs', () => {
    assertTrue(Storage.isSafeUrl('https://github.com'));
    assertTrue(Storage.isSafeUrl('http://example.com/page'));
    assertTrue(Storage.isSafeUrl('crown://settings'));
  });

  test('Blocks dangerous schemes and credential-embedded phishing URLs', () => {
    assertFalse(Storage.isSafeUrl('javascript:alert(1)'));
    assertFalse(Storage.isSafeUrl('data:text/html,<h1>Phish</h1>'));
    assertFalse(Storage.isSafeUrl('file:///C:/Windows/System32/calc.exe'));
    assertFalse(Storage.isSafeUrl('https://admin:password@attacker.com'));
  });

  test('Exempts YouTube anti-adblock bait selectors and play.google.com from static rules', () => {
    const adblockRules = JSON.parse(fs.readFileSync(path.resolve('src/public/assets/rules/adblock-rules.json'), 'utf8'));
    const privacyRules = JSON.parse(fs.readFileSync(path.resolve('src/public/assets/rules/privacy-rules.json'), 'utf8'));

    assertFalse(adblockRules.cosmeticSelectors.includes('#player-ads'), '#player-ads bait selector must not be hidden via CSS');
    assertFalse(adblockRules.cosmeticSelectors.includes('.ytp-ad-module'), '.ytp-ad-module bait selector must not be hidden via CSS');
    assertFalse(adblockRules.cosmeticSelectors.includes('.ytp-ad-overlay-container'), '.ytp-ad-overlay-container must not be hidden via CSS');
    assertTrue(adblockRules.domains.includes('ads.youtube.com'), 'ads.youtube.com must be in ad domains');
    assertFalse(privacyRules.domains.includes('play.google.com'), 'play.google.com must not be globally blocked in trackerDomains');
  });

  test('Syncs all privacy-rules.json tracker domains with Rust TRACKER_DOMAINS', () => {
    const privacyRules = JSON.parse(fs.readFileSync(path.resolve('src/public/assets/rules/privacy-rules.json'), 'utf8'));
    const rustSrc = fs.readFileSync(path.resolve('src-tauri/src/lib.rs'), 'utf8');
    const blockMatch = rustSrc.match(/const TRACKER_DOMAINS:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\];/);
    assertTrue(Boolean(blockMatch), 'TRACKER_DOMAINS constant must exist in src-tauri/src/lib.rs');

    const rustTrackers = new Set(
      Array.from(blockMatch[1].matchAll(/"([^"]+)"/g)).map(m => m[1].toLowerCase())
    );
    for (const domain of privacyRules.domains) {
      assertTrue(rustTrackers.has(domain.toLowerCase()), `Rust TRACKER_DOMAINS is missing ${domain}`);
    }
    assertEqual(rustTrackers.size, privacyRules.domains.length);
  });

  test('Blocks every domain in privacy-rules.json and respects per-site shield toggle', () => {
    const privacyRules = JSON.parse(fs.readFileSync(path.resolve('src/public/assets/rules/privacy-rules.json'), 'utf8'));
    const shield = new CrownShield();
    privacyRules.domains.forEach(d => shield.trackerDomains.add(d.toLowerCase()));

    for (const domain of privacyRules.domains) {
      const res = shield.evaluateUrl(`https://sub.${domain}/track.js`, 'https://example.com');
      assertTrue(res.blocked, `Expected tracker ${domain} to be blocked`);
      assertEqual(res.reason, 'tracker');
    }

    shield.setShieldForSite('https://example.com', false);
    const bypassed = shield.evaluateUrl('https://www.google-analytics.com/analytics.js', 'https://example.com');
    assertFalse(bypassed.blocked, 'Trackers should be allowed when per-site shield is disabled');

    shield.setShieldForSite('https://example.com', true);
    shield.blockTrackers = false;
    const disabledGlobal = shield.evaluateUrl('https://www.google-analytics.com/analytics.js', 'https://example.com');
    assertFalse(disabledGlobal.blocked, 'Trackers should be allowed when blockTrackers is false');
  });

  test('Includes native PopupGuard & POPUP_GUARD_SCRIPT while exempting YouTube frames', () => {
    const rustSrc = fs.readFileSync(path.resolve('src-tauri/src/lib.rs'), 'utf8');
    assertTrue(rustSrc.includes('struct PopupGuard'), 'PopupGuard struct must exist in src-tauri/src/lib.rs');
    assertTrue(rustSrc.includes('const POPUP_GUARD_SCRIPT:'), 'POPUP_GUARD_SCRIPT constant must exist in src-tauri/src/lib.rs');
    assertTrue(rustSrc.includes('if (isYtFrame) return;'), 'POPUP_GUARD_SCRIPT must exit early on YouTube frames');
    assertTrue(rustSrc.includes('initialization_script_for_all_frames(POPUP_GUARD_SCRIPT)'), 'POPUP_GUARD_SCRIPT must be injected into all frames');
  });

  test('YouTube cosmetic CSS & init script suppress interruption toasts without generic bait selectors', () => {
    const adblockRules = JSON.parse(fs.readFileSync(path.resolve('src/public/assets/rules/adblock-rules.json'), 'utf8'));
    const shield = new CrownShield();
    shield.cosmeticSelectors = adblockRules.cosmeticSelectors;
    shield.blockCookieNotices = false; // Even when cookie notices are off, YT ad/toast CSS must stay active

    const ytCss = shield.getCosmeticCss('https://www.youtube.com/watch?v=test');
    assertTrue(ytCss.includes('#toast:has(yt-formatted-string#text.yt-notification-action-renderer)'), 'Must include #toast notification action selector');
    assertTrue(ytCss.includes('yt-notification-action-renderer:has(a[href*="3037019"])'), 'Must include yt-notification-action-renderer 3037019 selector');
    assertTrue(ytCss.includes('yt-snackbar-view-model:has(a[href*="3037019"])'), 'Must include yt-snackbar-view-model 3037019 selector');
    assertTrue(ytCss.includes('ytd-enforcement-message-view-model'), 'Must include ytd-enforcement-message-view-model selector');
    assertTrue(ytCss.includes('tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)'), 'Must include tp-yt-paper-dialog enforcement selector');
    assertFalse(ytCss.includes('.ad-container'), 'Must not include generic .ad-container on YouTube');

    const nonYtCss = shield.getCosmeticCss('https://example.com/');
    assertFalse(nonYtCss.includes('tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)'), 'Must exclude YouTube enforcement dialog selector on non-YouTube domains');

    const rustSrc = fs.readFileSync(path.resolve('src-tauri/src/lib.rs'), 'utf8');
    assertTrue(rustSrc.includes('const YT_COSMETIC_CSS ='), 'Rust init script must embed YT_COSMETIC_CSS fallback');
    assertTrue(rustSrc.includes('window.__crownCosmeticWait'), 'Rust init script must include pre-paint MutationObserver wait');
    assertTrue(rustSrc.includes('interceptYtInterruptionAction'), 'Rust init script must intercept yt-action 3037019 popups');
    assertTrue(rustSrc.includes('bkaEnforcementMessageViewModel'), 'Rust init script must strip bkaEnforcementMessageViewModel');
    assertTrue(rustSrc.includes('enforcementMessageViewModel'), 'Rust init script must strip enforcementMessageViewModel');
  });
});

