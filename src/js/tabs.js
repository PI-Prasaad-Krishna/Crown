// Crown Browser — Advanced Tab Engine (Zero-Flicker In-Place DOM, FLIP Animations & Drag-and-Drop Reordering)
import { Storage } from './storage.js';

export const GROUP_COLORS = [
  { name: 'Gold', value: '#e6ca85' },
  { name: 'Amethyst', value: '#a855f7' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Mint', value: '#10b981' },
  { name: 'Rose', value: '#f43f5e' }
];

export class TabEngine {
  constructor(app) {
    this.app = app;
    this.tabs = [];
    this.groups = Storage.getTabGroups();
    this.activeTabId = null;
    this.tabCounter = 0;
    this.groupCounter = this.groups.length;
    this.position = Storage.getSettings().tabPosition || 'top'; // 'top' | 'left'
    this.sidebarCollapsed = Storage.getSettings().verticalCollapsed || false;
    this.isIncognitoWindow = Storage.isIncognitoWindow;

    // Persistent DOM cache for zero-flicker in-place updates on CPU & GPU systems
    this.tabElements = new Map(); // tabId -> HTMLElement
    this.newTabBtnEl = null;
    this.dragState = null;
    this.closedTabsStack = [];
    this.windowId = `crown-win-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.dragChannel = null;
    this.remoteHoverTarget = null;
  }

  init() {
    this.applyLayout(this.position);
    this._bindContextMenu();
    this._initCrossWindowTabBus();
  }

  // Cross-window Tab Drag & Merge Bus (Chrome-style merge ONLY onto another window's tab bar)
  _initCrossWindowTabBus() {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.dragChannel = new BroadcastChannel('crown_tab_drag_bus');
      this.dragChannel.onmessage = (event) => {
        const msg = event.data;
        if (!msg || msg.sourceWindowId === this.windowId) return;

        const container = this._getContainer();
        if (msg.type === 'TAB_DRAG_MOVE') {
          const hit = this._hitTestOwnTabBar(msg.screenX, msg.screenY);
          if (hit.overTabBar) {
            container?.classList.add('tab-bar-drop-target');
            this.dragChannel.postMessage({
              type: 'TAB_DRAG_HOVER_ACK',
              targetWindowId: this.windowId,
              sourceWindowId: msg.sourceWindowId,
              insertIndex: hit.insertIndex
            });
          } else {
            container?.classList.remove('tab-bar-drop-target');
          }
        } else if (msg.type === 'TAB_DRAG_HOVER_ACK') {
          if (msg.sourceWindowId === this.windowId) {
            this.remoteHoverTarget = {
              targetWindowId: msg.targetWindowId,
              insertIndex: msg.insertIndex,
              timestamp: Date.now()
            };
          }
        } else if (msg.type === 'TAB_DRAG_CLEAR') {
          container?.classList.remove('tab-bar-drop-target');
        } else if (msg.type === 'TAB_DRAG_DROP' && msg.targetWindowId === this.windowId) {
          container?.classList.remove('tab-bar-drop-target');
          if (msg.tabData && msg.tabData.url && Storage.isSafeUrl(msg.tabData.url, true)) {
            const newId = this.createTab({
              url: msg.tabData.url,
              title: msg.tabData.title || 'Tab',
              pinned: Boolean(msg.tabData.pinned),
              active: true
            });
            const newTab = this.tabs.find(t => t.id === newId);
            // Reorder to exact dropped slot on the tab bar if specified
            if (newTab && typeof msg.insertIndex === 'number' && msg.insertIndex >= 0 && msg.insertIndex < this.tabs.length) {
              const curIdx = this.tabs.findIndex(t => t.id === newTab.id);
              if (curIdx !== -1 && curIdx !== msg.insertIndex) {
                const [moved] = this.tabs.splice(curIdx, 1);
                this.tabs.splice(msg.insertIndex, 0, moved);
                this.render();
                this.saveSession();
              }
            }
            window.focus();
            if (newTab) {
              this.app?.showToast?.(`Merged tab "${newTab.title}" into this window`);
            }
          }
        }
      };
    } catch {}
  }

  // Strictly checks whether screen coordinates (screenX, screenY) fall inside THIS window's tab bar
  _hitTestOwnTabBar(screenX, screenY) {
    const container = this._getContainer();
    if (!container || document.hidden) return { overTabBar: false, insertIndex: -1 };

    const rect = container.getBoundingClientRect();
    // Estimate Chrome/WebView viewport screen origin
    const chromeOffsetY = Math.max(0, (window.outerHeight - window.innerHeight));
    const chromeOffsetX = Math.max(0, Math.round((window.outerWidth - window.innerWidth) / 2));
    const barLeft = window.screenX + chromeOffsetX + rect.left;
    const barRight = window.screenX + chromeOffsetX + rect.right;
    const barTop = window.screenY + chromeOffsetY + rect.top;
    const barBottom = window.screenY + chromeOffsetY + rect.bottom;

    // Pad vertical tolerance slightly (+14px) on the tab strip only, NEVER the webpage body
    const isInsideBar = (
      screenX >= barLeft - 10 &&
      screenX <= barRight + 10 &&
      screenY >= barTop - 14 &&
      screenY <= barBottom + 14
    );

    if (!isInsideBar) return { overTabBar: false, insertIndex: -1 };

    const localX = screenX - (window.screenX + chromeOffsetX);
    const localY = screenY - (window.screenY + chromeOffsetY);
    const isVertical = (this.position === 'left');
    let insertIndex = this.tabs.length;

    for (let i = 0; i < this.tabs.length; i++) {
      const el = this.tabElements.get(this.tabs[i].id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const mid = isVertical ? (r.top + r.height / 2) : (r.left + r.width / 2);
      if ((isVertical ? localY : localX) < mid) {
        insertIndex = i;
        break;
      }
    }
    return { overTabBar: true, insertIndex };
  }

  // Get active tab strip container
  _getContainer() {
    return this.position === 'left'
      ? document.getElementById('sidebar-tab-list')
      : document.getElementById('tab-bar');
  }

  // Set Layout: 'top' or 'left'
  setLayout(position) {
    if (position !== 'top' && position !== 'left') return;
    this.position = position;
    const settings = Storage.getSettings();
    settings.tabPosition = position;
    Storage.saveSettings(settings);

    this.applyLayout(position);
    this.render();
  }

  toggleLayout() {
    this.setLayout(this.position === 'top' ? 'left' : 'top');
  }

  toggleSidebarCollapse() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    const settings = Storage.getSettings();
    settings.verticalCollapsed = this.sidebarCollapsed;
    Storage.saveSettings(settings);

    const appEl = document.getElementById('crown-app');
    appEl.classList.toggle('tabs-sidebar-compact', this.sidebarCollapsed);
    this.render();
  }

  applyLayout(position) {
    const appEl = document.getElementById('crown-app');
    if (position === 'left') {
      appEl.classList.add('tabs-layout-left');
      appEl.classList.remove('tabs-layout-top');
      appEl.classList.toggle('tabs-sidebar-compact', !!this.sidebarCollapsed);
    } else {
      appEl.classList.remove('tabs-layout-left', 'tabs-sidebar-compact');
      appEl.classList.add('tabs-layout-top');
    }
  }

  // Capture current positions of tabs and the '+' button for FLIP animation
  _capturePositions() {
    const container = this._getContainer();
    const rects = new Map();
    if (!container) return rects;

    container.querySelectorAll('.browser-tab').forEach(el => {
      if (el.dataset.tabId) {
        rects.set(el.dataset.tabId, el.getBoundingClientRect());
      }
    });
    if (this.newTabBtnEl && container.contains(this.newTabBtnEl)) {
      rects.set('__new_tab_btn__', this.newTabBtnEl.getBoundingClientRect());
    }
    return rects;
  }

  // Play 2D integer-rounded FLIP transitions (works smoothly on software/CPU & GPU renderers)
  _playFlip(beforeRects, enteringId = null, excludeId = null) {
    const container = this._getContainer();
    if (!container) return;

    const animatedNodes = [];

    container.querySelectorAll('.browser-tab').forEach(el => {
      const id = el.dataset.tabId;
      if (!id || id === excludeId) return;

      if (id === enteringId) {
        const offset = this.position === 'left' ? 'translate(0px, -10px)' : 'translate(-14px, 0px)';
        el.style.transition = 'none';
        el.style.opacity = '0';
        el.style.transform = offset;
        animatedNodes.push(el);
        return;
      }

      const before = beforeRects.get(id);
      if (!before) return;
      const after = el.getBoundingClientRect();
      const dx = Math.round(before.left - after.left);
      const dy = Math.round(before.top - after.top);

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        animatedNodes.push(el);
      }
    });

    // Also glide the '+' New Tab button smoothly
    if (this.newTabBtnEl && container.contains(this.newTabBtnEl) && beforeRects.has('__new_tab_btn__')) {
      const beforeBtn = beforeRects.get('__new_tab_btn__');
      const afterBtn = this.newTabBtnEl.getBoundingClientRect();
      const dx = Math.round(beforeBtn.left - afterBtn.left);
      const dy = Math.round(beforeBtn.top - afterBtn.top);
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        this.newTabBtnEl.style.transition = 'none';
        this.newTabBtnEl.style.transform = `translate(${dx}px, ${dy}px)`;
        animatedNodes.push(this.newTabBtnEl);
      }
    }

    if (animatedNodes.length === 0) return;

    // Single layout read to commit starting transforms before playing transition
    void container.offsetWidth;

    const timing = 'transform 0.17s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s ease';
    animatedNodes.forEach(el => {
      el.style.transition = timing;
      el.style.transform = 'translate(0px, 0px)';
      el.style.opacity = '1';
    });

    setTimeout(() => {
      animatedNodes.forEach(el => {
        if (this.dragState && this.dragState.tabEl === el) return;
        el.style.transition = '';
        el.style.transform = '';
        el.style.opacity = '';
      });
    }, 185);
  }

  // Create Tab (Single-pass render with zero flicker; forces Incognito if inside an Incognito window)
  createTab(urlOrOpts = 'crown://newtab', isIncognito = false, groupId = null) {
    let url = 'crown://newtab';
    let customTitle = null;
    let isPinned = false;
    if (urlOrOpts && typeof urlOrOpts === 'object') {
      url = String(urlOrOpts.url || 'crown://newtab');
      isIncognito = Boolean(urlOrOpts.isIncognito);
      groupId = urlOrOpts.groupId || null;
      customTitle = urlOrOpts.title ? String(urlOrOpts.title) : null;
      isPinned = Boolean(urlOrOpts.pinned);
    } else if (typeof urlOrOpts === 'string') {
      url = urlOrOpts;
    }

    const effectiveIncognito = Boolean(this.isIncognitoWindow || isIncognito);
    const beforeRects = this._capturePositions();
    const id = `tab-${++this.tabCounter}`;
    const newTab = {
      id,
      url,
      title: customTitle || (url === 'crown://newtab' ? (effectiveIncognito ? 'Incognito' : 'New Tab') : this._extractDomain(url)),
      favicon: this._getFaviconSvg(url, effectiveIncognito),
      history: [url],
      historyIndex: 0,
      groupId,
      isIncognito: effectiveIncognito,
      pinned: isPinned,
      muted: false,
      audioPlaying: false,
      hibernated: false,
      lastActiveAt: Date.now()
    };

    this.tabs.push(newTab);
    this.activeTabId = id;
    this.app.createFrame(id);
    this.app.navigateTo(url, id);
    this.enforceMemoryBudget();
    this.saveSession();
    this._playFlip(beforeRects, id);
    if (url === 'crown://newtab' && typeof document !== 'undefined' && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        const omnibox = document.getElementById('omnibox-input');
        if (omnibox) {
          omnibox.focus();
          omnibox.select();
        }
      });
    }
    return id;
  }

  // Ultra-Low RAM Engine: Unload an inactive tab's iframe to free 100% of its JS Heap & DOM memory
  hibernateTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.id === this.activeTabId) return false;
    if (tab.url === 'crown://newtab' || tab.url.startsWith('crown://')) return false;

    this.app.removeFrame(tab.id);
    tab.hibernated = true;
    this.render();
    this.app.renderDefenseHub();
    return true;
  }

  // Keep at most maxLiveTabs (default 2 in Balanced mode) live webview frames in memory
  enforceMemoryBudget() {
    const settings = Storage.getSettings();
    if (settings.memorySaverMode === false) return;

    let maxLive = Number(settings.maxLiveTabs) || 2;
    if (settings.memorySaverLevel === 'moderate') maxLive = 5;
    else if (settings.memorySaverLevel === 'balanced') maxLive = 2;
    else if (settings.memorySaverLevel === 'maximum') maxLive = 1;

    if (this.app && this.app.splitViewActive && maxLive < 2) {
      maxLive = 2;
    }

    const whitelist = Array.isArray(settings.memoryWhitelist)
      ? settings.memoryWhitelist.map(d => String(d || '').toLowerCase().trim()).filter(Boolean)
      : [];

    const isWhitelisted = (urlStr) => {
      if (!whitelist.length || !urlStr) return false;
      try {
        const host = new URL(urlStr).hostname.toLowerCase();
        return whitelist.some(w => host === w || host.endsWith('.' + w));
      } catch {
        return false;
      }
    };

    const liveWebTabs = this.tabs.filter(t =>
      !t.hibernated &&
      t.url !== 'crown://newtab' &&
      !t.url.startsWith('crown://') &&
      (this.app?.frames ? this.app.frames.has(t.id) : true)
    );

    if (liveWebTabs.length <= maxLive) return;

    // Sort non-active, non-split, non-whitelisted live web tabs oldest-first and hibernate excess tabs
    const candidates = liveWebTabs
      .filter(t =>
        t.id !== this.activeTabId &&
        !(this.app && this.app.splitViewActive && t.id === this.app.splitSecondaryTabId) &&
        !isWhitelisted(t.url)
      )
      .sort((a, b) => (a.lastActiveAt || 0) - (b.lastActiveAt || 0));

    const excessCount = liveWebTabs.length - maxLive;
    for (let i = 0; i < excessCount && i < candidates.length; i++) {
      this.app.removeFrame(candidates[i].id);
      candidates[i].hibernated = true;
    }

    this.render();
    this.app.renderDefenseHub();
  }

  // Reset tabs and groups cleanly when switching user profiles
  resetForProfileSwitch(previousProfileId = null) {
    const outProf = previousProfileId || Storage.getActiveProfileId();
    this.tabs.forEach(t => this.app.removeFrame(t.id, outProf));
    if (this.app?._isNativeWebviewMode?.() && outProf) {
      window.__TAURI_INTERNALS__.invoke('close_profile_webviews', {
        profileId: outProf
      }).catch(() => {});
    }
    this.tabElements.forEach(el => el.remove());
    this.tabElements.clear();
    this.tabs = [];
    this.closedTabsStack = [];
    this.activeTabId = null;
    this.groups = Storage.getTabGroups();
    this.groupCounter = this.groups.length;
    this.position = Storage.getSettings().tabPosition || 'top';
    this.sidebarCollapsed = Storage.getSettings().verticalCollapsed || false;
    this.applyLayout(this.position);
    if (!this.restoreSession()) {
      this.createTab('crown://newtab', this.isIncognitoWindow);
    }
  }

  // Save session tabs for the active profile
  saveSession() {
    if (this.isIncognitoWindow) return;
    const sessionTabs = this.tabs.map(t => ({
      url: t.url,
      title: t.title,
      groupId: t.groupId || null,
      pinned: Boolean(t.pinned),
      isActive: t.id === this.activeTabId
    }));
    Storage.saveSessionTabs(sessionTabs);
  }

  // Restore saved session tabs for the active profile (MemoryGuard: background tabs hibernated)
  restoreSession() {
    if (this.isIncognitoWindow) return false;
    const saved = Storage.getSessionTabs();
    if (!Array.isArray(saved) || saved.length === 0) return false;

    this.tabs.forEach(t => this.app.removeFrame(t.id));
    this.tabElements.forEach(el => el.remove());
    this.tabElements.clear();
    this.tabs = [];
    this.activeTabId = null;

    let activeSaved = saved.find(s => s.isActive) || saved[0];

    saved.forEach(s => {
      const id = `tab-${++this.tabCounter}`;
      const isActive = (s === activeSaved);
      const isHibernated = !isActive && s.url !== 'crown://newtab' && !s.url.startsWith('crown://');

      const tab = {
        id,
        url: s.url || 'crown://newtab',
        title: s.title || this._extractDomain(s.url || 'crown://newtab'),
        favicon: this._getFaviconSvg(s.url || 'crown://newtab', false),
        history: [s.url || 'crown://newtab'],
        historyIndex: 0,
        groupId: s.groupId || null,
        isIncognito: false,
        pinned: Boolean(s.pinned),
        hibernated: isHibernated,
        lastActiveAt: isActive ? Date.now() : 0
      };
      this.tabs.push(tab);

      if (isActive) {
        this.activeTabId = id;
        this.app.createFrame(id);
        this.app.navigateTo(tab.url, id, { pushHistory: false });
      }
    });

    if (!this.activeTabId && this.tabs.length > 0) {
      this.activeTabId = this.tabs[0].id;
      this.tabs[0].hibernated = false;
      this.app.createFrame(this.activeTabId);
      this.app.navigateTo(this.tabs[0].url, this.activeTabId, { pushHistory: false });
    }

    this.render();
    this.app.syncActiveTab(this.getActiveTab());
    this.enforceMemoryBudget();
    return true;
  }

  // Reopen the most recently closed tab (Ctrl+Shift+T)
  reopenLastClosedTab() {
    if (!this.closedTabsStack.length) return false;
    const item = this.closedTabsStack.pop();
    if (item && item.url) {
      this.createTab(item.url, false, item.groupId);
      return true;
    }
    return false;
  }

  // Close Tab (Single-pass FLIP glide left in Top mode or glide up in Vertical Sidebar mode)
  closeTab(id, e) {
    if (e) e.stopPropagation();
    if (this.tabs.length <= 1) {
      this.app.navigateTo('crown://newtab', id);
      return;
    }

    const index = this.tabs.findIndex(t => t.id === id);
    if (index === -1) return;

    const targetTab = this.tabs[index];
    if (targetTab && !targetTab.isIncognito && targetTab.url !== 'crown://newtab') {
      this.closedTabsStack.push({
        url: targetTab.url,
        title: targetTab.title,
        groupId: targetTab.groupId
      });
      if (this.closedTabsStack.length > 30) this.closedTabsStack.shift();
    }

    const beforeRects = this._capturePositions();
    const isClosingActive = (this.activeTabId === id);

    // Notify Split View engine if one of the split tabs is closing
    if (this.app && typeof this.app.onTabClosedInSplitView === 'function') {
      this.app.onTabClosedInSplitView(id);
    }

    // Clean up frame and cached tab element
    this.app.removeFrame(id);
    const cachedEl = this.tabElements.get(id);
    if (cachedEl) {
      cachedEl.remove();
      this.tabElements.delete(id);
    }
    this.tabs.splice(index, 1);

    if (isClosingActive) {
      const nextTab = this.tabs[index] || this.tabs[index - 1];
      if (nextTab) {
        this.activeTabId = nextTab.id;
        nextTab.lastActiveAt = Date.now();
        if (nextTab.hibernated) {
          nextTab.hibernated = false;
          this.app.restoreHibernatedTab(nextTab);
        }
        this.app.syncActiveTab(nextTab);
      }
    }

    this.render();
    this.saveSession();
    this._playFlip(beforeRects);
  }

  switchTab(id) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return;
    if (this.activeTabId === id) return;

    this.activeTabId = id;
    tab.lastActiveAt = Date.now();
    if (tab.hibernated) {
      tab.hibernated = false;
      this.app.restoreHibernatedTab(tab);
    }
    this.app.syncActiveTab(tab);
    this.enforceMemoryBudget();
    this.saveSession();
    this.render();
  }

  getActiveTab() {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  // Pin or Unpin a tab (Pinned tabs lock to the start of the tab strip & hide the close button)
  togglePinTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return false;

    const beforeRects = this._capturePositions();
    tab.pinned = !tab.pinned;
    if (tab.pinned) {
      tab.groupId = null; // Pinned tabs sit outside groups at the start of the strip
    }

    // Reorder so all pinned tabs stay at the front while preserving relative order
    const pinnedTabs = this.tabs.filter(t => t.pinned);
    const unpinnedTabs = this.tabs.filter(t => !t.pinned);
    this.tabs = [...pinnedTabs, ...unpinnedTabs];

    this.render();
    this.saveSession();
    this._playFlip(beforeRects);
    return tab.pinned;
  }

  // Mute or Unmute a tab's audio/video streams
  toggleMuteTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return false;
    tab.muted = !tab.muted;
    const frame = this.app?.frames?.get(tabId);
    if (frame && frame.contentWindow) {
      try {
        frame.contentWindow.postMessage({ type: 'crown:set-muted', muted: tab.muted }, '*');
      } catch {}
    }
    if (this.app?._isNativeWebviewMode?.()) {
      window.__TAURI_INTERNALS__.invoke('tab_webview_action', {
        tabId,
        action: tab.muted ? 'mute' : 'unmute',
        profileId: Storage.getActiveProfileId()
      }).catch(() => {});
    }
    this.render();
    return tab.muted;
  }

  // Close all unpinned tabs except keepTabId
  closeOtherTabs(keepTabId) {
    const keepTab = this.tabs.find(t => t.id === keepTabId);
    if (!keepTab) return 0;
    const toClose = this.tabs.filter(t => t.id !== keepTabId && !t.pinned);
    toClose.forEach(t => {
      if (!t.isIncognito && t.url !== 'crown://newtab') {
        this.closedTabsStack.push({ url: t.url, title: t.title, groupId: t.groupId });
      }
      this.app?.removeFrame?.(t.id);
      const el = this.tabElements.get(t.id);
      if (el) {
        el.remove();
        this.tabElements.delete(t.id);
      }
    });
    this.tabs = this.tabs.filter(t => t.id === keepTabId || t.pinned);
    if (this.activeTabId !== keepTabId) {
      this.switchTab(keepTabId);
    } else {
      this.render();
      this.saveSession();
    }
    return toClose.length;
  }

  // Close all unpinned tabs to the right of fromTabId
  closeTabsToRight(fromTabId) {
    const idx = this.tabs.findIndex(t => t.id === fromTabId);
    if (idx === -1) return 0;
    const toClose = this.tabs.slice(idx + 1).filter(t => !t.pinned);
    const closeIds = new Set(toClose.map(t => t.id));
    toClose.forEach(t => {
      if (!t.isIncognito && t.url !== 'crown://newtab') {
        this.closedTabsStack.push({ url: t.url, title: t.title, groupId: t.groupId });
      }
      this.app?.removeFrame?.(t.id);
      const el = this.tabElements.get(t.id);
      if (el) {
        el.remove();
        this.tabElements.delete(t.id);
      }
    });
    this.tabs = this.tabs.filter(t => !closeIds.has(t.id));
    if (closeIds.has(this.activeTabId)) {
      this.switchTab(fromTabId);
    } else {
      this.render();
      this.saveSession();
    }
    return toClose.length;
  }

  // Cycle active tab forward (step=1, Ctrl+Tab) or backward (step=-1, Ctrl+Shift+Tab)
  cycleTab(step = 1) {
    if (this.tabs.length <= 1) return;
    const currentIdx = this.tabs.findIndex(t => t.id === this.activeTabId);
    if (currentIdx === -1) return;
    const nextIdx = (currentIdx + step + this.tabs.length) % this.tabs.length;
    this.switchTab(this.tabs[nextIdx].id);
  }

  // Jump to tab by 1-based shortcut (Ctrl+1..8 jumps to 0..7, Ctrl+9 jumps to last tab)
  switchToTabIndex(oneBasedNum) {
    if (this.tabs.length === 0) return;
    const targetIdx = oneBasedNum === 9
      ? this.tabs.length - 1
      : Math.min(oneBasedNum - 1, this.tabs.length - 1);
    if (this.tabs[targetIdx]) {
      this.switchTab(this.tabs[targetIdx].id);
    }
  }

  // Tab Groups
  createGroup(name, color = GROUP_COLORS[0].value) {
    const id = `group-${++this.groupCounter}-${Date.now()}`;
    const newGroup = {
      id,
      name: name || `Group ${this.groups.length + 1}`,
      color,
      collapsed: false
    };
    this.groups.push(newGroup);
    Storage.saveTabGroups(this.groups);
    this.render();
    return id;
  }

  assignTabToGroup(tabId, groupId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      const beforeRects = this._capturePositions();
      tab.groupId = groupId;
      this.render();
      this._playFlip(beforeRects);
    }
  }

  addTabToGroup(tabId, groupId) {
    return this.assignTabToGroup(tabId, groupId);
  }

  removeTabFromGroup(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      const beforeRects = this._capturePositions();
      tab.groupId = null;
      this.render();
      this._playFlip(beforeRects);
    }
  }

  toggleGroupCollapse(groupId) {
    const group = this.groups.find(g => g.id === groupId);
    if (group) {
      const beforeRects = this._capturePositions();
      group.collapsed = !group.collapsed;
      Storage.saveTabGroups(this.groups);
      this.render();
      this._playFlip(beforeRects);
    }
  }

  deleteGroup(groupId) {
    const beforeRects = this._capturePositions();
    this.groups = this.groups.filter(g => g.id !== groupId);
    this.tabs.forEach(t => {
      if (t.groupId === groupId) t.groupId = null;
    });
    Storage.saveTabGroups(this.groups);
    this.render();
    this._playFlip(beforeRects);
  }

  // In-Place DOM Render (Zero innerHTML tear-down so tabs never flicker)
  render() {
    const topBar = document.getElementById('tab-bar');
    const leftBar = document.getElementById('sidebar-tab-list');
    const targetContainer = this.position === 'left' ? leftBar : topBar;
    const inactiveContainer = this.position === 'left' ? topBar : leftBar;

    if (!targetContainer) return;
    if (inactiveContainer && inactiveContainer.childNodes.length > 0) {
      inactiveContainer.innerHTML = '';
    }

    const groupMap = new Map();
    this.groups.forEach(g => groupMap.set(g.id, []));
    const unassignedTabs = [];

    this.tabs.forEach(tab => {
      if (tab.groupId && groupMap.has(tab.groupId)) {
        groupMap.get(tab.groupId).push(tab);
      } else {
        unassignedTabs.push(tab);
      }
    });

    const desiredChildren = [];

    // 1. Unassigned tabs
    unassignedTabs.forEach(tab => {
      desiredChildren.push(this._getOrUpdateTabElement(tab, null));
    });

    // 2. Grouped tabs
    this.groups.forEach(group => {
      const gTabs = groupMap.get(group.id) || [];
      if (gTabs.length === 0 && this.position !== 'left') return;

      const safeColor = Storage.sanitizeColor(group.color);
      const pill = document.createElement('div');
      pill.className = `tab-group-pill ${group.collapsed ? 'collapsed' : ''}`;
      pill.style.setProperty('--group-color', safeColor);
      pill.innerHTML = `
        <span class="group-dot"></span>
        <span class="group-label">${this._escape(group.name)}</span>
        <span class="group-chevron">${group.collapsed ? '▶' : '▼'}</span>
      `;
      const dotEl = pill.querySelector('.group-dot');
      if (dotEl) dotEl.style.backgroundColor = safeColor;
      pill.onclick = (e) => {
        e.stopPropagation();
        this.toggleGroupCollapse(group.id);
      };
      pill.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._showGroupContextMenu(e.clientX, e.clientY, group);
      };
      desiredChildren.push(pill);

      if (!group.collapsed) {
        gTabs.forEach(tab => {
          desiredChildren.push(this._getOrUpdateTabElement(tab, group.color));
        });
      }
    });

    // 3. Persistent '+' New Tab Button
    if (!this.newTabBtnEl) {
      this.newTabBtnEl = document.createElement('button');
      this.newTabBtnEl.className = 'new-tab-btn';
      this.newTabBtnEl.title = 'New tab (Ctrl+T)';
      this.newTabBtnEl.onclick = () => this.createTab('crown://newtab');
    }
    const wantLabel = (this.position === 'left' && !this.sidebarCollapsed);
    const desiredBtnHtml = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      ${wantLabel ? '<span>New Tab</span>' : ''}
    `;
    if (this.newTabBtnEl._lastHtml !== desiredBtnHtml) {
      this.newTabBtnEl.innerHTML = desiredBtnHtml;
      this.newTabBtnEl._lastHtml = desiredBtnHtml;
    }
    desiredChildren.push(this.newTabBtnEl);

    // Reconcile children in place without destroying existing tab elements
    const desiredSet = new Set(desiredChildren);
    Array.from(targetContainer.children).forEach(child => {
      if (!desiredSet.has(child)) {
        child.remove();
      }
    });

    desiredChildren.forEach((node, idx) => {
      const currentAtIdx = targetContainer.children[idx];
      if (currentAtIdx !== node) {
        targetContainer.insertBefore(node, currentAtIdx || null);
      }
    });

    const mobileCountEl = typeof document !== 'undefined' ? document.getElementById('mobile-tab-count-val') : null;
    if (mobileCountEl) {
      mobileCountEl.textContent = String(this.tabs.length);
    }
  }

  _getOrUpdateTabElement(tab, groupColor = null) {
    let tabEl = this.tabElements.get(tab.id);
    if (!tabEl) {
      tabEl = document.createElement('div');
      tabEl.dataset.tabId = tab.id;
      tabEl.innerHTML = `
        <span class="tab-favicon"></span>
        <span class="tab-title"></span>
        <button class="tab-audio-btn" title="Mute / Unmute tab" style="display:none;"></button>
        <button class="tab-close-btn" title="Close tab">✕</button>
      `;

      tabEl.querySelector('.tab-audio-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const isMuted = this.toggleMuteTab(tab.id);
        this.app?.showToast?.(isMuted ? 'Tab muted' : 'Tab unmuted');
      });

      tabEl.querySelector('.tab-close-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(tab.id, e);
      });

      // Prevent browser auto-scroll when middle-clicking a tab in the tab strip
      tabEl.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
        }
      });

      // Middle-click (scroll-click) directly on a tab in the tab strip closes that tab
      tabEl.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          const currentTab = this.tabs.find(t => t.id === tab.id);
          if (currentTab && currentTab.pinned) {
            this.app.showToast('Tab is pinned — right-click to unpin before closing');
            return;
          }
          this.closeTab(tab.id, e);
        }
      });

      tabEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._showTabContextMenu(e.clientX, e.clientY, tab);
      });

      this._bindTabDrag(tabEl, tab);
      this.tabElements.set(tab.id, tabEl);
    }

    const isActive = tab.id === this.activeTabId;
    const isSplitSecondary = Boolean(this.app && this.app.splitViewActive && this.app.splitSecondaryTabId === tab.id);
    const isDragging = this.dragState && this.dragState.tab.id === tab.id;
    tabEl.className = `browser-tab ${isActive ? 'active' : ''} ${isSplitSecondary ? 'split-secondary' : ''} ${tab.pinned ? 'tab-pinned' : ''} ${tab.isIncognito ? 'incognito' : ''} ${tab.hibernated ? 'tab-sleeping' : ''} ${groupColor ? 'has-group-color' : ''} ${isDragging ? 'tab-dragging' : ''}`.trim();
    tabEl.title = tab.hibernated ? `${tab.title} — Hibernated (RAM Freed)` : (tab.pinned ? `${tab.title} (Pinned)` : tab.title);

    if (groupColor) {
      tabEl.style.setProperty('--tab-group-color', groupColor);
    } else {
      tabEl.style.removeProperty('--tab-group-color');
    }

    const favEl = tabEl.querySelector('.tab-favicon');
    const sleepSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
    const desiredFavicon = tab.hibernated ? sleepSvg : tab.favicon;
    if (favEl && favEl._lastFavicon !== desiredFavicon) {
      favEl.innerHTML = desiredFavicon;
      favEl._lastFavicon = desiredFavicon;
    }

    const titleEl = tabEl.querySelector('.tab-title');
    if (titleEl && titleEl.textContent !== tab.title) {
      titleEl.textContent = tab.title;
    }

    const audioBtn = tabEl.querySelector('.tab-audio-btn');
    if (audioBtn) {
      if (tab.muted || tab.audioPlaying) {
        audioBtn.style.display = 'inline-flex';
        audioBtn.title = tab.muted ? 'Unmute tab' : 'Mute tab';
        audioBtn.innerHTML = tab.muted
          ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`
          : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
      } else {
        audioBtn.style.display = 'none';
      }
    }

    return tabEl;
  }

  // Pointer-Driven Drag-and-Drop Tab Reordering + Chrome-Style Tear-Off & Tab-Bar Window Merge
  _bindTabDrag(tabEl, tab) {
    tabEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // left click only
      if (e.target.closest('.tab-close-btn')) return;

      // Activate the tab immediately on press for responsive feel
      if (this.activeTabId !== tab.id) {
        this.switchTab(tab.id);
      }

      const startX = e.clientX;
      const startY = e.clientY;
      let isDragging = false;
      let isDetachedDrag = false;
      let anchorX = startX;
      let anchorY = startY;

      const ghostEl = document.getElementById('tab-drag-detach-ghost');
      const ghostTitleEl = document.getElementById('detach-ghost-title');
      const ghostBadgeEl = document.getElementById('detach-ghost-badge');

      const onPointerMove = (moveEvent) => {
        const dx = moveEvent.clientX - anchorX;
        const dy = moveEvent.clientY - anchorY;

        if (!isDragging) {
          const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
          if (dist < 5) return;
          isDragging = true;
          this.dragState = { tab, tabEl };
          tabEl.classList.add('tab-dragging');
          try { tabEl.setPointerCapture(moveEvent.pointerId); } catch {}
        }

        const isVertical = (this.position === 'left');
        const perpDist = isVertical ? Math.abs(moveEvent.clientX - startX) : Math.abs(moveEvent.clientY - startY);
        const detachThreshold = isVertical ? 60 : 48;

        // Check if user dragged the tab out of the tab bar (downward in Top mode, rightward in Left Sidebar mode)
        if (perpDist > detachThreshold) {
          isDetachedDrag = true;
          this.remoteHoverTarget = null;

          // Broadcast screen coordinates so other Crown windows can highlight their tab bar ONLY if hovered over their tab bar
          if (this.dragChannel) {
            try {
              this.dragChannel.postMessage({
                type: 'TAB_DRAG_MOVE',
                sourceWindowId: this.windowId,
                screenX: moveEvent.screenX,
                screenY: moveEvent.screenY
              });
            } catch {}
          }

          tabEl.style.opacity = '0.35';
          tabEl.style.transform = `translate(${Math.round(dx * 0.25)}px, ${Math.round(dy * 0.25)}px) scale(0.94)`;

          if (ghostEl) {
            ghostEl.classList.remove('hidden');
            ghostEl.style.left = `${Math.min(window.innerWidth - 240, Math.max(8, moveEvent.clientX + 12))}px`;
            ghostEl.style.top = `${Math.min(window.innerHeight - 64, Math.max(8, moveEvent.clientY + 12))}px`;
            if (ghostTitleEl) ghostTitleEl.textContent = tab.title || 'New Tab';
            if (ghostBadgeEl) {
              setTimeout(() => {
                const isOverRemoteBar = this.remoteHoverTarget && (Date.now() - this.remoteHoverTarget.timestamp < 260);
                if (isOverRemoteBar) {
                  ghostBadgeEl.textContent = 'Drop on tab bar to merge into window';
                  ghostEl.classList.add('merge-ready');
                } else {
                  ghostBadgeEl.textContent = this.tabs.length > 1
                    ? 'Release to tear off into new window'
                    : 'Drag onto another window\'s tab bar to merge';
                  ghostEl.classList.remove('merge-ready');
                }
              }, 12);
            }
          }
          return;
        } else if (isDetachedDrag) {
          // Returned back inside own tab bar
          isDetachedDrag = false;
          tabEl.style.opacity = '';
          ghostEl?.classList.add('hidden');
          ghostEl?.classList.remove('merge-ready');
          if (this.dragChannel) {
            try { this.dragChannel.postMessage({ type: 'TAB_DRAG_CLEAR', sourceWindowId: this.windowId }); } catch {}
          }
        }

        const offsetX = isVertical ? 0 : Math.round(dx);
        const offsetY = isVertical ? Math.round(dy) : 0;
        tabEl.style.transform = `translate(${offsetX}px, ${offsetY}px)`;

        // Check if dragged tab crossed the midpoint of a sibling tab in the same group
        const container = this._getContainer();
        if (!container) return;

        const draggedRect = tabEl.getBoundingClientRect();
        const draggedCenter = isVertical
          ? (draggedRect.top + draggedRect.height / 2)
          : (draggedRect.left + draggedRect.width / 2);

        const sameGroupTabs = this.tabs.filter(t => (t.groupId || null) === (tab.groupId || null));
        const currentGroupIdx = sameGroupTabs.findIndex(t => t.id === tab.id);
        if (currentGroupIdx === -1) return;

        for (let i = 0; i < sameGroupTabs.length; i++) {
          if (i === currentGroupIdx) continue;
          const siblingTab = sameGroupTabs[i];
          const siblingEl = this.tabElements.get(siblingTab.id);
          if (!siblingEl) continue;

          const sibRect = siblingEl.getBoundingClientRect();
          const sibCenter = isVertical
            ? (sibRect.top + sibRect.height / 2)
            : (sibRect.left + sibRect.width / 2);

          const shouldSwap = (i < currentGroupIdx && draggedCenter < sibCenter)
            || (i > currentGroupIdx && draggedCenter > sibCenter);

          if (shouldSwap) {
            const beforeRects = this._capturePositions();
            const beforeSelfRect = tabEl.getBoundingClientRect();

            // Swap in this.tabs array
            const idxA = this.tabs.findIndex(t => t.id === tab.id);
            const idxB = this.tabs.findIndex(t => t.id === siblingTab.id);
            if (idxA !== -1 && idxB !== -1) {
              const temp = this.tabs[idxA];
              this.tabs[idxA] = this.tabs[idxB];
              this.tabs[idxB] = temp;
            }

            // Reorder DOM in place
            this.render();

            // Adjust anchor so the dragged tab stays locked under the cursor after DOM swap
            tabEl.style.transform = 'translate(0px, 0px)';
            const newLayoutRect = tabEl.getBoundingClientRect();
            anchorX += (newLayoutRect.left - (beforeSelfRect.left - offsetX));
            anchorY += (newLayoutRect.top - (beforeSelfRect.top - offsetY));

            const newDx = isVertical ? 0 : Math.round(moveEvent.clientX - anchorX);
            const newDy = isVertical ? Math.round(moveEvent.clientY - anchorY) : 0;
            tabEl.style.transform = `translate(${newDx}px, ${newDy}px)`;

            // Animate the swapped sibling smoothly into its new slot
            this._playFlip(beforeRects, null, tab.id);
            break;
          }
        }
      };

      const onPointerUp = (upEvent) => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        ghostEl?.classList.add('hidden');
        ghostEl?.classList.remove('merge-ready');
        tabEl.style.opacity = '';

        if (this.dragChannel) {
          try { this.dragChannel.postMessage({ type: 'TAB_DRAG_CLEAR', sourceWindowId: this.windowId }); } catch {}
        }

        if (isDragging) {
          try { tabEl.releasePointerCapture(upEvent.pointerId); } catch {}
          this.dragState = null;
          tabEl.classList.remove('tab-dragging');

          // Case 1: Dropped onto another Crown window's TAB BAR -> Merge tab into target window
          const validRemote = isDetachedDrag && this.remoteHoverTarget && (Date.now() - this.remoteHoverTarget.timestamp < 350);
          if (validRemote && this.dragChannel) {
            const targetWinId = this.remoteHoverTarget.targetWindowId;
            const insertIdx = this.remoteHoverTarget.insertIndex;
            this.remoteHoverTarget = null;

            this.dragChannel.postMessage({
              type: 'TAB_DRAG_DROP',
              sourceWindowId: this.windowId,
              targetWindowId: targetWinId,
              insertIndex: insertIdx,
              tabData: {
                url: tab.url,
                title: tab.title,
                pinned: tab.pinned
              }
            });

            if (this.tabs.length <= 1) {
              // Close this window since its last tab was merged into another window's tab bar
              window.close();
            } else {
              this.closeTab(tab.id);
            }
            return;
          }

          // Case 2: Torn off downward/outward outside any tab bar -> Open as a new Crown window!
          if (isDetachedDrag && this.tabs.length > 1) {
            const targetUrl = tab.url || 'crown://newtab';
            this.closeTab(tab.id);
            this.app?.openNewWindow?.(targetUrl, upEvent.screenX, upEvent.screenY);
            return;
          }

          tabEl.style.transition = 'transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)';
          tabEl.style.transform = 'translate(0px, 0px)';
          setTimeout(() => {
            tabEl.style.transition = '';
            tabEl.style.transform = '';
          }, 160);
        }
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    });
  }

  _showTabContextMenu(x, y, tab) {
    const menu = document.getElementById('tab-context-menu');
    if (!menu) return;

    let groupsHtml = '';
    if (this.groups.length > 0) {
      groupsHtml = `
        <div class="menu-divider"></div>
        <div class="menu-label">Add to Group:</div>
        ${this.groups.map(g => `
          <div class="menu-item" data-action="add-group" data-group-id="${this._escape(g.id)}">
            <span class="group-dot" style="background:${Storage.sanitizeColor(g.color)}"></span> ${this._escape(g.name)}
          </div>
        `).join('')}
      `;
    }

    const canHibernate = (tab.id !== this.activeTabId && !tab.hibernated && tab.url !== 'crown://newtab' && !tab.url.startsWith('crown://'));
    const isInSplit = Boolean(this.app && this.app.splitViewActive && (this.app.splitSecondaryTabId === tab.id || this.activeTabId === tab.id));
    const tabIdx = this.tabs.findIndex(t => t.id === tab.id);
    const hasRightTabs = tabIdx !== -1 && this.tabs.slice(tabIdx + 1).some(t => !t.pinned);
    const hasOtherTabs = this.tabs.some(t => t.id !== tab.id && !t.pinned);

    menu.innerHTML = `
      <div class="menu-item" data-action="pin">${tab.pinned ? 'Unpin Tab' : 'Pin Tab'}</div>
      <div class="menu-item" data-action="mute">${tab.muted ? 'Unmute Site / Tab' : 'Mute Site / Tab'}</div>
      <div class="menu-item" data-action="split-view">${isInSplit ? 'Exit Split View' : 'Open in Split View'}</div>
      ${this.tabs.length > 1 ? '<div class="menu-item" data-action="tear-off">Move Tab to New Window</div>' : ''}
      <div class="menu-divider"></div>
      <div class="menu-item" data-action="new-group">+ Add to New Group...</div>
      ${tab.groupId ? '<div class="menu-item" data-action="ungroup">Remove from Group</div>' : ''}
      ${groupsHtml}
      <div class="menu-divider"></div>
      ${canHibernate ? '<div class="menu-item" data-action="hibernate">Hibernate Tab</div>' : ''}
      <div class="menu-item" data-action="duplicate">Duplicate Tab</div>
      <div class="menu-item" data-action="inspect">Inspect (Ctrl+Shift+I)</div>
      <div class="menu-divider"></div>
      ${hasOtherTabs ? '<div class="menu-item" data-action="close-others">Close Other Tabs</div>' : ''}
      ${hasRightTabs ? '<div class="menu-item" data-action="close-right">Close Tabs to the Right</div>' : ''}
      <div class="menu-item danger" data-action="close">Close Tab</div>
    `;

    menu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 280)}px`;
    menu.classList.add('open');

    const handleAction = (e) => {
      const item = e.target.closest('.menu-item');
      if (!item) return;
      const action = item.dataset.action;

      if (action === 'pin') {
        const isNowPinned = this.togglePinTab(tab.id);
        this.app.showToast(isNowPinned ? 'Tab pinned' : 'Tab unpinned');
      } else if (action === 'mute') {
        const isNowMuted = this.toggleMuteTab(tab.id);
        this.app.showToast(isNowMuted ? 'Tab muted' : 'Tab unmuted');
      } else if (action === 'split-view') {
        if (this.app && typeof this.app.toggleSplitView === 'function') {
          this.app.toggleSplitView(tab.id);
        }
      } else if (action === 'tear-off') {
        if (this.tabs.length > 1) {
          const targetUrl = tab.url || 'crown://newtab';
          this.closeTab(tab.id);
          this.app?.openNewWindow?.(targetUrl);
        }
      } else if (action === 'new-group') {
        const defaultColor = GROUP_COLORS[this.groups.length % GROUP_COLORS.length].value;
        this.app.openTabGroupModal({
          title: 'New Tab Group',
          initialName: `Group ${this.groups.length + 1}`,
          initialColor: defaultColor,
          onSave: (name, color) => {
            const gid = this.createGroup(name, color);
            this.assignTabToGroup(tab.id, gid);
            this.app.showToast(`Created group "${name}"`);
          }
        });
      } else if (action === 'add-group') {
        this.assignTabToGroup(tab.id, item.dataset.groupId);
      } else if (action === 'ungroup') {
        this.removeTabFromGroup(tab.id);
      } else if (action === 'hibernate') {
        if (this.hibernateTab(tab.id)) {
          this.app.showToast('Tab hibernated — background memory freed');
        }
      } else if (action === 'duplicate') {
        this.createTab(tab.url, tab.isIncognito, tab.groupId);
      } else if (action === 'inspect') {
        if (this.activeTabId !== tab.id) {
          this.switchTab(tab.id);
        }
        if (this.app && typeof this.app.toggleDevTools === 'function') {
          this.app.toggleDevTools(true);
        }
      } else if (action === 'close-others') {
        const count = this.closeOtherTabs(tab.id);
        if (count > 0) this.app.showToast(`Closed ${count} other tab${count === 1 ? '' : 's'}`);
      } else if (action === 'close-right') {
        const count = this.closeTabsToRight(tab.id);
        if (count > 0) this.app.showToast(`Closed ${count} tab${count === 1 ? '' : 's'} to the right`);
      } else if (action === 'close') {
        this.closeTab(tab.id);
      }

      menu.classList.remove('open');
      document.removeEventListener('click', closeMenu);
    };

    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.classList.remove('open');
        document.removeEventListener('click', closeMenu);
      }
    };

    menu.onclick = handleAction;
    setTimeout(() => document.addEventListener('click', closeMenu), 50);
  }

  _showGroupContextMenu(x, y, group) {
    const menu = document.getElementById('tab-context-menu');
    if (!menu) return;

    menu.innerHTML = `
      <div class="menu-item" data-action="edit-group">Edit Group Name & Color...</div>
      <div class="menu-item" data-action="color-group">Cycle Color</div>
      <div class="menu-divider"></div>
      <div class="menu-item danger" data-action="delete-group">Delete Group</div>
    `;

    menu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
    menu.classList.add('open');

    const handleAction = (e) => {
      const item = e.target.closest('.menu-item');
      if (!item) return;
      const action = item.dataset.action;

      if (action === 'edit-group') {
        this.app.openTabGroupModal({
          title: 'Edit Tab Group',
          initialName: group.name,
          initialColor: group.color,
          onSave: (newName, newColor) => {
            group.name = newName;
            group.color = newColor;
            Storage.saveTabGroups(this.groups);
            this.render();
            this.app.showToast(`Updated group "${newName}"`);
          }
        });
      } else if (action === 'color-group') {
        const nextColor = GROUP_COLORS[(GROUP_COLORS.findIndex(c => c.value === group.color) + 1) % GROUP_COLORS.length].value;
        group.color = nextColor;
        Storage.saveTabGroups(this.groups);
        this.render();
      } else if (action === 'delete-group') {
        this.deleteGroup(group.id);
        this.app.showToast('Tab group removed');
      }

      menu.classList.remove('open');
    };

    menu.onclick = handleAction;
  }

  _bindContextMenu() {
    document.addEventListener('click', () => {
      document.getElementById('tab-context-menu')?.classList.remove('open');
    });
  }

  _getFaviconSvg(url, isIncognito, customFaviconUrl = null) {
    if (isIncognito) {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12h20"/><path d="m5 12 2-6h10l2 6"/><circle cx="7" cy="16" r="3"/><circle cx="17" cy="16" r="3"/><path d="M10 16h4"/></svg>`;
    }
    if (url === 'crown://newtab') {
      return `<svg width="14" height="14" viewBox="0 0 1024 1024"><polygon points="75,258 313,469 293,514 193,836" fill="#FBBF24"/><polygon points="293,514 351,659 392,836 193,836" fill="#EA580C"/><polygon points="511,188 336,515 511,466" fill="#F59E0B"/><polygon points="511,466 336,515 396,660 439,836 511,836" fill="#DC2626"/><polygon points="511,188 687,514 511,466" fill="#E11D48"/><polygon points="511,466 687,514 627,660 583,836 511,836" fill="#9F1239"/><polygon points="730,514 672,659 631,836 831,836" fill="#BE123C"/><polygon points="948,258 711,469 730,514 831,836" fill="#881337"/></svg>`;
    }
    if (url === 'crown://history') {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    }
    if (url === 'crown://bookmarks') {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
    }
    if (url === 'crown://settings' || (url && url.startsWith('crown://settings'))) {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    }
    if (url === 'crown://extensions') {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/></svg>`;
    }

    const globeSvg = `<svg class="tab-favicon-globe" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

    if (!url || !url.startsWith('http')) {
      return globeSvg;
    }

    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (!host) return globeSvg;

      const safeCustom = Storage.isSafeImageUrl(customFaviconUrl) ? customFaviconUrl : '';
      const iconUrl = safeCustom || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;

      return `<img class="tab-favicon-img" src="${this._escape(iconUrl)}" alt="" loading="lazy" />${globeSvg}`;
    } catch {
      return globeSvg;
    }
  }

  _extractDomain(url) {
    try {
      if (url === 'crown://newtab') return 'New Tab';
      if (url === 'crown://history') return 'History';
      if (url === 'crown://bookmarks') return 'Bookmarks';
      if (url === 'crown://settings' || url.startsWith('crown://settings')) return 'Settings';
      if (url === 'crown://extensions') return 'Extensions';
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return url;
    }
  }

  _escape(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
}
