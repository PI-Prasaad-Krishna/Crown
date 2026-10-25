// Crown Browser — Advanced Tab Engine (Tab Grouping & Vertical/Top Layouts)
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
  }

  init() {
    this.applyLayout(this.position);
    this._bindContextMenu();
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
    const headerEl = document.getElementById('crown-header');
    const sidebarContainer = document.getElementById('crown-vertical-sidebar');

    if (position === 'left') {
      appEl.classList.add('tabs-layout-left');
      appEl.classList.remove('tabs-layout-top');
      if (this.sidebarCollapsed) {
        appEl.classList.add('tabs-sidebar-compact');
      } else {
        appEl.classList.remove('tabs-sidebar-compact');
      }
    } else {
      appEl.classList.remove('tabs-layout-left', 'tabs-sidebar-compact');
      appEl.classList.add('tabs-layout-top');
    }
  }

  // Create Tab
  createTab(url = 'crown://newtab', isIncognito = false, groupId = null) {
    const id = `tab-${++this.tabCounter}`;
    const newTab = {
      id,
      url,
      title: url === 'crown://newtab' ? (isIncognito ? 'Incognito' : 'New Tab') : this._extractDomain(url),
      favicon: this._getFaviconSvg(url, isIncognito),
      history: [url],
      historyIndex: 0,
      groupId,
      isIncognito
    };

    this.tabs.push(newTab);
    this.app.createFrame(id);
    this.switchTab(id);
    this.app.navigateTo(url, id);
    this.render();
    return id;
  }

  closeTab(id, e) {
    if (e) e.stopPropagation();
    if (this.tabs.length <= 1) {
      this.app.navigateTo('crown://newtab', id);
      return;
    }

    const index = this.tabs.findIndex(t => t.id === id);
    if (index === -1) return;

    this.app.removeFrame(id);
    this.tabs.splice(index, 1);

    if (this.activeTabId === id) {
      const nextTab = this.tabs[index] || this.tabs[index - 1];
      this.switchTab(nextTab.id);
    } else {
      this.render();
    }
  }

  switchTab(id) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return;

    this.activeTabId = id;
    this.app.syncActiveTab(tab);
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
      tab.groupId = groupId;
      this.render();
    }
  }

  removeTabFromGroup(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.groupId = null;
      this.render();
    }
  }

  toggleGroupCollapse(groupId) {
    const group = this.groups.find(g => g.id === groupId);
    if (group) {
      group.collapsed = !group.collapsed;
      Storage.saveTabGroups(this.groups);
      this.render();
    }
  }

  deleteGroup(groupId) {
    this.groups = this.groups.filter(g => g.id !== groupId);
    this.tabs.forEach(t => {
      if (t.groupId === groupId) t.groupId = null;
    });
    Storage.saveTabGroups(this.groups);
    this.render();
  }

  // Render Tabs into Top bar or Left Sidebar
  render() {
    const targetContainer = this.position === 'left'
      ? document.getElementById('sidebar-tab-list')
      : document.getElementById('tab-bar');

    if (!targetContainer) return;
    targetContainer.innerHTML = '';

    // Group tabs by groups or unassigned
    const renderedGroupIds = new Set();

    // 1. Process group tabs and unassigned
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

    // Render unassigned tabs first (or order preserved)
    unassignedTabs.forEach(tab => {
      targetContainer.appendChild(this._createTabElement(tab));
    });

    // Render grouped tabs
    this.groups.forEach(group => {
      const gTabs = groupMap.get(group.id) || [];
      if (gTabs.length === 0 && this.position !== 'left') return; // hide empty groups in top bar

      // Group Header Pill
      const pill = document.createElement('div');
      pill.className = `tab-group-pill ${group.collapsed ? 'collapsed' : ''}`;
      pill.style.setProperty('--group-color', group.color);
      pill.innerHTML = `
        <span class="group-dot" style="background-color: ${group.color}"></span>
        <span class="group-label">${this._escape(group.name)}</span>
        <span class="group-chevron">${group.collapsed ? '▶' : '▼'}</span>
      `;
      pill.onclick = (e) => {
        e.stopPropagation();
        this.toggleGroupCollapse(group.id);
      };

      // Right click group pill
      pill.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._showGroupContextMenu(e.clientX, e.clientY, group);
      };

      targetContainer.appendChild(pill);

      // Render group tabs if not collapsed
      if (!group.collapsed) {
        gTabs.forEach(tab => {
          targetContainer.appendChild(this._createTabElement(tab, group.color));
        });
      }
    });

    // New Tab Button
    const newBtn = document.createElement('button');
    newBtn.className = 'new-tab-btn';
    newBtn.title = 'New tab (Ctrl+T)';
    newBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      ${this.position === 'left' && !this.sidebarCollapsed ? '<span>New Tab</span>' : ''}
    `;
    newBtn.onclick = () => this.createTab('crown://newtab');
    targetContainer.appendChild(newBtn);
  }

  _createTabElement(tab, groupColor = null) {
    const tabEl = document.createElement('div');
    const isActive = tab.id === this.activeTabId;
    tabEl.className = `browser-tab ${isActive ? 'active' : ''} ${tab.isIncognito ? 'incognito' : ''}`;
    tabEl.dataset.tabId = tab.id;

    if (groupColor) {
      tabEl.style.setProperty('--tab-group-color', groupColor);
      tabEl.classList.add('has-group-color');
    }

    tabEl.onclick = () => this.switchTab(tab.id);

    tabEl.innerHTML = `
      <span class="tab-favicon">${tab.favicon}</span>
      <span class="tab-title">${this._escape(tab.title)}</span>
      <button class="tab-close-btn" title="Close tab">✕</button>
    `;

    tabEl.querySelector('.tab-close-btn').onclick = (e) => this.closeTab(tab.id, e);

    tabEl.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showTabContextMenu(e.clientX, e.clientY, tab);
    };

    return tabEl;
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
          <div class="menu-item" data-action="add-group" data-group-id="${g.id}">
            <span class="group-dot" style="background:${g.color}"></span> ${this._escape(g.name)}
          </div>
        `).join('')}
      `;
    }

    menu.innerHTML = `
      <div class="menu-item" data-action="new-group">+ Add to New Group...</div>
      ${tab.groupId ? '<div class="menu-item" data-action="ungroup">Remove from Group</div>' : ''}
      ${groupsHtml}
      <div class="menu-divider"></div>
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
