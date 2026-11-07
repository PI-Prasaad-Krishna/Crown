// Crown Browser — Native Rust Core (Ultra-Low RAM Engine, Shield Gateway & Native Downloader)
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Write;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{WebviewUrl, WebviewWindowBuilder};
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
        return match ip {
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
        };
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
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Crown/1.0 Chrome/126.0.0.0 Safari/537.36")
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

fn build_shield_injection(base_url: &str, shield_enabled: bool, cosmetic_css: &str, extension_js: &str) -> String {
    let safe_base = base_url.replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;");
    let ad_json = serde_json::to_string(AD_DOMAINS).unwrap_or_else(|_| "[]".to_string());
    let tracker_json = serde_json::to_string(TRACKER_DOMAINS).unwrap_or_else(|_| "[]".to_string());
    let safe_css = cosmetic_css.replace("</style", "<\\/style");
    let safe_ext_js = extension_js.replace("</script", "<\\/script");

    format!(
        r#"<base href="{safe_base}">
<style id="crown-shield-cosmetic">{safe_css}</style>
<script>
(function() {{
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
      try {{ window.parent.postMessage({{ type: 'crown:devtools-net', method: m, url: String(urlStr || ''), status: 'ALLOW', kind: 'request' }}, '*'); }} catch(e){{}}
      return false;
    }}
    const adHost = matchHost(urlStr, AD_LIST);
    if (adHost) {{
      try {{
        window.parent.postMessage({{ type: 'crown:shield-block', kind: 'ad', target: adHost }}, '*');
        window.parent.postMessage({{ type: 'crown:devtools-net', method: m, url: String(urlStr), status: 'BLOCKED (Ad)', kind: 'ad' }}, '*');
      }} catch(e){{}}
      return true;
    }}
    const trkHost = matchHost(urlStr, TRACKER_LIST);
    if (trkHost) {{
      try {{
        window.parent.postMessage({{ type: 'crown:shield-block', kind: 'tracker', target: trkHost }}, '*');
        window.parent.postMessage({{ type: 'crown:devtools-net', method: m, url: String(urlStr), status: 'BLOCKED (Tracker)', kind: 'tracker' }}, '*');
      }} catch(e){{}}
      return true;
    }}
    try {{ window.parent.postMessage({{ type: 'crown:devtools-net', method: m, url: String(urlStr), status: 'ALLOW', kind: 'request' }}, '*'); }} catch(e){{}}
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
          window.parent.postMessage({{ type: 'crown:devtools-log', level: level, text: args }}, '*');
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

  window.addEventListener('message', function(e) {{
    if (e.source !== window.parent || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'crown:devtools-request-dom') {{
      try {{
        const tree = serializeDomNode(document.documentElement, 0);
        const totalNodes = document.getElementsByTagName('*').length;
        const scriptsCount = document.scripts ? document.scripts.length : 0;
        const stylesCount = document.styleSheets ? document.styleSheets.length : 0;
        window.parent.postMessage({{
          type: 'crown:devtools-dom',
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
        window.parent.postMessage({{ type: 'crown:devtools-log', level: 'result', text: formatted }}, '*');
      }} catch (err) {{
        window.parent.postMessage({{ type: 'crown:devtools-log', level: 'error', text: String(err) }}, '*');
      }}
    }}
  }});

  function resolveSafeLink(el) {{
    const a = el && el.closest ? el.closest('a[href]') : null;
    if (!a) return null;
    const rawHref = a.getAttribute('href') || '';
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return null;
    try {{
      const resolved = new URL(a.href, document.baseURI);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {{
        return resolved;
      }}
    }} catch (err) {{}}
    return null;
  }}

  document.addEventListener('click', function(e) {{
    if (autoScrollActive) {{
      stopAutoScroll();
      e.preventDefault();
      return;
    }}
    const resolved = resolveSafeLink(e.target);
    if (!resolved) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.shiftKey) {{
      window.parent.postMessage({{ type: 'crown:page-open-new-tab', url: resolved.toString() }}, '*');
    }} else {{
      window.parent.postMessage({{ type: 'crown:page-nav', url: resolved.toString(), title: document.title || resolved.hostname }}, '*');
    }}
  }}, true);

  document.addEventListener('auxclick', function(e) {{
    if (e.button !== 1) return;
    const resolved = resolveSafeLink(e.target);
    if (resolved) {{
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage({{ type: 'crown:page-open-new-tab', url: resolved.toString() }}, '*');
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
    try {{ window.parent.postMessage({{ type: 'crown:frame-focus' }}, '*'); }} catch(err) {{}}
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
      try {{ window.parent.postMessage({{ type: 'crown:toggle-devtools' }}, '*'); }} catch(err) {{}}
    }}
  }}, true);

  window.addEventListener('DOMContentLoaded', function() {{
    try {{
      if (document.title) {{
        window.parent.postMessage({{ type: 'crown:page-title', title: document.title, url: document.baseURI }}, '*');
      }}
    }} catch (e) {{}}
    try {{
      {safe_ext_js}
    }} catch (extErr) {{
      console.warn('[Crown Extension Sandbox]', extErr);
    }}
  }});
}})();
</script>"#
    )
}

