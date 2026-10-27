# Crown Web Browser

Crown is an ultra-lightweight, privacy-first web browser engineered for Desktop (Windows, macOS, Linux) and Mobile (Android). Built on a native Rust core powered by Tauri v2 and modern web standards, Crown delivers native OS-level request interception, advanced tab organization, and integrated defense telemetry while eliminating the heavy 150+ MB overhead of standalone Chromium distributions.

---

## Key Features

### Crown Shield Guard & Defense Hub
* **OS-Level Request Interception**: Outbound requests are evaluated in the native Rust backend (`on_navigation` hook) before network dispatch, stopping unwanted traffic at the platform boundary.
* **Real-time Defense Telemetry**: Dynamic metrics tracking active ads blocked, trackers stopped, tracking query tokens neutralized, and estimated bandwidth preserved.
* **Tracking Parameter Defuser**: Automatically sanitizes privacy-invasive URL parameters (including `utm_*`, `fbclid`, `gclid`, and `mc_eid`) upon navigation.
* **Interactive Shield Popover**: Omnibox shield trigger provides immediate per-site shield toggling and a live inspector displaying blocked network endpoints.
* **Cosmetic DOM Filtering**: Injects rules to suppress intrusive overlay banners, paywall modals, and cookie consent barriers.

### Advanced Tab & Layout Engine
* **Dual Tab Orientations**:
  * **Top Horizontal Tabs**: Classic pill layout with comfortable spacing, smooth active indicators, and drag-and-drop tab lifecycle management.
  * **Left Vertical Sidebar Tabs**: Space-efficient vertical tree, toggleable between a full 230px expanded view and a 54px compact icon rail.
* **Color-Coded Tab Grouping**: Organize related tabs into labeled groups with customizable color accents and collapsible accordion pills.
* **Tab Context Menu**: Right-click menu for instant actions including group assignment, tab renaming, duplication, and bulk closure.

### Dedicated Internal Views (`crown://`)
* **`crown://newtab`**: Clean, customizable start page featuring defense statistics, customizable background wallpapers, quick launch shortcuts, and unified omnibox search.
* **`crown://history`**: Chronological browsing timeline with real-time text query filtering, date-grouped entries, single-item deletion, and full history clearing.
* **`crown://bookmarks`**: Responsive visual bookmark manager with category tagging, instant filtering, and one-click launch capabilities.

### Integrated Browser Utilities
* **Download Manager Drawer**: Slide-out tray monitoring concurrent file downloads with live transfer speeds, progress bars, cancellation controls, and file management.
* **Incognito Private Browsing**: Isolated stealth session that prevents navigation records, cookie persistence, and telemetry caching.
* **Local Profiles**: Multi-profile switcher (Personal, Work, Custom) supporting distinct configurations and browsing contexts without cloud dependency.
* **Professional Design System**: Bespoke dark aesthetic, custom monochrome SVG iconography, and refined typography with zero unprofessional decorative emojis.

### Production Icon Suite
* Built with the **Minimalist Infinity Crown** design identity (Champagne Gold `#e6ca85` and Titanium White `#f0f2f5` on an Obsidian Squircle `#121316`).
* Ships with complete multi-resolution asset suites:
  * Windows: `icon.ico` (256px, 128px, 64px, 48px, 32px, 16px embedded multi-res)
  * macOS: `icon.icns` (retina-ready asset bundle)
  * Android: Adaptive vector icons across all densities (`mdpi`, `hdpi`, `xhdpi`, `xxhdpi`, `xxxhdpi`)
  * Web & Favicon: High-definition 32px and 64px master icons

---

## Technical Specifications

| Dimension | Specification |
| :--- | :--- |
| **Desktop Platform** | Windows 10/11 (WebView2), macOS (WebKit), Linux (WebKitGTK) |
| **Mobile Platform** | Android 7.0+ (API Level 24+), Android System WebView |
| **Frontend Runtime** | Vanilla ES6+ Modules, CSS Custom Properties, Vite 5 |
| **Backend Core** | Rust 1.80+ (Tauri v2 Application Framework) |
| **Native Crate** | `crown_lib` (staticlib, cdylib, rlib) |
| **Network Engine** | Reqwest (Rustls TLS), Tauri Webview Window Request Hooks |
| **Filter Format** | Trie-indexed Hostnames, Substring Token Sets, Regex Maps |
| **Core Distribution Size** | Under 50 KB web bundle |

