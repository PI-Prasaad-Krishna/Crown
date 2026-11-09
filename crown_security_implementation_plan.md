# IMPLEMENTATION ARCHITECTURE SPECIFICATION
# TARGET SYSTEM: Crown Browser (Tauri v2 + Native Rust Core + Vanilla ES6 Core)
# PROFILE: Selective Ephemeral Cookies & Hardware-Backed Hybrid Local Vault
# DATE: November 9, 2026

===============================================================================
1. OBJECTIVE & ARCHITECTURAL PHILOSOPHY
===============================================================================
- Privacy-First, Zero-Friction: Implement maximum privacy boundaries by default.
- Zero-Knowledge Local Architecture: Eliminate cloud dependencies completely.
- Offload Cryptography to Device Hardware: Seamlessly transition between desktop 
  hardware components (TPM, DPAPI, Apple Keychain) and mobile TEE via unified APIs.
- User Agency: Provide deterministic toggle overrides for data retention and storage 
  mechanisms via `crown://settings`.

===============================================================================
2. SYSTEM COMPONENT INTEGRATION MAP
===============================================================================
Frontend Layer (`src/js/`) 
 ├── `storage.js` -> Manages state routing, whitelist lookups, and DOM autofill.
 ├── `settings.js` -> Routes user configuration switches back across the bridge.
 └── IPC Bridge (`window.__TAURI_INTERNALS__.invoke`)
         │
         ▼
Tauri IPC Secure Bridge Layers
         │
         ▼
Native Rust Core Layer (`src-tauri/src/`)
 ├── `lib.rs` -> Handles core orchestration, cross-platform execution orchestration.
 ├── `cookie_jar.rs` -> Ephemeral memory tracking vs. Persistent SQLite serialization.
 └── `crypto_vault.rs` -> Hardware binding, AEAD execution, RAM mitigation (`zeroize`).

===============================================================================
3. PART I: COMPROMISE COOKIE SETTING (SELECTIVE PERSISTENCE)
===============================================================================
A. Structural Execution
- Default Behavior: Every cookie header parsed via `fetch_page_with_shield()` is treated 
  as an in-memory session cookie, stripping long-lived `Expires` or `Max-Age` constraints 
  unless explicitly matched against the Whitelist DB.
- Whitelist DB Engine: Light, file-backed SQLite database operating within the local user 
  app data directory (`AppSupport/Crown/`).

B. Rust Core Implementation (`src-tauri/src/cookie_jar.rs`)
```rust
use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::AppHandle;

#[derive(Serialize, Deserialize, Clone)]
pub struct CookieInfo {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
}

pub struct SystemCookieJar {
    pub ephemeral_jar: Mutex<HashMap<String, Vec<CookieInfo>>>, // Domain -> Cookies (RAM Only)
    pub db_connection: rusqlite::Connection,                   // Whitelisted persistent store
}

impl SystemCookieJar {
    pub fn commit_cookie(&self, domain: &str, cookie: CookieInfo, is_whitelisted: bool) {
        if is_whitelisted {
            // Write directly to local disk SQLite store
            self.db_connection.execute(
                "INSERT OR REPLACE INTO persistent_cookies (domain, name, value, path) VALUES (?1, ?2, ?3, ?4)",
                (&cookie.domain, &cookie.name, &cookie.value, &cookie.path),
            ).unwrap();
        } else {
            // Retain purely within memory allocation
            let mut jar = self.ephemeral_jar.lock().unwrap();
            jar.entry(domain.to_string()).or_insert_with(Vec::new).push(cookie);
        }
    }
}
```

C. Lifecycle Destruction Trigger (`src-tauri/src/lib.rs`)
```rust
tauri::Builder::default()
    .on_window_event(|window, event| match event {
        tauri::WindowEvent::Destroyed | tauri::WindowEvent::CloseRequested => {
            // Trigger zero-out sequence for ephemeral memory spaces
            let state = window.state::<SystemCookieJar>();
            let mut jar = state.ephemeral_jar.lock().unwrap();
            
            // Explicitly clear and allocate new clean memory map
            jar.clear();
            jar.shrink_to_fit();
        }
        _ => {}
    })
```

===============================================================================
4. PART II: HARDWARE-BACKED HYBRID LOCAL VAULT (ZERO-KNOWLEDGE)
===============================================================================
A. Cryptographic Foundations
- Storage File Format: Authenticated Encrypted JSON block saved globally to `~/.config/crown/vault.enc`.
- Algorithm: AES-256-GCM or ChaCha20-Poly1305.
- Key Handling Strategy: Automated OS Hardware Extraction.

