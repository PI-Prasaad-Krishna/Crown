// Crown Browser — Internal Pages Engine (crown://history, crown://bookmarks)
import { Storage } from './storage.js';

export const InternalViews = {
  // Check if a URL is an internal Crown URL
  isInternalUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase().trim();
    return lower.startsWith('crown://') || lower.startsWith('crisp://');
  },

  // Get the route name from internal URL (e.g. 'history', 'bookmarks', 'newtab')
  getRoute(url) {
    if (!url) return '';
    const clean = url.replace(/^(crown|crisp):\/\//i, '').replace(/\/$/, '').toLowerCase();
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
      default:
        container.innerHTML = `
          <div class="internal-error-view">
            <h2>Page not found</h2>
            <p>The internal page <code>${url}</code> does not exist.</p>
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
      const filtered = history.filter(item => 
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

          row.querySelector('.history-item-info').onclick = () => onNavigate(item.url);
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
      if (confirm('Clear all browsing history?')) {
        Storage.clearHistory();
        renderList();
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

        card.onclick = () => onNavigate(bm.url);
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
      const title = prompt('Bookmark title:');
      if (!title) return;
      const url = prompt('Bookmark URL:', 'https://');
      if (!url) return;
      const list = Storage.getBookmarks();
      list.push({ id: `bm-${Date.now()}`, title, url });
      Storage.saveBookmarks(list);
      renderGrid();
    });

    renderGrid();
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
    const history = Storage.getHistory().filter(h => h.timestamp !== timestamp);
    try {
      localStorage.setItem('crown_history', JSON.stringify(history));
    } catch(e) {}
  },

  _deleteBookmark(idOrUrl) {
    const bookmarks = Storage.getBookmarks().filter(b => b.id !== idOrUrl && b.url !== idOrUrl);
    Storage.saveBookmarks(bookmarks);
  },

  _escape(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};
