// Crown Browser — Native Rust Core (Ultra-Low RAM Engine, Shield Gateway & Native Downloader)
pub mod cookie_jar;
pub mod crypto_vault;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Write;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::window::{Color, WindowBuilder};
use tauri::{LogicalPosition, LogicalSize, Manager, Rect, WebviewUrl};
#[cfg(not(desktop))]
use tauri::WebviewWindowBuilder;
use url::Url;

static INCOGNITO_WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(1);

// High-performance shared HTTP clients (avoids re-initializing TLS & DNS pools on every request)
static SHIELD_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static SUGGEST_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static DOWNLOAD_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

const MAX_HTML_BYTES: usize = 5 * 1024 * 1024; // 5 MB cap for HTML documents
const MAX_DOWNLOAD_BYTES: usize = 250 * 1024 * 1024; // 250 MB cap for direct downloads

const AD_DOMAINS: &[&str] = &[
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "adservice.google.com",
    "ads.youtube.com",
    "pagead2.googlesyndication.com",
    "adnxs.com",
    "criteo.com",
    "outbrain.com",
    "taboola.com",
    "rubiconproject.com",
    "pubmatic.com",
    "openx.net",
    "advertising.com",
    "adcolony.com",
    "applovin.com",
    "unityads.unity3d.com",
    "amazon-adsystem.com",
    "casale-media.com",
    "media.net",
    "smartadserver.com",
    "adroll.com",
    "bidswitch.net",
    "popads.net",
    "propellerads.com",
    "adblade.com",
    "inmobi.com",
    "revcontent.com",
    "mgid.com",
    "adsterra.com",
    "teads.tv",
    "zergnet.com",
];

const TRACKER_DOMAINS: &[&str] = &[
    "google-analytics.com",
    "analytics.google.com",
    "googletagmanager.com",
    "segment.io",
    "segment.com",
    "hotjar.com",
    "mixpanel.com",
    "amplitude.com",
    "quantserve.com",
    "scorecardresearch.com",
    "chartbeat.com",
    "newrelic.com",
    "nr-data.net",
    "mouseflow.com",
    "crazyegg.com",
    "fullstory.com",
    "heapanalytics.com",
    "clarity.ms",
    "inspectlet.com",
    "branch.io",
    "appsflyer.com",
    "adjust.com",
    "optimizely.com",
    "kissmetrics.com",
    "connect.facebook.net",
];

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ShieldEvalResult {
    pub blocked: bool,
    pub reason: Option<String>,
    pub clean_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProxiedPageResponse {
    pub html: String,
    pub final_url: String,
    pub status: u16,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DownloadResult {
    pub filename: String,
    pub file_path: String,
    pub total_bytes: usize,
}

fn host_matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{}", domain))
}

fn is_allowed_shell_navigation(parsed: &Url) -> bool {
    let scheme = parsed.scheme();
    if scheme == "tauri" || scheme == "about" {
        return true;
    }
    if scheme == "http" || scheme == "https" {
        if let Some(host) = parsed.host_str() {
            let h = host.to_lowercase();
            return h == "localhost" || h == "127.0.0.1" || h == "tauri.localhost";
        }
    }
    false
}

fn is_restricted_ipv4(v4: std::net::Ipv4Addr) -> bool {
    let octets = v4.octets();
    v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_broadcast()
        || v4.is_unspecified()
        || v4.is_multicast()
        // Shared address space (RFC 6598: 100.64.0.0/10)
        || (octets[0] == 100 && (octets[1] & 0b1100_0000) == 0b0100_0000)
        // Cloud metadata endpoint (169.254.169.254)
        || (octets[0] == 169 && octets[1] == 254)
}

fn is_restricted_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_restricted_ipv4(v4),
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() || v6.is_multicast() {
                return true;
            }
            // Check IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 or ::ffff:169.254.169.254)
            if let Some(mapped_v4) = v6.to_ipv4_mapped() {
                if is_restricted_ipv4(mapped_v4) {
                    return true;
                }
            }
            let seg0 = v6.segments()[0];
            // Unique Local Addresses (fc00::/7) and Link-Local (fe80::/10)
            let is_ula = (seg0 & 0xfe00) == 0xfc00;
            let is_link_local = (seg0 & 0xffc0) == 0xfe80;
            is_ula || is_link_local
        }
    }
}

// Guard against SSRF to loopback, link-local, cloud metadata, or private IPv4/IPv6 network addresses
fn is_restricted_network_host(host: &str) -> bool {
    let lower = host.trim().to_lowercase();
    if lower.is_empty()
        || lower == "localhost"
        || lower.ends_with(".localhost")
        || lower.ends_with(".local")
        || lower.ends_with(".internal")
    {
        return true;
    }
    let clean_ip = lower.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = clean_ip.parse::<IpAddr>() {
        return is_restricted_ip(ip);
    }
    false
}

// Cloudflare-grade port filter: blocks dangerous non-HTTP ports to prevent SSRF port scanning and protocol smuggling (SMTP, Redis, SSH, etc.)
fn is_unsafe_network_port(port: u16) -> bool {
    matches!(
        port,
        1 | 7 | 9 | 11 | 13 | 15 | 17 | 19 | 20 | 21 // FTP
        | 22 // SSH
        | 23 // Telnet
        | 25 // SMTP
        | 37 | 42 | 43 | 53 // DNS
        | 69 | 77 | 79 | 87 | 95
        | 101 | 102 | 103 | 104 | 109 | 110 // POP3
        | 111 | 113 | 115 | 117 | 119 | 123 | 135 | 137 | 139 // NetBIOS
        | 143 // IMAP
        | 179 | 389 | 465 | 512 | 513 | 514 | 515 | 526 | 530 | 531 | 532 | 540 | 556 | 563 | 587 | 601 | 636
        | 993 // IMAPS
        | 995 // POP3S
        | 2049 // NFS
        | 3306 // MySQL
        | 5432 // PostgreSQL
        | 6379 // Redis
        | 11211 // Memcached
        | 27017 // MongoDB
    )
}

static VERIFIED_PUBLIC_HOSTS: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();

fn get_verified_public_hosts() -> &'static RwLock<HashSet<String>> {
    VERIFIED_PUBLIC_HOSTS.get_or_init(|| {
        let mut set = HashSet::new();
        for host in [
            "www.youtube.com",
            "youtube.com",
            "m.youtube.com",
            "music.youtube.com",
            "www.youtube-nocookie.com",
            "youtu.be",
            "www.google.com",
            "google.com",
            "duckduckgo.com",
            "www.bing.com",
            "github.com",
            "en.wikipedia.org",
            "www.wikipedia.org",
            "www.reddit.com",
            "reddit.com",
        ] {
            set.insert(host.to_string());
        }
        RwLock::new(set)
    })
}

// Cloudflare-grade DNS-resolving SSRF & DNS rebinding guard: verifies resolved IP targets
async fn is_restricted_network_host_async(host: &str) -> bool {
    if is_restricted_network_host(host) {
        return true;
    }
    let lower = host.trim().to_lowercase();
    let clean_host = lower.trim_start_matches('[').trim_end_matches(']').to_string();
    if let Ok(guard) = get_verified_public_hosts().read() {
        if guard.contains(&clean_host) {
            return false;
        }
    }
    let host_for_lookup = clean_host.clone();
    let res = tauri::async_runtime::spawn_blocking(move || {
        let target = format!("{}:80", host_for_lookup);
        std::net::ToSocketAddrs::to_socket_addrs(&target).map(|iter| iter.collect::<Vec<_>>())
    })
    .await;

    if let Ok(Ok(addrs)) = res {
        for addr in &addrs {
            if is_restricted_ip(addr.ip()) {
                return true;
            }
        }
        if !addrs.is_empty() {
            if let Ok(mut guard) = get_verified_public_hosts().write() {
                if guard.len() < 2048 {
                    guard.insert(clean_host);
                }
            }
        }
    }
    false
}

fn build_ssrf_safe_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 8 {
            return attempt.error("Too many redirects");
        }
        let url = attempt.url();
        let scheme = url.scheme().to_lowercase();
        if scheme != "http" && scheme != "https" {
            return attempt.error("Redirected to unsupported scheme");
        }
        if !url.username().is_empty() || url.password().is_some() {
            return attempt.error("Redirected URL contains embedded credentials");
        }
        if let Some(port) = url.port() {
            if is_unsafe_network_port(port) {
                return attempt.error("Redirected to unsafe network port");
            }
        }
        if let Some(host) = url.host_str() {
            if is_restricted_network_host(host) {
                return attempt.error("Redirected to restricted local or private network host");
            }
        } else {
            return attempt.error("Redirected URL missing host");
        }
        attempt.follow()
    })
}

fn get_shield_client() -> &'static reqwest::Client {
    SHIELD_HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .tcp_nodelay(true)
            .redirect(build_ssrf_safe_redirect_policy())
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
            .build()
            .expect("Failed to initialize Crown Shield HTTP client")
    })
}

fn get_suggest_client() -> &'static reqwest::Client {
    SUGGEST_HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_millis(1200))
            .tcp_nodelay(true)
            .redirect(build_ssrf_safe_redirect_policy())
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0")
            .build()
            .expect("Failed to initialize Crown Suggest HTTP client")
    })
}

fn get_download_client() -> &'static reqwest::Client {
    DOWNLOAD_HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .tcp_nodelay(true)
            .redirect(build_ssrf_safe_redirect_policy())
            .build()
            .expect("Failed to initialize Crown Download HTTP client")
    })
}

pub fn evaluate_url_internal(url_str: &str) -> ShieldEvalResult {
    let clean_url = url_str.to_string();
    let trimmed = url_str.trim();

    let parsed = match Url::parse(trimmed) {
        Ok(u) => u,
        Err(_) => {
            return ShieldEvalResult {
                blocked: true,
                reason: Some("invalid_url".to_string()),
                clean_url,
            };
        }
    };

    let scheme = parsed.scheme().to_lowercase();
    if scheme != "https" && scheme != "http" && scheme != "tauri" && scheme != "about" {
        return ShieldEvalResult {
            blocked: true,
            reason: Some("unsafe_scheme".to_string()),
            clean_url,
        };
    }

    // Block credential-embedded phishing URLs (e.g., https://google.com@attacker.com)
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return ShieldEvalResult {
            blocked: true,
            reason: Some("embedded_credentials".to_string()),
            clean_url,
        };
    }

    let host = parsed.host_str().unwrap_or("").to_lowercase();
    let path_lower = parsed.path().to_lowercase();

    let is_ad = AD_DOMAINS.iter().any(|d| host_matches(&host, d));
    let is_tracker = TRACKER_DOMAINS.iter().any(|d| host_matches(&host, d))
        || (host_matches(&host, "facebook.net") && path_lower.contains("/fbevents.js"));

    if is_ad {
        ShieldEvalResult {
            blocked: true,
            reason: Some("ad".to_string()),
            clean_url,
        }
    } else if is_tracker {
        ShieldEvalResult {
            blocked: true,
            reason: Some("tracker".to_string()),
            clean_url,
        }
    } else {
        ShieldEvalResult {
            blocked: false,
            reason: None,
            clean_url,
        }
    }
}

