// Crown Browser — Internal Pages Engine (crown://history, crown://bookmarks)
import { Storage } from './storage.js';

export const InternalViews = {
  // Check if a URL is an internal Crown URL
  isInternalUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase().trim();
    return lower.startsWith('crown://');
  },

  // Get the route name from internal URL (e.g. 'history', 'bookmarks', 'settings', 'extensions', 'newtab')
  getRoute(url) {
    if (!url) return '';
    const clean = url.replace(/^crown:\/\//i, '').replace(/\/$/, '').toLowerCase();
    if (clean.startsWith('settings')) return 'settings';
    return clean || 'newtab';
  },

  // Render the internal view into the container element
  render(container, url, onNavigate) {
    const route = this.getRoute(url);
    container.innerHTML = '';
    container.className = 'internal-view-container';

    switch (route) {
      case 'history':
        this.renderHistory(container, onNavigate);
        break;
      case 'bookmarks':
        this.renderBookmarks(container, onNavigate);
        break;
      case 'settings': {
        const hashIdx = (url || '').indexOf('#');
        const section = hashIdx !== -1 ? url.slice(hashIdx + 1).toLowerCase() : 'system';
        this.renderSettings(container, onNavigate, section || 'system');
        break;
      }
      case 'extensions':
        this.renderSettings(container, onNavigate, 'extensions');
        break;
      default:
        container.innerHTML = `
          <div class="internal-error-view">
            <h2>Page not found</h2>
            <p>The internal page <code>${this._escape(url)}</code> does not exist.</p>
          </div>
        `;
        break;
    }
  },

  // Render crown://history
  renderHistory(container, onNavigate) {
    const history = Storage.getHistory();

    container.innerHTML = `
      <div class="internal-page-layout">
        <div class="internal-page-sidebar">
          <div class="internal-sidebar-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <h2>History</h2>
          </div>
          <button class="internal-danger-btn" id="clear-all-history-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Clear Browsing Data
          </button>
        </div>

        <div class="internal-page-main">
          <div class="internal-search-bar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" id="history-search-input" placeholder="Search history..." />
          </div>

          <div class="history-list" id="history-items-list">
            <!-- Dynamically populated -->
          </div>
        </div>
      </div>
    `;

    const listEl = container.querySelector('#history-items-list');
    const searchInput = container.querySelector('#history-search-input');
    const clearBtn = container.querySelector('#clear-all-history-btn');

    const renderList = (filter = '') => {
      listEl.innerHTML = '';
      const currentHistory = Storage.getHistory();
      const filtered = currentHistory.filter(item => 
        (item.title || '').toLowerCase().includes(filter.toLowerCase()) || 
        (item.url || '').toLowerCase().includes(filter.toLowerCase())
      );

      if (filtered.length === 0) {
        listEl.innerHTML = `
          <div class="empty-state-notice">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <p>${filter ? 'No history matching your search.' : 'Your browsing history is clean and empty.'}</p>
          </div>
        `;
        return;
      }

      // Group by Date
      const groups = this._groupByDate(filtered);
      for (const [dateLabel, items] of Object.entries(groups)) {
        const groupEl = document.createElement('div');
        groupEl.className = 'history-date-group';
        groupEl.innerHTML = `<h3 class="history-date-heading">${dateLabel}</h3>`;

        items.forEach(item => {
          const row = document.createElement('div');
          row.className = 'history-item-row';
          const time = new Date(item.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          row.innerHTML = `
            <span class="history-item-time">${time}</span>
            <div class="history-item-info">
              <span class="history-item-title">${this._escape(item.title || item.url)}</span>
              <span class="history-item-url">${this._escape(item.url)}</span>
            </div>
            <div class="history-item-actions">
              <button class="history-action-btn delete-btn" title="Remove from history">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          `;

          const infoEl = row.querySelector('.history-item-info');
          infoEl.onclick = (e) => {
            if (e.ctrlKey || e.metaKey) {
              window.crown?.tabEngine?.createTab(item.url);
            } else {
              onNavigate(item.url);
            }
          };
          infoEl.addEventListener('auxclick', (e) => {
            if (e.button === 1) {
              e.preventDefault();
              e.stopPropagation();
              window.crown?.tabEngine?.createTab(item.url);
            }
          });
          row.querySelector('.delete-btn').onclick = (e) => {
            e.stopPropagation();
            this._deleteHistoryItem(item.timestamp);
            row.remove();
          };

          groupEl.appendChild(row);
        });

        listEl.appendChild(groupEl);
      }
    };

    searchInput.addEventListener('input', (e) => renderList(e.target.value.trim()));
    clearBtn.addEventListener('click', () => {
      if (window.crown && typeof window.crown.openClearDataModal === 'function') {
        window.crown.openClearDataModal(() => renderList(searchInput.value.trim()));
      } else {
        Storage.clearHistory();
        renderList(searchInput.value.trim());
      }
    });

    renderList();
  },

  // Render crown://bookmarks
  renderBookmarks(container, onNavigate) {
    const bookmarks = Storage.getBookmarks();

    container.innerHTML = `
      <div class="internal-page-layout">
        <div class="internal-page-sidebar">
          <div class="internal-sidebar-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            <h2>Bookmarks</h2>
          </div>
          <button class="internal-primary-btn" id="add-bookmark-modal-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Bookmark
          </button>
          <button class="internal-secondary-btn" id="export-bookmarks-btn" style="margin-top:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export to JSON
          </button>
          <button class="internal-secondary-btn" id="import-bookmarks-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Import JSON
          </button>
          <input type="file" id="import-bookmarks-file" accept=".json,application/json" style="display:none;" />
        </div>

        <div class="internal-page-main">
          <div class="internal-search-bar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" id="bookmarks-search-input" placeholder="Search bookmarks..." />
          </div>

          <div class="bookmarks-grid" id="bookmarks-items-grid">
            <!-- Dynamically populated -->
          </div>
        </div>
      </div>
    `;

    const gridEl = container.querySelector('#bookmarks-items-grid');
    const searchInput = container.querySelector('#bookmarks-search-input');
    const addBtn = container.querySelector('#add-bookmark-modal-btn');

    const renderGrid = (filter = '') => {
      gridEl.innerHTML = '';
      const currentList = Storage.getBookmarks();
      const filtered = currentList.filter(item => 
        (item.title || '').toLowerCase().includes(filter.toLowerCase()) || 
        (item.url || '').toLowerCase().includes(filter.toLowerCase())
      );

      if (filtered.length === 0) {
        gridEl.innerHTML = `
          <div class="empty-state-notice">
            <p>No bookmarks found.</p>
          </div>
        `;
        return;
      }

      filtered.forEach(bm => {
        const card = document.createElement('div');
        card.className = 'bookmark-card';
        card.innerHTML = `
          <div class="bookmark-card-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div class="bookmark-card-body">
            <div class="bookmark-card-title">${this._escape(bm.title)}</div>
            <div class="bookmark-card-url">${this._escape(bm.url)}</div>
          </div>
          <button class="bookmark-card-delete" title="Delete bookmark">✕</button>
        `;

        card.onclick = (e) => {
          if (e.ctrlKey || e.metaKey) {
            window.crown?.tabEngine?.createTab(bm.url);
          } else {
            onNavigate(bm.url);
          }
        };
        card.addEventListener('auxclick', (e) => {
          if (e.button === 1 && !e.target.closest('.bookmark-card-delete')) {
            e.preventDefault();
            e.stopPropagation();
            window.crown?.tabEngine?.createTab(bm.url);
          }
        });
        card.querySelector('.bookmark-card-delete').onclick = (e) => {
          e.stopPropagation();
          this._deleteBookmark(bm.id || bm.url);
          card.remove();
        };

        gridEl.appendChild(card);
      });
    };

    searchInput.addEventListener('input', (e) => renderGrid(e.target.value.trim()));
    addBtn.addEventListener('click', () => {
      if (window.crown && typeof window.crown.openBookmarkModal === 'function') {
        window.crown.openBookmarkModal('', 'https://', () => renderGrid(searchInput.value.trim()));
      }
    });

    const exportBtn = container.querySelector('#export-bookmarks-btn');
    const importBtn = container.querySelector('#import-bookmarks-btn');
    const importFileInput = container.querySelector('#import-bookmarks-file');

    exportBtn?.addEventListener('click', () => {
      const data = {
        app: 'Crown Browser',
        version: 1,
        exportedAt: new Date().toISOString(),
        bookmarks: Storage.getBookmarks()
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `crown-bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      window.crown?.showToast('Exported bookmarks to JSON file');
    });

    importBtn?.addEventListener('click', () => {
      importFileInput?.click();
    });

    importFileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          const incoming = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.bookmarks) ? parsed.bookmarks : []);
          if (!incoming.length) {
            window.crown?.showToast('No bookmarks found in file', 'error');
            return;
          }
          const current = Storage.getBookmarks();
          const existingUrls = new Set(current.map(b => b.url));
          let addedCount = 0;
          for (const item of incoming) {
            if (item && item.url && Storage.isSafeUrl(item.url) && !existingUrls.has(item.url)) {
              current.push({
                id: `bm-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                title: item.title || item.url,
                url: item.url
              });
              existingUrls.add(item.url);
              addedCount++;
            }
          }
          Storage.saveBookmarks(current);
          renderGrid(searchInput.value.trim());
          window.crown?.showToast(`Imported ${addedCount} new bookmark${addedCount === 1 ? '' : 's'}`);
        } catch {
          window.crown?.showToast('Failed to parse bookmarks file', 'error');
        }
      };
      reader.readAsText(file);
      importFileInput.value = '';
    });

    renderGrid();
  },

  // Render crown://settings & crown://extensions (Full Brave-style Settings Suite)
  renderSettings(container, onNavigate, initialSection = 'system') {
    let activeSection = initialSection || 'system';
    const validSections = new Set([
      'system', 'appearance', 'shields', 'search', 'extensions',
      'languages', 'downloads', 'accessibility', 'reset', 'about'
    ]);
    if (!validSections.has(activeSection)) activeSection = 'system';

    container.innerHTML = `
      <div class="crown-settings-shell">
        <aside class="crown-settings-sidebar">
          <div class="crown-settings-brand">
            <img src="./favicon.svg" width="18" height="18" alt="Crown" style="vertical-align:middle;margin-right:8px;" />
            <span>Settings</span>
          </div>

          <nav class="crown-settings-nav" id="settings-sidebar-nav">
            <button class="settings-nav-item" data-section="appearance">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
              <span>Appearance</span>
            </button>
            <button class="settings-nav-item" data-section="shields">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span>Shields &amp; privacy</span>
            </button>
            <button class="settings-nav-item" data-section="search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <span>Search engine</span>
            </button>
            <button class="settings-nav-item" data-section="extensions">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/></svg>
              <span>Extensions</span>
            </button>

            <div class="settings-nav-divider"></div>

            <button class="settings-nav-item" data-section="languages">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>
              <span>Languages</span>
            </button>
            <button class="settings-nav-item" data-section="downloads">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Downloads</span>
            </button>
            <button class="settings-nav-item" data-section="accessibility">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="7" r="1" fill="currentColor"/><path d="M9 11h6"/><path d="m10 17 2-5 2 5"/></svg>
              <span>Accessibility</span>
            </button>
            <button class="settings-nav-item" data-section="system">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              <span>System</span>
            </button>
            <button class="settings-nav-item" data-section="reset">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              <span>Reset settings</span>
            </button>
          </nav>

          <div class="crown-settings-sidebar-footer">
            <button class="settings-nav-item settings-about-btn" data-section="about">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <div class="settings-about-meta">
                <span>About Crown</span>
                <small>v1.0.0</small>
              </div>
            </button>
          </div>
        </aside>

        <div class="crown-settings-main">
          <header class="crown-settings-topbar">
            <div class="crown-settings-search-box">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input type="text" id="settings-search-input" placeholder="Search settings" autocomplete="off" />
            </div>
          </header>

          <div class="crown-settings-content" id="settings-sections-root">
            <!-- Populated dynamically -->
          </div>
        </div>
      </div>
    `;

    const rootEl = container.querySelector('#settings-sections-root');
    const searchInput = container.querySelector('#settings-search-input');
    const navButtons = container.querySelectorAll('.settings-nav-item');

    const updateSidebarActive = () => {
      navButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === activeSection);
      });
    };

    const renderAllSections = (searchFilter = '') => {
      const s = Storage.getSettings();
      const exts = Storage.getExtensions();
      const whitelist = Array.isArray(s.memoryWhitelist) ? s.memoryWhitelist : [];
      const q = searchFilter.trim().toLowerCase();
      const liveTabsCount = window.crown?.tabEngine ? window.crown.tabEngine.tabs.filter(t => !t.hibernated).length : 1;
      const hibernatedCount = window.crown?.tabEngine ? window.crown.tabEngine.tabs.filter(t => t.hibernated).length : 0;

      rootEl.innerHTML = `
        <!-- SYSTEM SECTION (Memory Saver & Power) -->
        <section class="settings-section-block" data-section-id="system" data-keywords="system memory saver ram hibernate maximum balanced moderate whitelist sites active power energy battery unplugged hardware acceleration">
          <h2 class="settings-section-heading">Memory</h2>
          <div class="settings-card">
            <div class="settings-row settings-row-top">
              <div class="settings-row-info">
                <div class="settings-row-title" style="display:flex;align-items:center;gap:8px;">
                  <span>Memory Saver</span>
                  <span class="settings-badge-pill" id="memory-live-status-pill">${liveTabsCount} live • ${hibernatedCount} hibernated</span>
                </div>
                <div class="settings-row-desc">
                  Crown frees up memory from inactive tabs. This gives active tabs and other apps more computer resources and keeps Crown fast. Your inactive tabs automatically become active again when you go back to them.
                </div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-memory-saver-toggle" ${s.memorySaverMode !== false ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="settings-radio-group ${s.memorySaverMode === false ? 'disabled-group' : ''}" id="memory-saver-levels-group">
              <label class="settings-radio-option">
                <input type="radio" name="memorySaverLevel" value="moderate" ${s.memorySaverLevel === 'moderate' ? 'checked' : ''} />
                <div class="settings-radio-text">
                  <div class="settings-radio-title">Moderate</div>
                  <div class="settings-radio-desc">Get moderate memory savings. Your tabs become inactive after a longer period of time (keeps up to 5 live tabs).</div>
                </div>
              </label>
              <label class="settings-radio-option">
                <input type="radio" name="memorySaverLevel" value="balanced" ${s.memorySaverLevel === 'balanced' ? 'checked' : ''} />
                <div class="settings-radio-text">
                  <div class="settings-radio-title">Balanced (recommended)</div>
                  <div class="settings-radio-desc">Get balanced memory savings. Your tabs become inactive after an optimal period of time (keeps up to 2 live tabs).</div>
                </div>
              </label>
              <label class="settings-radio-option">
                <input type="radio" name="memorySaverLevel" value="maximum" ${(!s.memorySaverLevel || s.memorySaverLevel === 'maximum') ? 'checked' : ''} />
                <div class="settings-radio-text">
                  <div class="settings-radio-title">Maximum</div>
                  <div class="settings-radio-desc">Get maximum memory savings (&lt;100 MB RAM target). Background tabs unload immediately when you switch away.</div>
                </div>
              </label>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Always keep these sites active</div>
                <div class="settings-row-desc">Sites you add here will stay active in memory and won't hibernate in the background.</div>
              </div>
              <button class="settings-outline-btn" id="open-add-whitelist-btn">Add</button>
            </div>

            <div class="settings-inline-form hidden" id="add-whitelist-form">
              <input type="text" id="whitelist-domain-input" class="settings-text-input" placeholder="e.g. github.com or docs.google.com" />
              <button class="settings-gold-btn" id="confirm-add-whitelist-btn">Add site</button>
              <button class="settings-outline-btn" id="cancel-add-whitelist-btn">Cancel</button>
            </div>

            <div class="settings-whitelist-list" id="memory-whitelist-container">
              ${whitelist.length === 0
                ? `<div class="settings-empty-subtext">No sites added</div>`
                : whitelist.map(domain => `
                  <div class="settings-whitelist-pill">
                    <span>${this._escape(domain)}</span>
                    <button class="whitelist-remove-btn" data-domain="${this._escape(domain)}" title="Remove site">✕</button>
                  </div>
                `).join('')}
            </div>
          </div>

          <h2 class="settings-section-heading">Power</h2>
          <div class="settings-card">
            <div class="settings-row settings-row-top">
              <div class="settings-row-info">
                <div class="settings-row-title">Energy Saver</div>
                <div class="settings-row-desc">
                  Crown conserves battery power by limiting background activity and visual effects, such as smooth scrolling and decorative animations.
                </div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-energy-saver-toggle" ${s.energySaver ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="settings-radio-group ${!s.energySaver ? 'disabled-group' : ''}" id="energy-saver-modes-group">
              <label class="settings-radio-option">
                <input type="radio" name="energySaverMode" value="battery_20" ${(!s.energySaverMode || s.energySaverMode === 'battery_20') ? 'checked' : ''} />
                <div class="settings-radio-text">
                  <div class="settings-radio-title">Turn on only when your battery is at 20% or lower</div>
                </div>
              </label>
              <label class="settings-radio-option">
                <input type="radio" name="energySaverMode" value="unplugged" ${s.energySaverMode === 'unplugged' ? 'checked' : ''} />
                <div class="settings-radio-text">
                  <div class="settings-radio-title">Turn on when your computer is unplugged</div>
                </div>
              </label>
              <label class="settings-radio-option">
                <input type="radio" name="energySaverMode" value="always" ${s.energySaverMode === 'always' ? 'checked' : ''} />
                <div class="settings-radio-text">
                  <div class="settings-radio-title">Always keep Energy Saver active</div>
                </div>
              </label>
            </div>
          </div>

          <h2 class="settings-section-heading">System</h2>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Use graphics acceleration when available</div>
                <div class="settings-row-desc">Offloads compositing and WebView rendering to the system GPU for smoother scrolling.</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-hw-accel-toggle" ${s.hardwareAcceleration !== false ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </section>

        <!-- APPEARANCE SECTION -->
        <section class="settings-section-block" data-section-id="appearance" data-keywords="appearance theme accent color wallpaper tab bar layout horizontal vertical bookmarks bar zoom">
          <h2 class="settings-section-heading">Appearance</h2>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Tab Bar Layout</div>
                <div class="settings-row-desc">Choose between a classic horizontal tab strip or a collapsible vertical sidebar.</div>
              </div>
              <select class="settings-select" id="set-tab-layout-select">
                <option value="top" ${s.tabPosition !== 'left' ? 'selected' : ''}>Horizontal Top Bar</option>
                <option value="left" ${s.tabPosition === 'left' ? 'selected' : ''}>Vertical Left Sidebar</option>
              </select>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Browser Accent Color</div>
                <div class="settings-row-desc">Select the primary highlight accent used across tabs, badges, and controls.</div>
              </div>
              <div class="color-swatch-row" id="set-accent-swatch-row">
                <button class="color-swatch ${(!s.accentColor || s.accentColor === '#e6ca85' || s.accentColor === '#d4af37') ? 'active' : ''}" data-color="#e6ca85" style="background:#e6ca85" title="Crown Gold"></button>
                <button class="color-swatch ${s.accentColor === '#38bdf8' ? 'active' : ''}" data-color="#38bdf8" style="background:#38bdf8" title="Royal Cyan"></button>
                <button class="color-swatch ${s.accentColor === '#a855f7' ? 'active' : ''}" data-color="#a855f7" style="background:#a855f7" title="Imperial Violet"></button>
                <button class="color-swatch ${s.accentColor === '#10b981' ? 'active' : ''}" data-color="#10b981" style="background:#10b981" title="Emerald Shield"></button>
                <button class="color-swatch ${s.accentColor === '#f43f5e' ? 'active' : ''}" data-color="#f43f5e" style="background:#f43f5e" title="Crimson Rose"></button>
              </div>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">New Tab Hub Backdrop</div>
                <div class="settings-row-desc">Customize the atmosphere of your New Tab Hub.</div>
              </div>
              <select class="settings-select" id="set-wallpaper-select">
                <option value="obsidian" ${(!s.wallpaper || s.wallpaper === 'obsidian') ? 'selected' : ''}>Obsidian Gold</option>
                <option value="midnight" ${s.wallpaper === 'midnight' ? 'selected' : ''}>Midnight Nebula</option>
                <option value="aurora" ${s.wallpaper === 'aurora' ? 'selected' : ''}>Emerald Aurora</option>
                <option value="crimson" ${s.wallpaper === 'crimson' ? 'selected' : ''}>Crimson Dusk</option>
                <option value="minimal" ${s.wallpaper === 'minimal' ? 'selected' : ''}>Pure Minimalist Matte</option>
                <option value="custom" ${s.wallpaper === 'custom' ? 'selected' : ''}>Custom Image / Wallpaper</option>
              </select>
            </div>

            <div class="settings-inline-form ${s.wallpaper === 'custom' ? '' : 'hidden'}" id="set-custom-wallpaper-row">
              <input type="text" id="set-custom-bg-url" class="settings-text-input" value="${this._escape(s.customBackground?.startsWith('data:') ? '' : (s.customBackground || ''))}" placeholder="Paste HTTPS image URL or upload local image..." />
              <button class="settings-gold-btn" id="set-apply-custom-bg-btn">Apply URL</button>
              <label class="settings-outline-btn" style="cursor:pointer;margin:0;">
                Upload Image
                <input type="file" id="set-upload-custom-bg-file" accept="image/*" class="hidden" />
              </label>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Show Bookmarks Bar</div>
                <div class="settings-row-desc">Display your saved bookmarks directly beneath the address bar.</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-bookmarks-bar-toggle" ${s.showBookmarksBar !== false ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Default Page Zoom</div>
                <div class="settings-row-desc">Set the default zoom level for web pages and internal views.</div>
              </div>
              <select class="settings-select" id="set-page-zoom-select">
                ${[75, 90, 100, 110, 125, 150].map(z => `<option value="${z}" ${(Number(s.pageZoom) || 100) === z ? 'selected' : ''}>${z}%</option>`).join('')}
              </select>
            </div>
          </div>
        </section>

        <!-- SHIELDS & PRIVACY SECTION -->
        <section class="settings-section-block" data-section-id="shields" data-keywords="shields privacy security adblock tracker cookie banners https upgrade gpc do not track clear browsing data">
          <h2 class="settings-section-heading">Shields &amp; Privacy</h2>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Crown Shield Ad &amp; Tracker Blocking</div>
                <div class="settings-row-desc">Block third-party ad networks, telemetry collectors, and fingerprinting scripts in Rust before pages render.</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-shield-enabled-toggle" ${s.shieldsEnabled !== false ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Strip URL Tracking Parameters</div>
                <div class="settings-row-desc">Automatically remove utm_*, fbclid, gclid, and 20+ tracking tokens from URLs when navigating.</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-strip-params-toggle" ${s.stripQueryParams !== false ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Hide Cookie Consent Popups &amp; Ad Slots</div>
                <div class="settings-row-desc">Inject cosmetic CSS rules to collapse intrusive GDPR cookie banners and empty ad placeholders.</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-cosmetic-toggle" ${s.blockCookieNotices !== false ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">HTTPS-Only Mode</div>
                <div class="settings-row-desc">Automatically upgrade standard links and address bar navigations to encrypted HTTPS connections.</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-https-only-toggle" ${s.httpsEverywhere !== false ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Send "Do Not Track" &amp; Global Privacy Control (Sec-GPC: 1)</div>
                <div class="settings-row-desc">Attach DNT: 1 and Sec-GPC: 1 headers to outgoing HTTP requests to opt out of data sale/sharing.</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-send-gpc-toggle" ${s.sendGpc !== false ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Clear Browsing Data</div>
                <div class="settings-row-desc">Wipe browsing history, download records, or reset shield telemetry counters.</div>
              </div>
              <button class="settings-outline-btn" id="set-clear-browsing-data-btn">Clear data...</button>
            </div>
          </div>
        </section>

        <!-- SEARCH ENGINE SECTION -->
        <section class="settings-section-block" data-section-id="search" data-keywords="search engine omnibox address bar duckduckgo google brave bing startpage ecosia autocomplete">
          <h2 class="settings-section-heading">Search Engine</h2>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Search engine used in the address bar</div>
                <div class="settings-row-desc">Also powers live OpenSearch autocomplete suggestions in the Omnibox and New Tab Hub.</div>
              </div>
              <select class="settings-select" id="set-search-engine-select">
                <option value="duckduckgo" ${(!s.searchEngine || s.searchEngine === 'duckduckgo') ? 'selected' : ''}>DuckDuckGo (Private)</option>
                <option value="google" ${s.searchEngine === 'google' ? 'selected' : ''}>Google</option>
                <option value="brave" ${s.searchEngine === 'brave' ? 'selected' : ''}>Brave Search</option>
                <option value="bing" ${s.searchEngine === 'bing' ? 'selected' : ''}>Microsoft Bing</option>
                <option value="startpage" ${s.searchEngine === 'startpage' ? 'selected' : ''}>Startpage</option>
                <option value="ecosia" ${s.searchEngine === 'ecosia' ? 'selected' : ''}>Ecosia</option>
                <option value="custom" ${s.searchEngine === 'custom' ? 'selected' : ''}>Custom Search URL</option>
              </select>
            </div>

            <div class="settings-inline-form ${s.searchEngine === 'custom' ? '' : 'hidden'}" id="set-custom-engine-row">
              <input type="text" id="set-custom-engine-input" class="settings-text-input" value="${this._escape(s.customSearchUrl || '')}" placeholder="https://search.example.com?q=%s" />
              <button class="settings-gold-btn" id="set-save-custom-engine-btn">Save URL</button>
            </div>
          </div>
        </section>

        <!-- EXTENSIONS SECTION (crown://extensions) -->
        <section class="settings-section-block" data-section-id="extensions" data-keywords="extensions addons chrome web store crx zip userscripts dark mode annoyance zapper youtube sponsor skipper lazy image custom css js">
          <div class="settings-section-header-row">
            <div>
              <h2 class="settings-section-heading" style="margin-bottom:4px;">Extensions (Chrome Web Store &amp; Zero-RAM Engine)</h2>
              <p class="settings-section-sub">Install extensions directly from the Chrome Web Store (.crx / .zip) or create sandboxed CSS/JS extensions with 0 MB background overhead.</p>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="settings-outline-btn" id="cws-browse-btn" title="Open Chrome Web Store in a new tab">Browse Chrome Web Store ↗</button>
              <button class="settings-gold-btn" id="open-custom-ext-btn">+ Custom CSS / Userscript</button>
            </div>
          </div>

          <!-- Chrome Web Store Direct Installer Card -->
          <div class="settings-card" style="margin-bottom:16px;">
            <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
                <div class="settings-row-info">
                  <div class="settings-row-title" style="display:flex;align-items:center;gap:8px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cr-accent-gold)" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="21.17" y1="8" x2="12" y2="8"/><line x1="3.95" y1="6.06" x2="8.54" y2="14"/><line x1="10.88" y1="21.94" x2="15.46" y2="14"/></svg>
                    <span>Install from Chrome Web Store</span>
                  </div>
                  <div class="settings-row-desc">Paste any Chrome Web Store extension URL (e.g. <code>https://chromewebstore.google.com/detail/.../cjpalhdlnbpafiamejdnhcphjbkeiagm</code>), a 32-character Extension ID, or upload a <code>.crx</code> / <code>.zip</code> package.</div>
                </div>
                <label class="settings-outline-btn" style="cursor:pointer;margin:0;white-space:nowrap;">
                  Upload .crx / .zip
                  <input type="file" id="cws-file-input" accept=".crx,.zip" class="hidden" />
                </label>
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                <input type="text" id="cws-url-input" class="settings-text-input" placeholder="Paste Chrome Web Store URL or 32-char Extension ID (e.g. eimadpbcbfnmbkopoojfekhnkhdbieeh)..." />
                <button class="settings-gold-btn" id="cws-install-btn" style="white-space:nowrap;">Add to Crown</button>
              </div>
            </div>
          </div>

          <div class="settings-card hidden" id="custom-ext-installer-card" style="margin-bottom:16px;">
            <div class="settings-row-title" style="margin-bottom:10px;">Install Sandboxed CSS / Userscript Extension</div>
            <div class="settings-form-stack">
              <input type="text" id="ext-name-input" class="settings-text-input" placeholder="Extension Name (e.g. Custom Reader Font)" />
              <input type="text" id="ext-desc-input" class="settings-text-input" placeholder="Short description of what this extension does" />
              <textarea id="ext-css-input" class="settings-code-textarea" rows="3" placeholder="Optional CSS rules injected into pages (e.g. body { font-family: Inter, sans-serif !important; })"></textarea>
              <textarea id="ext-js-input" class="settings-code-textarea" rows="4" placeholder="Optional Sandboxed JS executed on DOMContentLoaded inside child frames"></textarea>
              <div class="settings-form-actions">
                <button class="settings-outline-btn" id="cancel-custom-ext-btn">Cancel</button>
                <button class="settings-gold-btn" id="save-custom-ext-btn">Save &amp; Enable Extension</button>
              </div>
            </div>
          </div>

          <div class="extensions-grid" id="extensions-cards-list">
            ${exts.map(ext => `
              <div class="extension-card ${ext.enabled ? 'ext-active' : ''}">
                <div class="extension-card-top">
                  <div class="extension-icon-box">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/></svg>
                  </div>
                  <div class="extension-meta">
                    <div class="extension-title-row">
                      <span class="extension-name">${this._escape(ext.name)}</span>
                      <span class="extension-version">v${this._escape(ext.version || '1.0.0')}</span>
                      ${ext.builtIn
                        ? '<span class="extension-badge">Built-in</span>'
                        : (ext.source === 'chrome-web-store'
                          ? '<span class="extension-badge cws">Chrome Web Store</span>'
                          : '<span class="extension-badge custom">Custom</span>')}
                    </div>
                    <p class="extension-desc">${this._escape(ext.description)}</p>
                  </div>
                </div>
                <div class="extension-card-footer">
                  ${!ext.builtIn
                    ? `<button class="settings-outline-btn ext-remove-btn" data-ext-id="${this._escape(ext.id)}">Remove</button>`
                    : `<span class="extension-ram-note">0 MB idle overhead</span>`}
                  <label class="toggle-switch">
                    <input type="checkbox" class="ext-enable-toggle" data-ext-id="${this._escape(ext.id)}" ${ext.enabled ? 'checked' : ''} />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            `).join('')}
          </div>
        </section>

        <!-- LANGUAGES SECTION -->
        <section class="settings-section-block" data-section-id="languages" data-keywords="languages locale accept-language spellcheck grammar">
          <h2 class="settings-section-heading">Languages</h2>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Preferred Web Content Language (Accept-Language)</div>
                <div class="settings-row-desc">Sent to websites via the native Rust HTTP proxy to request pages in your preferred language.</div>
              </div>
              <select class="settings-select" id="set-language-select">
                <option value="en-US,en;q=0.9" ${(!s.language || s.language.startsWith('en-US')) ? 'selected' : ''}>English (United States)</option>
                <option value="en-GB,en;q=0.9" ${s.language?.startsWith('en-GB') ? 'selected' : ''}>English (United Kingdom)</option>
                <option value="de-DE,de;q=0.9,en;q=0.8" ${s.language?.startsWith('de-DE') ? 'selected' : ''}>Deutsch (German)</option>
                <option value="fr-FR,fr;q=0.9,en;q=0.8" ${s.language?.startsWith('fr-FR') ? 'selected' : ''}>Français (French)</option>
                <option value="es-ES,es;q=0.9,en;q=0.8" ${s.language?.startsWith('es-ES') ? 'selected' : ''}>Español (Spanish)</option>
                <option value="hi-IN,hi;q=0.9,en;q=0.8" ${s.language?.startsWith('hi-IN') ? 'selected' : ''}>हिन्दी / English (India)</option>
                <option value="ja-JP,ja;q=0.9,en;q=0.8" ${s.language?.startsWith('ja-JP') ? 'selected' : ''}>日本語 (Japanese)</option>
              </select>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Check for spelling errors</div>
                <div class="settings-row-desc">Enable native OS spellchecking inside browser input fields and text areas.</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-spellcheck-toggle" ${s.spellcheck !== false ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </section>

        <!-- DOWNLOADS SECTION -->
        <section class="settings-section-block" data-section-id="downloads" data-keywords="downloads folder path location files">
          <h2 class="settings-section-heading">Downloads</h2>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Download Location</div>
                <div class="settings-row-desc">Files are streamed in chunks via the Rust backend directly to your OS Downloads folder (~&#47;Downloads) with automatic duplicate numbering.</div>
              </div>
              <span class="settings-badge-pill">~/Downloads</span>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Download Manager Drawer</div>
                <div class="settings-row-desc">View completed downloads or start a direct URL file transfer.</div>
              </div>
              <button class="settings-outline-btn" id="set-open-downloads-btn">Open Downloads</button>
            </div>
          </div>
        </section>

        <!-- ACCESSIBILITY SECTION -->
        <section class="settings-section-block" data-section-id="accessibility" data-keywords="accessibility high contrast reduced motion animations minimum font size zoom">
          <h2 class="settings-section-heading">Accessibility</h2>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">High-Contrast Text Mode</div>
                <div class="settings-row-desc">Boost text legibility and border contrast across the browser interface.</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-high-contrast-toggle" ${s.highContrast ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Reduced Motion</div>
                <div class="settings-row-desc">Minimize tab FLIP animations, transitions, and smooth scrolling effects.</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-reduced-motion-toggle" ${s.reducedMotion ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="settings-card-divider"></div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Minimum Font Size</div>
                <div class="settings-row-desc">Enforce a minimum readable font size across proxied web pages.</div>
              </div>
              <select class="settings-select" id="set-min-font-select">
                ${[0, 12, 14, 16, 18].map(sz => `<option value="${sz}" ${(Number(s.minFontSize) || 0) === sz ? 'selected' : ''}>${sz === 0 ? 'None (Default)' : `${sz}px`}</option>`).join('')}
              </select>
            </div>
          </div>
        </section>

        <!-- RESET SETTINGS SECTION -->
        <section class="settings-section-block" data-section-id="reset" data-keywords="reset restore settings original defaults">
          <h2 class="settings-section-heading">Reset Settings</h2>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Restore settings to their original defaults</div>
                <div class="settings-row-desc">Resets search engine, appearance, memory saver, and shield preferences to factory defaults. Your bookmarks and history will not be affected.</div>
              </div>
              <button class="internal-danger-btn" id="set-trigger-reset-btn" style="width:auto;padding:8px 14px;">Reset settings</button>
            </div>

            <div class="settings-inline-form hidden" id="set-confirm-reset-bar" style="justify-content:space-between;border-color:rgba(239,68,68,0.35);background:rgba(239,68,68,0.06);">
              <span style="font-size:12.5px;color:var(--text-primary);">Are you sure you want to restore all Crown settings to defaults?</span>
              <div style="display:flex;gap:8px;">
                <button class="settings-outline-btn" id="set-cancel-reset-btn">Cancel</button>
                <button class="internal-danger-btn" id="set-confirm-reset-btn" style="width:auto;padding:6px 14px;">Confirm Reset</button>
              </div>
            </div>
          </div>
        </section>

        <!-- ABOUT CROWN SECTION -->
        <section class="settings-section-block" data-section-id="about" data-keywords="about crown version rust tauri security audit architecture">
          <h2 class="settings-section-heading">About Crown</h2>
          <div class="settings-card">
            <div class="settings-about-hero">
              <div class="settings-about-logo">
                <img src="./favicon.svg" width="32" height="32" alt="Crown" />
              </div>
              <div>
                <div class="settings-row-title" style="font-size:16px;">Crown Browser</div>
                <div class="settings-row-desc">Version 1.0.0 — Lightweight Privacy Browser powered by Native Rust &amp; Tauri v2</div>
              </div>
            </div>
            <div class="settings-card-divider"></div>
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Memory Architecture</div>
                <div class="settings-row-desc">Stationary Single-Viewport DOM + MemoryGuard Auto-Hibernation (&lt;100 MB Active RAM Target)</div>
              </div>
              <span class="settings-badge-pill">Verified</span>
            </div>
            <div class="settings-card-divider"></div>
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-title">Security Hardening</div>
                <div class="settings-row-desc">SSRF-Guarded Rust HTTP Proxy • Credentialless Sandbox • Strict CSP • Zero Cloud Telemetry</div>
              </div>
              <span class="settings-badge-pill">Protected</span>
            </div>
          </div>
        </section>
      `;

      // Filter visibility: if search query is present, show all matching sections; otherwise show only activeSection
      const blocks = rootEl.querySelectorAll('.settings-section-block');
      let anyVisible = false;
      blocks.forEach(block => {
        if (!q) {
          const match = block.dataset.sectionId === activeSection;
          block.classList.toggle('hidden', !match);
          if (match) anyVisible = true;
        } else {
          const text = (block.textContent + ' ' + (block.dataset.keywords || '')).toLowerCase();
          const match = text.includes(q);
          block.classList.toggle('hidden', !match);
          if (match) anyVisible = true;
        }
      });

      if (!anyVisible && q) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'empty-state-notice';
        emptyEl.innerHTML = `<p>No settings found matching "<strong>${this._escape(searchFilter)}</strong>".</p>`;
        rootEl.appendChild(emptyEl);
      }

      this._bindSettingsEvents(rootEl, renderAllSections, searchInput);
    };

    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        activeSection = btn.dataset.section;
        if (searchInput.value.trim()) {
          searchInput.value = '';
        }
        updateSidebarActive();
        renderAllSections('');
      });
    });

    searchInput.addEventListener('input', (e) => {
      renderAllSections(e.target.value);
    });

    updateSidebarActive();
    renderAllSections('');
  },

  _bindSettingsEvents(rootEl, refreshFn, searchInput) {
    const updateMemoryPill = () => {
      const pill = rootEl.querySelector('#memory-live-status-pill');
      if (pill && window.crown?.tabEngine) {
        const live = window.crown.tabEngine.tabs.filter(t => !t.hibernated).length;
        const hib = window.crown.tabEngine.tabs.filter(t => t.hibernated).length;
        pill.textContent = `${live} live • ${hib} hibernated`;
      }
    };

    const saveAndSync = (patch, toastMsg) => {
      const updated = Storage.saveSettings(patch);
      if (window.crown) {
        if (typeof window.crown.applyAccessibilityAndAppearanceSettings === 'function') {
          window.crown.applyAccessibilityAndAppearanceSettings();
        }
        if (window.crown.tabEngine) {
          window.crown.tabEngine.enforceMemoryBudget();
        }
        if (typeof window.crown.renderDefenseHub === 'function') {
          window.crown.renderDefenseHub();
        }
        if (typeof window.crown.broadcastPageSettingsToFrames === 'function') {
          window.crown.broadcastPageSettingsToFrames();
        }
        if (toastMsg) window.crown.showToast(toastMsg);
      }
      updateMemoryPill();
      return updated;
    };

    // Memory Saver toggle & levels
    rootEl.querySelector('#set-memory-saver-toggle')?.addEventListener('change', (e) => {
      const on = e.target.checked;
      saveAndSync({ memorySaverMode: on }, `MemoryGuard ${on ? 'enabled' : 'disabled'}`);
      rootEl.querySelector('#memory-saver-levels-group')?.classList.toggle('disabled-group', !on);
    });

    rootEl.querySelectorAll('input[name="memorySaverLevel"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const level = e.target.value;
        const maxLive = level === 'moderate' ? 5 : (level === 'balanced' ? 2 : 1);
        saveAndSync({ memorySaverLevel: level, maxLiveTabs: maxLive }, `Memory Saver set to ${level}`);
      });
    });

    // Memory Whitelist Add/Remove
    const addWhitelistForm = rootEl.querySelector('#add-whitelist-form');
    const domainInput = rootEl.querySelector('#whitelist-domain-input');
    rootEl.querySelector('#open-add-whitelist-btn')?.addEventListener('click', () => {
      addWhitelistForm?.classList.remove('hidden');
      domainInput?.focus();
    });
    rootEl.querySelector('#cancel-add-whitelist-btn')?.addEventListener('click', () => {
      addWhitelistForm?.classList.add('hidden');
      if (domainInput) domainInput.value = '';
    });
    rootEl.querySelector('#confirm-add-whitelist-btn')?.addEventListener('click', () => {
      let raw = (domainInput?.value || '').trim().toLowerCase();
      if (!raw) return;
      try {
        if (raw.includes('://')) raw = new URL(raw).hostname.toLowerCase();
      } catch {}
      raw = raw.replace(/^www\./, '').replace(/\/.*$/, '');
      if (!raw || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw)) {
        window.crown?.showToast('Enter a valid domain (e.g. github.com)', 'error');
        return;
      }
      const s = Storage.getSettings();
      const list = Array.isArray(s.memoryWhitelist) ? [...s.memoryWhitelist] : [];
      if (!list.includes(raw)) {
        list.push(raw);
        saveAndSync({ memoryWhitelist: list }, `Added ${raw} to active site exceptions`);
      }
      refreshFn(searchInput?.value || '');
    });

    rootEl.querySelectorAll('.whitelist-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const domain = btn.dataset.domain;
        const s = Storage.getSettings();
        const list = (s.memoryWhitelist || []).filter(d => d !== domain);
        saveAndSync({ memoryWhitelist: list }, `Removed ${domain} from exceptions`);
        refreshFn(searchInput?.value || '');
      });
    });

    // Power / Energy Saver
    rootEl.querySelector('#set-energy-saver-toggle')?.addEventListener('change', (e) => {
      const on = e.target.checked;
      saveAndSync({ energySaver: on }, `Energy Saver ${on ? 'enabled' : 'disabled'}`);
      rootEl.querySelector('#energy-saver-modes-group')?.classList.toggle('disabled-group', !on);
    });

    rootEl.querySelectorAll('input[name="energySaverMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        saveAndSync({ energySaverMode: e.target.value }, 'Updated Energy Saver power policy');
      });
    });

    rootEl.querySelector('#set-hw-accel-toggle')?.addEventListener('change', (e) => {
      saveAndSync({ hardwareAcceleration: e.target.checked }, 'Updated graphics acceleration setting');
    });

    // Appearance
    rootEl.querySelector('#set-tab-layout-select')?.addEventListener('change', (e) => {
      const pos = e.target.value;
      if (window.crown?.tabEngine) {
        window.crown.tabEngine.setLayout(pos);
      } else {
        saveAndSync({ tabPosition: pos });
      }
      window.crown?.showToast(`Switched to ${pos === 'left' ? 'Vertical Sidebar' : 'Horizontal Top'} tabs`);
    });

    rootEl.querySelectorAll('#set-accent-swatch-row .color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        const color = sw.dataset.color;
        rootEl.querySelectorAll('#set-accent-swatch-row .color-swatch').forEach(b => b.classList.remove('active'));
        sw.classList.add('active');
        saveAndSync({ accentColor: color }, 'Updated accent color');
      });
    });

    rootEl.querySelector('#set-wallpaper-select')?.addEventListener('change', (e) => {
      const wp = e.target.value;
      rootEl.querySelector('#set-custom-wallpaper-row')?.classList.toggle('hidden', wp !== 'custom');
      if (wp !== 'custom') {
        saveAndSync({ wallpaper: wp, customBackground: '' }, 'Updated New Tab Hub wallpaper');
        window.crown?.applyWallpaper?.(wp);
      } else {
        saveAndSync({ wallpaper: 'custom' }, 'Select or paste a custom wallpaper below');
      }
    });

    rootEl.querySelector('#set-apply-custom-bg-btn')?.addEventListener('click', () => {
      const urlVal = (rootEl.querySelector('#set-custom-bg-url')?.value || '').trim();
      if (!urlVal) {
        window.crown?.showToast('Enter an HTTPS image URL first', 'error');
        return;
      }
      saveAndSync({ wallpaper: 'custom', customBackground: urlVal }, 'Applied custom wallpaper URL');
      window.crown?.applyCustomBackground?.(urlVal);
    });

    rootEl.querySelector('#set-upload-custom-bg-file')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) {
        window.crown?.showToast('Wallpaper image must be under 4 MB', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        saveAndSync({ wallpaper: 'custom', customBackground: dataUrl }, 'Uploaded custom wallpaper');
        window.crown?.applyCustomBackground?.(dataUrl);
      };
      reader.readAsDataURL(file);
    });

    rootEl.querySelector('#set-bookmarks-bar-toggle')?.addEventListener('change', (e) => {
      saveAndSync({ showBookmarksBar: e.target.checked }, e.target.checked ? 'Bookmarks bar shown' : 'Bookmarks bar hidden');
    });

    rootEl.querySelector('#set-page-zoom-select')?.addEventListener('change', (e) => {
      const z = Number(e.target.value) || 100;
      if (window.crown && typeof window.crown.setPageZoom === 'function') {
        window.crown.setPageZoom(z);
      } else {
        saveAndSync({ pageZoom: z });
      }
    });

    // Shields & Privacy (unified setting keys!)
    rootEl.querySelector('#set-shield-enabled-toggle')?.addEventListener('change', (e) => {
      const on = e.target.checked;
      saveAndSync({ shieldsEnabled: on, blockAds: on, blockTrackers: on }, `Crown Shield ${on ? 'enabled' : 'paused'}`);
      window.crown?.updateShieldBadge?.();
    });

    rootEl.querySelector('#set-strip-params-toggle')?.addEventListener('change', (e) => {
      const on = e.target.checked;
      saveAndSync({ stripQueryParams: on }, `URL tracking parameter stripper ${on ? 'enabled' : 'disabled'}`);
    });

    rootEl.querySelector('#set-cosmetic-toggle')?.addEventListener('change', (e) => {
      const on = e.target.checked;
      saveAndSync({ blockCookieNotices: on }, `Cookie popup & cosmetic filter ${on ? 'enabled' : 'disabled'}`);
    });

    rootEl.querySelector('#set-https-only-toggle')?.addEventListener('change', (e) => {
      const on = e.target.checked;
      saveAndSync({ httpsEverywhere: on }, `HTTPS-Only Mode ${on ? 'enabled' : 'disabled'}`);
    });

    rootEl.querySelector('#set-send-gpc-toggle')?.addEventListener('change', (e) => {
      const on = e.target.checked;
      saveAndSync({ sendGpc: on }, `Global Privacy Control (Sec-GPC) ${on ? 'enabled' : 'disabled'}`);
    });

    rootEl.querySelector('#set-clear-browsing-data-btn')?.addEventListener('click', () => {
      window.crown?.openClearDataModal();
    });

    // Search Engine (unified setting keys!)
    rootEl.querySelector('#set-search-engine-select')?.addEventListener('change', (e) => {
      const key = e.target.value;
      window.crown?.searchManager?.setEngine(key);
      rootEl.querySelector('#set-custom-engine-row')?.classList.toggle('hidden', key !== 'custom');
      window.crown?.showToast(`Default search engine set to ${window.crown?.searchManager?.getCurrentEngine()?.name || key}`);
    });

    rootEl.querySelector('#set-save-custom-engine-btn')?.addEventListener('click', () => {
      const urlVal = rootEl.querySelector('#set-custom-engine-input')?.value.trim() || '';
      if (urlVal) {
        window.crown?.searchManager?.setEngine('custom', urlVal);
        window.crown?.showToast('Saved custom search engine URL');
      }
    });

    // Extensions — Chrome Web Store Direct Installer & .crx/.zip Package Uploader
    rootEl.querySelector('#cws-browse-btn')?.addEventListener('click', () => {
      window.crown?.tabEngine?.createTab({
        url: 'https://chromewebstore.google.com',
        title: 'Chrome Web Store',
        active: true
      });
    });

    const cwsInstallBtn = rootEl.querySelector('#cws-install-btn');
    const cwsUrlInput = rootEl.querySelector('#cws-url-input');
    cwsInstallBtn?.addEventListener('click', async () => {
      const raw = (cwsUrlInput?.value || '').trim();
      if (!raw) {
        window.crown?.showToast('Paste a Chrome Web Store URL or 32-character Extension ID', 'error');
        return;
      }
      cwsInstallBtn.disabled = true;
      const origLabel = cwsInstallBtn.textContent;
      cwsInstallBtn.textContent = 'Downloading CRX...';
      try {
        const installed = await Storage.installFromChromeWebStore(raw);
        window.crown?.broadcastPageSettingsToFrames?.();
        window.crown?.showToast(`Installed "${installed.name}" (v${installed.version}) from Chrome Web Store`);
        if (cwsUrlInput) cwsUrlInput.value = '';
        refreshFn(searchInput?.value || '');
      } catch (err) {
        window.crown?.showToast(String(err?.message || err || 'Chrome Web Store install failed'), 'error');
      } finally {
        cwsInstallBtn.disabled = false;
        cwsInstallBtn.textContent = origLabel;
      }
    });

    rootEl.querySelector('#cws-file-input')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const extObj = await Storage.unpackCrxOrZipBytes(new Uint8Array(buf), file.name.replace(/\.(crx|zip)$/i, ''));
        const exts = Storage.getExtensions().filter(x => x.id !== extObj.id);
        exts.push(extObj);
        Storage.saveExtensions(exts);
        window.crown?.broadcastPageSettingsToFrames?.();
        window.crown?.showToast(`Installed "${extObj.name}" (v${extObj.version}) from package`);
        refreshFn(searchInput?.value || '');
      } catch (err) {
        window.crown?.showToast(`Package unpack error: ${err?.message || err}`, 'error');
      }
    });

    rootEl.querySelector('#open-custom-ext-btn')?.addEventListener('click', () => {
      rootEl.querySelector('#custom-ext-installer-card')?.classList.toggle('hidden');
    });
    rootEl.querySelector('#cancel-custom-ext-btn')?.addEventListener('click', () => {
      rootEl.querySelector('#custom-ext-installer-card')?.classList.add('hidden');
    });
    rootEl.querySelector('#save-custom-ext-btn')?.addEventListener('click', () => {
      const name = (rootEl.querySelector('#ext-name-input')?.value || '').trim();
      const desc = (rootEl.querySelector('#ext-desc-input')?.value || '').trim();
      const css = (rootEl.querySelector('#ext-css-input')?.value || '').trim();
      const js = (rootEl.querySelector('#ext-js-input')?.value || '').trim();
      if (!name) {
        window.crown?.showToast('Please enter a name for the extension', 'error');
        return;
      }
      if (!css && !js) {
        window.crown?.showToast('Provide CSS rules or sandboxed JS for the extension', 'error');
        return;
      }
      const exts = Storage.getExtensions();
      exts.push({
        id: `ext-custom-${Date.now()}`,
        name: name.slice(0, 48),
        version: '1.0.0',
        description: desc || 'User-installed sandboxed extension.',
        enabled: true,
        builtIn: false,
        css,
        js
      });
      Storage.saveExtensions(exts);
      window.crown?.broadcastPageSettingsToFrames?.();
      window.crown?.showToast(`Installed extension "${name}"`);
      refreshFn(searchInput?.value || '');
    });

    rootEl.querySelectorAll('.ext-enable-toggle').forEach(tog => {
      tog.addEventListener('change', (e) => {
        const id = tog.dataset.extId;
        const exts = Storage.getExtensions();
        const target = exts.find(x => x.id === id);
        if (target) {
          target.enabled = e.target.checked;
          Storage.saveExtensions(exts);
          tog.closest('.extension-card')?.classList.toggle('ext-active', target.enabled);
          window.crown?.broadcastPageSettingsToFrames?.();
          window.crown?.showToast(`${target.name} ${target.enabled ? 'enabled' : 'disabled'}`);
        }
      });
    });

    rootEl.querySelectorAll('.ext-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.extId;
        const exts = Storage.getExtensions().filter(x => x.id !== id || x.builtIn);
        Storage.saveExtensions(exts);
        window.crown?.broadcastPageSettingsToFrames?.();
        window.crown?.showToast('Extension removed');
        refreshFn(searchInput?.value || '');
      });
    });

    // Languages
    rootEl.querySelector('#set-language-select')?.addEventListener('change', (e) => {
      saveAndSync({ language: e.target.value }, 'Updated preferred Accept-Language header');
    });
    rootEl.querySelector('#set-spellcheck-toggle')?.addEventListener('change', (e) => {
      saveAndSync({ spellcheck: e.target.checked }, `Spellcheck ${e.target.checked ? 'enabled' : 'disabled'}`);
    });

    // Downloads
    rootEl.querySelector('#set-open-downloads-btn')?.addEventListener('click', () => {
      document.getElementById('downloads-drawer')?.classList.add('open');
      window.crown?.downloadManager?.renderDrawer?.();
    });

    // Accessibility
    rootEl.querySelector('#set-high-contrast-toggle')?.addEventListener('change', (e) => {
      saveAndSync({ highContrast: e.target.checked }, `High-Contrast mode ${e.target.checked ? 'enabled' : 'disabled'}`);
    });
    rootEl.querySelector('#set-reduced-motion-toggle')?.addEventListener('change', (e) => {
      saveAndSync({ reducedMotion: e.target.checked }, `Reduced Motion ${e.target.checked ? 'enabled' : 'disabled'}`);
    });
    rootEl.querySelector('#set-min-font-select')?.addEventListener('change', (e) => {
      saveAndSync({ minFontSize: Number(e.target.value) || 0 }, 'Updated minimum page font size');
    });

    // Reset Settings
    const confirmBar = rootEl.querySelector('#set-confirm-reset-bar');
    rootEl.querySelector('#set-trigger-reset-btn')?.addEventListener('click', () => {
      confirmBar?.classList.remove('hidden');
    });
    rootEl.querySelector('#set-cancel-reset-btn')?.addEventListener('click', () => {
      confirmBar?.classList.add('hidden');
    });
    rootEl.querySelector('#set-confirm-reset-btn')?.addEventListener('click', () => {
      const defaults = Storage.resetSettingsToDefaults();
      if (window.crown) {
        window.crown.searchManager?.setEngine(defaults.searchEngine);
        window.crown.tabEngine?.setLayout(defaults.tabPosition);
        window.crown.applyWallpaper?.(defaults.wallpaper);
        window.crown.applyAccessibilityAndAppearanceSettings?.();
        window.crown.broadcastPageSettingsToFrames?.();
        window.crown.updateShieldBadge?.();
        window.crown.showToast('All settings restored to factory defaults');
      }
      refreshFn('');
    });
  },

  _groupByDate(items) {
    const groups = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    items.forEach(item => {
      const d = new Date(item.timestamp || Date.now()).toDateString();
      let label = d;
      if (d === today) label = 'Today';
      else if (d === yesterday) label = 'Yesterday';

      if (!groups[label]) groups[label] = [];
      groups[label].push(item);
    });
    return groups;
  },

  _deleteHistoryItem(timestamp) {
    Storage.deleteHistoryItem(timestamp);
    window.crown?.showToast('Removed from history');
  },

  _deleteBookmark(idOrUrl) {
    const bookmarks = Storage.getBookmarks().filter(b => b.id !== idOrUrl && b.url !== idOrUrl);
    Storage.saveBookmarks(bookmarks);
    window.crown?.showToast('Bookmark removed');
  },

  _escape(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};
