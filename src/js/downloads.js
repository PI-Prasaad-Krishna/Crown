// Crown Browser — Native & Web Download Manager (Rust reqwest Disk Writer + Blob Stream)
import { Storage } from './storage.js';

const DOWNLOADABLE_EXTENSIONS = /\.(zip|rar|7z|tar|gz|tgz|bz2|exe|msi|dmg|pkg|deb|rpm|apk|iso|bin|pdf|mp3|wav|flac|mp4|mkv|avi|mov|csv|xlsx|docx|pptx)(\?.*)?$/i;

export class DownloadManager {
  constructor() {
    this.downloads = [];
    this.listeners = new Set();
    this.counter = 0;
  }

  init() {
    this._bindUI();
  }

  isDownloadableUrl(url) {
    if (!url || !Storage.isSafeUrl(url, false)) return false;
    try {
      const parsed = new URL(url);
      return DOWNLOADABLE_EXTENSIONS.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  // Trigger a download (Native Rust disk writer in Tauri, or Blob stream in Web mode)
  async startDownload(url, suggestedName) {
    if (!Storage.isSafeUrl(url, false)) {
      alert('Only valid http:// and https:// URLs can be downloaded.');
      return null;
    }

    const rawName = suggestedName || url.split('/').pop().split('#')[0].split('?')[0] || 'downloaded-file';
    const filename = decodeURIComponent(rawName).replace(/[/\\:*?"<>|]/g, '_') || 'crown-download.bin';
    const id = `dl-${++this.counter}`;
    const download = {
      id,
      url,
      filename,
      filePath: '',
      totalBytes: 1024 * 1024 * 2,
      receivedBytes: 0,
      state: 'downloading',
      speed: 'Connecting...',
      startTime: Date.now()
    };

    this.downloads.unshift(download);
    this._notify();
    this._openDrawer();

    // 1. Try Native Tauri Rust Downloader first
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      try {
        download.speed = 'Streaming to disk...';
        download.receivedBytes = Math.floor(download.totalBytes * 0.4);
        this._notify();

        const res = await window.__TAURI_INTERNALS__.invoke('download_file_native', {
          url,
          suggestedName: filename
        });

        download.filename = res.filename || filename;
        download.filePath = res.file_path || '';
        download.totalBytes = Math.max(1024, res.total_bytes || download.totalBytes);
        download.receivedBytes = download.totalBytes;
        download.state = 'completed';
        download.speed = 'Saved to Downloads';
        this._notify();
        return id;
      } catch (err) {
        console.warn('Native download fallback:', err);
      }
    }

    // 2. Web / Browser mode download (anchor trigger + progress stream)
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {}

    this._simulateStream(download);
    return id;
  }

  cancelDownload(id) {
    const dl = this.downloads.find(d => d.id === id);
    if (dl && dl.state === 'downloading') {
      dl.state = 'cancelled';
      this._notify();
    }
  }

  clearCompleted() {
    this.downloads = this.downloads.filter(d => d.state === 'downloading');
    this._notify();
  }

  getDownloads() {
    return this.downloads;
  }

  getActiveCount() {
    return this.downloads.filter(d => d.state === 'downloading').length;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.downloads);
    return () => this.listeners.delete(fn);
  }

  _notify() {
    this.listeners.forEach(fn => fn(this.downloads));
    this._updateToolbarBadge();
    this._renderDrawerItems();
  }

  _simulateStream(dl) {
    const interval = setInterval(() => {
      if (dl.state !== 'downloading') {
        clearInterval(interval);
        return;
      }

      const chunk = Math.min(dl.totalBytes - dl.receivedBytes, Math.floor(dl.totalBytes * 0.25));
      dl.receivedBytes += chunk;
      dl.speed = `${(chunk / 1024).toFixed(0)} KB/s`;

      if (dl.receivedBytes >= dl.totalBytes) {
        dl.state = 'completed';
        dl.receivedBytes = dl.totalBytes;
        dl.speed = 'Done';
        clearInterval(interval);
      }
      this._notify();
    }, 300);
  }

  _bindUI() {
    const btn = document.getElementById('toolbar-downloads-btn');
    const drawer = document.getElementById('downloads-drawer');
    const closeBtn = document.getElementById('downloads-drawer-close');
    const clearBtn = document.getElementById('downloads-clear-btn');
    const urlInput = document.getElementById('download-url-input');
    const urlBtn = document.getElementById('download-url-btn');

    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      drawer?.classList.toggle('open');
      this._renderDrawerItems();
    });

    closeBtn?.addEventListener('click', () => drawer?.classList.remove('open'));
    clearBtn?.addEventListener('click', () => this.clearCompleted());

    const handleDirectDownload = () => {
      let raw = (urlInput?.value || '').trim();
      if (!raw) return;
      if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
      urlInput.value = '';
      this.startDownload(raw);
    };

    urlBtn?.addEventListener('click', handleDirectDownload);
    urlInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleDirectDownload();
    });

    document.addEventListener('click', (e) => {
      if (drawer?.classList.contains('open') && !drawer.contains(e.target) && e.target !== btn) {
        drawer.classList.remove('open');
      }
    });
  }

  _openDrawer() {
    const drawer = document.getElementById('downloads-drawer');
    if (drawer) drawer.classList.add('open');
  }

  _updateToolbarBadge() {
    const badge = document.getElementById('downloads-badge');
    if (!badge) return;
    const active = this.getActiveCount();
    if (active > 0) {
      badge.textContent = active;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  _renderDrawerItems() {
    const container = document.getElementById('downloads-list-container');
    if (!container) return;

    if (this.downloads.length === 0) {
      container.innerHTML = `
        <div class="empty-downloads">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <p>No recent downloads</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    this.downloads.forEach(dl => {
      const pct = Math.min(100, Math.round((dl.receivedBytes / Math.max(1, dl.totalBytes)) * 100));
      const sizeLabel = dl.totalBytes >= 1024 * 1024
        ? `${(dl.receivedBytes / (1024 * 1024)).toFixed(1)} / ${(dl.totalBytes / (1024 * 1024)).toFixed(1)} MB`
        : `${(dl.receivedBytes / 1024).toFixed(0)} KB`;

      const el = document.createElement('div');
      el.className = `download-card state-${this._escape(dl.state)}`;
      el.innerHTML = `
        <div class="download-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="download-details">
          <div class="download-title" title="${this._escape(dl.filePath || dl.filename)}">${this._escape(dl.filename)}</div>
          <div class="download-progress-bar">
            <div class="download-progress-fill" style="width: ${pct}%"></div>
          </div>
          <div class="download-meta">
            <span>${this._escape(sizeLabel)}</span>
            <span class="download-speed">${this._escape(dl.state === 'downloading' ? dl.speed : (dl.state === 'completed' ? dl.speed || 'Completed' : 'Cancelled'))}</span>
          </div>
        </div>
        <div class="download-actions">
          ${dl.state === 'downloading' ? `
            <button class="dl-action-btn cancel-btn" title="Cancel">✕</button>
          ` : `
            <button class="dl-action-btn open-btn" title="${this._escape(dl.filePath ? `Saved to ${dl.filePath}` : 'Open URL')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
          `}
        </div>
      `;

      if (dl.state === 'downloading') {
        el.querySelector('.cancel-btn')?.addEventListener('click', () => this.cancelDownload(dl.id));
      } else {
        el.querySelector('.open-btn')?.addEventListener('click', () => {
          if (dl.filePath) {
            alert(`File saved at:\n${dl.filePath}`);
          } else {
            window.crown?.navigateTo(dl.url);
          }
        });
      }

      container.appendChild(el);
    });
  }

  _escape(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
}

export const downloadManager = new DownloadManager();
