// Crown Browser — Native Rust Core (Desktop & Android)
use serde::{Deserialize, Serialize};
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ShieldEvalResult {
    pub blocked: bool,
    pub reason: Option<String>,
    pub clean_url: String,
}

fn extract_host(url: &str) -> String {
    let trimmed = url.trim().to_lowercase();
    let without_scheme = if let Some(idx) = trimmed.find("://") {
        &trimmed[idx + 3..]
    } else {
        trimmed.as_str()
    };
    let authority = without_scheme
        .split(&['/', '?', '#'][..])
        .next()
        .unwrap_or("");
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    host_port.split(':').next().unwrap_or("").to_string()
}

fn host_matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{}", domain))
}

pub fn evaluate_url_internal(url: &str) -> ShieldEvalResult {
    let clean_url = url.to_string();
    let lower = url.trim().to_lowercase();

    // Block dangerous schemes at the native layer
    if lower.starts_with("javascript:") || lower.starts_with("vbscript:") || lower.starts_with("data:text/html") {
        return ShieldEvalResult {
            blocked: true,
            reason: Some("unsafe_scheme".to_string()),
            clean_url,
        };
    }

    let host = extract_host(&lower);

    const AD_DOMAINS: &[&str] = &[
        "doubleclick.net",
        "googlesyndication.com",
        "googleadservices.com",
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
    ];

    const TRACKER_DOMAINS: &[&str] = &[
        "google-analytics.com",
        "googletagmanager.com",
        "hotjar.com",
        "clarity.ms",
        "segment.com",
        "mixpanel.com",
        "amplitude.com",
        "crazyegg.com",
        "mouseflow.com",
        "scorecardresearch.com",
    ];

    let is_ad = AD_DOMAINS.iter().any(|d| host_matches(&host, d));
    let is_tracker = TRACKER_DOMAINS.iter().any(|d| host_matches(&host, d))
        || (host_matches(&host, "facebook.net") && lower.contains("/fbevents.js"));

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
                    let url_str = url.as_str();
                    let eval = evaluate_url_internal(url_str);
                    if eval.blocked {
                        eprintln!("[Crown Native Shield] Blocked OS navigation: {}", url_str);
                        return false;
                    }
                    true
                });

            let _ = win_builder.build();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            evaluate_url,
            get_system_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running Crown browser application");
}
