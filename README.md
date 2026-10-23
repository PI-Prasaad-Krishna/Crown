# Crown Web Browser

Crown is a lightweight, privacy-focused, cross-platform web browser engineered for Desktop (Windows, macOS, Linux) and Mobile (Android / Google Play Store).

By combining a native Rust backend (powered by Tauri v2) with host platform rendering engines (Microsoft WebView2 on Windows, Android System WebView on mobile), Crown achieves a distribution bundle of under 50 KB for its web core while eliminating the 150+ MB overhead associated with bundling dedicated Chromium binaries.

---

## Architectural Highlights

### Integrated Shield Engine
* **Network Request Evaluation**: Intercepts and matches outbound network requests against structured rule sets derived from EasyList and EasyPrivacy.
* **Query Parameter Sanitization**: Automatically strips cross-site tracking tokens and analytics parameters (such as `fbclid`, `gclid`, `mc_eid`, and `utm_*` prefixes) before navigation commits.
* **Cosmetic Filter Injection**: Injects targeted CSS selectors into web contents to suppress intrusive banner units, popups, and consent dialogs.
* **Real-time Telemetry Metrics**: Computes session and historical telemetry for blocked requests, estimated bandwidth preserved, and page latency reductions.

### Interface Architecture
* **Native Tab Geometry**: Standard Chromium tab architecture with window controls, pinned active state, and drag-and-drop tab lifecycle management.
* **Omnibox Navigation**: Integrated address bar supporting dynamic search provider resolution, TLS security state inspection, and direct shield management.
* **New Tab Experience**: Clean, unadorned dashboard featuring vector shortcut dispatchers, real-time blocking statistics, and user-defined background customizers.

---

## Technical Specifications

| Dimension | Specification |
| :--- | :--- |
| **Desktop Target** | Windows 10/11 (WebView2), macOS (WebKit), Linux (WebKitGTK) |
| **Mobile Target** | Android 7.0+ (API Level 24+), Android System WebView |
| **Core Distribution Footprint** | ~48 KB uncompressed (~13 KB gzipped) |
| **Estimated APK Size** | ~10–15 MB (Google Play Store distribution) |
| **Backend Layer** | Rust 1.80+ (Tauri v2 Application Framework) |
| **Frontend Runtime** | Vanilla ES6+ Modules, CSS Variables Design System, Vite 5 |
| **Adblock Rule Formats** | Tokenized Host Trie, Substring Sets, Regex Pattern Maps |

---

## Repository Structure

```text
Crown/
├── .agents/                    # Agent customizations, MCP configuration, and skills
│   ├── mcp_config.json         # MCP server definitions
│   └── skills/                 # Bundled analysis skills
├── src/                        # Web application core
│   ├── index.html              # Main browser application document
│   ├── css/
│   │   └── style.css           # Desktop and mobile styling, design tokens
│   ├── js/
│   │   ├── app.js              # Application controller, tab management, UI bindings
│   │   ├── shield.js           # Request interception, privacy rules, query defusers
│   │   ├── search.js           # Omnibox parsing and search provider resolution
│   │   └── storage.js          # IndexedDB and LocalStorage persistence layer
│   └── public/
│       └── assets/rules/       # Filter lists and tracking parameter manifests
├── src-tauri/                  # Native Rust application shell
│   ├── Cargo.toml              # Rust workspace dependencies and build metadata
│   ├── tauri.conf.json         # Window definitions, permissions, and Android manifest
│   ├── build.rs                # Tauri build hook
│   └── src/
│       └── main.rs             # Native command handlers and platform bridge
├── dist/                       # Production frontend compilation target
├── package.json                # Project scripts and dependencies
├── vite.config.js              # Vite bundler configuration
└── .gitignore                  # Git exclusion rules
```

---

## Development Setup

### Prerequisites
* **Node.js**: Version 20 LTS or later
* **npm**: Version 10 or later
* **Rust Toolchain**: Stable release (`rustc` and `cargo` 1.80+)
* **Android Development (Optional for Mobile Builds)**:
  * Android Studio with Android SDK Platform 34+
  * Android NDK (version 26+)
  * Java Development Kit (JDK 17)

### Local Development Server

To run the web application interface with hot-module replacement:

```bash
# Install dependencies
npm install

# Start Vite development server
npm run dev
```

The application will be served at `http://127.0.0.1:3000/`.

---

## Build and Distribution Pipelines

### 1. Web Core Compilation
Compiles and minifies the browser frontend into the `dist/` distribution directory:

```bash
npm run build
```

### 2. Standalone Desktop Application
Packages the application into a native desktop executable for the host operating system:

```bash
npm run build:desktop
```

Compiled binaries are located in `src-tauri/target/release/`.

### 3. Android Application Package (Google Play Store)
Crown supports direct packaging into an Android App Bundle (`.aab`) suitable for submission to the Google Play Developer Console.

#### Initialize Android Workspace
```bash
npm run tauri android init
```

#### Run on Android Device / Emulator
```bash
npm run tauri android dev
```

#### Production Android Bundle Generation
```bash
npm run build:android
```

The production artifact will be emitted to:
`src-tauri/gen/android/app/build/outputs/bundle/release/app-release.aab`

---

## Privacy Engine Configuration

The blocking subsystem relies on local rule manifests located in `src/public/assets/rules/`:
* `adblock-rules.json`: High-frequency ad distribution networks and cosmetic layout suppressors.
* `privacy-rules.json`: Telemetry, tracking, and user behavior analytics endpoints.
* `query-filter.json`: Tracking parameters stripped from navigation requests before transmission.

Site-specific exceptions can be applied at runtime via the Shield popover in the browser toolbar.

---

## License

This software is released under the MIT License. See `LICENSE` for details.
