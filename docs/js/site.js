// Crown Browser Marketing Site — Progressive Enhancement Script

const RELEASE_BASE = 'https://github.com/PI-Prasaad-Krishna/Crown/releases/latest/download';

const INSTALLERS = {
  windows: {
    heroLabel: 'Download for Windows',
    heroUrl: `${RELEASE_BASE}/Crown_1.0.0_x64_en-US.msi`,
    title: 'Crown for Windows (64-bit)',
    desc: 'Requires Windows 10 or Windows 11 with Microsoft Edge WebView2 Runtime. Includes MSI installer and NSIS executable setup.',
    primaryLabel: 'Download Windows Installer (.msi)',
    primaryUrl: `${RELEASE_BASE}/Crown_1.0.0_x64_en-US.msi`,
    secondaryLabel: 'Download Setup (.exe)',
    secondaryUrl: `${RELEASE_BASE}/Crown_1.0.0_x64-setup.exe`,
    preview: `Target asset: ${RELEASE_BASE}/Crown_1.0.0_x64_en-US.msi`
  },
  macos: {
    heroLabel: 'Download for macOS',
    heroUrl: `${RELEASE_BASE}/Crown_1.0.0_aarch64.dmg`,
    title: 'Crown for macOS (Apple Silicon & Intel)',
    desc: 'Native WKWebView shell with encrypted AES-256-GCM vault and owner-only 0o600 keyfile isolation. Choose Apple Silicon (.dmg) or Intel x64 (.dmg).',
    primaryLabel: 'Download Apple Silicon (.dmg)',
    primaryUrl: `${RELEASE_BASE}/Crown_1.0.0_aarch64.dmg`,
    secondaryLabel: 'Download Intel (.dmg)',
    secondaryUrl: `${RELEASE_BASE}/Crown_1.0.0_x64.dmg`,
    preview: `Target asset: ${RELEASE_BASE}/Crown_1.0.0_aarch64.dmg`
  },
  linux: {
    heroLabel: 'Download for Linux',
    heroUrl: `${RELEASE_BASE}/Crown_1.0.0_amd64.AppImage`,
    title: 'Crown for Linux (x86_64)',
    desc: 'Powered by WebKitGTK with strict SSRF and vault sandboxing. Distributed as portable AppImage and Debian package.',
    primaryLabel: 'Download AppImage',
    primaryUrl: `${RELEASE_BASE}/Crown_1.0.0_amd64.AppImage`,
    secondaryLabel: 'Download Debian (.deb)',
    secondaryUrl: `${RELEASE_BASE}/Crown_1.0.0_amd64.deb`,
    preview: `Target asset: ${RELEASE_BASE}/Crown_1.0.0_amd64.AppImage`
  },
  android: {
    heroLabel: 'Download for Android',
    heroUrl: `${RELEASE_BASE}/Crown_1.0.0.apk`,
    title: 'Crown for Android (API 24+)',
    desc: 'Built via Tauri Android pipeline with Shield tracking parameter stripping, dark reader styles, and local history isolation.',
    primaryLabel: 'Download Android APK (.apk)',
    primaryUrl: `${RELEASE_BASE}/Crown_1.0.0.apk`,
    secondaryLabel: 'View GitHub Releases',
    secondaryUrl: 'https://github.com/PI-Prasaad-Krishna/Crown/releases/latest',
    preview: `Target asset: ${RELEASE_BASE}/Crown_1.0.0.apk`
  }
};