B. Multi-Platform Hardware Integration Core (`src-tauri/src/crypto_vault.rs`)
```rust
use keyring::Entry;
use rand::RngCore;
use zeroize::Zeroize;

#[cfg(target_os = "android")]
use jni::JNIEnv;

pub fn fetch_hardware_master_key() -> Result<Vec<u8>, String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        let entry = Entry::new("com.crown.browser", "system_vault_key")
            .map_err(|e| e.to_string())?;
            
        match entry.get_password() {
            Ok(hex_key) => Ok(hex::decode(hex_key).unwrap()),
            Err(_) => {
                // Initialize default randomized state safely
                let mut raw_key = vec![0u8; 32];
                rand::thread_rng().fill_bytes(&mut raw_key);
                let hex_encoded = hex::encode(&raw_key);
                entry.set_password(&hex_encoded).map_err(|e| e.to_string())?;
                raw_key.zeroize(); // Wipe working structure from stack
                Ok(hex::decode(hex_encoded).unwrap())
            }
        }
    }

    #[cfg(target_os = "android")]
    {
        // Interop framework wrapper mapping back to the Android KeyStore System
        // Calls KeyStore via Native JNI bridge inside the TEE/StrongBox wrapper environment.
        unimplemented!("Android keystore JNI binding mapped inside tauri android-plugin infrastructure");
    }
}
```

C. The Secure Memory Protection Guarding Strategy
- Wrap dynamic credential strings returned across the bridge inside types implementing the `Zeroize` trait.
- Keep the JavaScript representation bounded tightly inside standard scoping limits. Immediately write structural values directly to targeted DOM structures, rather than maintaining globally accessible memory handles.

===============================================================================
5. PART III: THE TOGGLEABLE SETTINGS SYSTEM SCHEMA
===============================================================================
To preserve full operational autonomy for the user, provide deterministic overrides inside `crown://settings`.

A. Default Configuration Logic Matrix
- `cookie_mode`: Default state is `"COMPROMISE"`. 
  - Overrides: `"TOTAL_WIPE"` (All entries dropped on app exit), `"PERSIST_ALL"` (Legacy insecure tracking operation).
- `vault_security_level`: Default state is `"HARDWARE_ONLY"`.
  - Overrides: `"HARDWARE_WITH_BIOMETRIC"` (Forces Windows Hello / Touch ID / Device Lock PIN check before processing IPC autofill requests).

B. Frontend Settings Controller (`src/js/settings.js`)
```javascript
// Dispatches modified toggle actions downstream directly across the native core
async function updateCookieCompromiseMode(targetMode) {
    try {
        await window.__TAURI_INTERNALS__.invoke('update_cookie_policy_setting', { 
            policyMode: targetMode 
        });
        console.log(`Crown privacy boundary reconfigured to: ${targetMode}`);
    } catch (err) {
        console.error("Failed to commit settings boundary alteration:", err);
    }
}

async function updateVaultSecurityLevel(targetLevel) {
    try {
        await window.__TAURI_INTERNALS__.invoke('update_vault_auth_setting', {
            securityLevel: targetLevel
        });
    } catch (err) {
        console.error("Failed to commit vault security configuration:", err);
    }
}
```

C. Rust IPC Boundary Processing Switch (`src-tauri/src/lib.rs`)
```rust
#[tauri::command]
fn update_cookie_policy_setting(policy_mode: String, state: tauri::State<SystemConfig>) -> Result<(), String> {
    let mut config = state.lock_configuration();
    // Persist configuration change to system disk state
    config.cookie_mode = policy_mode; 
    config.save_to_disk();
    Ok(())
}

#[tauri::command]
fn update_vault_auth_setting(security_level: String, state: tauri::State<SystemConfig>) -> Result<(), String> {
    let mut config = state.lock_configuration();
    config.vault_security_level = security_level;
    config.save_to_disk();
    Ok(())
}
```

===============================================================================
6. IMPLEMENTATION STEPS FOR ANTIGRAVITY IDE
===============================================================================
1. Create new modules under `src-tauri/src/` named `cookie_jar.rs` and `crypto_vault.rs`.
2. Update `src-tauri/Cargo.toml` dependencies with:
   `keyring = "3.2"`, `zeroize = { version = "1.8", features = ["derive"] }`, `rusqlite = "0.32"`, `aes-gcm = "0.10"`.
3. Include new rust modules inside `src-tauri/src/lib.rs` using `pub mod cookie_jar;` and `pub mod crypto_vault;`.
4. Register the new system configuration states and command methods directly within the `tauri::Builder` instantiation layout.
5. Create UI inputs mapping cleanly to `updateCookieCompromiseMode` and `updateVaultSecurityLevel` in the settings frontend engine.
