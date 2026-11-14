# Crown Browser — Complete Project Documentation & Technical Specification

> **Version:** 1.0.0  
> **Target Platforms:** Windows, macOS, Linux, Android (SDK 24+)  
> **Core Architecture:** Tauri v2 (Rust Native Core) + Vanilla ES6+ Web Shell + Vite 5  
> **License:** MIT  

---

## Table of Contents
1. [Project Overview & Architectural Philosophy](#1-project-overview--architectural-philosophy)
2. [Complete Repository Directory Structure](#2-complete-repository-directory-structure)
3. [Native Rust Core Engine (`src-tauri`)](#3-native-rust-core-engine-src-tauri)
   - [3.1 Native Module Layout & Cargo Configuration](#31-native-module-layout--cargo-configuration)
   - [3.2 Tauri IPC Command Registry](#32-tauri-ipc-command-registry)
   - [3.3 Cloudflare-Grade SSRF & Port Filtering](#33-cloudflare-grade-ssrf--port-filtering)
   - [3.4 Shield Gateway & Page Proxy Engine](#34-shield-gateway--page-proxy-engine)
   - [3.5 Native Downloader Engine](#35-native-downloader-engine)
   - [3.6 Window Lifecycle & Multi-Window Spawning](#36-window-lifecycle--multi-window-spawning)
   - [3.7 Chrome Web Store CRX3 Package Fetcher](#37-chrome-web-store-crx3-package-fetcher)
   - [3.8 Search Suggestions Provider](#38-search-suggestions-provider)
4. [Security & Cryptography Subsystems](#4-security--cryptography-subsystems)
   - [4.1 Selective Ephemeral Cookie Jar (`cookie_jar.rs`)](#41-selective-ephemeral-cookie-jar-cookie_jarrs)
   - [4.2 Hardware-Backed Hybrid Local Vault (`crypto_vault.rs`)](#42-hardware-backed-hybrid-local-vault-crypto_vaultrs)
   - [4.3 Content Security Policy (CSP) Configuration](#43-content-security-policy-csp-configuration)
5. [Front-End Core Engine (`src/js`)](#5-front-end-core-engine-srcjs)
   - [5.1 Main Controller (`app.js`)](#51-main-controller-appjs)
   - [5.2 Tab Management & FLIP Engine (`tabs.js`)](#52-tab-management--flip-engine-tabsjs)
   - [5.3 Persistence & Multi-Profile Storage (`storage.js`)](#53-persistence--multi-profile-storage-storagejs)
   - [5.4 Search Engine & Omnibox Parser (`search.js`)](#54-search-engine--omnibox-parser-searchjs)
   - [5.5 Internal Views & Virtual Scheme Router (`internal-views.js`)](#55-internal-views--virtual-scheme-router-internal-viewsjs)
6. [Dynamic Favicon & Identity Engine](#6-dynamic-favicon--identity-engine)
7. [Crown Shield Ad & Tracker Protection](#7-crown-shield-ad--tracker-protection)
8. [Cross-Device & Mobile (Android) Responsive System](#8-cross-device--mobile-android-responsive-system)
9. [Design System, Theming & UI Layout](#9-design-system-theming--ui-layout)
10. [Automated Unit Testing & Production Verification](#10-automated-unit-testing--production-verification)
11. [Build, Packaging & Distribution Pipeline](#11-build-packaging--distribution-pipeline)
12. [Complete Keyboard Shortcuts & Gestures Reference](#12-complete-keyboard-shortcuts--gestures-reference)

---

## 1. Project Overview & Architectural Philosophy

Crown Browser is an ultra-lightweight, customizable modern web browser designed to eliminate bloat, minimize system resource consumption, and enforce uncompromising privacy by default.

### Key Architectural Tenets
1. **Zero Framework Overhead**: The front-end user interface is implemented entirely in vanilla ES6+ JavaScript, native modern CSS, and HTML5. There is no React, Vue, Angular, or virtual DOM abstraction. DOM elements are updated via fine-grained, in-place reconciliation and the FLIP (First, Last, Invert, Play) animation technique, guaranteeing 60fps interaction with negligible CPU load and zero memory leaks.
2. **Dual-Layer Architecture**:
   - **Native System Layer (Rust / Tauri v2)**: Handles high-performance HTTP networking, TLS termination, SSRF security validation, encrypted credentials vaulting (AES-256-GCM), native file streaming downloads, Chrome Web Store CRX package parsing, and native OS window management.
   - **Web Shell Layer (HTML/CSS/JS)**: Renders the frameless browser shell (tab bars, address omnibox, bookmarks, defense panel, settings, history, and downloads). On desktop, external websites render in native child WebView2 instances (`WebviewBuilder::new`) with Win32 `SetWindowRgn` cutout regions keeping pages live behind floating menus (with an `<iframe>` fallback only when running outside Tauri).
3. **Ultra-Low Memory Footprint**: Crown leverages the OS WebView2 runtime (no bundled Chromium binary) and implements an *Ultra-Low RAM Hibernation* engine that closes inactive tab webviews while preserving full history stacks and state.
4. **Brave-Inspired Built-In Shields**: Protection is enforced at the native WebView2 `WebResourceRequested` network layer (`ShieldRuntimeState`) and via in-page JavaScript/cosmetic rules, blocking banner ads, video prerolls, telemetry trackers, and tracking URL parameters (`utm_*`, `fbclid`, `gclid`).
5. **Zero-Knowledge Security Vault & Ephemeral Cookie Storage**: Sensitive credentials are encrypted on-device with hardware-derived keys and memory stack zeroization. Cookie storage defaults to RAM-only ephemeral retention, and Incognito windows enforce `.incognito(true)` InPrivate isolation on both the shell and all child tab webviews.

```mermaid
graph TD
    User([User Interaction]) --> WebShell[Crown Web Shell Vanilla JS/CSS]
    WebShell --> TabEng[TabEngine & FLIP Transitions]
    WebShell --> Omnibox[Search & Omnibox Parser]
    WebShell --> ShieldUI[Defense Hub & Shields]
    WebShell --> Views[crown:// Internal Views Router]
    
    TabEng --> ChildWV[Native Child WebView2 Tabs]
    
    WebShell -- Tauri IPC Invoke --> RustCore[Rust Native Core lib.rs]
    
    RustCore --> CookieJar[Selective Ephemeral Cookie Jar]
    RustCore --> CryptoVault[Hardware-Backed Hybrid Vault AES-256-GCM]
    RustCore --> NetShield[WebResourceRequested Shield & SSRF Filter]
    RustCore --> Downloader[Native Chunked Downloader]
    RustCore --> SuggestClient[Search Suggestion Client]
    RustCore --> WindowMgr[Frameless WindowBuilder & Cutouts]
    
    ChildWV --> Internet((External Web / HTTPS))
    Downloader --> Disk[(Downloads Directory)]
    CookieJar --> EphemRAM[(In-Memory RAM Jar)]
    CookieJar --> WhitelistDisk[(persistent_cookies.json)]
    CryptoVault --> VaultDisk[(vault.enc + .master_hardware_key)]
```

---

## 2. Complete Repository Directory Structure

```
d:\Crown\
├── .gitignore                          # Git exclusions for dependencies, builds, OS files, and local caches
├── CROWN_DOCUMENTATION.md              # Complete technical documentation & specification (this file)
├── crown_security_implementation_plan.md# Initial security roadmap & specification document
├── package.json                        # Node.js project manifest, dependencies, and build scripts
├── vite.config.js                      # Vite 5 configuration (root: 'src', publicDir: 'public')
├── src/                                # Front-end source code
│   ├── index.html                      # Single-page application shell, titlebar, modals, frame container
│   ├── css/
│   │   └── style.css                   # Comprehensive stylesheet, CSS variables, dark/light themes, mobile styles
│   ├── js/
│   │   ├── app.js                      # Central application controller, IPC bindings, frame management, DevTools
│   │   ├── internal-views.js           # Virtual router & renderers for crown:// views
│   │   ├── search.js                   # Search engine providers, bang shortcuts, omnibox input parser
│   │   ├── storage.js                  # Persistence layer, multi-profile isolation, bookmarks, settings
│   │   └── tabs.js                     # Tab lifecycle, FLIP animations, groups, Ultra-Low RAM Hibernation
│   └── public/                         # Static assets served at root / bundled to dist
│       └── assets/
│           ├── crown-logo.svg          # High-resolution vector browser brand logo
│           └── rules/
│               ├── adblock-rules.json  # Network domain blocklist & cosmetic CSS selectors
│               ├── privacy-rules.json  # Telemetry endpoints, analytics hosts, social widgets
│               └── query-filter.json   # Query parameter tracker stripping definitions
├── src-tauri/                          # Native Rust system layer (Tauri v2)
│   ├── Cargo.toml                      # Rust crate manifest, dependencies (ring, zeroize, hex, reqwest, tauri)
│   ├── tauri.conf.json                 # Tauri v2 runtime configuration, window specs, CSP security policies
│   ├── build.rs                        # Tauri build script
│   ├── icons/                          # Application icons across platforms (ico, icns, png)
│   └── src/
│       ├── main.rs                     # Native binary entry point
│       ├── lib.rs                      # Native core, IPC commands, SSRF filter, proxy engine, window manager
│       ├── cookie_jar.rs               # Selective ephemeral cookie jar, RAM store, whitelist persistence
│       └── crypto_vault.rs             # Hardware-backed AES-256-GCM vault, zeroize memory hygiene
└── test/                               # Automated unit testing suite
    ├── runner.js                       # Zero-dependency async test runner, reporter, pass/fail rate calculator
    ├── setup.js                        # Headless browser mock environment (DOM, Window, Storage, Fetch)
    └── unit/
        ├── downloads.test.js           # Native filename sanitizer, duplicate resolver tests
        ├── favicon.test.js             # Dynamic favicon resolution and fallback tests
        ├── responsive-mobile.test.js   # Responsive breakpoint, touch target, and mobile CSS rules tests
        ├── search.test.js              # Omnibox parser, search query routing, bang shortcuts tests
        ├── security-vault.test.js      # AES-256-GCM vault and selective cookie jar tests
        ├── shield.test.js              # Shield blocking, query parameter stripping, SSRF guard tests
        ├── storage.test.js             # Profile isolation, settings sanitization, bookmarks tests
        └── tab-engine.test.js          # Tab lifecycle, groups, and Ultra-Low RAM Hibernation tests
```

---

## 3. Native Rust Core Engine (`src-tauri`)

### 3.1 Native Module Layout & Cargo Configuration
The Rust native core is located in `src-tauri/`. It is compiled as a `staticlib`, `cdylib`, and `rlib` to support desktop execution as well as native mobile bindings for Android.

#### `Cargo.toml` Dependencies:
- **`tauri = "2.0.0"`**: Modern cross-platform windowing, webview bindings, and IPC event bus.
- **`serde = { version = "1.0", features = ["derive"] }` & `serde_json = "1.0"`**: High-speed serialization and deserialization between Rust structures and JavaScript JSON payloads.
- **`url = "2.5"`**: RFC 3986 compliant URL parsing and normalization.
- **`reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }`**: Async HTTP client utilizing Rustls for modern, memory-safe TLS without OpenSSL C library vulnerabilities.
- **`ring = "0.17"`**: High-performance cryptographic engine powering AES-256-GCM authenticated encryption and hardware-entropy system random number generation (`SystemRandom`).
- **`zeroize = "1.9"`**: Secure memory eradication ensuring master keys and credentials are overwritten with zeroes upon deallocation.
- **`hex = "0.4"`**: Hexadecimal encoding and decoding for cryptographic nonces and ciphertexts.

---

### 3.2 Tauri IPC Command Registry
The native layer exposes a comprehensive set of invokable commands registered through `tauri::generate_handler!`:

| Command Name | Arguments | Return Type | Description |
| :--- | :--- | :--- | :--- |
| `evaluate_url` | `url: String` | `ShieldEvalResult` | Checks a URL against native ad/tracker domain blocklists. |
| `get_system_info` | *None* | `String` | Returns host OS platform and target CPU architecture. |
| `open_or_navigate_tab_webview` | `tab_id, url, x, y, width, height, visible, shield_enabled, cosmetic_css, extension_js, spellcheck, zoom, is_incognito` | `Result<(), String>` | Spawns or navigates a native child WebView2 tab (with SSRF checks, `.incognito(...)` isolation, WebResourceRequested Shield, and OAuth popup support). |
| `sync_tab_webview` | `tab_id, x, y, width, height, visible, cutouts` | `Result<Option<String>, String>` | Positions/hides a child tab webview, applies Win32 `SetWindowRgn` cutout regions for floating overlays, and returns its live URL. |
| `tab_webview_action` | `tab_id, action` | `Result<(), String>` | Executes `back`, `forward`, `reload`, `mute`, or `unmute` on a child tab webview. |
| `close_tab_webview` | `tab_id` | `Result<(), String>` | Closes and disposes a child tab webview. |
| `sync_shield_config` | `shields_enabled, block_ads, block_trackers, send_gpc, ad_domains, tracker_domains, per_site_shields` | `Result<(), String>` | Syncs Crown Shield configuration and domain lists into Rust `ShieldRuntimeState`. |
| `set_tab_webview_zoom` | `tab_id, zoom` | `Result<(), String>` | Applies native zoom scale factor to a child tab webview. |
| `update_tab_webview_settings` | `tab_id, cosmetic_css, extension_js, spellcheck` | `Result<(), String>` | Live-updates cosmetic CSS, extension scripts, and spellcheck on a child tab webview. |
| `fetch_page_with_shield` | `url: String, shield_enabled: bool, cosmetic_css: String, accept_language: Option<String>, send_gpc: Option<bool>, extension_js: Option<String>` | `Result<ProxiedPageResponse, String>` | Legacy/fallback HTML proxy used for web-only (`vite` browser) mode when native child webviews are unavailable. |
| `download_file_native` | `url: String, suggested_name: String` | `Result<DownloadResult, String>` | Downloads a file natively to the OS Downloads directory with chunked streaming and duplicate filename resolution. |
| `open_incognito_window` | *AppHandle* | `Result<(), String>` | Spawns an isolated incognito browser window with memory-only partition. |
| `open_new_window` | `initial_url: Option<String>, x: Option<f64>, y: Option<f64>` | `Result<(), String>` | Spawns a new Crown window, optionally loading a specified URL and positioned at screen coordinates. |
| `fetch_chrome_crx` | `extension_id: String` | `Result<Vec<u8>, String>` | Downloads a signed CRX2/CRX3 package from the Chrome Web Store. |
| `fetch_search_suggestions` | `query: String, provider: Option<String>` | `Result<Vec<String>, String>` | Queries live search engine suggestion endpoints (Google, DuckDuckGo, Brave, Bing) with automatic failover. |
| `window_minimize` | *Window* | `Result<(), String>` | Minimizes the active window. |
| `window_toggle_maximize`| *Window* | `Result<(), String>` | Toggles between maximized and restored window states. |
| `window_close` | *Window* | `Result<(), String>` | Closes the current window and triggers ephemeral data destruction. |
| `update_cookie_policy_setting` | `policy_mode: String` | `Result<(), String>` | Sets cookie policy mode (`COMPROMISE`, `TOTAL_WIPE`, `PERSIST_ALL`). |
| `update_vault_auth_setting` | `security_level: String` | `Result<(), String>` | Updates vault security level (`HARDWARE_ONLY`, `HARDWARE_WITH_BIOMETRIC`). |
| `get_security_settings` | *State* | `Result<SecuritySettingsResponse, String>` | Returns current cookie mode, cookie whitelist, and vault security level. |
| `cookie_whitelist_add` | `domain: String` | `Result<(), String>` | Adds a domain to the persistent cookie whitelist. |
| `cookie_whitelist_remove` | `domain: String` | `Result<(), String>` | Removes a domain from the cookie whitelist. |
| `cookie_whitelist_get` | *State* | `Result<Vec<String>, String>` | Returns all whitelisted cookie domains. |
| `vault_get_entries` | *State* | `Result<Vec<VaultCredential>, String>` | Decrypts and retrieves stored credentials from the local vault. |
| `vault_save_entry` | `entry: VaultCredential` | `Result<(), String>` | Encrypts and commits a credential into the local vault. |
| `vault_delete_entry` | `id: String` | `Result<(), String>` | Deletes a credential from the vault by its ID. |
| `vault_clear` | *State* | `Result<(), String>` | Securely purges all vault credentials and re-encrypts an empty store. |

---

### 3.3 Cloudflare-Grade SSRF & Port Filtering
To prevent Server-Side Request Forgery (SSRF), DNS rebinding attacks, local network scanning, and protocol smuggling, Crown enforces rigorous multi-layered validation on every outbound request:

1. **Restricted IP Address Detection (`is_restricted_ip`)**:
   - **IPv4**: Blocks loopback (`127.0.0.0/8`), private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local autoconfiguration (`169.254.0.0/16`), broadcast (`255.255.255.255`), unspecified (`0.0.0.0`), multicast (`224.0.0.0/4`), carrier-grade shared address space (RFC 6598: `100.64.0.0/10`), and cloud metadata IP (`169.254.169.254`).
   - **IPv6**: Blocks loopback (`::1`), unspecified (`::`), multicast (`ff00::/8`), Unique Local Addresses (RFC 4193: `fc00::/7`), Link-Local addresses (`fe80::/10`), and IPv4-mapped IPv6 addresses (e.g., `::ffff:127.0.0.1` or `::ffff:169.254.169.254`).
2. **Host Resolution & DNS Rebinding Guard (`is_restricted_network_host_async`)**:
   - Resolves target domain names to their socket addresses using asynchronous worker threads prior to connection initiation.
   - If any resolved IP belongs to a restricted subnet, the connection is instantly rejected.
   - Host strings ending in `.localhost`, `.local`, or `.internal` are dropped immediately without DNS lookup.
3. **Unsafe Port Blacklist (`is_unsafe_network_port`)**:
   - Outbound connections are prohibited from targeting non-standard or dangerous infrastructure ports:
     - **FTP**: 20, 21
     - **SSH**: 22
     - **Telnet**: 23
     - **SMTP / Mail**: 25, 465, 587
     - **DNS**: 53
     - **POP3 / IMAP**: 109, 110, 143, 993, 995
     - **NetBIOS / SMB**: 135, 137, 139, 445
     - **Databases**: 3306 (MySQL), 5432 (PostgreSQL), 6379 (Redis), 11211 (Memcached), 27017 (MongoDB)
     - **Legacy & Remote Access**: 1, 7, 9, 11, 13, 15, 17, 19, 69, 79, 87, 95, 101-104, 111, 113, 115, 117, 119, 123, 179, 389, 512-515, 526, 530-532, 540, 556, 563, 601, 636, 2049.
4. **Strict Redirect Policy (`build_ssrf_safe_redirect_policy`)**:
   - Maximum 8 redirect hops allowed.
   - Scheme change to non-HTTP/HTTPS is blocked.
   - Strips embedded credentials (`user:pass@host`).
   - Re-evaluates destination host and port against SSRF and unsafe port filters on every redirect step.

---

### 3.4 Native Child WebView2 Engine & WebResourceRequested Shield
On desktop, Crown renders external websites inside native Tauri v2 child WebView2 instances (`open_or_navigate_tab_webview`) rather than `<iframe>`s, ensuring full compatibility with modern JS apps, cookies, WebAuthn, OAuth login popups (`NewWindowResponse::Allow` for sized/SSO popups), and `X-Frame-Options` / `CSP` headers:

1. **Network-Level Filtering & Privacy Headers**:
   - On Windows, `ICoreWebView2::AddWebResourceRequestedFilter` + `WebResourceRequestedEventHandler` inspects subresources against `ShieldRuntimeState` (`ad_domains`, `tracker_domains`, YouTube telemetry/ad endpoints, and per-site toggles).
   - Injects `Sec-GPC: 1` and `DNT: 1` request headers when enabled and emits `shield-block` events asynchronously back to the shell.
2. **Initialization Script (`build_child_webview_init_script`)**:
   - Injects `#crown-shield-cosmetic` CSS rules (including YouTube `:has()` ad-grid collapse rules), active user extensions, and spellcheck state.
   - Strips YouTube `adPlacements`/`playerAds`/`adSlots` JSON payloads and auto-skips video ads when Shield is active.
   - Forwards `crown:child-pointerdown` WebMessages so clicking back onto the page dismisses open floating menus.
3. **Legacy `fetch_page_with_shield` Fallback**:
   - Retained for non-Tauri browser preview mode, enforcing 5 MB HTML streaming caps and SSRF validation.

---

### 3.5 Native Downloader Engine
The native downloader (`download_file_native`) provides secure, resilient background file acquisition:

1. **Safety Constraints**:
   - Allowed schemes restricted to `http://` and `https://`.
   - SSRF host checks and unsafe port blacklists enforced.
   - Maximum file size cap enforced at 250 MB (`MAX_DOWNLOAD_BYTES`).
2. **Sanitization (`sanitize_filename`)**:
   - Strips dangerous path traversal characters: `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, and control characters `\0`..`\x1f`.
   - Detects and neutralizes Windows reserved device names: `CON`, `PRN`, `AUX`, `NUL`, `COM1`..`COM9`, `LPT1`..`LPT9` by prefixing with `crown-`.
   - Truncates filenames to a safe maximum of 180 characters.
3. **Collision Avoidance (`resolve_unique_download_path`)**:
   - Detects existing files in the user's Downloads directory and automatically appends sequential suffixes: `filename (1).ext`, `filename (2).ext`, up to 999.
4. **Streaming Execution**:
   - Streams chunks incrementally into disk via `std::fs::File`, removing partial temporary files immediately if the transfer fails or exceeds the size threshold.

---

### 3.6 Window Lifecycle & Multi-Window Spawning
Crown supports multi-window environments and tearing off tabs into independent windows:

1. **Incognito Windows (`open_incognito_window`)**:
   - Spawns a new `WebviewWindow` with `incognito(true)`.
   - Uses an isolated in-memory web session partition; cookies and history do not touch disk.
   - Appends `?incognito=1` to the shell entry URL to style the window with dark stealth accents and incognito indicator badges.
2. **Detached Windows (`open_new_window`)**:
   - Spawns a standard Crown window, passing target navigation URLs via query parameters (`index.html?initialUrl=...`).
   - Accepts initial `x` and `y` desktop screen coordinates to position the new window precisely where the user dropped a dragged tab.
3. **Destruction Cleanup**:
   - Listens to `WindowEvent::Destroyed` and `WindowEvent::CloseRequested`.
   - Invokes `cookie_jar.clear_ephemeral()`, immediately freeing in-memory cookie structures.

---

### 3.7 Chrome Web Store CRX3 Package Fetcher
The `fetch_chrome_crx` command enables Crown to download extensions directly from Google's official update servers:

1. **ID Validation**: Validates the 32-character Chrome extension identifier against `[a-p]{32}`.
2. **Direct Fetch**: Hits `https://clients2.google.com/service/update2/crx` with `acceptformat=crx2,crx3`.
3. **Package Safety**: Enforces a 25 MB package cap (`MAX_CRX_BYTES`) and validates minimum header length.

---

### 3.8 Search Suggestions Provider
The `fetch_search_suggestions` command powers Crown's omnibox autocomplete:

1. **Multi-Engine Support**: Supports Google OpenSearch, DuckDuckGo Autocomplete, Brave Search Suggest, and Bing API.
2. **Resilient Failover**: If the user's preferred search engine suggestion endpoint fails or times out (1200ms timeout), Crown automatically queries high-availability fallback endpoints (Google & DuckDuckGo).
3. **Dual-Format JSON Parser (`extract_suggestions_from_json`)**:
   - Parses Standard OpenSearch arrays: `["query", ["suggestion1", "suggestion2"]]`.
   - Parses DuckDuckGo object arrays: `[{"phrase": "suggestion1"}, {"phrase": "suggestion2"}]`.
   - Filters out duplicates and caps results to 6 suggestions.

---

## 4. Security & Cryptography Subsystems

### 4.1 Selective Ephemeral Cookie Jar (`cookie_jar.rs`)

Traditional browsers persist all cookies to disk databases (e.g., SQLite `Cookies` files), allowing persistent trackers to track users across browser restarts. Crown completely redesigns this mechanism:

```mermaid
stateDiagram-v2
    [*] --> InboundResponse: Set-Cookie Header Received
    InboundResponse --> PolicyCheck: Evaluate Cookie Policy Mode
    
    state PolicyCheck {
        TOTAL_WIPE --> EphemeralRAM: Store in RAM Only
        PERSIST_ALL --> DiskStore: Commit to persistent_cookies.json
        COMPROMISE --> WhitelistCheck: Is Domain in Whitelist?
    }
    
    state WhitelistCheck {
        No --> EphemeralRAM: Store in RAM Only
        Yes --> DiskStore: Commit to persistent_cookies.json
    }
    
    EphemeralRAM --> WindowClose: Window Close or Exit
    WindowClose --> ZeroedOut: Memory Drained & Dropped
    ZeroedOut --> [*]
```

#### Modes of Operation:
1. **`COMPROMISE` (Default)**:
   - Untrusted domains have their cookies stored strictly in an in-memory `HashMap<String, Vec<CookieInfo>>`.
   - Only domains explicitly added by the user to the *Cookie Whitelist* (e.g., trusted email or banking services) are serialized to `persistent_cookies.json`.
2. **`TOTAL_WIPE`**:
   - Zero cookies ever touch persistent disk storage. All cookies exist only in RAM and are permanently purged when the browser window closes.
3. **`PERSIST_ALL`**:
   - All cookies are written to `persistent_cookies.json` across sessions.

#### Cookie Model (`CookieInfo`):
```rust
pub struct CookieInfo {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
}
```

---

### 4.2 Hardware-Backed Hybrid Local Vault (`crypto_vault.rs`)

Crown features a built-in Zero-Knowledge credential vault for passwords and sensitive tokens:

#### Cryptographic Specifications:
- **Cipher**: AES-256-GCM (`ring::aead::AES_256_GCM`).
- **Key Length**: 256 bits (32 bytes).
- **Nonce / IV**: Cryptographically secure 96-bit (12-byte) initialization vector generated per encryption operation via `ring::rand::SystemRandom`.
- **Memory Hygiene (`Zeroize`)**: The `VaultCredential` struct implements the `Zeroize` trait:
  ```rust
  impl Zeroize for VaultCredential {
      fn zeroize(&mut self) {
          self.secret.zeroize();
          self.username.zeroize();
      }
  }
  ```
  When credentials are dropped, their secret fields in memory are actively overwritten with zeroes to protect against cold-boot and heap inspection attacks.
- **Master Key Generation**: A hardware-grade random master key is created on first initialization and stored with restricted platform file permissions in `.master_hardware_key`.
- **Encrypted Package Structure (`vault.enc`)**:
  ```json
  {
    "nonce_hex": "4a7f9b...",
    "ciphertext_hex": "8e3c1a...",
    "security_level": "HARDWARE_ONLY",
    "version": 1
  }
  ```

---

### 4.3 Content Security Policy (CSP) Configuration
In `tauri.conf.json`, Crown enforces a hardened CSP policy:
```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https: http:;
connect-src 'self' ipc: http://ipc.localhost https:;
frame-src https: http: about:;
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
form-action 'self' https:;
```
- Restricts shell script execution strictly to local bundled assets (`'self'`).
- Prevents embedding of the Crown shell inside unauthorized framing environments (`frame-ancestors 'none'`).
- Disallows legacy plugin objects (`object-src 'none'`).

---

## 5. Front-End Core Engine (`src/js`)

### 5.1 Main Controller (`app.js`)
The `CrownApp` class serves as the central orchestrator:
- **Lifecycle Management**: Mounts on DOMContentLoaded, initializes the `TabEngine`, `SearchManager`, `Storage`, keyboard shortcut listeners, and defense hub.
- **Webview Frame Management**:
  - Maintains `this.frames = new Map()` mapping tab IDs to DOM `<iframe>` elements.
  - Toggles active frames by toggling CSS visibility classes (`active` vs hidden).
  - Listens to child iframe `postMessage` events (`crown:page-nav`, `crown:page-open-new-tab`, `crown:shield-block`, `crown:devtools-log`, `crown:devtools-dom`, `crown:devtools-net`).
- **Interactive Split View Engine & In-Pane Picker**:
  - Enables side-by-side multitasking with zero hardcoded website fallbacks.
  - **Untouched Left Pane**: Preserves the active tab as-is (webpages, `crown://newtab` dashboard, or `crown://*` internal views without forcing external search engines).
  - **In-Pane Secondary Picker (`#split-secondary-picker`)**: Replaces hardcoded companion URLs with an in-pane tab/URL selector displaying open tabs, a direct search/URL bar, and user shortcuts & bookmarks.
  - **Floating Split Controls (`#split-view-floating-bar`)**: Sleek pill providing 1-click **Pane Swap (`⇄`)**, **Switch Right Tab (`⊞`)**, and **Exit Split View (`✕`)**, alongside an active pane indicator.
  - **Pointer-Capture Divider**: Real-time ratio resizing (20% to 80%) with GPU-accelerated sub-pixel clamping.
- **DevTools Panel**:
  - Built-in slide-over drawer with 4 functional tabs: **Elements** (DOM tree explorer), **Console** (interactive REPL and log viewer), **Network** (waterfall and blocked tracker status), and **Storage** (cookies, local storage viewer).
- **Defense Hub Sidebar**:
  - Slide-out panel providing real-time telemetry on blocked trackers, active cosmetic rules, HTTPS upgrade status, and quick shields toggling for the active site.
- **Download Shelf**:
  - Docked bottom bar displaying active downloads, live transfer progress, completion status, and native folder opening.

---

### 5.2 Tab Management & FLIP Engine (`tabs.js`)
The `TabEngine` delivers silky-smooth, flicker-free tab strip rendering using the FLIP (First, Last, Invert, Play) animation methodology:

```mermaid
sequenceDiagram
    participant U as User Action
    participant TE as TabEngine
    participant DOM as Browser DOM
    
    U->>TE: Close Tab / Drag Tab / Create Tab
    TE->>TE: _capturePositions() (Record initial BoundingClientRects)
    TE->>DOM: Reconcile DOM Nodes in-place (No innerHTML destruction)
    TE->>TE: Calculate Delta X & Y (dx = before.left - after.left)
    TE->>DOM: Apply Inverted Transform (translate(dx, dy) transition: none)
    TE->>DOM: Read offsetWidth (Commit layout state)
    TE->>DOM: Apply Target Transform (translate(0,0) transition: 0.17s cubic-bezier)
    TE->>DOM: Reset transitions on completion
```

#### Ultra-Low RAM Hibernation Algorithm:
1. `enforceMemoryBudget()` evaluates all open web tabs.
2. Checks user-configured budget (`maximum` = 1 tab, `balanced` = 2 tabs, `moderate` = 5 tabs).
3. Whitelisted domains (configured in Settings) are exempted from hibernation.
4. Oldest inactive tabs (`lastActiveAt` timestamp) have their `<iframe>` detached from the DOM tree, releasing 100% of their JavaScript heap and rendering memory.
5. Hibernated tabs remain visible in the tab bar with a subtle sleep indicator. Clicking a hibernated tab instantly restores its frame and reloads its URL transparently.

#### Tab Groups:
- Users can create named color-coded groups.
- Tabs can be dragged or assigned into groups.
- Groups can be collapsed into a compact pill, hiding all member tabs to declutter the workspace.
- Preserved across sessions in `Storage.saveTabGroups()`.

#### Dual Layout Modes:
- **Top Bar**: Standard horizontal tab strip.
- **Left Vertical Sidebar**: Modern vertical tab tree with collapsible icon-only compact mode.

#### Cross-Window Tab Drag & Tear-Off:
- Uses `BroadcastChannel('crown-tab-drag')` to broadcast tab coordinates during pointer drag operations.
- Hovering over another Crown window's tab bar highlights a drop indicator; releasing merges the tab into the destination window. Releasing outside any window tears off the tab into a newly spawned Crown instance.

---

### 5.3 Persistence & Multi-Profile Storage (`storage.js`)
The `Storage` module manages browser state:

1. **Multi-Profile Isolation**:
   - Stores profiles under namespaced prefixes (`crown_${profileName}_${key}`).
   - Enables seamless switching between Personal, Work, and Guest profiles.
2. **Managed Data Stores**:
   - `settings`: Browser configuration, shield defaults, DNS-over-HTTPS settings, search provider.
   - `bookmarks`: Ordered array with title, URL, custom favicon, pointer drag-and-slide reordering (`reorderBookmarks`), inline editing (`updateBookmark`), and Netscape HTML + JSON import/export (`exportBookmarksToHtml`, `parseBookmarksFromHtml`).
   - `history`: Browsing history entries with visit timestamps and hit counts.
   - `tabGroups`: Group configurations, names, colors, and collapsed states.
   - `sessionTabs`: Saved tab configurations for automatic session restore upon startup.
   - `permissions`: Per-origin permissions (camera, microphone, geolocation, notifications).
   - `vaultCredentials`: Encrypted credential references.
   - `cookieWhitelist`: Whitelisted domains for persistent cookie retention.

---

### 5.4 Search Engine & Omnibox Parser (`search.js`)
The `SearchManager` parses all address bar input:

1. **URL vs Search Detection (`parseOmniboxInput`)**:
   - Detects explicit schemes: `http://`, `https://`, `crown://`, `about:`, `file://`.
   - Detects local hosts: `localhost`, `127.0.0.1`, `0.0.0.0`, `*.local`.
   - Detects valid Top-Level Domains (TLDs) via regex matching against common international TLDs (`.com`, `.org`, `.net`, `.io`, `.dev`, `.ai`, etc.).
   - Matches input with port numbers: `localhost:8080`, `192.168.1.1:3000`.
   - If classified as a query, routes through the user's active search engine.
2. **Search Providers**:
   - **Google**: `https://www.google.com/search?q={q}`
   - **DuckDuckGo**: `https://duckduckgo.com/?q={q}`
   - **Brave**: `https://search.brave.com/search?q={q}`
   - **Bing**: `https://www.bing.com/search?q={q}`
   - **Ecosia**: `https://www.ecosia.org/search?q={q}`
   - **Startpage**: `https://www.startpage.com/sp/search?query={q}`
   - **Kagi**: `https://kagi.com/search?q={q}`
   - **Swisscows**: `https://swisscows.com/web?query={q}`
   - **Qwant**: `https://www.qwant.com/?q={q}`
3. **DuckDuckGo-Style Bang Shortcuts**:
   - `!g <query>` -> Google
   - `!yt <query>` -> YouTube
   - `!gh <query>` -> GitHub
   - `!w <query>` -> Wikipedia
   - `!d <query>` -> DuckDuckGo
   - `!b <query>` -> Bing
   - `!r <query>` -> Reddit
4. **Query Parameter Tracker Stripper (`stripTrackingParams`)**:
   - Automatically sanitizes outbound URLs by stripping tracking tokens:
     - `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
     - `fbclid` (Facebook Click Identifier)
     - `gclid` (Google Click Identifier)
     - `mc_eid` (Mailchimp Email ID)
     - `msclkid` (Microsoft Bing Click ID)
     - `igshid` (Instagram Share ID)
     - `yclid` (Yandex Click ID)

---

### 5.5 Internal Views & Virtual Scheme Router (`internal-views.js`)
Crown routes all `crown://*` URLs through a virtual internal page renderer:

| Virtual URL | View Title | Description & Features |
| :--- | :--- | :--- |
| `crown://newtab` | New Tab | Quick search bar, customizable speed-dial bookmarks, live clock, privacy statistics widget, wallpaper backgrounds, and quick shield toggles. |
| `crown://settings` | Settings | Comprehensive settings hub: General, Shields & Privacy, Ephemeral Cookie Jar, Hardware Vault, Appearance, Profiles, Downloads, and System. |
| `crown://history` | History | Browsing history grouped chronologically (Today, Yesterday, Last 7 Days, Older) with search, single-item deletion, and full browsing data clearance modal. |
| `crown://bookmarks` | Bookmarks | Bookmarks manager supporting folder organization, search, editing, and Netscape HTML format import and export. |
| `crown://downloads` | Downloads | Complete downloads overview with file-type icons, size indicators, search, and native file/folder reveal buttons. |
| `crown://defense` | Defense Hub | Detailed privacy dashboard with live charts of blocked network requests, tracker inspect view, and custom cosmetic CSS rules editor. |
| `crown://extensions`| Extensions | Chrome Web Store extension installer, CRX file unpacker, and active extension manager. |

---

## 6. Dynamic Favicon & Identity Engine

Crown avoids hardcoded static icons for external websites. Instead, it utilizes an adaptive, resilient dynamic favicon engine:

1. **Origin Favicon Resolution**:
   - For web URLs, Crown first constructs the origin favicon path (`https://<domain>/favicon.ico`).
   - Uses Google's high-availability favicon proxy service (`https://www.google.com/s2/favicons?domain=<domain>&sz=32`) to resolve icons for domains lacking root `.ico` files.
2. **In-Page DOM Link Parsing**:
   - When web pages finish loading, the frame scanner extracts `<link rel="icon">`, `<link rel="shortcut icon">`, and `<link rel="apple-touch-icon">` tags.
   - If found, the tab's favicon dynamically upgrades to the site's self-declared high-resolution icon.
3. **Internal Scheme Branding**:
   - `crown://newtab`: Crown gold vector emblem.
   - `crown://history`: Clock / history glyph.
   - `crown://bookmarks`: Star / bookmark glyph.
   - `crown://downloads`: Arrow download glyph.
   - `crown://settings`: Gear / settings glyph.
   - `crown://defense`: Shield emblem.
   - Incognito tabs: Fedora / incognito glasses glyph.
4. **Resilient Globe Fallback**:
   - If an image fails to load (`onerror` event), Crown instantly replaces it with a crisp, theme-aware vector SVG globe:
     ```html
     <svg class="tab-favicon-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
       <circle cx="12" cy="12" r="10"/>
       <line x1="2" y1="12" x2="22" y2="12"/>
       <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
     </svg>
     ```

---

## 7. Crown Shield Ad & Tracker Protection

Protection in Crown operates via a dual-layered defense mechanism:

```mermaid
flowchart LR
    Outbound[Outbound Request] --> L1{Layer 1: Rust Native Gateway}
    L1 -->|Known Ad/Tracker Host| Block1[Drop Connection & Increment Shield Count]
    L1 -->|Safe Host| Ingest[Fetch HTML Body]
    
    Ingest --> L2{Layer 2: In-Page Script Injection}
    L2 --> SubRequests[Sub-resource fetch / XHR]
    SubRequests -->|Match Ad/Tracker Pattern| Block2[Reject Promise & Report to DevTools]
    SubRequests -->|Safe| Allow[Proceed]
    
    L2 --> Cosmetic[Cosmetic CSS Rules Injection]
    Cosmetic --> Hide[Set display: none on Ad DOM Elements]
```

### Protection Layers:
1. **Layer 1: Native Network Gatekeeper (`lib.rs`)**:
   - In-memory blocklists containing top ad networks (`doubleclick.net`, `googlesyndication.com`, `criteo.com`, `adnxs.com`, `taboola.com`, etc.) and tracking endpoints (`google-analytics.com`, `hotjar.com`, `segment.io`, `mixpanel.com`, `clarity.ms`, etc.).
   - Fast domain suffix matching (`host == domain || host.ends_with(".domain")`).
   - **YouTube Ad-Block Integrity Balance**: Blocks preroll/midroll/companion ad endpoints (`/pagead/`, `/api/stats/ads`, `/get_midroll_info`, `/youtubei/v1/player/ad_break`) while preserving YouTube's player-integrity and QoE endpoints (`jnn-pa.googleapis.com`, `/api/stats/qoe`, `/api/stats/playback`, `/api/stats/watchtime`, `/api/stats/atr`) so video switching stays fast without `"Experiencing interruptions?"` stalls.
2. **Layer 2: In-Page Sub-Resource Interception**:
   - Intercepts all runtime asynchronous network requests (`fetch` and `XMLHttpRequest`) originating from scripts on the page.
   - Blocks trackers loaded via dynamically constructed URLs.
3. **Layer 3: Cosmetic Ad Element Suppression**:
   - Evaluates CSS selectors from `src/public/assets/rules/adblock-rules.json`.
   - Collapses ad container placeholders, preventing empty whitespace and broken layout boxes.
4. **Layer 4: Telemetry & Fingerprinting Shields**:
   - Strips `Referer` headers when navigating across different origins.
   - Broadcasts `Sec-GPC: 1` signaling non-consent for user data sales.

---

## 8. Cross-Device & Mobile (Android) Responsive System

Crown is designed to provide optimal usability across desktop monitors, laptops, tablets, and Android smartphones:

### Mobile Architecture Specs:
1. **Viewport & Safe Area Configuration**:
   - Configured in `src/index.html`:
     ```html
     <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
     ```
   - Automatically adapts layout margins to device notches, camera punch-holes, and system navigation bars using `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.
2. **Touch-Friendly Tap Targets**:
   - All interactive controls, navigation buttons, tab close icons, and omnibox inputs enforce a minimum tap target of 44px × 44px on mobile screens, adhering to Material Design and Apple Human Interface Guidelines.
3. **Responsive Breakpoints**:
   - **Tablet / Small Laptop (`max-width: 768px`)**:
     - Sidebar tab layout automatically collapses into a compact icon rail.
     - Omnibox expands to prioritize URL readability.
     - Window control buttons (minimize/maximize/close) hide if running in fullscreen mobile mode.
   - **Smartphone (`max-width: 480px`)**:
     - Tab bar switches to a horizontal scrollable strip (`overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none;`).
     - Modals and settings overlays transition from floating desktop boxes into native-style bottom sheets anchored to the bottom of the display (`border-radius: 18px 18px 0 0;`).
     - Split view transitions to a stacked vertical layout or single-tab focus.
4. **Android WebView Fallback & Mobile Zoom Behavior**:
   - `_isNativeWebviewMode()` detects Android user agents (`/Android/i.test(navigator.userAgent)`) and returns `false` so mobile builds route cleanly through `fetch_page_with_shield` rather than invoking desktop-only `WindowBuilder::add_child` WebView2 commands.
   - Desktop's conditional `#omnibox-zoom-btn` and `#zoom-popover` are hidden on mobile (`max-width: 768px`), deferring to native Android pinch-to-zoom.
   - `@media (pointer: coarse)` enlarges `.nav-btn`, `.omnibox-action-btn`, `.tab-close-btn`, and `.browser-tab` hit areas for touch ergonomics.

---

## 9. Design System, Theming & UI Layout

Crown features a bespoke luxury dark-gold design aesthetic inspired by high-end precision instruments:

### CSS Design Tokens (`src/css/style.css`):
```css
:root {
  --bg-primary: #0b0c0e;       /* Deep obsidian black */
  --bg-secondary: #141519;     /* Elevated charcoal panel */
  --bg-tertiary: #1c1e24;      /* Interactive hover card */
  --border-color: #2a2d37;     /* Subtle structure border */
  --border-focus: #e6ca85;     /* Radiant gold focus ring */
  --text-primary: #f0f2f5;     /* Crisp high-contrast white */
  --text-secondary: #9aa0a6;   /* Muted metadata grey */
  --accent-gold: #e6ca85;      /* Signature Crown Gold */
  --accent-gold-hover: #f3dc9e;/* Bright gold hover */
  --accent-gold-dim: rgba(230, 202, 133, 0.15); /* Translucent glow */
  --danger-color: #ef4444;     /* Warning red */
  --success-color: #10b981;    /* Shield active green */
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --transition-fast: 0.15s ease;
  --transition-smooth: 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
```

### Typography & Elevations:
- Fluid monospace numbers for tab indices and memory meters.
- Multi-layer box shadows providing depth separation between the omnibox, tab bar, web viewports, and modal overlays.

---

## 10. Automated Unit Testing & Production Verification

Crown features a zero-dependency automated unit test harness that validates all core features, security modules, and settings.

### Test Runner Architecture (`test/runner.js`):
- Runs entirely in Node.js with native ES modules (`"type": "module"`).
- Organizes tests into logical feature suites.
- Captures test assertions (`assert`, `assertEqual`, `assertTrue`, `assertFalse`).
- Calculates execution duration and formats results into an aligned tabular pass/fail rate summary.
- **Strict Quality Gate**: Integrated directly into `npm run build`. If any test fails, the build immediately aborts with exit code 1.

### Test Suite Categories:
```
========================================================================
   CROWN BROWSER — PRODUCTION FEATURE & SETTINGS UNIT TEST SUITE
========================================================================

Feature / Setting Category                    Total   Passed   Failed    Pass Rate
--------------------------------------------------------------------------------
Feature: Download Manager                         3        3        0      100.0%
Feature: Dynamic Favicon & Fallback               7        7        0      100.0%
Feature: Bookmark Reordering, Editing...          3        3        0      100.0%
Feature: 100% Working Built-in Extens...          1        1        0      100.0%
Feature: Tab Audio Mute & Extended Ta...          2        2        0      100.0%
Security & Polish: Cloudflare-Grade H...          1        1        0      100.0%
Feature: Responsive Design & Mobile (...          8        8        0      100.0%
Feature: Search Engines & Omnibox Parser          4        4        0      100.0%
Feature: Selective Ephemeral Cookie P...          3        3        0      100.0%
Feature: Hardware-Backed Hybrid Local...          3        3        0      100.0%
Feature: Crown Shield Ad & Tracker Bl...          3        3        0      100.0%
Feature: URL Query Parameter Stripper             2        2        0      100.0%
Feature: Safe URL & SSRF Validation               2        2        0      100.0%
Setting: Settings Defaults & Sanitiza...          3        3        0      100.0%
Setting: Profile Isolation & State Sc...          1        1        0      100.0%
Setting: Bookmarks & History Management           2        2        0      100.0%
Setting: Site Permissions                         2        2        0      100.0%
Feature: Tab Engine & Lifecycle                   5        5        0      100.0%
Feature: Tab Groups                               3        3        0      100.0%
Feature: Ultra-Low RAM Hibernation                2        2        0      100.0%
================================================================================
OVERALL PRODUCTION SUITE TOTALS                  60       60        0      100.0%

✔ 100% PASS RATE ACHIEVED — ALL CROWN FEATURES & SETTINGS VERIFIED PRODUCTION READY.
```

---

## 11. Build, Packaging & Distribution Pipeline

### Available Scripts (`package.json`):
```bash
# Start front-end Vite development server (HMR enabled)
npm run dev

# Execute the automated unit test suite
npm test

# Run tests and compile production web bundle to dist/
npm run build

# Start full desktop application in Tauri development mode
npm run desktop

# Compile production desktop installers (MSI, AppImage, DMG)
npm run build:desktop

# Compile Android package (APK / AAB)
npm run build:android
```

### Tauri Android Packaging:
- `tauri.conf.json` specifies `minSdkVersion: 24` (Android 7.0 Nougat and above).
- Generates unsigned APKs for testing or signed AAB bundles for Google Play Store deployment.

---

## 12. Complete Keyboard Shortcuts & Gestures Reference

| Shortcut | Context | Action |
| :--- | :--- | :--- |
| `Ctrl + K` (`Cmd + K`) | Global | Open Instant Command Palette & Tab/Bookmark Search |
| `Ctrl + T` (`Cmd + T`) | Global | Open a new tab |
| `Ctrl + W` (`Cmd + W`) | Global | Close the active tab |
| `Ctrl + Shift + T` | Global | Reopen the most recently closed tab |
| `Ctrl + Tab` | Global | Cycle forward to the next tab |
| `Ctrl + Shift + Tab` | Global | Cycle backward to the previous tab |
| `Ctrl + 1` to `Ctrl + 8` | Global | Jump directly to tab at index 1 through 8 |
| `Ctrl + 9` | Global | Jump directly to the last tab |
| `Ctrl + L` (`Cmd + L`) / `Alt + D` | Global | Focus and select the address omnibox |
| `Ctrl + R` / `F5` | Global | Reload the active tab |
| `Ctrl + Shift + R` | Global | Hard reload bypassing cache |
| `Ctrl + H` | Global | Open browsing history (`crown://history`) |
| `Ctrl + B` | Global | Open bookmarks manager (`crown://bookmarks`) |
| `Ctrl + J` | Global | Open downloads shelf / manager (`crown://downloads`) |
| `Ctrl + D` | Global | Bookmark the current page |
| `Ctrl + Shift + N` | Global | Open a new Incognito window |
| `Ctrl + Shift + I` / `F12` | Global | Toggle Crown Developer Tools drawer |
| `Ctrl + \` | Global | Toggle Split View (dual-pane browsing) |
| `Ctrl + +` / `Ctrl + -` | Global | Zoom in / Zoom out webview page |
| `Ctrl + 0` | Global | Reset page zoom to 100% |
| `Escape` | Omnibox / DevTools / Modal | Close modal, close DevTools, or blur address bar |
| `Middle Click` (Tab) | Tab Strip | Close the clicked tab without focusing it |
| `Middle Click` (Web Page) | Webview Viewport | Activate physics-based mouse auto-scrolling |
| `Middle Click` (Link) | Webview Viewport | Open clicked link in a background tab |
| `Ctrl + Click` (Link) | Webview Viewport | Open clicked link in a background tab |
| `Shift + Click` (Link) | Webview Viewport | Open clicked link in a new foreground window |

---

## 13. Hardened Security & Anti-Exploit Architecture

Crown Browser incorporates multi-layered defense-in-depth security mitigations across both native Rust and web layers:

### 13.1 RFC 6265 Cookie Domain & Supercookie Prevention (`SEC-01`)
- **Domain Matching**: `is_valid_cookie_domain()` validates `Domain=` attributes received in `Set-Cookie` headers against the canonical origin host.
- **TLD Supercookie Block**: Any cookie specifying a domain without an internal period (`.`) (e.g. `Domain=com`, `Domain=org`) is rejected to prevent setting public suffix supercookies across distinct web properties.
- **Fallback Binding**: Malformed or cross-domain `Domain` values automatically fall back strictly to the single canonical origin host.

### 13.2 Post-Redirect & Anti-DNS-Rebinding Sockets (`SEC-02`)
- **Socket Verification**: When streaming web pages (`fetch_page_with_shield`), downloading files (`download_file_native`), or fetching CRX packages (`fetch_chrome_crx`), the actual connected socket address (`resp.remote_addr()`) is verified post-handshake against restricted private IP ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`) and blocked ports.
- **Post-Redirect Scheme & Host Enforcement**: Redirect chains are re-verified so an external download cannot be redirected into internal network assets or unsupported protocol schemes.

### 13.3 IPC Parameter Sanitation (`SEC-03`)
- `open_new_window` validates `initial_url` prior to spawning a new WebviewWindow: caps the string length at 2048 bytes, strips control characters, and enforces a strict whitelist of schemes (`crown://`, `http://`, `https://`).

### 13.4 Frame Bridge Origin Authentication (`SEC-04`)
- Inside injected Shield scripts, `window.addEventListener('message', ...)` enforces `e.source === window.parent` to ensure commands originate solely from the trusted parent application shell.
- In-shell DevTools message listeners strictly cap text and URL strings to prevent message inflation or log DoS attacks.

### 13.5 Incognito Isolation & Media Validation (`SEC-05`)
- Custom wallpapers cannot be saved to persistent `localStorage` when running in Incognito mode.
- Image uploads enforce strict raster MIME types (`image/png`, `image/jpeg`, `image/webp`, `image/gif`) and a 4 MB maximum size cap to prevent vector script execution via SVG or memory exhaustion.

---

## 14. In-Page URL Synchronization & Reader Mode Architecture

### 14.1 Full-Fidelity In-Page Navigation Sync
- **Navigation Interception**: Injected scripts in `src-tauri/src/lib.rs` continuously observe URL mutations:
  - Intercepts `history.pushState` and `history.replaceState` calls made by single-page application routers.
  - Listens to `popstate` and `hashchange` browser events.
  - Intercepts GET `<form>` submissions to route search queries (e.g. Wikipedia search) through Crown's navigation stack.
  - Fires `crown:page-url-change` on `DOMContentLoaded` and `load`.
- **Omnibox & History Sync**:
  - `CrownApp` receives `crown:page-url-change` and synchronizes `senderTab.url = data.url` with the complete URL path (preserving `/wiki/Max_Verstappen` rather than truncating to `wikipedia.org`).
  - Automatically pushes intermediate article navigations into `senderTab.history`, enabling true Back/Forward navigation.
  - Updates `omnibox.value` dynamically without disrupting active user input.
  - Automatically updates the HTTPS padlock indicator, bookmark star status, and offline QR code generator.

### 14.2 Strict Domain Truncation Isolation
- **Apex Domain Deduplication**: `Storage.extractBaseDomain(url)` is strictly isolated to New Tab Frequent Shortcuts aggregation (`Storage.getFrequentSites()`).
- **Complete Path Preservation**: Omnibox, per-tab history stacks, bookmarks bar, `crown://bookmarks`, `crown://history`, and QR generation preserve 100% full URLs (protocol, host, port, path, query, and hash).

### 14.3 Distraction-Free Reader Mode
- **Zero-Emoji UI**: All emojis (`📖`, `🎨`, `✕`) have been removed in favor of clean typography (`X min read`, `Theme`, `Exit`) and crisp SVGs, maintaining Crown's sleek dark theme aesthetic.
- **Atmospheric Theme Linkage**:
  - Automatically detects browser appearance settings (`settings.wallpaper` / `settings.readerTheme`).
  - Supports `theme-dark`, `theme-sepia`, and `theme-light` reading modes.
  - Cycles cleanly between themes and automatically persists user preferences to `Storage.saveSettings({ readerTheme })`.
- **Live In-Frame DOM Article Extraction**:
  - Reader view extracts headings (`h1`-`h4`), paragraphs (`p`), blockquotes, code blocks (`pre`), lists (`ul`/`ol`), and figures directly from the live DOM via `crown:extract-article` message bridge.
  - Eliminates stale homepage fallback rendering when reading deep subpages.