const SHIELD_PROBES = {
  ad: {
    verdict: 'Blocked at WebResourceRequested (Ad Shim Served)',
    detail: 'Response: 200 application/javascript (window.google_ad_status = 1;) with zero external connection opened.'
  },
  tracker: {
    verdict: 'Blocked at Native Network Filter (Tracker Drop)',
    detail: 'Request to www.google-analytics.com stopped locally with empty payload, DNT: 1, and Sec-GPC: 1 headers enforced.'
  },
  utm: {
    verdict: 'Query Tracking Tokens Stripped Before Navigation',
    detail: 'Rewritten URL: https://example.com/article (removed utm_source and fbclid tracking identifiers).'
  },
  clean: {
    verdict: 'Allowed with DNT: 1 and Sec-GPC: 1 Headers',
    detail: 'Passed SSRF IPv4/IPv6 check, scheme check (HTTPS), and port firewall rules; rendered in active profile WebView2.'
  }
};

const PROFILE_SIMS = {
  personal: {
    verdict: 'web_profiles/default + Crown/vault.enc',
    detail: 'Cookies, IndexedDB, LocalStorage, and Vault storage paths are partitioned inside web_profiles/default.'
  },
  work: {
    verdict: 'web_profiles/profile-work + Crown/vaults/profile-work/vault.enc',
    detail: 'Switching profiles closes outgoing child webviews cleanly and mounts an independent Chromium storage root.'
  },
  incognito: {
    verdict: 'InPrivate Window (.incognito(true))',
    detail: 'Runs non-persistent WebView2 memory storage with zero disk writes to bookmarks, history, or frequent shortcuts.'
  }
};

const MEMORY_SIMS = {
  maximum: {
    verdict: 'Maximum: 1 active tab, all background tabs hibernated',
    detail: 'Unloads background WebView2 processes as soon as you switch focus, preserving scroll and full history stack.'
  },
  balanced: {
    verdict: 'Balanced: 2 active tabs, remaining tabs hibernated',
    detail: 'Active and most recent background tab stay warm; inactive tabs unload child webview handles until focused.'
  },
  moderate: {
    verdict: 'Moderate: up to 5 active tabs kept warm',
    detail: 'Designed for multi-tab workflows needing instant switching while still bounding peak idle RAM.'
  }
};

function detectPlatform() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'windows';
}

function setupMobileDrawer() {
  const toggle = document.getElementById('mobile-nav-toggle');
  const drawer = document.getElementById('mobile-nav-drawer');
  if (!toggle || !drawer) return;

  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    drawer.hidden = !open;
  };

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  drawer.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setOpen(false));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drawer.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });
}

function bindTabGroup(tabSelector, onSelect) {
  const tabs = Array.from(document.querySelectorAll(tabSelector));
  if (!tabs.length) return;

  const activate = (tab, moveFocus = false) => {
    tabs.forEach((t) => {
      const active = t === tab;
      t.setAttribute('aria-selected', active ? 'true' : 'false');
      t.setAttribute('tabindex', active ? '0' : '-1');
      const panelId = t.getAttribute('aria-controls');
      if (panelId && panelId !== 'os-panel') {
        const panel = document.getElementById(panelId);
        if (panel) panel.hidden = !active;
      }
    });
    if (moveFocus) tab.focus({ preventScroll: true });
    onSelect(tab);
  };

  tabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => activate(tab, false));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        activate(tabs[(idx + 1) % tabs.length], true);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        activate(tabs[(idx - 1 + tabs.length) % tabs.length], true);
      }
    });
  });

  return activate;
}

