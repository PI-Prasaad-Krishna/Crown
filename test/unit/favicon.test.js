import { suite, test, assert, assertEqual, assertTrue } from '../runner.js';
import { TabEngine } from '../../src/js/tabs.js';

suite('Feature: Dynamic Favicon & Fallback', () => {
  const mockApp = { syncActiveTab: () => {}, showToast: () => {} };

  test('Internal crown://newtab returns brand SVG', () => {
    const engine = new TabEngine(mockApp);
    const icon = engine._getFaviconSvg('crown://newtab', false);
    assertTrue(icon.includes('<svg'), 'Must be SVG');
    assertTrue(icon.includes('polygon'), 'Must have brand polygon points');
  });

  test('Internal crown://settings returns cog SVG', () => {
    const engine = new TabEngine(mockApp);
    const icon = engine._getFaviconSvg('crown://settings', false);
    assertTrue(icon.includes('<svg'), 'Must be SVG');
    assertTrue(icon.includes('<circle'), 'Must contain settings icon shapes');
  });

  test('Incognito mode returns private browsing mask SVG', () => {
    const engine = new TabEngine(mockApp);
    const icon = engine._getFaviconSvg('https://example.com', true);
    assertTrue(icon.includes('<svg'), 'Must be SVG');
    assertTrue(icon.includes('circle'), 'Must contain glasses/mask shapes');
  });

  test('External web URL resolves real website favicon via high-resolution proxy', () => {
    const engine = new TabEngine(mockApp);
    const icon = engine._getFaviconSvg('https://github.com/torvalds/linux', false);
    assertTrue(icon.includes('<img'), 'Must generate img tag');
    assertTrue(icon.includes('github.com'), 'Must target host domain');
    assertTrue(icon.includes('tab-favicon-img'), 'Must have CSS class tab-favicon-img');
    assertTrue(icon.includes('loading="lazy"'), 'Must have lazy loading');
  });

  test('Favicon image includes inline fallback to globe SVG on error', () => {
    const engine = new TabEngine(mockApp);
    const icon = engine._getFaviconSvg('https://nonexistent-sample-domain.xyz', false);
    assertTrue(icon.includes('onerror='), 'Must have onerror fallback');
    assertTrue(icon.includes('tab-favicon-globe'), 'Must fallback to globe SVG');
  });

  test('Supports custom resolved favicon URL from page HTML head', () => {
    const engine = new TabEngine(mockApp);
    const customUrl = 'https://custom-site.com/assets/brand-icon.png';
    const icon = engine._getFaviconSvg('https://custom-site.com', false, customUrl);
    assertTrue(icon.includes(customUrl), 'Must use provided custom icon URL');
  });

  test('Malformed or invalid URLs safely fallback to default globe SVG', () => {
    const engine = new TabEngine(mockApp);
    const icon = engine._getFaviconSvg('not-a-valid-url', false);
    assertTrue(icon.includes('tab-favicon-globe'), 'Must render globe SVG for invalid URLs');
  });
});

