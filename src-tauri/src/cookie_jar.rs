// Crown Browser — Selective Ephemeral Cookie Jar & Whitelist Engine
// Implements in-memory RAM session isolation with disk-backed SQLite/file persistence for whitelisted domains.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct CookieInfo {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    #[serde(default)]
    pub secure: bool,
    #[serde(default)]
    pub http_only: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct PersistentCookieStore {
    pub cookies: HashMap<String, Vec<CookieInfo>>,
    pub whitelist: Vec<String>,
    pub cookie_mode: String, // "COMPROMISE" | "TOTAL_WIPE" | "PERSIST_ALL"
}

pub struct SystemCookieJar {
    pub ephemeral_jar: Mutex<HashMap<String, Vec<CookieInfo>>>, // Domain -> Cookies (RAM Only)
    pub whitelist: Mutex<Vec<String>>,
    pub cookie_mode: Mutex<String>,
    storage_path: PathBuf,
}

impl SystemCookieJar {
    pub fn new(base_dir: &Path) -> Self {
        let crown_dir = base_dir.join("Crown");
        let _ = fs::create_dir_all(&crown_dir);
        let storage_path = crown_dir.join("persistent_cookies.json");

        let mut initial_whitelist = Vec::new();
        let mut initial_mode = "COMPROMISE".to_string();

        if storage_path.exists() {
            if let Ok(mut file) = File::open(&storage_path) {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok() {
                    if let Ok(store) = serde_json::from_str::<PersistentCookieStore>(&content) {
                        initial_whitelist = store.whitelist;
                        if !store.cookie_mode.is_empty() {
                            initial_mode = store.cookie_mode;
                        }
                    }
                }
            }
        }

        Self {
            ephemeral_jar: Mutex::new(HashMap::new()),
            whitelist: Mutex::new(initial_whitelist),
            cookie_mode: Mutex::new(initial_mode),
            storage_path,
        }
    }

    fn normalize_domain(domain: &str) -> String {
        domain.trim().trim_start_matches('.').to_lowercase()
    }

    pub fn is_whitelisted(&self, domain: &str) -> bool {
        let clean = Self::normalize_domain(domain);
        let wl = self.whitelist.lock().unwrap();
        wl.iter().any(|d| {
            let cd = Self::normalize_domain(d);
            clean == cd || clean.ends_with(&format!(".{}", cd))
        })
    }

    pub fn commit_cookie(&self, domain: &str, cookie: CookieInfo) {
        let clean_domain = Self::normalize_domain(domain);
        let mode = self.cookie_mode.lock().unwrap().clone();
        let whitelisted = self.is_whitelisted(&clean_domain);

        match mode.as_str() {
            "TOTAL_WIPE" => {
                // Keep strictly in ephemeral RAM
                let mut jar = self.ephemeral_jar.lock().unwrap();
                let list = jar.entry(clean_domain).or_default();
                list.retain(|c| c.name != cookie.name || c.path != cookie.path);
                list.push(cookie);
            }
            "PERSIST_ALL" => {
                // Write directly to disk
                self.persist_cookie_to_disk(&clean_domain, cookie);
            }
            _ => {
                // "COMPROMISE" mode (default):
                // Whitelisted domains are saved to persistent disk; all others stay purely in RAM
                if whitelisted {
                    self.persist_cookie_to_disk(&clean_domain, cookie);
                } else {
                    let mut jar = self.ephemeral_jar.lock().unwrap();
                    let list = jar.entry(clean_domain).or_default();
                    list.retain(|c| c.name != cookie.name || c.path != cookie.path);
                    list.push(cookie);
                }
            }
        }
    }

    pub fn get_cookies_for_domain(&self, domain: &str) -> Vec<CookieInfo> {
        let clean_domain = Self::normalize_domain(domain);
        let mut results = Vec::new();

        // 1. Check ephemeral RAM
        if let Ok(jar) = self.ephemeral_jar.lock() {
            for (d, cookies) in jar.iter() {
                if clean_domain == *d || clean_domain.ends_with(&format!(".{}", d)) {
                    results.extend(cookies.clone());
                }
            }
        }

        // 2. Check persistent disk
        if let Ok(store) = self.read_disk_store() {
            for (d, cookies) in store.cookies.iter() {
                if clean_domain == *d || clean_domain.ends_with(&format!(".{}", d)) {
                    for c in cookies {
                        if !results.iter().any(|r| r.name == c.name && r.domain == c.domain) {
                            results.push(c.clone());
                        }
                    }
                }
            }
        }

        results
    }

    // Zero-out sequence for ephemeral memory space
    pub fn clear_ephemeral(&self) {
        if let Ok(mut jar) = self.ephemeral_jar.lock() {
            jar.clear();
            jar.shrink_to_fit();
        }
    }

    pub fn set_cookie_mode(&self, mode: &str) {
        let sanitized = match mode {
            "TOTAL_WIPE" => "TOTAL_WIPE",
            "PERSIST_ALL" => "PERSIST_ALL",
            _ => "COMPROMISE",
        };
        if let Ok(mut m) = self.cookie_mode.lock() {
            *m = sanitized.to_string();
        }
        self.sync_disk_metadata();
    }

    pub fn get_cookie_mode(&self) -> String {
        self.cookie_mode.lock().unwrap().clone()
    }

    pub fn add_whitelist_domain(&self, domain: &str) {
        let clean = Self::normalize_domain(domain);
        if clean.is_empty() {
            return;
        }
        if let Ok(mut wl) = self.whitelist.lock() {
            if !wl.iter().any(|d| Self::normalize_domain(d) == clean) {
                wl.push(clean);
            }
        }
        self.sync_disk_metadata();
    }

    pub fn remove_whitelist_domain(&self, domain: &str) {
        let clean = Self::normalize_domain(domain);
        if let Ok(mut wl) = self.whitelist.lock() {
            wl.retain(|d| Self::normalize_domain(d) != clean);
        }
        self.sync_disk_metadata();
    }

    pub fn get_whitelist(&self) -> Vec<String> {
        self.whitelist.lock().unwrap().clone()
    }

    fn read_disk_store(&self) -> Result<PersistentCookieStore, String> {
        if !self.storage_path.exists() {
            return Ok(PersistentCookieStore::default());
        }
        let mut file = File::open(&self.storage_path).map_err(|e| e.to_string())?;
        let mut content = String::new();
        file.read_to_string(&mut content).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }

    fn write_disk_store(&self, store: &PersistentCookieStore) -> Result<(), String> {
        if let Some(parent) = self.storage_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
        let mut file = File::create(&self.storage_path).map_err(|e| e.to_string())?;
        file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())
    }

    fn persist_cookie_to_disk(&self, domain: &str, cookie: CookieInfo) {
        let mut store = self.read_disk_store().unwrap_or_default();
        store.whitelist = self.get_whitelist();
        store.cookie_mode = self.get_cookie_mode();
        let list = store.cookies.entry(domain.to_string()).or_default();
        list.retain(|c| c.name != cookie.name || c.path != cookie.path);
        list.push(cookie);
        let _ = self.write_disk_store(&store);
    }

    fn sync_disk_metadata(&self) {
        let mut store = self.read_disk_store().unwrap_or_default();
        store.whitelist = self.get_whitelist();
        store.cookie_mode = self.get_cookie_mode();
        let _ = self.write_disk_store(&store);
    }
}