---

## Repository Structure

```text
Crown/
├── src/                        # Web application frontend core
│   ├── index.html              # Main browser document and shell
│   ├── css/
│   │   └── style.css           # Design system tokens, layouts, and components
│   ├── js/
│   │   ├── app.js              # Application lifecycle, layout switching, hotkeys
│   │   ├── tabs.js             # TabEngine: vertical/horizontal modes, tab grouping
│   │   ├── shield.js           # Crown Shield Guard, telemetry, and URL defuser
│   │   ├── internal-views.js   # History (crown://history) and bookmarks manager
│   │   ├── downloads.js        # Download drawer, transfer progress, speed calculations
│   │   ├── search.js           # Omnibox parsing, internal protocol routing
│   │   └── storage.js          # IndexedDB and LocalStorage persistence layer
│   └── public/
│       ├── favicon.png         # Browser favicon
│       └── assets/rules/       # Filter lists, adblock rules, query filter definitions
├── src-tauri/                  # Native Rust application shell
│   ├── Cargo.toml              # Rust crate manifest (`crown_lib`)
│   ├── tauri.conf.json         # Tauri v2 window parameters, security permissions
│   ├── build.rs                # Native build hook
│   ├── icons/                  # Production asset suite (.ico, .icns, Android mipmaps)
│   └── src/
│       ├── lib.rs              # Native command handlers and navigation interceptor
│       └── main.rs             # Application entry point
├── package.json                # Project dependencies and script definitions
├── vite.config.js              # Vite build and dev server configuration
└── .gitignore                  # Git tracking exclusion rules
```

---

## Getting Started

### Prerequisites
* **Node.js**: Version 20 LTS or later
* **npm**: Version 10 or later
* **Rust Toolchain**: Stable release (`rustc` and `cargo` 1.80+ / 1.99+)
* **Java Development Kit**: JDK 17 or JDK 21 (required for Android Gradle toolchains)
* **Android SDK & NDK** (Optional for mobile builds): Platform API 34+, NDK 26+

### Installation

```bash
# Clone the repository
git clone https://github.com/PI-Prasaad-Krishna/Crown.git
cd Crown

# Install Node dependencies
npm install
```

### Local Development

To run the browser frontend inside a hot-reloading browser environment:

```bash
npm run dev
```

The web interface will be available at `http://localhost:3000/`.

To launch the native desktop shell with Tauri live reloading:

```bash
npm run desktop
```

---

## Build and Packaging Pipelines

### 1. Web Core Compilation
Compiles and optimizes the web bundle into the `dist/` directory:

```bash
npm run build
```

### 2. Standalone Desktop Installer (Windows / macOS / Linux)
Generates native release binaries and system installers (e.g., NSIS `.exe` or `.msi` on Windows):

```bash
npm run build:desktop
```

Compiled desktop artifacts will be generated in `src-tauri/target/release/`.

### 3. Android Mobile Build
Crown supports direct compilation to standalone Android packages:

```bash
# Initialize Android project structure (first time only)
npm run tauri android init

# Run on an Android device or active emulator
npm run tauri android dev

# Compile release APK / AAB package
npm run build:android
```

The compiled Android bundle will be output to:
`src-tauri/gen/android/app/build/outputs/apk/release/`

---

## Distribution Strategy

Crown is distributed directly to users without platform gatekeepers or store fees:
* **Desktop Distribution**: Standalone Windows executable installers (`.exe` / NSIS) hosted directly via the official Crown web portal.
* **Mobile Distribution**: Direct Android APK sideloading and third-party open-source repository indexing.
* **Zero Cloud Lock-in**: User profiles and browsing records remain strictly local on the host device.

---

## Upcoming Roadmap

* [ ] Custom Crown product landing page and direct download portal.
* [ ] Cloudless peer-to-peer sync engine for cross-device bookmarks and history.
* [ ] Expanded filter engine supporting dynamic user custom lists.
* [ ] WebExtension API compatibility shim for lightweight add-ons.

---

## License

This project is licensed under the MIT License. See the [LICENSE](file:///d:/Crown/LICENSE) file for details.