fn build_shield_injection(base_url: &str, shield_enabled: bool, cosmetic_css: &str, extension_js: &str, tab_id: &str) -> String {
    let safe_base = base_url.replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;");
    let safe_tab_id = tab_id.replace('"', "").replace('\\', "");
    let ad_json = serde_json::to_string(AD_DOMAINS).unwrap_or_else(|_| "[]".to_string());
    let tracker_json = serde_json::to_string(TRACKER_DOMAINS).unwrap_or_else(|_| "[]".to_string());
    let safe_css = cosmetic_css.replace("</style", "<\\/style");
    let safe_ext_js = extension_js.replace("</script", "<\\/script");

    format!(
        r#"<base href="{safe_base}">
<style id="crown-shield-cosmetic">{safe_css}</style>
<script>
(function() {{
  const CROWN_TAB_ID = "{safe_tab_id}";
  const SHIELD_ON = {shield_enabled};
  const AD_LIST = {ad_json};
  const TRACKER_LIST = {tracker_json};

  function matchHost(urlStr, list) {{
    try {{
      const h = new URL(urlStr, document.baseURI).hostname.toLowerCase();
      return list.some(d => h === d || h.endsWith('.' + d)) ? h : null;
    }} catch (e) {{
      return null;
    }}
  }}

  function checkBlock(urlStr, method) {{
    const m = method || 'GET';
    if (!SHIELD_ON || !urlStr) {{
      try {{ window.parent.postMessage({{ type: 'crown:devtools-net', tabId: CROWN_TAB_ID, method: m, url: String(urlStr || ''), status: 'ALLOW', kind: 'request' }}, '*'); }} catch(e){{}}
      return false;
    }}
    const adHost = matchHost(urlStr, AD_LIST);
    if (adHost) {{
      try {{
        window.parent.postMessage({{ type: 'crown:shield-block', tabId: CROWN_TAB_ID, kind: 'ad', target: adHost }}, '*');
        window.parent.postMessage({{ type: 'crown:devtools-net', tabId: CROWN_TAB_ID, method: m, url: String(urlStr), status: 'BLOCKED (Ad)', kind: 'ad' }}, '*');
      }} catch(e){{}}
      return true;
    }}
    const trkHost = matchHost(urlStr, TRACKER_LIST);
    if (trkHost) {{
      try {{
        window.parent.postMessage({{ type: 'crown:shield-block', tabId: CROWN_TAB_ID, kind: 'tracker', target: trkHost }}, '*');
        window.parent.postMessage({{ type: 'crown:devtools-net', tabId: CROWN_TAB_ID, method: m, url: String(urlStr), status: 'BLOCKED (Tracker)', kind: 'tracker' }}, '*');
      }} catch(e){{}}
      return true;
    }}
    try {{ window.parent.postMessage({{ type: 'crown:devtools-net', tabId: CROWN_TAB_ID, method: m, url: String(urlStr), status: 'ALLOW', kind: 'request' }}, '*'); }} catch(e){{}}
    return false;
  }}

  const origFetch = window.fetch;
  if (origFetch) {{
    window.fetch = function(input, init) {{
      const u = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      const m = (init && init.method) ? init.method : 'FETCH';
      if (checkBlock(u, m)) return Promise.reject(new Error('Blocked by Crown Shield'));
      return origFetch.apply(this, arguments);
    }};
  }}

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {{
    if (checkBlock(String(url || ''), String(method || 'XHR'))) {{
      this._crownBlocked = true;
    }}
    return origOpen.apply(this, arguments);
  }};
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {{
    if (this._crownBlocked) return;
    return origSend.apply(this, arguments);
  }};

  // DevTools Console Forwarding Bridge
  ['log', 'info', 'warn', 'error'].forEach(function(level) {{
    const orig = console[level];
    if (typeof orig === 'function') {{
      console[level] = function() {{
        try {{
          const args = Array.prototype.slice.call(arguments).map(function(a) {{
            if (typeof a === 'object' && a !== null) {{
              try {{ return JSON.stringify(a); }} catch(e) {{ return String(a); }}
            }}
            return String(a);
          }}).join(' ');
          window.parent.postMessage({{ type: 'crown:devtools-log', tabId: CROWN_TAB_ID, level: level, text: args }}, '*');
        }} catch(e) {{}}
        return orig.apply(console, arguments);
      }};
    }}
  }});

  // DevTools DOM Inspector & Sandboxed Eval Bridge
  function serializeDomNode(el, depth) {{
    if (!el || depth > 5) return null;
    const tag = (el.tagName || '').toLowerCase();
    if (!tag) return null;
    const id = el.id || '';
    const cls = typeof el.className === 'string' ? el.className.trim() : '';
    const attrs = [];
    if (el.attributes) {{
      for (let i = 0; i < Math.min(el.attributes.length, 5); i++) {{
        const at = el.attributes[i];
        if (at.name !== 'id' && at.name !== 'class' && at.name !== 'style') {{
          attrs.push({{ name: at.name, value: String(at.value || '').slice(0, 60) }});
        }}
      }}
    }}
    let textSnippet = '';
    for (let i = 0; i < el.childNodes.length; i++) {{
      if (el.childNodes[i].nodeType === 3) {{
        const t = el.childNodes[i].textContent.trim();
        if (t) {{ textSnippet = t.slice(0, 80); break; }}
      }}
    }}
    const children = [];
    if (depth < 5 && el.children) {{
      const maxChildren = depth < 2 ? 25 : 12;
      for (let i = 0; i < Math.min(el.children.length, maxChildren); i++) {{
        const childObj = serializeDomNode(el.children[i], depth + 1);
        if (childObj) children.push(childObj);
      }}
    }}
    return {{
      tag: tag,
      id: id,
      cls: cls,
      attrs: attrs,
      text: textSnippet,
      totalChildren: el.children ? el.children.length : 0,
      children: children
    }};
  }}

  let crownTabMuted = false;
  function applyMediaMuteState(muted) {{
    crownTabMuted = Boolean(muted);
    document.querySelectorAll('video, audio').forEach(function(m) {{
      try {{ m.muted = crownTabMuted; }} catch(err) {{}}
    }});
  }}

  document.addEventListener('pointerdown', function() {{
    try {{
      if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {{
        window.chrome.webview.postMessage('crown:child-pointerdown');
      }}
    }} catch(e) {{}}
  }}, true);

  document.addEventListener('keydown', function(e) {{
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    let zoomMsg = null;
    if (e.key === '=' || e.key === '+') zoomMsg = 'crown:zoom:in';
    else if (e.key === '-' || e.key === '_') zoomMsg = 'crown:zoom:out';
    else if (e.key === '0') zoomMsg = 'crown:zoom:reset';
    if (zoomMsg) {{
      e.preventDefault();
      try {{
        if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {{
          window.chrome.webview.postMessage(zoomMsg);
        }}
      }} catch(err) {{}}
    }}
  }}, true);

  window.addEventListener('wheel', function(e) {{
    if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return;
    e.preventDefault();
    const zoomMsg = e.deltaY < 0 ? 'crown:zoom:in' : 'crown:zoom:out';
    try {{
      if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {{
        window.chrome.webview.postMessage(zoomMsg);
      }}
    }} catch(err) {{}}
  }}, {{ passive: false, capture: true }});

  document.addEventListener('play', function(e) {{
    if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {{
      if (crownTabMuted) {{
        try {{ e.target.muted = true; }} catch(err) {{}}
      }}
      try {{ window.parent.postMessage({{ type: 'crown:media-state', tabId: CROWN_TAB_ID, playing: true }}, '*'); }} catch(err) {{}}
    }}
  }}, true);

  document.addEventListener('pause', function(e) {{
    if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {{
      const anyPlaying = Array.from(document.querySelectorAll('video, audio')).some(function(m) {{ return !m.paused && !m.ended; }});
      try {{ window.parent.postMessage({{ type: 'crown:media-state', tabId: CROWN_TAB_ID, playing: anyPlaying }}, '*'); }} catch(err) {{}}
    }}
  }}, true);

  window.addEventListener('message', function(e) {{
    if (!e.isTrusted || e.source !== window.parent || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'crown:devtools-request-dom') {{
      try {{
        const tree = serializeDomNode(document.documentElement, 0);
        const totalNodes = document.getElementsByTagName('*').length;
        const scriptsCount = document.scripts ? document.scripts.length : 0;
        const stylesCount = document.styleSheets ? document.styleSheets.length : 0;
        window.parent.postMessage({{
          type: 'crown:devtools-dom',
          tabId: CROWN_TAB_ID,
          tree: tree,
          metrics: {{
            url: document.baseURI,
            title: document.title || '',
            totalNodes: totalNodes,
            scriptsCount: scriptsCount,
            stylesCount: stylesCount
          }}
        }}, '*');
      }} catch (err) {{}}
    }} else if (e.data.type === 'crown:devtools-eval') {{
      try {{
        const code = String(e.data.code || '');
        const res = (0, eval)(code);
        let formatted = '';
        if (typeof res === 'object' && res !== null) {{
          try {{ formatted = JSON.stringify(res, null, 2); }} catch(err) {{ formatted = String(res); }}
        }} else {{
          formatted = String(res);
        }}
        window.parent.postMessage({{ type: 'crown:devtools-log', tabId: CROWN_TAB_ID, level: 'result', text: formatted }}, '*');
      }} catch (err) {{
        window.parent.postMessage({{ type: 'crown:devtools-log', tabId: CROWN_TAB_ID, level: 'error', text: String(err) }}, '*');
      }}
    }} else if (e.data.type === 'crown:apply-page-settings') {{
      try {{
        const styleEl = document.getElementById('crown-shield-cosmetic');
        if (styleEl && typeof e.data.css === 'string') {{
          styleEl.textContent = e.data.css;
        }}
        if (document.body && typeof e.data.spellcheck === 'boolean') {{
          document.body.spellcheck = e.data.spellcheck;
        }}
        const extScript = typeof e.data.js === 'string' ? e.data.js : (typeof e.data.extJs === 'string' ? e.data.extJs : '');
        if (extScript.trim()) {{
          (0, eval)(extScript);
        }}
      }} catch (err) {{}}
    }} else if (e.data.type === 'crown:set-muted') {{
      applyMediaMuteState(e.data.muted);
    }} else if (e.data.type === 'crown:extract-article') {{
      extractArticleContent();
    }}
  }});

  function escapeHtml(str) {{
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }}

  function extractArticleContent() {{
    try {{
      const title = document.title || '';
      let articleTitle = title;
      const h1 = document.querySelector('article h1, main h1, h1, .mw-first-heading');
      if (h1 && h1.textContent.trim()) {{
        articleTitle = h1.textContent.trim();
      }}
      const contentRoot = document.querySelector('article, [itemprop="articleBody"], .mw-parser-output, .article-content, .article-body, .post-content, .entry-content, #content, main, [role="main"]') || document.body;
      const parserDoc = contentRoot ? contentRoot.cloneNode(true) : document.createElement('div');
      parserDoc.querySelectorAll('script, style, nav, footer, header, aside, iframe, noscript, svg, form, .mw-editsection, .navbox, .sidebar, .reference, .reflist, .catlinks, .thumbcaption .magnify, [role="navigation"], [role="banner"], [role="contentinfo"]').forEach(function(el) {{ el.remove(); }});

      const blocks = [];
      let wordCount = 0;
      parserDoc.querySelectorAll('h2, h3, h4, p, blockquote, pre, ul, ol, figure').forEach(function(node) {{
        const tag = node.tagName.toLowerCase();
        if (tag === 'p') {{
          const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
          if (text.length >= 20) {{
            wordCount += text.split(/\\s+/).length;
            blocks.push('<p>' + escapeHtml(text) + '</p>');
          }}
        }} else if (tag === 'h2' || tag === 'h3' || tag === 'h4') {{
          const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
          if (text && text.length < 140) {{
            blocks.push('<' + tag + '>' + escapeHtml(text) + '</' + tag + '>');
          }}
        }} else if (tag === 'blockquote') {{
          const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
          if (text) {{
            wordCount += text.split(/\\s+/).length;
            blocks.push('<blockquote>' + escapeHtml(text) + '</blockquote>');
          }}
        }} else if (tag === 'pre') {{
          const text = node.textContent || '';
          if (text.trim()) {{
            blocks.push('<pre><code>' + escapeHtml(text) + '</code></pre>');
          }}
        }} else if (tag === 'ul' || tag === 'ol') {{
          const items = [];
          node.querySelectorAll(':scope > li').forEach(function(li) {{
            const liText = (li.textContent || '').replace(/\\s+/g, ' ').trim();
            if (liText) {{
              wordCount += liText.split(/\\s+/).length;
              items.push('<li>' + escapeHtml(liText) + '</li>');
            }}
          }});
          if (items.length > 0 && items.length <= 30) {{
            blocks.push('<' + tag + '>' + items.join('') + '</' + tag + '>');
          }}
        }} else if (tag === 'figure') {{
          const img = node.querySelector('img[src]');
          if (img) {{
            const src = img.getAttribute('src');
            const alt = img.getAttribute('alt') || '';
            if (src && (/^https?:\\/\\//i.test(src) || /^data:image\\//i.test(src))) {{
              const capEl = node.querySelector('figcaption');
              const caption = capEl ? capEl.textContent.trim() : alt;
              blocks.push('<figure class="reader-figure"><img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '" loading="lazy" />' + (caption ? '<figcaption>' + escapeHtml(caption) + '</figcaption>' : '') + '</figure>');
            }}
          }}
        }}
      }});

      const activeUrl = (document.baseURI && /^https?:\\/\\//i.test(document.baseURI)) ? document.baseURI : (window.location.href || '{safe_base}');
      window.parent.postMessage({{
        type: 'crown:article-extracted',
        tabId: CROWN_TAB_ID,
        title: articleTitle,
        blocks: blocks,
        wordCount: wordCount,
        url: activeUrl
      }}, '*');
    }} catch(err) {{
      window.parent.postMessage({{
        type: 'crown:article-extracted',
        tabId: CROWN_TAB_ID,
        error: String(err),
        url: window.location.href || document.baseURI
      }}, '*');
    }}
  }}

  let virtualCurrentUrl = '{safe_base}';
  let pendingCandidateUrl = null;
  let pendingCandidateTimer = null;

  function setPendingCandidate(urlStr) {{
    if (!urlStr) return;
    pendingCandidateUrl = urlStr;
    if (pendingCandidateTimer) clearTimeout(pendingCandidateTimer);
    pendingCandidateTimer = setTimeout(function() {{
      pendingCandidateUrl = null;
    }}, 2500);
  }}

  function resolveVirtualUrl(nextUrlArg) {{
    if (nextUrlArg && typeof nextUrlArg === 'string') {{
      try {{
        const resolved = new URL(nextUrlArg, virtualCurrentUrl || document.baseURI || '{safe_base}');
        if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {{
          virtualCurrentUrl = resolved.toString();
        }}
      }} catch (e) {{}}
    }}
  }}

  function notifyUrlChange() {{
    try {{
      let currentUrl = window.location.href;
      if (!currentUrl || currentUrl.startsWith('about:srcdoc') || currentUrl === 'about:blank') {{
        currentUrl = virtualCurrentUrl || document.baseURI || '{safe_base}';
      }} else {{
        virtualCurrentUrl = currentUrl;
      }}
      if (currentUrl && currentUrl !== 'about:blank' && !currentUrl.startsWith('about:srcdoc')) {{
        window.parent.postMessage({{
          type: 'crown:page-url-change',
          tabId: CROWN_TAB_ID,
          url: currentUrl,
          title: document.title || ''
        }}, '*');
      }}
    }} catch (e) {{}}
  }}

  const origPushState = history.pushState;
  if (origPushState) {{
    history.pushState = function() {{
      const ret = origPushState.apply(this, arguments);
      if (arguments.length >= 3 && arguments[2] !== undefined && arguments[2] !== null) {{
        resolveVirtualUrl(String(arguments[2]));
      }}
      notifyUrlChange();
      return ret;
    }};
  }}
  const origReplaceState = history.replaceState;
  if (origReplaceState) {{
    history.replaceState = function() {{
      const ret = origReplaceState.apply(this, arguments);
      if (arguments.length >= 3 && arguments[2] !== undefined && arguments[2] !== null) {{
        resolveVirtualUrl(String(arguments[2]));
      }}
      notifyUrlChange();
      return ret;
    }};
  }}
  window.addEventListener('popstate', notifyUrlChange, {{ passive: true }});
  window.addEventListener('hashchange', notifyUrlChange, {{ passive: true }});

  function normalizeCandidateUrl(rawTarget) {{
    if (!rawTarget || typeof rawTarget !== 'string') return null;
    let target = rawTarget.trim();
    if (!target || target.startsWith('#') || target.startsWith('javascript:') || target.startsWith('mailto:') || target.startsWith('tel:')) return null;
    if (target.startsWith('//')) {{
      target = 'https:' + target;
    }}
    const base = (document.baseURI && /^https?:\\/\\//i.test(document.baseURI))
      ? document.baseURI
      : '{safe_base}';
    try {{
      const resolved = new URL(target, base);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {{
        return resolved;
      }}
    }} catch (err) {{}}
    return null;
  }}

  function dispatchCrownNav(urlObj, isNewTab) {{
    if (!urlObj) return;
    const urlStr = urlObj.toString();
    if (isNewTab) {{
      window.parent.postMessage({{ type: 'crown:page-open-new-tab', tabId: CROWN_TAB_ID, url: urlStr }}, '*');
    }} else {{
      window.parent.postMessage({{ type: 'crown:page-nav', tabId: CROWN_TAB_ID, url: urlStr, title: document.title || urlObj.hostname }}, '*');
    }}
  }}

  function resolveSafeLink(el) {{
    if (!el || !el.closest) return null;
    const a = el.closest('a[href], area[href]');
    if (a) {{
      const rawHref = a.getAttribute('href') || '';
      return normalizeCandidateUrl(rawHref);
    }}
    const dataLink = el.closest('[data-href], [data-url]');
    if (dataLink) {{
      const rawData = dataLink.getAttribute('data-href') || dataLink.getAttribute('data-url') || '';
      return normalizeCandidateUrl(rawData);
    }}
    return null;
  }}

  function handleFormSubmission(form) {{
    if (!form || (form.method && form.method.toLowerCase() === 'post')) return false;
    try {{
      const rawAction = form.getAttribute('action') || '';
      const actionUrl = normalizeCandidateUrl(rawAction) || normalizeCandidateUrl(window.location.href) || normalizeCandidateUrl('{safe_base}');
      if (!actionUrl) return false;

      const elements = form.elements || [];
      for (let i = 0; i < elements.length; i++) {{
        const el = elements[i];
        if (!el || !el.name || el.disabled) continue;
        const type = (el.type || '').toLowerCase();
        if ((type === 'radio' || type === 'checkbox') && !el.checked) continue;
        if (type === 'submit' || type === 'button' || type === 'reset' || type === 'file' || type === 'image') continue;
        if (el.value !== undefined && el.value !== null) {{
          actionUrl.searchParams.set(el.name, el.value);
        }}
      }}
      const targetAttr = (form.getAttribute('target') || '').toLowerCase();
      dispatchCrownNav(actionUrl, targetAttr === '_blank');
      return true;
    }} catch (err) {{
      return false;
    }}
  }}

  document.addEventListener('submit', function(e) {{
    const form = e.target;
    if (handleFormSubmission(form)) {{
      e.preventDefault();
      e.stopPropagation();
    }}
  }}, true);

  try {{
    const origFormSubmit = HTMLFormElement.prototype.submit;
    if (origFormSubmit) {{
      HTMLFormElement.prototype.submit = function() {{
        if (handleFormSubmission(this)) {{
          return;
        }}
        return origFormSubmit.apply(this, arguments);
      }};
    }}
  }} catch(e) {{}}

  try {{
    const origAnchorClick = HTMLAnchorElement.prototype.click;
    if (origAnchorClick) {{
      HTMLAnchorElement.prototype.click = function() {{
        const resolved = resolveSafeLink(this);
        if (resolved) {{
          const targetAttr = (this.getAttribute('target') || '').toLowerCase();
          dispatchCrownNav(resolved, targetAttr === '_blank');
          return;
        }}
        return origAnchorClick.apply(this, arguments);
      }};
    }}
  }} catch(e) {{}}

  const origWindowOpen = window.open;
  window.open = function(url, target) {{
    const normalized = normalizeCandidateUrl(String(url || ''));
    if (normalized) {{
      const isNewTab = target !== '_self' && target !== '_top' && target !== '_parent' && Boolean(target);
      dispatchCrownNav(normalized, isNewTab);
      return null;
    }}
    if (origWindowOpen) {{
      return origWindowOpen.apply(this, arguments);
    }}
    return null;
  }};

  const origAssign = window.location.assign;
  if (origAssign) {{
    try {{
      window.location.assign = function(url) {{
        const normalized = normalizeCandidateUrl(String(url || ''));
        if (normalized) {{
          dispatchCrownNav(normalized, false);
        }}
      }};
    }} catch(e) {{}}
  }}
  const origReplace = window.location.replace;
  if (origReplace) {{
    try {{
      window.location.replace = function(url) {{
        const normalized = normalizeCandidateUrl(String(url || ''));
        if (normalized) {{
          dispatchCrownNav(normalized, false);
        }}
      }};
    }} catch(e) {{}}
  }}

  document.addEventListener('click', function(e) {{
    if (autoScrollActive) {{
      stopAutoScroll();
      e.preventDefault();
      return;
    }}
    const resolved = resolveSafeLink(e.target);
    if (!resolved) return;
    const a = e.target.closest('a[href], area[href]');
    const targetAttr = (a && a.getAttribute('target') || '').toLowerCase();
    const isNewTab = Boolean(e.ctrlKey || e.metaKey || e.shiftKey || targetAttr === '_blank');
    e.preventDefault();
    e.stopPropagation();
    dispatchCrownNav(resolved, isNewTab);
  }}, true);

  document.addEventListener('auxclick', function(e) {{
    if (e.button !== 1) return;
    const resolved = resolveSafeLink(e.target);
    if (resolved) {{
      e.preventDefault();
      e.stopPropagation();
      dispatchCrownNav(resolved, true);
    }}
  }}, true);

  // Middle-Click (Scroll-Click) Mouse-Movement Auto-Scroll Engine
  let autoScrollActive = false;
  let autoOriginX = 0;
  let autoOriginY = 0;
  let autoCurX = 0;
  let autoCurY = 0;
  let autoRafId = null;
  let autoMarker = null;

  function stopAutoScroll() {{
    autoScrollActive = false;
    if (autoRafId) {{
      cancelAnimationFrame(autoRafId);
      autoRafId = null;
    }}
    if (autoMarker && autoMarker.parentNode) {{
      autoMarker.parentNode.removeChild(autoMarker);
    }}
    autoMarker = null;
  }}

  function stepAutoScroll() {{
    if (!autoScrollActive) return;
    const dx = autoCurX - autoOriginX;
    const dy = autoCurY - autoOriginY;
    const vx = Math.abs(dx) > 8 ? (dx - Math.sign(dx) * 8) * 0.14 : 0;
    const vy = Math.abs(dy) > 8 ? (dy - Math.sign(dy) * 8) * 0.16 : 0;
    if (vx !== 0 || vy !== 0) {{
      window.scrollBy(vx, vy);
    }}
    autoRafId = requestAnimationFrame(stepAutoScroll);
  }}

  document.addEventListener('mousedown', function(e) {{
    try {{ window.parent.postMessage({{ type: 'crown:frame-focus', tabId: CROWN_TAB_ID }}, '*'); }} catch(err) {{}}
    if (e.button === 0) {{
      const cand = resolveSafeLink(e.target);
      if (cand) {{
        setPendingCandidate(cand.toString());
        const isSuggestion = e.target && e.target.closest && e.target.closest('.suggestion-link, .suggestions-dropdown a, [role="option"], [role="listbox"] a');
        if (isSuggestion) {{
          const a = e.target.closest('a[href], area[href]');
          const targetAttr = (a && a.getAttribute('target') || '').toLowerCase();
          const isNewTab = Boolean(e.ctrlKey || e.metaKey || e.shiftKey || targetAttr === '_blank');
          e.preventDefault();
          e.stopPropagation();
          dispatchCrownNav(cand, isNewTab);
          return;
        }}
      }}
    }}
    if (e.button === 1) {{
      if (resolveSafeLink(e.target)) {{
        e.preventDefault();
        return;
      }}
      if (e.target && e.target.closest && e.target.closest('input, textarea, select, button, [contenteditable]')) {{
        return;
      }}
      e.preventDefault();
      if (autoScrollActive) {{
        stopAutoScroll();
        return;
      }}
      autoScrollActive = true;
      autoOriginX = e.clientX;
      autoOriginY = e.clientY;
      autoCurX = e.clientX;
      autoCurY = e.clientY;

      autoMarker = document.createElement('div');
      autoMarker.style.cssText = 'position:fixed;z-index:2147483647;width:26px;height:26px;border-radius:50%;background:#141519;color:#e6ca85;border:1.5px solid #e6ca85;box-shadow:0 4px 12px rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;pointer-events:none;transform:translate(-50%,-50%);left:' + autoOriginX + 'px;top:' + autoOriginY + 'px;';
      autoMarker.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 9 5-5 5 5"/><path d="m7 15 5 5 5-5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>';
      document.documentElement.appendChild(autoMarker);
      autoRafId = requestAnimationFrame(stepAutoScroll);
    }} else if (autoScrollActive) {{
      stopAutoScroll();
    }}
  }}, true);

  window.addEventListener('mousemove', function(e) {{
    if (!autoScrollActive) return;
    autoCurX = e.clientX;
    autoCurY = e.clientY;
  }}, true);

  window.addEventListener('wheel', function() {{
    if (autoScrollActive) stopAutoScroll();
  }}, {{ passive: true }});

  window.addEventListener('keydown', function(e) {{
    if (autoScrollActive && e.key === 'Escape') stopAutoScroll();
    if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i')) {{
      e.preventDefault();
      try {{ window.parent.postMessage({{ type: 'crown:toggle-devtools', tabId: CROWN_TAB_ID }}, '*'); }} catch(err) {{}}
      return;
    }}
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {{
      const tgt = e.target;
      if (tgt && tgt.tagName === 'INPUT') {{
        const inputType = (tgt.type || 'text').toLowerCase();
        if (inputType === 'text' || inputType === 'search' || inputType === 'url' || tgt.getAttribute('role') === 'combobox' || tgt.getAttribute('role') === 'searchbox') {{
          const activeSugg = document.querySelector('.suggestion-link.active, .suggestions-dropdown a.active, [aria-selected="true"] a[href], [role="option"][aria-selected="true"]');
          if (activeSugg) {{
            const resolvedSugg = resolveSafeLink(activeSugg);
            if (resolvedSugg) {{
              e.preventDefault();
              e.stopPropagation();
              dispatchCrownNav(resolvedSugg, Boolean(e.ctrlKey || e.metaKey));
              return;
            }}
          }}
          const form = tgt.form || (tgt.closest ? tgt.closest('form') : null);
          if (form && handleFormSubmission(form)) {{
            e.preventDefault();
            e.stopPropagation();
            return;
          }}
        }}
      }}
    }}
  }}, true);

  function flushPendingNavOnUnload() {{
    if (pendingCandidateUrl) {{
      const targetUrl = pendingCandidateUrl;
      pendingCandidateUrl = null;
      try {{
        window.parent.postMessage({{
          type: 'crown:page-nav',
          tabId: CROWN_TAB_ID,
          url: targetUrl,
          title: document.title || ''
        }}, '*');
      }} catch (err) {{}}
    }}
  }}
  window.addEventListener('beforeunload', flushPendingNavOnUnload, {{ passive: true }});
  window.addEventListener('pagehide', flushPendingNavOnUnload, {{ passive: true }});

  window.addEventListener('DOMContentLoaded', function() {{
    notifyUrlChange();
    try {{
      if (document.title) {{
        const titleUrl = virtualCurrentUrl || ((document.baseURI && /^https?:\\/\\//i.test(document.baseURI)) ? document.baseURI : '{safe_base}');
        window.parent.postMessage({{ type: 'crown:page-title', tabId: CROWN_TAB_ID, title: document.title, url: titleUrl }}, '*');
      }}
    }} catch (e) {{}}
    try {{
      {safe_ext_js}
    }} catch (extErr) {{
      console.warn('[Crown Extension Sandbox]', extErr);
    }}
  }});
  window.addEventListener('load', notifyUrlChange, {{ passive: true }});
}})();
</script>"#
    )
}

fn is_valid_cookie_domain(specified_domain: &str, origin_host: &str) -> bool {
    let clean_spec = specified_domain.trim().trim_start_matches('.').to_lowercase();
    let clean_origin = origin_host.trim().trim_start_matches('.').to_lowercase();

    if clean_spec.is_empty() || clean_origin.is_empty() {
        return false;
    }

    if clean_spec.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }

    if clean_origin.parse::<std::net::IpAddr>().is_ok() {
        return clean_spec == clean_origin;
    }

    if !clean_spec.contains('.') {
        return false;
    }

    clean_origin == clean_spec || clean_origin.ends_with(&format!(".{}", clean_spec))
}

fn parse_and_commit_cookies(
    headers: &reqwest::header::HeaderMap,
    origin_host: &str,
    cookie_jar: &cookie_jar::SystemCookieJar,
) {
    let origin_clean = origin_host.trim().trim_start_matches('.').to_lowercase();
    for val in headers.get_all(reqwest::header::SET_COOKIE) {
        if let Ok(cookie_str) = val.to_str() {
            let parts: Vec<&str> = cookie_str.split(';').map(|s| s.trim()).collect();
            if let Some(first) = parts.first() {
                if let Some((name, value)) = first.split_once('=') {
                    let mut domain = origin_clean.clone();
                    let mut path = "/".to_string();
                    let mut secure = false;
                    let mut http_only = false;

                    for part in &parts[1..] {
                        let lower = part.to_ascii_lowercase();
                        if let Some((k, v)) = part.split_once('=') {
                            let kl = k.trim().to_ascii_lowercase();
                            if kl == "domain" {
                                let candidate = v.trim().trim_start_matches('.').to_string();
                                if is_valid_cookie_domain(&candidate, &origin_clean) {
                                    domain = candidate.to_lowercase();
                                } else {
                                    domain = origin_clean.clone();
                                }
                            } else if kl == "path" {
                                path = v.trim().to_string();
                            }
                        } else if lower == "secure" {
                            secure = true;
                        } else if lower == "httponly" {
                            http_only = true;
                        }
                    }

                    let cookie_domain = domain.clone();
                    cookie_jar.commit_cookie(
                        &domain,
                        cookie_jar::CookieInfo {
                            name: name.trim().to_string(),
                            value: value.trim().to_string(),
                            domain: cookie_domain,
                            path,
                            secure,
                            http_only,
                        },
                    );
                }
            }
        }
    }
}

// Fetch a webpage through Rust reqwest, stripping X-Frame-Options & CSP frame-ancestors and injecting Crown Shield
#[tauri::command]
async fn fetch_page_with_shield(
    url: String,
    shield_enabled: bool,
    cosmetic_css: String,
    accept_language: Option<String>,
    send_gpc: Option<bool>,
    extension_js: Option<String>,
    tab_id: Option<String>,
    cookie_jar: tauri::State<'_, cookie_jar::SystemCookieJar>,
) -> Result<ProxiedPageResponse, String> {
    let parsed = Url::parse(url.trim()).map_err(|e| format!("Invalid URL: {}", e))?;
    let scheme = parsed.scheme().to_lowercase();
    if scheme != "https" && scheme != "http" {
        return Err("Only http:// and https:// URLs are supported".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Embedded credentials are not allowed".to_string());
    }
    let host = parsed.host_str().unwrap_or("");
    if is_restricted_network_host_async(host).await {
        return Err("Restricted local/private network address".to_string());
    }
    let port = parsed.port_or_known_default().unwrap_or(80);
    if is_unsafe_network_port(port) {
        return Err("Target port is blocked for security reasons".to_string());
    }

    let eval = evaluate_url_internal(parsed.as_str());
    if shield_enabled && eval.blocked {
        return Err(format!("Blocked by Crown Shield ({})", eval.reason.unwrap_or_default()));
    }

    let mut req = get_shield_client()
        .get(parsed.as_str())
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        )
        .header("Sec-Ch-Ua", "\"Chromium\";v=\"130\", \"Google Chrome\";v=\"130\", \"Not?A_Brand\";v=\"99\"")
        .header("Sec-Ch-Ua-Mobile", "?0")
        .header("Sec-Ch-Ua-Platform", "\"Windows\"")
        .header("Sec-Fetch-Dest", "document")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "none")
        .header("Sec-Fetch-User", "?1")
        .header("Upgrade-Insecure-Requests", "1");

    // Strict ASCII validation for custom Accept-Language header to prevent CRLF / header injection
    let mut lang_set = false;
    if let Some(raw_lang) = accept_language {
        let trimmed = raw_lang.trim();
        if !trimmed.is_empty()
            && trimmed.len() <= 48
            && trimmed.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | ',' | ';' | '=' | '.'))
        {
            req = req.header(reqwest::header::ACCEPT_LANGUAGE, trimmed);
            lang_set = true;
        }
    }
    if !lang_set {
        req = req.header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9");
    }

    if send_gpc.unwrap_or(true) {
        req = req.header("DNT", "1").header("Sec-GPC", "1");
    }

    let mut resp = req
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // VULN-03 Anti-DNS Rebinding Guard: verify actual connected socket IP & port
    if let Some(remote_addr) = resp.remote_addr() {
        if is_restricted_ip(remote_addr.ip()) || is_unsafe_network_port(remote_addr.port()) {
            return Err("Blocked DNS rebinding to restricted network socket".to_string());
        }
    }

    // SEC-02: Post-redirect scheme & host verification
    let final_scheme = resp.url().scheme().to_lowercase();
    if final_scheme != "https" && final_scheme != "http" {
        return Err("Redirected to unsupported URL scheme".to_string());
    }
    if let Some(final_host) = resp.url().host_str() {
        if is_restricted_network_host_async(final_host).await {
            return Err("Redirected to restricted network address".to_string());
        }
    }

    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();

    if let Some(final_host) = resp.url().host_str() {
        parse_and_commit_cookies(resp.headers(), final_host, &cookie_jar);
    }

    // Fast O(1) Content-Type check: reject binary/media streams so only HTML/XHTML documents are buffered
    if let Some(ct) = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
        let ct_lower = ct.to_ascii_lowercase();
        if !ct_lower.contains("text/html") && !ct_lower.contains("application/xhtml+xml") && !ct_lower.starts_with("text/plain") {
            return Err(format!("Non-HTML content-type ({})", ct_lower));
        }
    }

    // Fast O(1) Content-Length check before streaming
    if let Some(len) = resp.content_length() {
        if len > MAX_HTML_BYTES as u64 {
            return Err("HTML response exceeds 5 MB limit".to_string());
        }
    }

    let init_cap = resp
        .content_length()
        .map(|l| (l as usize).min(MAX_HTML_BYTES))
        .unwrap_or(64 * 1024);
    let mut body_bytes = Vec::with_capacity(init_cap);

    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if body_bytes.len() + chunk.len() > MAX_HTML_BYTES {
            return Err("HTML stream exceeded 5 MB safety limit".to_string());
        }
        body_bytes.extend_from_slice(&chunk);
    }

    let raw_html = String::from_utf8_lossy(&body_bytes).into_owned();
    let injection = build_shield_injection(
        &final_url,
        shield_enabled,
        &cosmetic_css,
        extension_js.as_deref().unwrap_or(""),
        tab_id.as_deref().unwrap_or(""),
    );

    // Zero-allocation, UTF-8 safe ASCII byte-window search for <head> or <head ...>
    let head_insert_at = raw_html
        .as_bytes()
        .windows(5)
        .position(|w| w.eq_ignore_ascii_case(b"<head"))
        .and_then(|start| {
            let after_tag = raw_html.as_bytes().get(start + 5)?;
            if *after_tag == b'>' {
                Some(start + 6)
            } else if after_tag.is_ascii_whitespace() {
                raw_html[start + 5..]
                    .find('>')
                    .map(|rel_end| start + 5 + rel_end + 1)
            } else {
                None
            }
        });

    let html = if let Some(insert_at) = head_insert_at {
        let mut combined = String::with_capacity(raw_html.len() + injection.len());
        combined.push_str(&raw_html[..insert_at]);
        combined.push_str(&injection);
        combined.push_str(&raw_html[insert_at..]);
        combined
    } else {
        let mut combined = String::with_capacity(raw_html.len() + injection.len());
        combined.push_str(&injection);
        combined.push_str(&raw_html);
        combined
    };

    Ok(ProxiedPageResponse {
        html,
        final_url,
        status,
    })
}

