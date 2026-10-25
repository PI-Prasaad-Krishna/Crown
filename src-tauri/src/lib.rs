// Crown Browser — Native Rust Core (Desktop & Android)
use serde::{Deserialize, Serialize};
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ShieldEvalResult {
    pub blocked: bool,
    pub reason: Option<String>,
    pub clean_url: String,
}

pub fn evaluate_url_internal(url: &str) -> ShieldEvalResult {
    let clean_url = url.to_string();
    let lower = url.to_lowercase();

    let is_ad = lower.contains("doubleclick.net")
        || lower.contains("googlesyndication.com")
        || lower.contains("googleadservices.com")
        || lower.contains("adnxs.com")
        || lower.contains("criteo.com")
        || lower.contains("outbrain.com")
        || lower.contains("taboola.com")
        || lower.contains("rubiconproject.com")
        || lower.contains("pubmatic.com")
        || lower.contains("openx.net")
        || lower.contains("advertising.com")
        || lower.contains("adcolony.com")
        || lower.contains("applovin.com")
        || lower.contains("unityads.unity3d.com")
        || lower.contains("amazon-adsystem.com")
        || lower.contains("casale-media.com")
        || lower.contains("media.net")
        || lower.contains("smartadserver.com")
        || lower.contains("adroll.com")
        || lower.contains("bidswitch.net")
        || lower.contains("popads.net")
        || lower.contains("propellerads.com");

    let is_tracker = lower.contains("google-analytics.com")
        || lower.contains("googletagmanager.com")
        || lower.contains("hotjar.com")
        || lower.contains("clarity.ms")
        || lower.contains("segment.com")
        || lower.contains("mixpanel.com")
        || lower.contains("amplitude.com")
        || lower.contains("crazyegg.com")
        || lower.contains("mouseflow.com")
        || lower.contains("facebook.net/en_us/fbevents.js")
        || lower.contains("scorecardresearch.com");

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
