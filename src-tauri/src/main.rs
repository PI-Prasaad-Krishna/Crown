// Crown Browser — Native Rust Core (Desktop & Android)
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{command, AppHandle, Runtime};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct ShieldEvalResult {
    pub blocked: bool,
    pub reason: Option<String>,
    pub clean_url: String,
}

#[command]
fn evaluate_url(url: String) -> ShieldEvalResult {
    let clean_url = url.clone();
    let lower = url.to_lowercase();
    
    // Check against ad and tracker heuristics
    let is_ad = lower.contains("doubleclick.net") 
        || lower.contains("googlesyndication.com") 
        || lower.contains("adnxs.com")
        || lower.contains("criteo.com");

    let is_tracker = lower.contains("google-analytics.com")
        || lower.contains("googletagmanager.com")
        || lower.contains("hotjar.com")
        || lower.contains("clarity.ms");

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

#[command]
fn get_system_info() -> String {
    format!(
        "Crown Native Core v1.0.0 (Target: {})",
        std::env::consts::OS
    )
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            evaluate_url,
            get_system_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running Crown browser application");
}