#[tauri::command]
fn evaluate_url(url: String) -> ShieldEvalResult {
    evaluate_url_internal(&url)
}

#[tauri::command]
fn get_system_info() -> String {
    format!(
        "Crown Native Core v1.0.0 (Target: {}, Arch: {})",
        std::env::consts::OS,
        std::env::consts::ARCH
    )
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
    if is_restricted_network_host(host) {
        return Err("Restricted local/private network address".to_string());
    }

    let eval = evaluate_url_internal(parsed.as_str());
    if shield_enabled && eval.blocked {
        return Err(format!("Blocked by Crown Shield ({})", eval.reason.unwrap_or_default()));
    }

    let mut req = get_shield_client().get(parsed.as_str());

    // Strict ASCII validation for custom Accept-Language header to prevent CRLF / header injection
    if let Some(raw_lang) = accept_language {
        let trimmed = raw_lang.trim();
        if !trimmed.is_empty()
            && trimmed.len() <= 48
            && trimmed.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | ',' | ';' | '=' | '.'))
        {
            req = req.header(reqwest::header::ACCEPT_LANGUAGE, trimmed);
        }
    }

    if send_gpc.unwrap_or(true) {
        req = req.header("DNT", "1").header("Sec-GPC", "1");
    }

    let mut resp = req
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();

    if let Some(final_host) = resp.url().host_str() {
        if is_restricted_network_host(final_host) {
            return Err("Redirected to restricted network address".to_string());
        }
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
    );

    // Zero-allocation, UTF-8 safe ASCII byte-window search for <head>
    let head_pos = raw_html
        .as_bytes()
        .windows(6)
        .position(|w| w.eq_ignore_ascii_case(b"<head>"));

    let html = if let Some(idx) = head_pos {
        let insert_at = idx + 6;
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
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() || trimmed == ".." {
        "crown-download.bin".to_string()
    } else {
        trimmed.chars().take(180).collect()
    }
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
        if is_restricted_network_host(host) {
            return Err("Restricted network host".to_string());
        }
    }

    let mut resp = get_download_client()
        .get(parsed.as_str())
        .send()
        .await
        .map_err(|e| e.to_string())?;

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

#[tauri::command]
fn open_incognito_window(app: tauri::AppHandle) -> Result<(), String> {
    let id = INCOGNITO_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("incognito-{}", id);

    let win_builder = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::App("index.html?incognito=1".into()),
    )
    .title("Crown Browser (Incognito)")
    .inner_size(1200.0, 800.0)
    .min_inner_size(360.0, 540.0)
    .resizable(true)
    .incognito(true)
    .on_navigation(|url| {
        if !is_allowed_shell_navigation(url) {
            eprintln!("[Crown Native Shield] Blocked top-level shell navigation: {}", url);
            return false;
        }
        let eval = evaluate_url_internal(url.as_str());
        !eval.blocked
    });

    win_builder.build().map_err(|e| e.to_string())?;
    Ok(())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Crown Browser")
                .inner_size(1200.0, 800.0)
                .min_inner_size(360.0, 540.0)
                .resizable(true)
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

            let _ = win_builder.build();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            evaluate_url,
            get_system_info,
            fetch_page_with_shield,
            download_file_native,
            open_incognito_window,
            fetch_search_suggestions,
            window_minimize,
            window_toggle_maximize,
            window_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running Crown browser application");
}