function triggerUpdateMotion(el, cls = 'is-updated') {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function setupRevealObserver() {
  const nodes = Array.from(document.querySelectorAll('[data-reveal]'));
  if (!nodes.length) return;

  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced || typeof IntersectionObserver !== 'function') {
    nodes.forEach((n) => n.classList.add('is-seen'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-seen');
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

  nodes.forEach((n) => io.observe(n));
}

function setupWorkbenchProbes() {
  const bindProbes = (listId, attr, map, outId) => {
    const list = document.getElementById(listId);
    const out = document.getElementById(outId);
    if (!list || !out) return;
    const btns = Array.from(list.querySelectorAll('button'));
    btns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute(attr);
        const info = map[key];
        if (!info) return;
        btns.forEach((b) => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
        out.querySelector('.probe-result__verdict').textContent = info.verdict;
        out.querySelector('.probe-result__detail').textContent = info.detail;
        triggerUpdateMotion(out);
      });
    });
  };

  bindProbes('shield-probe-list', 'data-probe', SHIELD_PROBES, 'engine-live-output');
  bindProbes('profile-probe-list', 'data-profile-sim', PROFILE_SIMS, 'profile-live-output');
  bindProbes('memory-probe-list', 'data-memory-sim', MEMORY_SIMS, 'memory-live-output');

  const previewImg = document.getElementById('workbench-preview-img');
  const workbenchFrame = previewImg ? previewImg.closest('.product-frame') : null;
  bindTabGroup('#engine [role="tab"]', (tab) => {
    if (!previewImg) return;
    if (tab.id === 'tab-profiles') {
      previewImg.src = './assets/screens/incognito.png';
      previewImg.alt = 'Crown isolated Private window with zero persisted browsing history';
      if (workbenchFrame) workbenchFrame.style.aspectRatio = '1490 / 993';
    } else if (tab.id === 'tab-memory') {
      previewImg.src = './assets/screens/settings.png';
      previewImg.alt = 'Crown Settings showing Memory Saver levels and Energy Saver controls';
      if (workbenchFrame) workbenchFrame.style.aspectRatio = '1917 / 1016';
    } else {
      previewImg.src = './assets/screens/newtab.png';
      previewImg.alt = 'Crown Browser workspace with Shield Guard request counters';
      if (workbenchFrame) workbenchFrame.style.aspectRatio = '1495 / 992';
    }
    triggerUpdateMotion(previewImg, 'is-swapping');
  });
}

function setupDownloads() {
  const heroBtn = document.getElementById('hero-download-btn');
  const heroLabel = document.getElementById('hero-download-label');
  const dlCard = document.querySelector('#downloads .download-card');
  const titleEl = document.getElementById('dl-title');
  const descEl = document.getElementById('dl-desc');
  const primaryBtn = document.getElementById('dl-primary-btn');
  const primaryLabel = document.getElementById('dl-primary-label');
  const secondaryBtn = document.getElementById('dl-secondary-btn');
  const previewEl = document.getElementById('dl-url-preview');
  const androidPreview = document.getElementById('dl-android-preview');

  const applyPlatform = (osKey, animate = false) => {
    const cfg = INSTALLERS[osKey] || INSTALLERS.windows;
    if (titleEl) titleEl.textContent = cfg.title;
    if (descEl) descEl.textContent = cfg.desc;
    if (primaryBtn) primaryBtn.href = cfg.primaryUrl;
    if (primaryLabel) primaryLabel.textContent = cfg.primaryLabel;
    if (secondaryBtn) {
      secondaryBtn.textContent = cfg.secondaryLabel;
      secondaryBtn.href = cfg.secondaryUrl;
    }
    if (previewEl) previewEl.textContent = cfg.preview;
    if (androidPreview) {
      androidPreview.hidden = osKey !== 'android';
    }
    if (dlCard) {
      dlCard.classList.toggle('download-card--android', osKey === 'android');
    }
    if (animate) triggerUpdateMotion(dlCard);
  };

  const activateOsTab = bindTabGroup('#downloads [role="tab"]', (tab) => {
    applyPlatform(tab.dataset.os || 'windows', true);
  });

  const detected = detectPlatform();
  const cfg = INSTALLERS[detected] || INSTALLERS.windows;
  if (heroBtn) heroBtn.href = cfg.heroUrl;
  if (heroLabel) heroLabel.textContent = cfg.heroLabel;

  const initialTab = document.getElementById(`os-tab-${detected}`);
  if (initialTab && activateOsTab) {
    activateOsTab(initialTab, false);
  } else {
    applyPlatform(detected, false);
  }
}

setupRevealObserver();
setupMobileDrawer();
setupWorkbenchProbes();
setupDownloads();
