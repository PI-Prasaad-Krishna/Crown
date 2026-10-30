// Crown Browser — Native Rust Core (Ultra-Low RAM Engine, Shield Gateway & Native Downloader)
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tauri::{WebviewUrl, WebviewWindowBuilder};
use url::Url;

static INCOGNITO_WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(1);

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

// Guard against SSRF to loopback, link-local, or private network addresses
fn is_Restricted_network_host(host: &str) -> bool {
    let lower = host.trim().to_lowercase();
    if lower == "localhost" || lower.ends_with(".local") || lower.ends_with(".internal") {
        return true;
    }
    let clean_ip = lower.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = clean_ip.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_broadcast()
                    || v4.is_unspecified()
                    || v4.octets()[0] == 100 && (v4.octets()[1] & 0b1100_0000) == 0b0100_0000
            }
            IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
        };
    }
    false
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

fn build_shield_injection(base_url: &str, shield_enabled: bool, cosmetic_css: &str) -> String {
    let safe_base = base_url.replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;");
    let ad_json = serde_json::to_string(AD_DOMAINS).unwrap_or_else(|_| "[]".to_string());
    let tracker_json = serde_json::to_string(TRACKER_DOMAINS).unwrap_or_else(|_| "[]".to_string());
    let safe_css = cosmetic_css.replace("</style", "<\\/style");

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

  function checkBlock(urlStr) {{
    if (!SHIELD_ON || !urlStr) return false;
    const adHost = matchHost(urlStr, AD_LIST);
    if (adHost) {{
      try {{ window.parent.postMessage({{ type: 'crown:shield-block', kind: 'ad', target: adHost }}, '*'); }} catch(e){{}}
      return true;
    }}
    const trkHost = matchHost(urlStr, TRACKER_LIST);
    if (trkHost) {{
      try {{ window.parent.postMessage({{ type: 'crown:shield-block', kind: 'tracker', target: trkHost }}, '*'); }} catch(e){{}}
      return true;
    }}
    return false;
  }}

  const origFetch = window.fetch;
  if (origFetch) {{
    window.fetch = function(input, init) {{
      const u = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      if (checkBlock(u)) return Promise.reject(new Error('Blocked by Crown Shield'));
      return origFetch.apply(this, arguments);
    }};
  }}

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {{
    if (checkBlock(String(url || ''))) {{
      this._crownBlocked = true;
    }}
    return origOpen.apply(this, arguments);
  }};
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {{
    if (this._crownBlocked) return;
    return origSend.apply(this, arguments);
  }};

  document.addEventListener('click', function(e) {{
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const rawHref = a.getAttribute('href') || '';
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;
    try {{
      const resolved = new URL(a.href, document.baseURI);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {{
        e.preventDefault();
        window.parent.postMessage({{ type: 'crown:page-nav', url: resolved.toString(), title: document.title || resolved.hostname }}, '*');
      }}
    }} catch (err) {{}}
  }}, true);

  window.addEventListener('DOMContentLoaded', function() {{
    try {{
      if (document.title) {{
        window.parent.postMessage({{ type: 'crown:page-title', title: document.title, url: document.baseURI }}, '*');
      }}
    }} catch (e) {{}}
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

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Crown/1.0 Chrome/126.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(parsed.as_str()).send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();

    if let Some(final_host) = resp.url().host_str() {
        if is_restricted_network_host(final_host) {
            return Err("Redirected to restricted network address".to_string());
        }
    }

    let raw_html = resp.text().await.map_err(|e| e.to_string())?;
    let injection = build_shield_injection(&final_url, shield_enabled, &cosmetic_css);

    let html = if let Some(idx) = raw_html.to_lowercase().find("<head>") {
        let insert_at = idx + 6;
        format!("{}{}{}", &raw_html[..insert_at], injection, &raw_html[insert_at..])
    } else {
        format!("{}{}", injection, raw_html)
    };

    Ok(ProxiedPageResponse {
        html,
        final_url,
        status,
    })
}

fn is_restricted_network_host(host: &str) -> bool {
    is_Restricted_network_host(host)
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

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(parsed.as_str()).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Download failed with HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let filename = sanitize_filename(&suggested_name);
    let target_dir = resolve_downloads_dir();
    let dest_path = target_dir.join(&filename);

    std::fs::write(&dest_path, &bytes).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(DownloadResult {
        filename,
        file_path: dest_path.to_string_lossy().to_string(),
        total_bytes: bytes.len(),
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
            open_incognito_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running Crown browser application");
}
