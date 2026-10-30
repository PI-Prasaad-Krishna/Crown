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
  }

  init() {
    this.applyLayout(this.position);
    this._bindContextMenu();
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
  createTab(url = 'crown://newtab', isIncognito = false, groupId = null) {
    const effectiveIncognito = Boolean(this.isIncognitoWindow || isIncognito);
    const beforeRects = this._capturePositions();
    const id = `tab-${++this.tabCounter}`;
    const newTab = {
      id,
      url,
      title: url === 'crown://newtab' ? (effectiveIncognito ? 'Incognito' : 'New Tab') : this._extractDomain(url),
      favicon: this._getFaviconSvg(url, effectiveIncognito),
      history: [url],
      historyIndex: 0,
      groupId,
      isIncognito: effectiveIncognito,
      hibernated: false,
      lastActiveAt: Date.now()
    };

    this.tabs.push(newTab);
    this.activeTabId = id;
    this.app.createFrame(id);
    this.app.navigateTo(url, id);
    this.enforceMemoryBudget();
    this._playFlip(beforeRects, id);
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

  // Keep at most maxLiveTabs (default 1 in Low-RAM mode) live webview frames in memory
  enforceMemoryBudget() {
    const settings = Storage.getSettings();
    if (settings.memorySaverMode === false) return;

    const maxLive = Math.max(1, Number(settings.maxLiveTabs) || 1);
    const liveWebTabs = this.tabs.filter(t =>
      !t.hibernated &&
      t.url !== 'crown://newtab' &&
      !t.url.startsWith('crown://') &&
      this.app.frames.has(t.id)
    );

    if (liveWebTabs.length <= maxLive) return;

    // Sort non-active live web tabs oldest-first and hibernate excess tabs
    const candidates = liveWebTabs
      .filter(t => t.id !== this.activeTabId)
      .sort((a, b) => (a.lastActiveAt || 0) - (b.lastActiveAt || 0));

    const excessCount = liveWebTabs.length - maxLive;
    for (let i = 0; i < excessCount && i < candidates.length; i++) {
      this.app.removeFrame(candidates[i].id);
      candidates[i].hibernated = true;
    }

    this.render();
    this.app.renderDefenseHub();
  }

  // Reset tabs and groups cleanly when switching user profiles (0 MB overhead multi-profile)
  resetForProfileSwitch() {
    this.tabs.forEach(t => this.app.removeFrame(t.id));
    this.tabElements.forEach(el => el.remove());
    this.tabElements.clear();
    this.tabs = [];
    this.activeTabId = null;
    this.groups = Storage.getTabGroups();
    this.groupCounter = this.groups.length;
    this.position = Storage.getSettings().tabPosition || 'top';
    this.sidebarCollapsed = Storage.getSettings().verticalCollapsed || false;
    this.applyLayout(this.position);
    this.createTab('crown://newtab', this.isIncognitoWindow);
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

    const beforeRects = this._capturePositions();
    const isClosingActive = (this.activeTabId === id);

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
    this.render();
  }

  getActiveTab() {
    return this.tabs.find(t => t.id === this.activeTabId);
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
  }

  _getOrUpdateTabElement(tab, groupColor = null) {
    let tabEl = this.tabElements.get(tab.id);
    if (!tabEl) {
      tabEl = document.createElement('div');
      tabEl.dataset.tabId = tab.id;
      tabEl.innerHTML = `
        <span class="tab-favicon"></span>
        <span class="tab-title"></span>
        <button class="tab-close-btn" title="Close tab">✕</button>
      `;

      tabEl.querySelector('.tab-close-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(tab.id, e);
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
    const isDragging = this.dragState && this.dragState.tab.id === tab.id;
    tabEl.className = `browser-tab ${isActive ? 'active' : ''} ${tab.isIncognito ? 'incognito' : ''} ${tab.hibernated ? 'tab-sleeping' : ''} ${groupColor ? 'has-group-color' : ''} ${isDragging ? 'tab-dragging' : ''}`.trim();
    tabEl.title = tab.hibernated ? `${tab.title} — Hibernated (RAM Freed)` : tab.title;

    if (groupColor) {
      tabEl.style.setProperty('--tab-group-color', groupColor);
    } else {
      tabEl.style.removeProperty('--tab-group-color');
    }

    const favEl = tabEl.querySelector('.tab-favicon');
    if (favEl && favEl._lastFavicon !== tab.favicon) {
      favEl.innerHTML = tab.favicon;
      favEl._lastFavicon = tab.favicon;
    }

    const titleEl = tabEl.querySelector('.tab-title');
    const displayTitle = tab.hibernated ? `💤 ${tab.title}` : tab.title;
    if (titleEl && titleEl.textContent !== displayTitle) {
      titleEl.textContent = displayTitle;
    }

    return tabEl;
  }

  // Pointer-Driven Drag-and-Drop Tab Reordering (Supports both Horizontal Top & Vertical Left Sidebar)
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
      let anchorX = startX;
      let anchorY = startY;

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

        if (isDragging) {
          try { tabEl.releasePointerCapture(upEvent.pointerId); } catch {}
          this.dragState = null;
          tabEl.classList.remove('tab-dragging');
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

    menu.innerHTML = `
      <div class="menu-item" data-action="new-group">+ Add to New Group...</div>
      ${tab.groupId ? '<div class="menu-item" data-action="ungroup">Remove from Group</div>' : ''}
      ${groupsHtml}
      <div class="menu-divider"></div>
      ${canHibernate ? '<div class="menu-item" data-action="hibernate">💤 Hibernate Tab (Free RAM)</div>' : ''}
      <div class="menu-item" data-action="duplicate">Duplicate Tab</div>
      <div class="menu-item danger" data-action="close">Close Tab</div>
    `;

    menu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 250)}px`;
    menu.classList.add('open');

    const handleAction = (e) => {
      const item = e.target.closest('.menu-item');
      if (!item) return;
      const action = item.dataset.action;

      if (action === 'new-group') {
        const name = prompt('Enter Group Name:', 'New Group');
        if (name) {
          const color = GROUP_COLORS[this.groups.length % GROUP_COLORS.length].value;
          const gid = this.createGroup(name, color);
          this.assignTabToGroup(tab.id, gid);
        }
      } else if (action === 'add-group') {
        this.assignTabToGroup(tab.id, item.dataset.groupId);
      } else if (action === 'ungroup') {
        this.removeTabFromGroup(tab.id);
      } else if (action === 'hibernate') {
        this.hibernateTab(tab.id);
      } else if (action === 'duplicate') {
        this.createTab(tab.url, tab.isIncognito, tab.groupId);
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
      <div class="menu-item" data-action="rename-group">Rename Group</div>
      <div class="menu-item" data-action="color-group">Change Color</div>
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

      if (action === 'rename-group') {
        const newName = prompt('New group name:', group.name);
        if (newName) {
          group.name = newName;
          Storage.saveTabGroups(this.groups);
          this.render();
        }
      } else if (action === 'color-group') {
        const nextColor = GROUP_COLORS[(GROUP_COLORS.findIndex(c => c.value === group.color) + 1) % GROUP_COLORS.length].value;
        group.color = nextColor;
        Storage.saveTabGroups(this.groups);
        this.render();
      } else if (action === 'delete-group') {
        this.deleteGroup(group.id);
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

  _getFaviconSvg(url, isIncognito) {
    if (isIncognito) {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12h20"/><circle cx="7" cy="16" r="3"/><circle cx="17" cy="16" r="3"/><path d="M10 16h4"/></svg>`;
    }
    if (url === 'crown://newtab') {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/></svg>`;
    }
    if (url === 'crown://history') {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    }
    if (url === 'crown://bookmarks') {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
    }
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  }

  _extractDomain(url) {
    try {
      if (url === 'crown://newtab') return 'New Tab';
      if (url === 'crown://history') return 'History';
      if (url === 'crown://bookmarks') return 'Bookmarks';
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