fn sanitize_filename(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'..='\x1f'))
        .collect();
    let mut trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() || trimmed == ".." {
        return "crown-download.bin".to_string();
    }

    // Windows reserved device names: CON, PRN, AUX, NUL, COM1..9, LPT1..9
    let stem = trimmed.split('.').next().unwrap_or("").to_ascii_uppercase();
    let is_reserved = matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" |
        "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9" |
        "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9"
    );
    if is_reserved {
        trimmed = format!("crown-{}", trimmed);
    }

    trimmed.chars().take(180).collect()
}

fn resolve_downloads_dir() -> PathBuf {
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(user_profile).join("Downloads");
        if p.exists() {
            return p;
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let p = PathBuf::from(home).join("Downloads");
        if p.exists() {
            return p;
        }
    }
    std::env::temp_dir()
}

// Prevent overwriting existing files in Downloads by appending " (1)", " (2)", etc.
fn resolve_unique_download_path(dir: &Path, filename: &str) -> (String, PathBuf) {
    let initial = dir.join(filename);
    if !initial.exists() {
        return (filename.to_string(), initial);
    }

    let path_obj = Path::new(filename);
    let stem = path_obj
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("crown-download");
    let ext = path_obj.extension().and_then(|e| e.to_str()).unwrap_or("");

    for i in 1..=999 {
        let candidate_name = if ext.is_empty() {
            format!("{} ({})", stem, i)
        } else {
            format!("{} ({}).{}", stem, i, ext)
        };
        let candidate_path = dir.join(&candidate_name);
        if !candidate_path.exists() {
            return (candidate_name, candidate_path);
        }
    }

    let fallback_name = format!("{}-{}", stem, std::time::UNIX_EPOCH.elapsed().map(|d| d.as_secs()).unwrap_or(1));
    let fallback_path = dir.join(&fallback_name);
    (fallback_name, fallback_path)
}

