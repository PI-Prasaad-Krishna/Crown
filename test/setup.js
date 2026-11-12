// Browser environment simulation for Crown Browser Node.js unit tests
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

class MemoryStorage {
  constructor() {
    this._store = new Map();
  }
  getItem(key) {
    return this._store.has(key) ? this._store.get(key) : null;
  }
  setItem(key, value) {
    this._store.set(String(key), String(value));
  }
  removeItem(key) {
    this._store.delete(String(key));
  }
  clear() {
    this._store.clear();
  }
  get length() {
    return this._store.size;
  }
  key(index) {
    return Array.from(this._store.keys())[index] || null;
  }
}

class DOMElementMock {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.childNodes = [];
    this.parentNode = null;
    this.offsetWidth = 100;
    this.offsetHeight = 30;
    this.classList = {
      _classes: new Set(),
      add(...cls) { cls.forEach(c => this._classes.add(c)); },
      remove(...cls) { cls.forEach(c => this._classes.delete(c)); },
      toggle(cls, force) {
        if (force === undefined) {
          if (this._classes.has(cls)) { this._classes.delete(cls); return false; }
          else { this._classes.add(cls); return true; }
        }
        if (force) { this._classes.add(cls); return true; }
        this._classes.delete(cls); return false;
      },
      contains(cls) { return this._classes.has(cls); }
    };
    this.attributes = new Map();
    this.style = {
      setProperty: () => {},
      removeProperty: () => {}
    };
    this.dataset = {};
    this._listeners = new Map();
    this._textContent = '';
    this.innerHTML = '';
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(val) {
    this._textContent = String(val ?? '');
    this.innerHTML = String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k) || null; }
  removeAttribute(k) { this.attributes.delete(k); }

  addEventListener(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
  }

  dispatchEvent(event) {
    const list = this._listeners.get(event.type) || [];
    list.forEach(fn => fn(event));
    return true;
  }

  appendChild(child) {
    if (child && child.parentNode) {
      child.parentNode.removeChild(child);
    }
    if (child) child.parentNode = this;
    this.children.push(child);
    this.childNodes.push(child);
    return child;
  }

  insertBefore(newChild, refChild) {
    if (!newChild) return null;
    if (newChild.parentNode) {
      newChild.parentNode.removeChild(newChild);
    }
    newChild.parentNode = this;
    const idx = this.children.indexOf(refChild);
    if (idx !== -1) {
      this.children.splice(idx, 0, newChild);
      this.childNodes.splice(idx, 0, newChild);
    } else {
      this.children.push(newChild);
      this.childNodes.push(newChild);
    }
    return newChild;
  }

  removeChild(child) {
    this.children = this.children.filter(c => c !== child);
    this.childNodes = this.childNodes.filter(c => c !== child);
    if (child) child.parentNode = null;
    return child;
  }

  replaceChild(newChild, oldChild) {
    const idx = this.children.indexOf(oldChild);
    if (idx !== -1) {
      if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
      newChild.parentNode = this;
      oldChild.parentNode = null;
      this.children[idx] = newChild;
      this.childNodes[idx] = newChild;
    }
    return newChild;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  contains(node) {
    if (!node) return false;
    if (this === node) return true;
    return this.children.some(c => c === node || (c.contains && c.contains(node)));
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 };
  }

  closest(sel) {
    return this;
  }

  querySelector(sel) {
    return new DOMElementMock('div');
  }

  querySelectorAll(sel) {
    return [];
  }
}

const tabBarEl = new DOMElementMock('nav');
const sidebarTabListEl = new DOMElementMock('div');

// Global browser shims
globalThis.localStorage = new MemoryStorage();
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

globalThis.window = {
  location: { search: '', href: 'http://localhost:3000' },
  localStorage: globalThis.localStorage,
  addEventListener(event, fn) {},
  removeEventListener(event, fn) {},
  dispatchEvent(event) {},
  crown: {
    showToast() {},
    updateShieldBadge() {},
    searchManager: null,
    tabEngine: null,
  }
};

const elementCache = new Map([
  ['tab-bar', tabBarEl],
  ['sidebar-tab-list', sidebarTabListEl]
]);

globalThis.document = {
  body: new DOMElementMock('body'),
  createElement(tag) {
    return new DOMElementMock(tag);
  },
  getElementById(id) {
    if (!elementCache.has(id)) {
      const el = new DOMElementMock('div');
      el.id = id;
      elementCache.set(id, el);
    }
    return elementCache.get(id);
  },
  querySelector(sel) {
    return new DOMElementMock('div');
  },
  querySelectorAll(sel) {
    return [];
  }
};

// Mock fetch for local rule assets
globalThis.fetch = async (url) => {
  const clean = String(url).replace(/^\.\//, '');
  const localPath = path.join(rootDir, 'src', 'public', clean);
  if (fs.existsSync(localPath)) {
    const content = fs.readFileSync(localPath, 'utf-8');
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(content),
      text: async () => content
    };
  }
  return {
    ok: false,
    status: 404,
    json: async () => ({}),
    text: async () => ''
  };
};

export { MemoryStorage, DOMElementMock, rootDir };
