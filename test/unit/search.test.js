import { suite, test, assert, assertEqual, assertTrue } from '../runner.js';
import { SearchManager, SearchProviders } from '../../src/js/search.js';
import { Storage } from '../../src/js/storage.js';

suite('Feature: Search Engines & Omnibox Parser', () => {
  test('Contains all built-in high privacy search engines', () => {
    assert(SearchProviders.google !== undefined, 'Google provider exists');
    assert(SearchProviders.duckduckgo !== undefined, 'DuckDuckGo provider exists');
    assert(SearchProviders.brave !== undefined, 'Brave provider exists');
    assert(SearchProviders.bing !== undefined, 'Bing provider exists');
  });

  test('Expands bangs syntax to correct search destination', () => {
    const manager = new SearchManager();
    manager.init();

    const gQuery = manager.parseInput('!g rust lang');
    assertEqual(gQuery, 'https://www.google.com/search?q=rust%20lang');

    const ytQuery = manager.parseInput('!yt tauri v2');
    assertEqual(ytQuery, 'https://www.youtube.com/results?search_query=tauri%20v2');

    const ghQuery = manager.parseInput('!gh crown-browser');
    assertEqual(ghQuery, 'https://github.com/search?q=crown-browser');
  });

  test('Correctly identifies standard URLs vs text search queries', () => {
    const manager = new SearchManager();
    manager.init();

    // Standard valid URLs
    assertEqual(manager.parseInput('https://google.com'), 'https://google.com');
    assertEqual(manager.parseInput('github.com'), 'https://github.com');
    assertEqual(manager.parseInput('localhost:3000'), 'http://localhost:3000');
    assertEqual(manager.parseInput('127.0.0.1:8080'), 'http://127.0.0.1:8080');

    // Plain text queries
    const textRes = manager.parseInput('how to build a browser');
    assertTrue(textRes.startsWith('https://www.google.com/search?q='), 'Should format as search query');
  });

  test('Parses OpenSearch and AC autocomplete suggestion responses', () => {
    const manager = new SearchManager();

    // OpenSearch format: ["query", ["s1", "s2", "s3"]]
    const openSearchPayload = ['tauri', ['tauri v2', 'tauri mobile', 'tauri vs electron']];
    const extracted1 = manager._extractSuggestionsFromPayload(openSearchPayload);
    assertEqual(extracted1.length, 3);
    assertEqual(extracted1[0], 'tauri v2');

    // DuckDuckGo AC format: [{"phrase": "p1"}, {"phrase": "p2"}]
    const ddgPayload = [{ phrase: 'rustlang' }, { phrase: 'rustup' }];
    const extracted2 = manager._extractSuggestionsFromPayload(ddgPayload);
    assertEqual(extracted2.length, 2);
    assertEqual(extracted2[0], 'rustlang');
  });
});