#[tauri::command]
async fn download_file_native(url: String, suggested_name: String) -> Result<DownloadResult, String> {
    let parsed = Url::parse(url.trim()).map_err(|e| format!("Invalid download URL: {}", e))?;
    let scheme = parsed.scheme().to_lowercase();
    if scheme != "https" && scheme != "http" {
        return Err("Only http:// and https:// downloads are allowed".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Embedded credentials are not allowed".to_string());
    }
    if let Some(host) = parsed.host_str() {
        if is_restricted_network_host_async(host).await {
            return Err("Restricted network host".to_string());
        }
    }
    let port = parsed.port_or_known_default().unwrap_or(80);
    if is_unsafe_network_port(port) {
        return Err("Target port is blocked for security reasons".to_string());
    }

    let mut resp = get_download_client()
        .get(parsed.as_str())
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // VULN-03 Anti-DNS Rebinding Guard: verify actual connected socket IP & port
    if let Some(remote_addr) = resp.remote_addr() {
        if is_restricted_ip(remote_addr.ip()) || is_unsafe_network_port(remote_addr.port()) {
            return Err("Blocked DNS rebinding to restricted network socket".to_string());
        }
    }

    // SEC-02: Post-redirect scheme & host verification
    let final_scheme = resp.url().scheme().to_lowercase();
    if final_scheme != "https" && final_scheme != "http" {
        return Err("Redirected to unsupported URL scheme".to_string());
    }
    if let Some(final_host) = resp.url().host_str() {
        if is_restricted_network_host_async(final_host).await {
            return Err("Redirected to restricted network address".to_string());
        }
    }

    if !resp.status().is_success() {
        return Err(format!("Download failed with HTTP {}", resp.status()));
    }

    if let Some(len) = resp.content_length() {
        if len > MAX_DOWNLOAD_BYTES as u64 {
            return Err("Download exceeds 250 MB safety limit".to_string());
        }
    }

    let base_filename = sanitize_filename(&suggested_name);
    let target_dir = resolve_downloads_dir();
    let (final_filename, dest_path) = resolve_unique_download_path(&target_dir, &base_filename);

    let mut file = File::create(&dest_path).map_err(|e| format!("Failed to create file: {}", e))?;
    let mut total_bytes: usize = 0;

    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        total_bytes = total_bytes.saturating_add(chunk.len());
        if total_bytes > MAX_DOWNLOAD_BYTES {
            let _ = std::fs::remove_file(&dest_path);
            return Err("Download exceeded 250 MB safety limit".to_string());
        }
        file.write_all(&chunk).map_err(|e| {
            let _ = std::fs::remove_file(&dest_path);
            format!("Failed while writing download: {}", e)
        })?;
    }

    Ok(DownloadResult {
        filename: final_filename,
        file_path: dest_path.to_string_lossy().to_string(),
        total_bytes,
    })
}

