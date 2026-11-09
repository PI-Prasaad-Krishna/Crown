import { suite, test, assert, assertEqual, assertTrue, assertFalse } from '../runner.js';
import { TabEngine } from '../../src/js/tabs.js';
import { Storage } from '../../src/js/storage.js';

const createMockApp = () => {
  const frames = new Map();
  return {
    frames,
    splitViewActive: false,
    splitSecondaryTabId: null,
    createFrame: (id) => {
      const frame = { classList: { toggle: () => {}, remove: () => {} }, remove: () => {} };
      frames.set(id, frame);
      return frame;
    },
    removeFrame: (id) => {
      frames.delete(id);
    },
    navigateTo: () => {},
    syncActiveTab: () => {},
    restoreHibernatedTab: () => {},
    showToast: () => {},
    renderDefenseHub: () => {},
  };
};

const addTab = (engine, url) => {
  const id = engine.createTab(url);
  return engine.tabs.find(t => t.id === id);
};

const addGroup = (engine, name, color) => {
  const id = engine.createGroup(name, color);
  return engine.groups.find(g => g.id === id);
};

suite('Feature: Tab Engine & Lifecycle', () => {
  const mockApp = createMockApp();

  test('Creates new tab with default newtab URL and sets it active', () => {
    localStorage.clear();
    const engine = new TabEngine(mockApp);
    const tab = addTab(engine, 'crown://newtab');
    assert(tab !== null, 'Tab should be created');
    assertEqual(tab.url, 'crown://newtab');
    assertEqual(tab.title, 'New Tab');
    assertEqual(engine.activeTabId, tab.id);
    assertEqual(engine.tabs.length, 1);
  });

  test('Maintains per-tab history stack on creation', () => {
    const engine = new TabEngine(mockApp);
    const tab = addTab(engine, 'https://example.com');
    assert(Array.isArray(tab.history), 'History should be array');
    assertEqual(tab.history.length, 1);
    assertEqual(tab.history[0], 'https://example.com');
    assertEqual(tab.historyIndex, 0);
  });

  test('Switches active tab and updates timestamps', () => {
    const engine = new TabEngine(mockApp);
    const tab1 = addTab(engine, 'https://site1.com');
    const tab2 = addTab(engine, 'https://site2.com');
    assertEqual(engine.activeTabId, tab2.id);

    engine.switchTab(tab1.id);
    assertEqual(engine.activeTabId, tab1.id);
    assertTrue(tab1.lastActiveAt > 0, 'Tab lastActiveAt should be updated');
  });

  test('Closes active tab and focuses adjacent neighbor tab', () => {
    const engine = new TabEngine(mockApp);
    const tab1 = addTab(engine, 'https://site1.com');
    const tab2 = addTab(engine, 'https://site2.com');
    const tab3 = addTab(engine, 'https://site3.com');

    engine.switchTab(tab2.id);
    engine.closeTab(tab2.id);

    assertEqual(engine.tabs.length, 2);
    assert(engine.tabs.find(t => t.id === tab2.id) === undefined, 'Tab 2 should be removed');
    assertEqual(engine.activeTabId, tab3.id, 'Should focus next or previous tab');
    assertEqual(engine.closedTabsStack.length, 1, 'Closed tab should be in undo stack');
  });

  test('Pin and unpin tab toggles pinned state', () => {
    const engine = new TabEngine(mockApp);
    const tab = addTab(engine, 'https://pinned.com');
    assertFalse(tab.pinned);

    engine.togglePinTab(tab.id);
    assertTrue(tab.pinned, 'Tab should now be pinned');

    engine.togglePinTab(tab.id);
    assertFalse(tab.pinned, 'Tab should be unpinned');
  });
});

suite('Feature: Tab Groups', () => {
  const mockApp = createMockApp();

  test('Creates a tab group with custom name and accent color', () => {
    localStorage.clear();
    const engine = new TabEngine(mockApp);
    const group = addGroup(engine, 'Work', '#a855f7');
    assert(group !== null, 'Group should be created');
    assertEqual(group.name, 'Work');
    assertEqual(group.color, '#a855f7');
    assertFalse(group.collapsed);
  });

  test('Assigns and unassigns tab to a group', () => {
    const engine = new TabEngine(mockApp);
    const group = addGroup(engine, 'Research', '#06b6d4');
    const tab = addTab(engine, 'https://research.org');

    engine.addTabToGroup(tab.id, group.id);
    assertEqual(tab.groupId, group.id);

    engine.removeTabFromGroup(tab.id);
    assertEqual(tab.groupId, null);
  });

  test('Toggles group collapse and expansion', () => {
    const engine = new TabEngine(mockApp);
    const group = addGroup(engine, 'Finance', '#10b981');
    assertFalse(group.collapsed);

    engine.toggleGroupCollapse(group.id);
    const updated = engine.groups.find(g => g.id === group.id);
    assertTrue(updated.collapsed, 'Group should be collapsed');
  });
});

suite('Feature: Ultra-Low RAM Hibernation', () => {
  test('Enforces memory budget by hibernating oldest inactive tabs', () => {
    localStorage.clear();
    Storage.saveSettings({ memorySaverMode: true, memorySaverLevel: 'maximum', memoryWhitelist: [] });

    let hibernatedIds = [];
    const mockApp = createMockApp();
    mockApp.removeFrame = (id) => { hibernatedIds.push(id); };

    const engine = new TabEngine(mockApp);
    const tab1 = addTab(engine, 'https://site1.com');
    tab1.lastActiveAt = Date.now() - 5000;

    const tab2 = addTab(engine, 'https://site2.com');
    tab2.lastActiveAt = Date.now();

    // Ensure frames map has both tabs so enforceMemoryBudget recognizes them as live
    mockApp.frames = new Map([[tab1.id, {}], [tab2.id, {}]]);

    engine.enforceMemoryBudget();

    assertTrue(tab1.hibernated, 'Inactive background tab should be hibernated in maximum mode');
    assertFalse(tab2.hibernated, 'Active tab must never hibernate');
  });

  test('Whitelisted domain bypasses hibernation', () => {
    localStorage.clear();
    Storage.saveSettings({ memorySaverMode: true, memorySaverLevel: 'maximum', memoryWhitelist: ['important.com'] });

    const mockApp = createMockApp();
    const engine = new TabEngine(mockApp);

    const tab1 = addTab(engine, 'https://important.com/dashboard');
    tab1.lastActiveAt = Date.now() - 10000;

    const tab2 = addTab(engine, 'https://site2.com');
    tab2.lastActiveAt = Date.now();

    mockApp.frames = new Map([[tab1.id, {}], [tab2.id, {}]]);

    engine.enforceMemoryBudget();

    assertFalse(tab1.hibernated, 'Whitelisted domain must not be hibernated');
  });
});