#[cfg(desktop)]
fn create_browser_window(
    app: &tauri::AppHandle,
    win_label: &str,
    title: &str,
    app_url: WebviewUrl,
    width: f64,
    height: f64,
    position: Option<(f64, f64)>,
    incognito: bool,
) -> Result<(), String> {
    let bg_color = if incognito {
        Color(9, 10, 13, 255)
    } else {
        Color(19, 20, 23, 255)
    };

    let mut win_builder = WindowBuilder::new(app, win_label)
        .title(title)
        .decorations(false)
        .visible(false)
        .background_color(bg_color)
        .inner_size(width, height)
        .min_inner_size(360.0, 540.0)
        .resizable(true);

    if let Some((px, py)) = position {
        win_builder = win_builder.position(px, py);
    }

    let window = win_builder.build().map_err(|e| e.to_string())?;

    let shell_label = if win_label == "main" {
        "shell".to_string()
    } else {
        format!("{}-shell", win_label)
    };

    let shell_builder = WebviewBuilder::new(shell_label, app_url)
        .auto_resize()
        .background_color(bg_color)
        .incognito(incognito)
        .on_navigation(|url| {
            if !is_allowed_shell_navigation(url) {
                eprintln!("[Crown Native Shield] Blocked top-level shell navigation: {}", url);
                return false;
            }
            let eval = evaluate_url_internal(url.as_str());
            if eval.blocked {
                eprintln!("[Crown Native Shield] Blocked OS navigation: {}", url.as_str());
                return false;
            }
            true
        });

    window
        .add_child(
            shell_builder,
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    let _ = window.show();
    Ok(())
}

#[tauri::command]
async fn open_incognito_window(app: tauri::AppHandle) -> Result<(), String> {
    let id = INCOGNITO_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("incognito-{}", id);

    #[cfg(desktop)]
    {
        return create_browser_window(
            &app,
            &label,
            "Crown Browser (Incognito)",
            WebviewUrl::App("index.html?incognito=1".into()),
            1200.0,
            800.0,
            None,
            true,
        );
    }

    #[cfg(not(desktop))]
    {
        let win_builder = WebviewWindowBuilder::new(
            &app,
            label,
            WebviewUrl::App("index.html?incognito=1".into()),
        )
        .title("Crown Browser (Incognito)")
        .incognito(true);
        win_builder.build().map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
async fn open_new_window(
    app: tauri::AppHandle,
    initial_url: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(), String> {
    let id = INCOGNITO_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("crown-win-{}", id);

    let mut app_path = "index.html".to_string();
    if let Some(raw_url) = initial_url {
        let trimmed = raw_url.trim();
        // SEC-03: Validate length and ensure only safe schemes (crown://, http://, https://) with no control characters
        if !trimmed.is_empty() && trimmed.len() <= 2048 && !trimmed.chars().any(|c| c.is_control()) {
            let lower = trimmed.to_ascii_lowercase();
            if lower.starts_with("crown://") || lower.starts_with("https://") || lower.starts_with("http://") {
                if let Ok(mut u) = Url::parse("http://localhost/index.html") {
                    u.query_pairs_mut().append_pair("initialUrl", trimmed);
                    if let Some(q) = u.query() {
                        app_path = format!("index.html?{}", q);
                    }
                }
            }
        }
    }

    let pos = match (x, y) {
        (Some(px), Some(py)) if px.is_finite() && py.is_finite() => {
            Some((px.max(0.0), py.max(0.0)))
        }
        _ => None,
    };

    #[cfg(desktop)]
    {
        return create_browser_window(
            &app,
            &label,
            "Crown Browser",
            WebviewUrl::App(app_path.into()),
            1160.0,
            780.0,
            pos,
            false,
        );
    }

    #[cfg(not(desktop))]
    {
        let win_builder = WebviewWindowBuilder::new(
            &app,
            label,
            WebviewUrl::App(app_path.into()),
        )
        .title("Crown Browser");
        win_builder.build().map_err(|e| e.to_string())?;
        Ok(())
    }
}

// Download a Chrome Web Store CRX3/CRX2 package by its 32-char extension ID ([a-p]{32})
#[tauri::command]
async fn fetch_chrome_crx(extension_id: String) -> Result<Vec<u8>, String> {
    let clean_id = extension_id.trim().to_ascii_lowercase();
    if clean_id.len() != 32 || !clean_id.chars().all(|c| matches!(c, 'a'..='p')) {
        return Err("Invalid Chrome Extension ID (must be 32 characters a-p)".to_string());
    }

    let crx_url = format!(
        "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=122.0.0.0&acceptformat=crx2,crx3&x=id%3D{}%26installsource%3Dondemand%26uc",
        clean_id
    );

    let mut resp = get_download_client()
        .get(&crx_url)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Chrome Web Store: {}", e))?;

    // SEC-02 Anti-DNS Rebinding Guard: verify actual connected socket IP & port
    if let Some(remote_addr) = resp.remote_addr() {
        if is_restricted_ip(remote_addr.ip()) || is_unsafe_network_port(remote_addr.port()) {
            return Err("Blocked DNS rebinding to restricted network socket".to_string());
        }
    }

    if !resp.status().is_success() {
        return Err(format!("Chrome Web Store returned HTTP {}", resp.status()));
    }

    const MAX_CRX_BYTES: usize = 25 * 1024 * 1024; // 25 MB cap for extensions
    if let Some(len) = resp.content_length() {
        if len > MAX_CRX_BYTES as u64 {
            return Err("Extension package exceeds 25 MB limit".to_string());
        }
    }

    let mut out = Vec::with_capacity(128 * 1024);
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if out.len() + chunk.len() > MAX_CRX_BYTES {
            return Err("Extension stream exceeded 25 MB limit".to_string());
        }
        out.extend_from_slice(&chunk);
    }

    if out.len() < 22 {
        return Err("Chrome Web Store returned an empty package for this ID".to_string());
    }

    Ok(out)
}

// Parse both OpenSearch JSON ([query, ["s1", "s2"]]) and DuckDuckGo JSON ([{"phrase": "s1"}, ...])
fn extract_suggestions_from_json(json_val: &serde_json::Value) -> Vec<String> {
    let mut results = Vec::with_capacity(6);

    // Format 1: Standard OpenSearch [ "query", ["sug1", "sug2", ...] ]
    if let Some(arr) = json_val.get(1).and_then(|v| v.as_array()) {
        for item in arr.iter() {
            if let Some(s) = item.as_str() {
                let clean = s.trim();
                if !clean.is_empty() && !results.iter().any(|r: &String| r.eq_ignore_ascii_case(clean)) {
                    results.push(clean.to_string());
                    if results.len() >= 6 {
                        return results;
                    }
                }
            }
        }
    }

    // Format 2: DuckDuckGo object array [ {"phrase": "sug1"}, {"phrase": "sug2"} ]
    if let Some(arr) = json_val.as_array() {
        for item in arr.iter() {
            if let Some(s) = item.get("phrase").and_then(|v| v.as_str()) {
                let clean = s.trim();
                if !clean.is_empty() && !results.iter().any(|r: &String| r.eq_ignore_ascii_case(clean)) {
                    results.push(clean.to_string());
                    if results.len() >= 6 {
                        return results;
                    }
                }
            }
        }
    }

    results
}

// Fetch live search engine query suggestions (Supports Google, DuckDuckGo, Brave & Bing OpenSearch)
#[tauri::command]
async fn fetch_search_suggestions(query: String, provider: Option<String>) -> Result<Vec<String>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() || trimmed.len() > 160 {
        return Ok(vec![]);
    }

    let client = get_suggest_client();
    let prov = provider.unwrap_or_else(|| "google".to_string()).to_lowercase();

    // Build ordered endpoints based on active search provider with automatic failover
    let mut endpoints: Vec<Url> = Vec::with_capacity(2);

    if prov == "duckduckgo" {
        if let Ok(mut u) = Url::parse("https://ac.duckduckgo.com/ac/") {
            u.query_pairs_mut().append_pair("q", trimmed).append_pair("type", "list");
            endpoints.push(u);
        }
    } else if prov == "bing" {
        if let Ok(mut u) = Url::parse("https://api.bing.com/osjson.aspx") {
            u.query_pairs_mut().append_pair("query", trimmed);
            endpoints.push(u);
        }
    } else if prov == "brave" {
        if let Ok(mut u) = Url::parse("https://search.brave.com/api/suggest") {
            u.query_pairs_mut().append_pair("q", trimmed);
            endpoints.push(u);
        }
    }

    // Always include Google OpenSearch & DuckDuckGo AC as high-availability live providers
    if let Ok(mut u) = Url::parse("https://suggestqueries.google.com/complete/search") {
        u.query_pairs_mut().append_pair("client", "firefox").append_pair("q", trimmed);
        endpoints.push(u);
    }
    if let Ok(mut u) = Url::parse("https://ac.duckduckgo.com/ac/") {
        u.query_pairs_mut().append_pair("q", trimmed);
        endpoints.push(u);
    }

    for endpoint in endpoints {
        if let Ok(resp) = client.get(endpoint.as_str()).send().await {
            if resp.status().is_success() {
                if let Ok(body_text) = resp.text().await {
                    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&body_text) {
                        let parsed = extract_suggestions_from_json(&json_val);
                        if !parsed.is_empty() {
                            return Ok(parsed);
                        }
                    }
                }
            }
        }
    }

    Ok(vec![])
}

#[tauri::command]
fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_toggle_maximize(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn update_cookie_policy_setting(
    policy_mode: String,
    cookie_jar: tauri::State<'_, cookie_jar::SystemCookieJar>,
) -> Result<(), String> {
    cookie_jar.set_cookie_mode(&policy_mode);
    Ok(())
}

#[tauri::command]
fn update_vault_auth_setting(
    security_level: String,
    vault: tauri::State<'_, crypto_vault::SystemVault>,
) -> Result<(), String> {
    vault.set_security_level(&security_level);
    Ok(())
}

#[tauri::command]
fn cookie_whitelist_add(
    domain: String,
    cookie_jar: tauri::State<'_, cookie_jar::SystemCookieJar>,
) -> Result<(), String> {
    cookie_jar.add_whitelist_domain(&domain);
    Ok(())
}

#[tauri::command]
fn cookie_whitelist_remove(
    domain: String,
    cookie_jar: tauri::State<'_, cookie_jar::SystemCookieJar>,
) -> Result<(), String> {
    cookie_jar.remove_whitelist_domain(&domain);
    Ok(())
}

#[tauri::command]
fn vault_get_entries(
    vault: tauri::State<'_, crypto_vault::SystemVault>,
) -> Result<Vec<crypto_vault::VaultCredential>, String> {
    vault.get_entries()
}

#[tauri::command]
fn vault_save_entry(
    entry: crypto_vault::VaultCredential,
    vault: tauri::State<'_, crypto_vault::SystemVault>,
) -> Result<(), String> {
    vault.save_entry(entry)
}

#[tauri::command]
fn vault_delete_entry(
    id: String,
    vault: tauri::State<'_, crypto_vault::SystemVault>,
) -> Result<(), String> {
    vault.delete_entry(&id)
}

fn sanitize_webview_label(window_label: &str, tab_id: &str) -> String {
    let clean_win: String = window_label
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let clean_tab: String = tab_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    format!("{}-tab-{}", clean_win, clean_tab)
}

fn emit_shell_webview_event(shell: &tauri::Webview, payload: serde_json::Value) {
    let shell_clone = shell.clone();
    let js = format!(
        "window.crown && window.crown._onNativeWebviewEvent && window.crown._onNativeWebviewEvent({});",
        payload
    );
    tauri::async_runtime::spawn(async move {
        let _ = shell_clone.eval(&js);
    });
}

#[derive(Clone)]
pub struct ShieldRuntimeConfig {
    pub shields_enabled: bool,
    pub block_ads: bool,
    pub block_trackers: bool,
    pub send_gpc: bool,
    pub ad_domains: HashSet<String>,
    pub tracker_domains: HashSet<String>,
    pub per_site_shields: HashMap<String, bool>,
}

impl Default for ShieldRuntimeConfig {
    fn default() -> Self {
        Self {
            shields_enabled: true,
            block_ads: true,
            block_trackers: true,
            send_gpc: true,
            ad_domains: AD_DOMAINS.iter().map(|s| s.to_string()).collect(),
            tracker_domains: TRACKER_DOMAINS.iter().map(|s| s.to_string()).collect(),
            per_site_shields: HashMap::new(),
        }
    }
}

pub struct ShieldRuntimeState(pub Arc<RwLock<Arc<ShieldRuntimeConfig>>>);

impl Default for ShieldRuntimeState {
    fn default() -> Self {
        Self(Arc::new(RwLock::new(Arc::new(ShieldRuntimeConfig::default()))))
    }
}

fn host_matches_domain_set(host: &str, domains: &HashSet<String>) -> bool {
    let mut cur = host;
    loop {
        if domains.contains(cur) {
            return true;
        }
        match cur.find('.') {
            Some(idx) => cur = &cur[idx + 1..],
            None => return false,
        }
    }
}

fn evaluate_resource_request(
    cfg: &ShieldRuntimeConfig,
    top_host: &str,
    req_url: &str,
) -> Option<(&'static str, String)> {
    let site_enabled = if top_host.is_empty() {
        true
    } else {
        cfg.per_site_shields.get(top_host).copied().unwrap_or(true)
    };
    if !cfg.shields_enabled || !site_enabled {
        return None;
    }

    let parsed = Url::parse(req_url).ok()?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return None;
    }

    let req_host = parsed.host_str()?.to_lowercase();
    let path = parsed.path();
    let is_yt = req_host == "www.youtube.com"
        || req_host == "youtube.com"
        || req_host == "m.youtube.com"
        || req_host == "www.youtube-nocookie.com";

    if cfg.block_ads {
        if host_matches_domain_set(&req_host, &cfg.ad_domains) {
            return Some(("ad", req_host));
        }
        if is_yt
            && (path.starts_with("/pagead/")
                || path.starts_with("/api/stats/ads")
                || path.starts_with("/get_midroll_info")
                || path.starts_with("/youtubei/v1/player/ad_break")
                || (path.starts_with("/get_video_info")
                    && parsed.query().unwrap_or("").contains("adunit")))
        {
            return Some(("ad", req_host));
        }
    }

    if cfg.block_trackers && host_matches_domain_set(&req_host, &cfg.tracker_domains) {
        return Some(("tracker", req_host));
    }

    None
}

#[tauri::command]
fn sync_shield_config(
    state: tauri::State<'_, ShieldRuntimeState>,
    shields_enabled: bool,
    block_ads: bool,
    block_trackers: bool,
    send_gpc: bool,
    ad_domains: Vec<String>,
    tracker_domains: Vec<String>,
    per_site_shields: HashMap<String, bool>,
) -> Result<(), String> {
    let prev = state
        .0
        .read()
        .map(|g| Arc::clone(&*g))
        .unwrap_or_else(|_| Arc::new(ShieldRuntimeConfig::default()));
    let next = ShieldRuntimeConfig {
        shields_enabled,
        block_ads,
        block_trackers,
        send_gpc,
        ad_domains: if ad_domains.is_empty() {
            prev.ad_domains.clone()
        } else {
            ad_domains.into_iter().map(|d| d.to_lowercase()).collect()
        },
        tracker_domains: if tracker_domains.is_empty() {
            prev.tracker_domains.clone()
        } else {
            tracker_domains.into_iter().map(|d| d.to_lowercase()).collect()
        },
        per_site_shields: per_site_shields
            .into_iter()
            .map(|(k, v)| (k.to_lowercase(), v))
            .collect(),
    };
    let mut guard = state.0.write().map_err(|e| e.to_string())?;
    *guard = Arc::new(next);
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn set_tab_webview_zoom(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    tab_id: String,
    zoom: f64,
) -> Result<(), String> {
    let label = sanitize_webview_label(webview.window().label(), &tab_id);
    if let Some(wv) = app.get_webview(&label) {
        wv.set_zoom(zoom.clamp(0.25, 5.0))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn update_tab_webview_settings(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    tab_id: String,
    cosmetic_css: String,
    extension_js: String,
    spellcheck: bool,
) -> Result<(), String> {
    let label = sanitize_webview_label(webview.window().label(), &tab_id);
    if let Some(wv) = app.get_webview(&label) {
        let css_json = serde_json::to_string(&cosmetic_css).unwrap_or_else(|_| "\"\"".to_string());
        let ext_json = serde_json::to_string(&extension_js).unwrap_or_else(|_| "\"\"".to_string());
        let script = format!(
            "window.__crownUpdateSettings && window.__crownUpdateSettings({css_json}, {ext_json}, {spellcheck});"
        );
        let _ = wv.eval(&script);
    }
    Ok(())
}

fn build_child_webview_init_script(
    shield_enabled: bool,
    cosmetic_css: &str,
    extension_js: &str,
    spellcheck: bool,
) -> String {
    let ad_json = serde_json::to_string(AD_DOMAINS).unwrap_or_else(|_| "[]".to_string());
    let tracker_json = serde_json::to_string(TRACKER_DOMAINS).unwrap_or_else(|_| "[]".to_string());
    let css_json = serde_json::to_string(cosmetic_css).unwrap_or_else(|_| "\"\"".to_string());
    let ext_json = serde_json::to_string(extension_js).unwrap_or_else(|_| "\"\"".to_string());

    format!(
        r#"(function() {{
  if (window.__crownChildInitDone) return;
  window.__crownChildInitDone = true;
  const SHIELD_ON = {shield_enabled};
  const AD_LIST = {ad_json};
  const TRACKER_LIST = {tracker_json};
  let currentCss = {css_json};
  let currentExtJs = {ext_json};
  let currentSpellcheck = {spellcheck};
  const isYt = /(^|\.)youtube(-nocookie)?\.com$/i.test(window.location.hostname);

  function matchHost(urlStr, list) {{
    try {{
      const u = new URL(urlStr, window.location.href);
      const h = u.hostname.toLowerCase();
      return list.some(d => h === d || h.endsWith('.' + d)) ? h : null;
    }} catch (e) {{
      return null;
    }}
  }}

  function shouldBlock(urlStr) {{
    if (!SHIELD_ON || !urlStr) return false;
    if (matchHost(urlStr, AD_LIST) || matchHost(urlStr, TRACKER_LIST)) return true;
    if (isYt) {{
      try {{
        const u = new URL(urlStr, window.location.href);
        const p = u.pathname || '';
        const q = u.search || '';
        if (
          p.startsWith('/pagead/') ||
          p.startsWith('/api/stats/ads') ||
          p.startsWith('/get_midroll_info') ||
          p.startsWith('/youtubei/v1/player/ad_break') ||
          (p.startsWith('/get_video_info') && q.includes('adunit'))
        ) {{
          return true;
        }}
      }} catch (e) {{}}
    }}
    return false;
  }}

  const YT_AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams', 'adBreakParams'];
  const YT_RECURSE_KEYS = [
    'playerResponse',
    'response',
    'onResponseReceivedEndpoints',
    'entries',
    'endpoint',
    'watchEndpoint',
    'unserializedPrefetchData',
    'command',
    'reelWatchEndpoint'
  ];

  function stripYtAds(obj, depth) {{
    const d = depth || 0;
    if (!obj || typeof obj !== 'object' || d > 8) return obj;
    if (Array.isArray(obj)) {{
      for (let i = obj.length - 1; i >= 0; i--) {{
        const item = obj[i];
        if (item && typeof item === 'object') {{
          if (item.reelWatchEndpoint && item.reelWatchEndpoint.adClientParams && item.reelWatchEndpoint.adClientParams.isAd) {{
            obj.splice(i, 1);
            continue;
          }}
          stripYtAds(item, d + 1);
        }}
      }}
      return obj;
    }}
    if (
      obj.unserializedPrefetchData &&
      obj.unserializedPrefetchData.playerResponse &&
      (obj.unserializedPrefetchData.playerResponse.adPlacements || obj.unserializedPrefetchData.playerResponse.adSlots)
    ) {{
      try {{ delete obj.unserializedPrefetchData; }} catch (e) {{ obj.unserializedPrefetchData = undefined; }}
    }}
    for (let i = 0; i < YT_AD_KEYS.length; i++) {{
      const k = YT_AD_KEYS[i];
      if (k in obj) {{
        try {{ delete obj[k]; }} catch (e) {{ obj[k] = undefined; }}
      }}
    }}
    if (obj.reelWatchEndpoint && obj.reelWatchEndpoint.adClientParams && obj.reelWatchEndpoint.adClientParams.isAd) {{
      try {{ delete obj.reelWatchEndpoint; }} catch (e) {{}}
    }}
    for (let i = 0; i < YT_RECURSE_KEYS.length; i++) {{
      const rk = YT_RECURSE_KEYS[i];
      if (rk in obj && obj[rk] && typeof obj[rk] === 'object') {{
        stripYtAds(obj[rk], d + 1);
      }}
    }}
    return obj;
  }}

  function hasYtAdKeysInText(text) {{
    return (
      typeof text === 'string' &&
      (text.includes('"adPlacements"') ||
        text.includes('"adSlots"') ||
        text.includes('"playerAds"') ||
        text.includes('"adBreakHeartbeatParams"'))
    );
  }}

  function rewriteYtPlayerJsonText(text) {{
    if (!hasYtAdKeysInText(text)) {{
      return text;
    }}
    return text
      .replace(/"adPlacements"/g, '"no_ads"')
      .replace(/"adSlots"/g, '"no_ads_slots"')
      .replace(/"playerAds"/g, '"no_player_ads"')
      .replace(/"adBreakHeartbeatParams"/g, '"no_ad_heartbeat"');
  }}

  function isYtApiRewriteTarget(urlStr) {{
    if (!urlStr || typeof urlStr !== 'string') return false;
    return (
      urlStr.includes('/youtubei/v1/player') ||
      urlStr.includes('/youtubei/v1/get_watch') ||
      urlStr.includes('/youtubei/v1/next') ||
      urlStr.includes('/playlist') ||
      urlStr.includes('/resolve_url') ||
      urlStr.includes('/reel_watch_sequence')
    );
  }}

  // Brave active serverContract + JSON.stringify recovery & snackbar suppression (iodk_youtube_rules.txt lines 661-667, 680)
  const YT_RECOVERY_TOKENS = ['channel', 'yahi', 'inline', 'oaeb'];
  let ytRemainingTokens = YT_RECOVERY_TOKENS.slice();
  let ytNeedReload = false;
  let origYtUserAgent = null;

  function isYtPremiumActive() {{
    try {{
      const iconType = window.ytInitialData &&
        window.ytInitialData.topbar &&
        window.ytInitialData.topbar.desktopTopbarRenderer &&
        window.ytInitialData.topbar.desktopTopbarRenderer.logo &&
        window.ytInitialData.topbar.desktopTopbarRenderer.logo.topbarLogoRenderer &&
        window.ytInitialData.topbar.desktopTopbarRenderer.logo.topbarLogoRenderer.iconImage &&
        window.ytInitialData.topbar.desktopTopbarRenderer.logo.topbarLogoRenderer.iconImage.iconType;
      if (iconType === 'YOUTUBE_PREMIUM_LOGO') return true;
      const masthead = document.getElementById('masthead');
      if (masthead && masthead.attributes && masthead.attributes['logo-type'] && masthead.attributes['logo-type'].value === 'YOUTUBE_PREMIUM_LOGO') {{
        return true;
      }}
    }} catch (e) {{}}
    return false;
  }}

  function setYtUAToken(token) {{
    try {{
      const client = window.ytcfg && window.ytcfg.data_ && window.ytcfg.data_.INNERTUBE_CONTEXT && window.ytcfg.data_.INNERTUBE_CONTEXT.client;
      if (!client || typeof client.userAgent !== 'string') return;
      if (origYtUserAgent === null) {{
        origYtUserAgent = client.userAgent;
      }}
      if (token) {{
        const match = origYtUserAgent.match(/Mozilla\/5\.0 \([^)]+/);
        const prefix = match ? match[0] : null;
        client.userAgent = prefix ? origYtUserAgent.replace(prefix, prefix + '; ' + token) : origYtUserAgent;
      }} else {{
        client.userAgent = origYtUserAgent;
      }}
    }} catch (e) {{}}
  }}

  function getYtPlayerState() {{
    const player = document.getElementById('movie_player');
    if (!player) return {{}};
    return {{
      player: player,
      response: typeof player.getPlayerResponse === 'function' ? player.getPlayerResponse() : null,
      stats: typeof player.getStatsForNerds === 'function' ? player.getStatsForNerds() : null,
      progress: typeof player.getProgressState === 'function' ? player.getProgressState() : null,
      buffer: typeof player.getPlayerStateObject === 'function' && player.getPlayerStateObject() ? player.getPlayerStateObject().isBuffering : false
    }};
  }}

  function isYtStuckAtZero(buffer, stats, tokens) {{
    return Boolean(
      buffer &&
      stats &&
      stats.buffer_health_seconds === '0.00 s' &&
      stats.resolution === '0x0' &&
      tokens.length > 0
    );
  }}

  function checkAndRecoverYtPlayer() {{
    try {{
      if (
        isYtPremiumActive() ||
        window.location.href.startsWith('https://www.youtube.com/tv#/') ||
        window.location.href.startsWith('https://www.youtube.com/embed/')
      ) return;
      const state = getYtPlayerState();
      const player = state.player;
      const response = state.response;
      const stats = state.stats;
      const progress = state.progress;
      const buffer = state.buffer;
      if (!player) return;

      if (window.location.href.includes('/watch?') || window.location.href.includes('/embed/')) {{
        if (
          (progress && progress.duration > 0 && (progress.loaded < progress.duration || progress.duration - progress.current > 1)) ||
          (response && response.videoDetails && response.videoDetails.isLive)
        ) {{
          if (stats && !(stats.debug_info && typeof stats.debug_info.startsWith === 'function' && stats.debug_info.startsWith('SSAP, AD'))) {{
            const params = new URLSearchParams(window.location.search);
            const videoId = response && response.videoDetails && response.videoDetails.videoId ? response.videoDetails.videoId : params.get('v');
            const startSeconds = (response && response.playerConfig && response.playerConfig.playbackStartConfig && response.playerConfig.playbackStartConfig.startSeconds) || parseInt(params.get('t') || '0', 10) || 0;
            const errScreen = response && response.playabilityStatus ? response.playabilityStatus.errorScreen : null;
            const errRuns = errScreen ? JSON.stringify(
              (errScreen.playerErrorMessageRenderer && errScreen.playerErrorMessageRenderer.subreason && errScreen.playerErrorMessageRenderer.subreason.runs) ||
              (errScreen.playerInterstitialRenderer && errScreen.playerInterstitialRenderer.content && errScreen.playerInterstitialRenderer.content.interstitialViewModel && errScreen.playerInterstitialRenderer.content.interstitialViewModel.description && errScreen.playerInterstitialRenderer.content.interstitialViewModel.description.commandRuns)
            ) : '';

            if (
              response &&
              response.playabilityStatus &&
              response.playabilityStatus.status === 'UNPLAYABLE' &&
              !(errScreen && errScreen.playerErrorMessageRenderer && errScreen.playerErrorMessageRenderer.playerCaptchaViewModel) &&
              errRuns &&
              errRuns.includes('WEB_PAGE_TYPE_UNKNOWN') &&
              errRuns.includes('https://support.google.com/youtube/answer/3037019')
            ) {{
              ytRemainingTokens = ytRemainingTokens.slice(1);
              setYtUAToken(ytRemainingTokens.length > 0 ? ytRemainingTokens[0] : '');
              ytNeedReload = false;
              if (videoId && typeof player.loadVideoById === 'function') {{
                player.loadVideoById(videoId, startSeconds);
              }}
            }} else if (ytRemainingTokens.length === 0) {{
              ytNeedReload = false;
              setYtUAToken('');
            }} else if (isYtStuckAtZero(buffer, stats, ytRemainingTokens) && ytNeedReload) {{
              setYtUAToken(ytRemainingTokens[0]);
              ytNeedReload = false;
              if (videoId && typeof player.loadVideoById === 'function') {{
                player.loadVideoById(videoId, startSeconds);
              }}
            }} else if (
              !ytNeedReload &&
              progress &&
              progress.current - startSeconds > 0.1 &&
              progress.current - startSeconds < 5 &&
              window.location.href.includes('&list=') &&
              typeof player.getPlaylistId === 'function' &&
              player.getPlaylistId() === null
            ) {{
              const pm = document.querySelector('yt-playlist-manager');
              const pd = pm && typeof pm.getPlaylistData === 'function' ? pm.getPlaylistData() : null;
              if (pd) {{
                if (typeof pm.setPlaylistData === 'function') pm.setPlaylistData(pd);
                if (typeof pm.setPlayerPlaybackControlData === 'function') pm.setPlayerPlaybackControlData({{ playlistPanelRenderer: pd }});
              }}
            }}
            return;
          }}
          if (stats && progress && progress.duration > 0 && typeof player.seekTo === 'function') {{
            player.seekTo(progress.duration);
          }}
        }}
      }} else {{
        ytRemainingTokens = YT_RECOVERY_TOKENS.slice();
      }}
    }} catch (e) {{}}
  }}

  function markYtStallAndRecover() {{
    try {{
      const state = getYtPlayerState();
      if (state.player && isYtStuckAtZero(state.buffer, state.stats, ytRemainingTokens)) {{
        const baseUrl = state.response &&
          state.response.playbackTracking &&
          state.response.playbackTracking.videostatsPlaybackUrl &&
          state.response.playbackTracking.videostatsPlaybackUrl.baseUrl;
        if (typeof baseUrl === 'string' && baseUrl.includes('reloadxhr')) {{
          ytRemainingTokens = ytRemainingTokens.slice(1);
        }}
        ytNeedReload = true;
        checkAndRecoverYtPlayer();
      }}
    }} catch (e) {{}}
  }}

  function onYtStallSignal() {{
    markYtStallAndRecover();
    setTimeout(markYtStallAndRecover, 50);
    setTimeout(markYtStallAndRecover, 150);
  }}

  if (SHIELD_ON) {{
    if (isYt) {{
      // Brave doubleclick_instream_ad_status.js shim
      try {{ window.google_ad_status = 1; }} catch (e) {{}}

      // Monotonic performance.now() guard (Brave brave-youtube-navigation-fix.js)
      try {{
        const origPerfNow = window.performance.now;
        let prevNow = 0;
        window.performance.now = function() {{
          let cur = origPerfNow.apply(this, arguments);
          if (cur <= prevNow) cur = prevNow + Number.EPSILON * 100000;
          return (prevNow = cur);
        }};
      }} catch (e) {{}}

      // Brave nano-stb: accelerate YouTube's 17000ms [native code] ad-wait timer by 0.001x -> 17ms (iodk_youtube_rules.txt line 680)
      try {{
        const origSetTimeout = window.setTimeout;
        const fnToStr = Function.prototype.toString;
        window.setTimeout = function(fn, delay) {{
          if (delay === 17000 && typeof fn === 'function') {{
            try {{
              if (fnToStr.call(fn).includes('[native code]')) {{
                arguments[1] = 17;
              }}
            }} catch (e) {{}}
          }}
          return origSetTimeout.apply(this, arguments);
        }};
      }} catch (e) {{}}

      // Neutralize YouTube onAbnormalityDetected (iodk_youtube_rules.txt line 661)
      try {{
        const origThen = window.Promise.prototype.then;
        const fnToStr = Function.prototype.toString;
        window.Promise.prototype.then = function(onFulfilled, onRejected) {{
          if (typeof onFulfilled === 'function') {{
            try {{
              const s = fnToStr.call(onFulfilled);
              if (s.includes('onAbnormalityDetected')) {{
                onFulfilled = function() {{}};
              }}
            }} catch (e) {{}}
          }}
          return origThen.call(this, onFulfilled, onRejected);
        }};
      }} catch (e) {{}}

      // Suppress "Experiencing interruptions?" onSnackbarMessage popup & trigger SABR recovery if stuck at 0x0
      try {{
        const origMapHas = window.Map.prototype.has;
        window.Map.prototype.has = function(key) {{
          if (key === 'onSnackbarMessage') {{
            if (!ytNeedReload) {{
              try {{ onYtStallSignal(); }} catch (e) {{}}
            }}
            return false;
          }}
          return origMapHas.apply(this, arguments);
        }};
        const origMapGet = window.Map.prototype.get;
        window.Map.prototype.get = function(key) {{
          if (key === 'onSnackbarMessage') {{
            return undefined;
          }}
          return origMapGet.apply(this, arguments);
        }};
      }} catch (e) {{}}

      // Detect 104/105-byte Uint8Array SABR ad-backoff chunk (iodk_youtube_rules.txt line 661)
      try {{
        const origArrayPush = window.Array.prototype.push;
        window.Array.prototype.push = function(firstArg) {{
          if (
            firstArg &&
            typeof firstArg === 'object' &&
            firstArg.constructor &&
            firstArg.constructor.name === 'Uint8Array' &&
            firstArg.buffer &&
            firstArg.buffer.byteLength === firstArg.length &&
            (firstArg.length === 104 || firstArg.length === 105)
          ) {{
            try {{ onYtStallSignal(); }} catch (e) {{}}
          }}
          return origArrayPush.apply(this, arguments);
        }};
      }} catch (e) {{}}

      // Brave active JSON.stringify recovery rules (iodk_youtube_rules.txt lines 662-667)
      try {{
        const origStringify = JSON.stringify;
        JSON.stringify = function(val) {{
          if (val && typeof val === 'object') {{
            try {{
              const ua = val.context && val.context.client && typeof val.context.client.userAgent === 'string'
                ? val.context.client.userAgent
                : '';
              if (val.attestationRequest && ua) {{
                if (ua.includes('channel') && val.context.client.clientName === 'WEB') {{
                  val.context.client.clientScreen = 'CHANNEL';
                }}
                if (ua.includes('yahi')) {{
                  val.params = 'YAHI';
                }}
                if (ua.includes('inline') && val.playbackContext && val.playbackContext.contentPlaybackContext) {{
                  val.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd = true;
                }}
                if (ua.includes('oaeb')) {{
                  val.params = 'oAEBogYBLg';
                }}
                if (
                  /(adunit|channel|inline|yahi|oaeb|eafg|yaf4)/.test(ua) &&
                  val.playbackContext &&
                  val.playbackContext.contentPlaybackContext &&
                  typeof val.playbackContext.contentPlaybackContext.referer === 'string'
                ) {{
                  val.playbackContext.contentPlaybackContext.referer =
                    val.playbackContext.contentPlaybackContext.referer.replace(/(?:#reloadxhr)?$/, '#reloadxhr');
                }}
              }}
              if (val.createCommentParams && ua) {{
                val.context.client.userAgent = ua.replace(/; (adunit|channel|inline|yahi|oaeb|eafg|yaf4)\b/, '');
              }}
            }} catch (e) {{}}
          }}
          return origStringify.apply(this, arguments);
        }};
      }} catch (e) {{}}

      try {{
        let _ytInitPlayerResp = stripYtAds(window.ytInitialPlayerResponse);
        Object.defineProperty(window, 'ytInitialPlayerResponse', {{
          configurable: true,
          enumerable: true,
          get: function() {{ return _ytInitPlayerResp; }},
          set: function(val) {{ _ytInitPlayerResp = stripYtAds(val); }}
        }});
      }} catch (e) {{}}

      const origJsonParse = JSON.parse;
      JSON.parse = function(text, reviver) {{
        if (hasYtAdKeysInText(text)) {{
          const cleanText = rewriteYtPlayerJsonText(text);
          const res = origJsonParse.call(this, cleanText, reviver);
          if (res && typeof res === 'object') {{
            return stripYtAds(res);
          }}
          return res;
        }}
        return origJsonParse.call(this, text, reviver);
      }};

      const origRespJson = Response.prototype.json;
      Response.prototype.json = function() {{
        const respUrl = this.url || '';
        if (isYtApiRewriteTarget(respUrl) || respUrl.includes('/youtubei/v1/reel/')) {{
          return origRespJson.apply(this, arguments).then(stripYtAds);
        }}
        return origRespJson.apply(this, arguments);
      }};

      const origRespText = Response.prototype.text;
      Response.prototype.text = function() {{
        const respUrl = this.url || '';
        if (isYtApiRewriteTarget(respUrl)) {{
          return origRespText.apply(this, arguments).then(rewriteYtPlayerJsonText);
        }}
        return origRespText.apply(this, arguments);
      }};
    }}
  }}

  const origFetch = window.fetch;
  if (origFetch) {{
    window.fetch = function(input, init) {{
      const u = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      if (shouldBlock(u)) {{
        return Promise.resolve(new Response('{{}}', {{
          status: 200,
          statusText: 'OK',
          headers: {{ 'Content-Type': 'application/json' }}
        }}));
      }}
      if (SHIELD_ON && isYt && isYtApiRewriteTarget(u)) {{
        return origFetch.apply(this, arguments).then(function(responseBefore) {{
          if (!responseBefore || !responseBefore.ok || typeof responseBefore.clone !== 'function') {{
            return responseBefore;
          }}
          let clone;
          try {{
            clone = responseBefore.clone();
          }} catch (e) {{
            return responseBefore;
          }}
          return clone.text().then(function(textBefore) {{
            const textAfter = rewriteYtPlayerJsonText(textBefore);
            if (textAfter === textBefore) {{
              return responseBefore;
            }}
            const responseAfter = new Response(textAfter, {{
              status: responseBefore.status,
              statusText: responseBefore.statusText,
              headers: responseBefore.headers
            }});
            try {{
              Object.defineProperties(responseAfter, {{
                ok: {{ value: responseBefore.ok }},
                redirected: {{ value: responseBefore.redirected }},
                type: {{ value: responseBefore.type }},
                url: {{ value: responseBefore.url }}
              }});
            }} catch (e) {{}}
            return responseAfter;
          }}).catch(function() {{
            return responseBefore;
          }});
        }});
      }}
      return origFetch.apply(this, arguments);
    }};
  }}

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {{
    const u = String(url || '');
    this._crownUrl = u;
    if (shouldBlock(u)) this._crownBlocked = true;
    return origOpen.apply(this, arguments);
  }};
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {{
    if (this._crownBlocked) {{
      const xhr = this;
      try {{
        Object.defineProperty(xhr, 'readyState', {{ configurable: true, get: function() {{ return 4; }} }});
        Object.defineProperty(xhr, 'status', {{ configurable: true, get: function() {{ return 200; }} }});
        Object.defineProperty(xhr, 'statusText', {{ configurable: true, get: function() {{ return 'OK'; }} }});
        Object.defineProperty(xhr, 'responseText', {{ configurable: true, get: function() {{ return '{{}}'; }} }});
        Object.defineProperty(xhr, 'response', {{ configurable: true, get: function() {{ return '{{}}'; }} }});
      }} catch (e) {{}}
      Promise.resolve().then(function() {{
        try {{ xhr.dispatchEvent(new Event('readystatechange')); }} catch (e) {{}}
        try {{ xhr.dispatchEvent(new ProgressEvent('load')); }} catch (e) {{}}
        try {{ xhr.dispatchEvent(new ProgressEvent('loadend')); }} catch (e) {{}}
      }});
      return;
    }}
    if (SHIELD_ON && isYt && isYtApiRewriteTarget(this._crownUrl)) {{
      const xhr = this;
      xhr.addEventListener('readystatechange', function() {{
        if (xhr.readyState === 4 && (xhr.responseType === '' || xhr.responseType === 'text')) {{
          try {{
            const raw = xhr.responseText;
            if (hasYtAdKeysInText(raw)) {{
              const cleaned = rewriteYtPlayerJsonText(raw);
              Object.defineProperty(xhr, 'responseText', {{ configurable: true, get: function() {{ return cleaned; }} }});
              Object.defineProperty(xhr, 'response', {{ configurable: true, get: function() {{ return cleaned; }} }});
            }}
          }} catch (e) {{}}
        }}
      }});
    }}
    return origSend.apply(this, arguments);
  }};

  window.__crownSetMuted = function(muted) {{
    const m = Boolean(muted);
    window.__crownTabMuted = m;
    document.querySelectorAll('video, audio').forEach(function(el) {{
      try {{ el.muted = m; }} catch(e) {{}}
    }});
  }};

  document.addEventListener('pointerdown', function() {{
    try {{
      if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {{
        window.chrome.webview.postMessage('crown:child-pointerdown');
      }}
    }} catch(e) {{}}
  }}, true);

  document.addEventListener('keydown', function(e) {{
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    let zoomMsg = null;
    if (e.key === '=' || e.key === '+') zoomMsg = 'crown:zoom:in';
    else if (e.key === '-' || e.key === '_') zoomMsg = 'crown:zoom:out';
    else if (e.key === '0') zoomMsg = 'crown:zoom:reset';
    if (zoomMsg) {{
      e.preventDefault();
      try {{
        if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {{
          window.chrome.webview.postMessage(zoomMsg);
        }}
      }} catch(err) {{}}
    }}
  }}, true);

  window.addEventListener('wheel', function(e) {{
    if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return;
    e.preventDefault();
    const zoomMsg = e.deltaY < 0 ? 'crown:zoom:in' : 'crown:zoom:out';
    try {{
      if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {{
        window.chrome.webview.postMessage(zoomMsg);
      }}
    }} catch(err) {{}}
  }}, {{ passive: false, capture: true }});

  document.addEventListener('play', function(e) {{
    if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO') && window.__crownTabMuted) {{
      try {{ e.target.muted = true; }} catch(err) {{}}
    }}
  }}, true);

  function ensureCosmeticStyle() {{
    try {{
      const host = document.head || document.documentElement;
      if (!host) return;
      let st = document.getElementById('crown-shield-cosmetic');
      if (!st) {{
        st = document.createElement('style');
        st.id = 'crown-shield-cosmetic';
        host.appendChild(st);
      }}
      const fullCss = currentCss || '';
      if (st.textContent !== fullCss) {{
        st.textContent = fullCss;
      }}
    }} catch(e) {{}}
  }}

  function applyCosmeticAndExt(forceExt) {{
    ensureCosmeticStyle();
    try {{
      if (document.documentElement) document.documentElement.spellcheck = Boolean(currentSpellcheck);
      if (document.body) document.body.spellcheck = Boolean(currentSpellcheck);
    }} catch(e) {{}}
    try {{
      if (currentExtJs && currentExtJs.trim() && (forceExt || !window.__crownExtApplied)) {{
        window.__crownExtApplied = true;
        (0, eval)(currentExtJs);
      }}
    }} catch(e) {{}}
  }}

  ensureCosmeticStyle();

  window.__crownUpdateSettings = function(css, extJs, spellcheck) {{
    currentCss = css || '';
    const nextExt = extJs || '';
    const extChanged = nextExt !== currentExtJs;
    currentExtJs = nextExt;
    currentSpellcheck = Boolean(spellcheck);
    applyCosmeticAndExt(extChanged);
  }};

  function skipYouTubeAds() {{
    if (!SHIELD_ON || !isYt) return;
    const player = document.getElementById('movie_player');
    if (!player) return;
    const isAd = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
    const vid = player.querySelector('video');
    if (!isAd) {{
      if (vid && vid.__crownAdMuted) {{
        vid.__crownAdMuted = false;
        vid.muted = Boolean(window.__crownTabMuted);
        if (vid.playbackRate > 2) vid.playbackRate = 1;
      }}
      return;
    }}
    const skipBtn = player.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-slot button');
    if (skipBtn) {{
      try {{ skipBtn.click(); }} catch (e) {{}}
    }}
    if (vid) {{
      if (!vid.muted) {{
        vid.__crownAdMuted = true;
        vid.muted = true;
      }}
      try {{
        if (vid.duration > 0 && Number.isFinite(vid.duration) && vid.currentTime < vid.duration - 0.1) {{
          vid.currentTime = Math.max(0, vid.duration - 0.05);
        }}
      }} catch (e) {{}}
    }}
  }}

  function attachYtPlayerObserver() {{
    if (!SHIELD_ON || !isYt || typeof MutationObserver === 'undefined') return;
    const player = document.getElementById('movie_player');
    if (!player || player.__crownPlayerObserved) return;
    player.__crownPlayerObserved = true;
    const obs = new MutationObserver(function() {{
      skipYouTubeAds();
      checkAndRecoverYtPlayer();
    }});
    obs.observe(player, {{ attributes: true, attributeFilter: ['class'] }});
  }}

  if (SHIELD_ON && isYt) {{
    document.addEventListener('yt-navigate-finish', function() {{
      ensureCosmeticStyle();
      attachYtPlayerObserver();
      skipYouTubeAds();
      checkAndRecoverYtPlayer();
    }});
    document.addEventListener('loadedmetadata', function(e) {{
      if (e.target && e.target.tagName === 'VIDEO') {{
        attachYtPlayerObserver();
        skipYouTubeAds();
      }}
    }}, true);
  }}

  if (document.readyState === 'loading') {{
    document.addEventListener('DOMContentLoaded', function() {{
      applyCosmeticAndExt(false);
      attachYtPlayerObserver();
      skipYouTubeAds();
      if (SHIELD_ON && isYt) {{
        checkAndRecoverYtPlayer();
      }}
    }});
  }} else {{
    applyCosmeticAndExt(false);
    attachYtPlayerObserver();
    skipYouTubeAds();
    if (SHIELD_ON && isYt) {{
      checkAndRecoverYtPlayer();
    }}
  }}
}})();"#,
        shield_enabled = shield_enabled,
        ad_json = ad_json,
        tracker_json = tracker_json,
        css_json = css_json,
        ext_json = ext_json,
        spellcheck = spellcheck
    )
}

#[cfg(desktop)]
#[tauri::command]
async fn open_or_navigate_tab_webview(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    tab_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
    shield_enabled: bool,
    cosmetic_css: String,
    extension_js: Option<String>,
    spellcheck: Option<bool>,
    zoom: Option<f64>,
    is_incognito: Option<bool>,
) -> Result<(), String> {
    let parsed = Url::parse(url.trim()).map_err(|e| format!("Invalid URL: {}", e))?;
    let scheme = parsed.scheme().to_lowercase();
    if scheme != "https" && scheme != "http" {
        return Err("Only http:// and https:// URLs are supported".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Embedded credentials are not allowed".to_string());
    }
    let host = parsed.host_str().unwrap_or("");
    if is_restricted_network_host_async(host).await {
        return Err("Restricted local/private network address".to_string());
    }
    let port = parsed.port_or_known_default().unwrap_or(80);
    if is_unsafe_network_port(port) {
        return Err("Target port is blocked for security reasons".to_string());
    }
    let eval_res = evaluate_url_internal(parsed.as_str());
    if shield_enabled && eval_res.blocked {
        return Err(format!("Blocked by Crown Shield ({})", eval_res.reason.unwrap_or_default()));
    }

    let parent_win = webview.window();
    let label = sanitize_webview_label(parent_win.label(), &tab_id);
    let incognito = parent_win.label().starts_with("incognito-") || is_incognito.unwrap_or(false);
    let safe_w = width.max(1.0);
    let safe_h = height.max(1.0);
    let spellcheck_val = spellcheck.unwrap_or(true);
    let ext_val = extension_js.unwrap_or_default();

    let next_bounds = (
        x.round() as i32,
        y.round() as i32,
        safe_w.round() as i32,
        safe_h.round() as i32,
        visible,
    );

    if let Some(existing) = app.get_webview(&label) {
        let mut bounds_changed = true;
        if let Ok(mut guard) = webview_sync_cache().lock() {
            if let Some(prev) = guard.get(&label) {
                bounds_changed = (prev.0, prev.1, prev.2, prev.3, prev.4) != next_bounds;
            }
            let prev_cutouts = guard.get(&label).map(|p| p.5.clone()).unwrap_or_default();
            guard.insert(
                label.clone(),
                (
                    next_bounds.0,
                    next_bounds.1,
                    next_bounds.2,
                    next_bounds.3,
                    next_bounds.4,
                    prev_cutouts,
                ),
            );
        }
        if bounds_changed {
            let _ = existing.set_bounds(Rect {
                position: LogicalPosition::new(x, y).into(),
                size: LogicalSize::new(safe_w, safe_h).into(),
            });
            if visible {
                let _ = existing.show();
            } else {
                let _ = existing.hide();
            }
        }
        if let Some(z) = zoom {
            let _ = existing.set_zoom(z.clamp(0.25, 5.0));
        }
        existing.navigate(parsed).map_err(|e| e.to_string())?;
        return Ok(());
    }

    let init_script = build_child_webview_init_script(
        shield_enabled,
        &cosmetic_css,
        &ext_val,
        spellcheck_val,
    );

    let tab_id_load = tab_id.clone();
    let shell_load = webview.clone();
    let tab_id_title = tab_id.clone();
    let shell_title = webview.clone();
    let tab_id_new = tab_id.clone();
    let shell_new = webview.clone();

    let bg_color = if incognito {
        Color(9, 10, 13, 255)
    } else {
        Color(19, 20, 23, 255)
    };

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .background_color(bg_color)
        .incognito(incognito)
        .initialization_script(&init_script)
        .on_navigation(move |nav_url| {
            let s = nav_url.scheme().to_lowercase();
            if s != "http" && s != "https" && s != "about" && s != "blob" {
                return false;
            }
            if let Some(h) = nav_url.host_str() {
                if is_restricted_network_host(h) {
                    return false;
                }
            }
            let ev = evaluate_url_internal(nav_url.as_str());
            if shield_enabled && ev.blocked {
                return false;
            }
            true
        })
        .on_page_load(move |_wv, payload| {
            let state = match payload.event() {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            emit_shell_webview_event(
                &shell_load,
                serde_json::json!({
                    "type": "page-load",
                    "tabId": tab_id_load,
                    "url": payload.url().to_string(),
                    "state": state
                }),
            );
        })
        .on_document_title_changed(move |wv, title| {
            let current_url = wv.url().map(|u| u.to_string()).unwrap_or_default();
            emit_shell_webview_event(
                &shell_title,
                serde_json::json!({
                    "type": "title-changed",
                    "tabId": tab_id_title,
                    "title": title,
                    "url": current_url
                }),
            );
        })
        .on_new_window(move |new_url, features| {
            let s = new_url.scheme().to_lowercase();
            if s != "http" && s != "https" {
                return NewWindowResponse::Deny;
            }
            if let Some(h) = new_url.host_str() {
                if is_restricted_network_host(h) {
                    return NewWindowResponse::Deny;
                }
            }
            let host = new_url.host_str().unwrap_or("").to_lowercase();
            let is_oauth_host = host == "accounts.google.com"
                || host == "login.microsoftonline.com"
                || host == "login.live.com"
                || host == "appleid.apple.com"
                || host == "github.com" && new_url.path().starts_with("/login")
                || host.ends_with(".auth0.com")
                || host == "discord.com" && new_url.path().starts_with("/oauth2");
            if features.size().is_some() || is_oauth_host {
                return NewWindowResponse::Allow;
            }
            emit_shell_webview_event(
                &shell_new,
                serde_json::json!({
                    "type": "new-tab",
                    "sourceTabId": tab_id_new,
                    "url": new_url.to_string()
                }),
            );
            NewWindowResponse::Deny
        });

    let parent_win = webview.window();
    let child = parent_win
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(safe_w, safe_h),
        )
        .map_err(|e| e.to_string())?;

    if let Ok(mut guard) = webview_sync_cache().lock() {
        guard.insert(
            label.clone(),
            (
                next_bounds.0,
                next_bounds.1,
                next_bounds.2,
                next_bounds.3,
                next_bounds.4,
                Vec::new(),
            ),
        );
    }

    if let Some(z) = zoom {
        let _ = child.set_zoom(z.clamp(0.25, 5.0));
    }

    #[cfg(target_os = "windows")]
    {
        let shield_arc = Arc::clone(&app.state::<ShieldRuntimeState>().0);
        let shell_block = webview.clone();
        let tab_id_block = tab_id.clone();
        let shell_msg = webview.clone();
        let tab_id_msg = tab_id.clone();
        let _ = child.with_webview(move |platform_wv| {
            unsafe {
                use webview2_com::Microsoft::Web::WebView2::Win32::{
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_OTHER,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST,
                    ICoreWebView2Environment,
                };
                use webview2_com::{
                    take_pwstr, WebMessageReceivedEventHandler, WebResourceRequestedEventHandler,
                };
                use windows::core::{w, PWSTR};

                let controller = platform_wv.controller();
                let Ok(core_wv) = controller.CoreWebView2() else {
                    return;
                };
                let env: ICoreWebView2Environment = platform_wv.environment();
                for ctx in [
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_OTHER,
                ] {
                    let _ = core_wv.AddWebResourceRequestedFilter(w!("*"), ctx);
                }
                let mut token = 0i64;
                let handler = WebResourceRequestedEventHandler::create(Box::new(move |sender, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    let Ok(req) = args.Request() else {
                        return Ok(());
                    };
                    let mut uri_pwstr = PWSTR::null();
                    if req.Uri(&mut uri_pwstr).is_err() {
                        return Ok(());
                    }
                    let req_url = take_pwstr(uri_pwstr);
                    // Fast-path skip high-volume media/thumbnail CDN & static asset chunks to keep playback snappy
                    if req_url.contains(".googlevideo.com/")
                        || req_url.contains(".ytimg.com/")
                        || req_url.contains(".ggpht.com/")
                        || req_url.contains("www.youtube.com/s/desktop/")
                        || req_url.contains("www.youtube.com/s/player/")
                        || req_url.contains("fonts.gstatic.com/")
                        || req_url.contains("www.gstatic.com/")
                    {
                        return Ok(());
                    }
                    let mut top_host = String::new();
                    if let Some(wv_sender) = sender.as_ref() {
                        let mut source_pwstr = PWSTR::null();
                        if wv_sender.Source(&mut source_pwstr).is_ok() {
                            let src = take_pwstr(source_pwstr);
                            if let Ok(u) = Url::parse(&src) {
                                top_host = u.host_str().unwrap_or("").to_lowercase();
                            }
                        }
                    }

                    let cfg = shield_arc
                        .read()
                        .map(|g| Arc::clone(&*g))
                        .unwrap_or_else(|_| Arc::new(ShieldRuntimeConfig::default()));
                    if cfg.send_gpc {
                        if let Ok(headers) = req.Headers() {
                            let _ = headers.SetHeader(w!("DNT"), w!("1"));
                            let _ = headers.SetHeader(w!("Sec-GPC"), w!("1"));
                        }
                    }

                    if let Some((kind, host_matched)) =
                        evaluate_resource_request(&cfg, &top_host, &req_url)
                    {
                        if let Ok(resp) = env.CreateWebResourceResponse(
                            None,
                            200,
                            w!("OK"),
                            w!("Content-Type: text/plain; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store"),
                        ) {
                            let _ = args.SetResponse(&resp);
                            emit_shell_webview_event(
                                &shell_block,
                                serde_json::json!({
                                    "type": "shield-block",
                                    "tabId": tab_id_block,
                                    "kind": kind,
                                    "host": host_matched,
                                    "url": req_url
                                }),
                            );
                        }
                    }
                    Ok(())
                }));
                let _ = core_wv.add_WebResourceRequested(&handler, &mut token);

                let mut msg_token = 0i64;
                let msg_handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    let mut msg_pwstr = PWSTR::null();
                    if args.TryGetWebMessageAsString(&mut msg_pwstr).is_ok() {
                        let msg = take_pwstr(msg_pwstr);
                        if msg == "crown:child-pointerdown" {
                            emit_shell_webview_event(
                                &shell_msg,
                                serde_json::json!({
                                    "type": "child-pointerdown",
                                    "tabId": tab_id_msg
                                }),
                            );
                        } else if let Some(dir) = msg.strip_prefix("crown:zoom:") {
                            emit_shell_webview_event(
                                &shell_msg,
                                serde_json::json!({
                                    "type": "zoom",
                                    "tabId": tab_id_msg,
                                    "dir": dir
                                }),
                            );
                        }
                    }
                    Ok(())
                }));
                let _ = core_wv.add_WebMessageReceived(&msg_handler, &mut msg_token);
            }
        });
    }

    if !visible {
        let _ = child.hide();
    }
    Ok(())
}

#[cfg(desktop)]
#[derive(serde::Deserialize)]
struct OverlayCutout {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[cfg(desktop)]
type WebviewSyncTuple = (i32, i32, i32, i32, bool, Vec<(i32, i32, i32, i32)>);

#[cfg(desktop)]
fn webview_sync_cache() -> &'static std::sync::Mutex<std::collections::HashMap<String, WebviewSyncTuple>> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, WebviewSyncTuple>>> =
        std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

#[cfg(desktop)]
#[tauri::command]
fn sync_tab_webview(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
    cutouts: Option<Vec<OverlayCutout>>,
) -> Result<Option<String>, String> {
    let label = sanitize_webview_label(webview.window().label(), &tab_id);
    if let Some(wv) = app.get_webview(&label) {
        let cutout_list = cutouts.unwrap_or_default();
        let cutout_tuples: Vec<(i32, i32, i32, i32)> = cutout_list
            .iter()
            .filter(|c| c.width > 0 && c.height > 0)
            .map(|c| (c.x, c.y, c.width, c.height))
            .collect();
        let next_bounds = (
            x.round() as i32,
            y.round() as i32,
            width.max(1.0).round() as i32,
            height.max(1.0).round() as i32,
            visible,
        );

        let mut bounds_changed = true;
        let mut cutouts_changed = !cutout_tuples.is_empty();
        if let Ok(mut guard) = webview_sync_cache().lock() {
            if let Some(prev) = guard.get(&label) {
                bounds_changed = (prev.0, prev.1, prev.2, prev.3, prev.4) != next_bounds;
                cutouts_changed = prev.5 != cutout_tuples;
            }
            guard.insert(
                label.clone(),
                (
                    next_bounds.0,
                    next_bounds.1,
                    next_bounds.2,
                    next_bounds.3,
                    next_bounds.4,
                    cutout_tuples,
                ),
            );
        }

        if visible && width >= 1.0 && height >= 1.0 {
            if bounds_changed {
                let _ = wv.set_bounds(Rect {
                    position: LogicalPosition::new(x, y).into(),
                    size: LogicalSize::new(width.max(1.0), height.max(1.0)).into(),
                });
                let _ = wv.show();
            }
            #[cfg(target_os = "windows")]
            if cutouts_changed || (bounds_changed && !cutout_list.is_empty()) {
                let _ = wv.with_webview(move |platform_wv| {
                    unsafe {
                        use windows::Win32::Foundation::{HWND, RECT};
                        use windows::Win32::Graphics::Gdi::{
                            CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_DIFF,
                        };
                        use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

                        let mut hwnd = HWND::default();
                        if platform_wv.controller().ParentWindow(&mut hwnd).is_err()
                            || hwnd.is_invalid()
                        {
                            return;
                        }
                        if cutout_list.is_empty() {
                            let _ = SetWindowRgn(hwnd, None, true);
                            return;
                        }
                        let mut rc = RECT::default();
                        if GetClientRect(hwnd, &mut rc).is_err() {
                            return;
                        }
                        let base_rgn: HRGN = CreateRectRgn(0, 0, rc.right, rc.bottom);
                        if base_rgn.is_invalid() {
                            return;
                        }
                        for c in cutout_list {
                            if c.width <= 0 || c.height <= 0 {
                                continue;
                            }
                            let cut_rgn = CreateRectRgn(
                                c.x,
                                c.y,
                                c.x.saturating_add(c.width),
                                c.y.saturating_add(c.height),
                            );
                            if !cut_rgn.is_invalid() {
                                let _ = CombineRgn(Some(base_rgn), Some(base_rgn), Some(cut_rgn), RGN_DIFF);
                                let _ = DeleteObject(cut_rgn.into());
                            }
                        }
                        // SetWindowRgn takes ownership of base_rgn on success
                        if SetWindowRgn(hwnd, Some(base_rgn), true) == 0 {
                            let _ = DeleteObject(base_rgn.into());
                        }
                    }
                });
            }
        } else if bounds_changed {
            let _ = wv.hide();
        }
        return Ok(wv.url().ok().map(|u| u.to_string()));
    }
    Ok(None)
}

#[cfg(desktop)]
#[tauri::command]
fn tab_webview_action(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    tab_id: String,
    action: String,
) -> Result<(), String> {
    let label = sanitize_webview_label(webview.window().label(), &tab_id);
    if let Some(wv) = app.get_webview(&label) {
        match action.as_str() {
            "back" => {
                let _ = wv.eval("window.history.back();");
            }
            "forward" => {
                let _ = wv.eval("window.history.forward();");
            }
            "reload" => {
                let _ = wv.eval("window.location.reload();");
            }
            "mute" => {
                let _ = wv.eval("window.__crownSetMuted && window.__crownSetMuted(true);");
            }
            "unmute" => {
                let _ = wv.eval("window.__crownSetMuted && window.__crownSetMuted(false);");
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn close_tab_webview(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    tab_id: String,
) -> Result<(), String> {
    let label = sanitize_webview_label(webview.window().label(), &tab_id);
    if let Ok(mut guard) = webview_sync_cache().lock() {
        guard.remove(&label);
    }
    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.close();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));

            app.manage(cookie_jar::SystemCookieJar::new(&app_data_dir));
            app.manage(crypto_vault::SystemVault::new(&app_data_dir));
            app.manage(ShieldRuntimeState::default());

            #[cfg(desktop)]
            {
                let _ = create_browser_window(
                    app.handle(),
                    "main",
                    "Crown Browser",
                    WebviewUrl::default(),
                    1200.0,
                    800.0,
                    None,
                    false,
                );
            }

            #[cfg(not(desktop))]
            {
                let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                    .title("Crown Browser");
                let _ = win_builder.build();
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Destroyed | tauri::WindowEvent::CloseRequested { .. } => {
                if let Some(cookie_jar) = window.try_state::<cookie_jar::SystemCookieJar>() {
                    cookie_jar.clear_ephemeral();
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            fetch_page_with_shield,
            download_file_native,
            open_incognito_window,
            open_new_window,
            fetch_chrome_crx,
            fetch_search_suggestions,
            window_minimize,
            window_toggle_maximize,
            window_close,
            update_cookie_policy_setting,
            update_vault_auth_setting,
            cookie_whitelist_add,
            cookie_whitelist_remove,
            vault_get_entries,
            vault_save_entry,
            vault_delete_entry,
            open_or_navigate_tab_webview,
            sync_tab_webview,
            tab_webview_action,
            close_tab_webview,
            sync_shield_config,
            set_tab_webview_zoom,
            update_tab_webview_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running Crown browser application");
}
