# StockFilo — Developer Setup Guide

This guide covers everything you need to get a local development environment running from scratch.

---

## Prerequisites

Install all of the following before cloning the project.

### 1. Node.js (v20 or later)
Download from [nodejs.org](https://nodejs.org) or use a version manager:
```bash
# Windows (winget)
winget install OpenJS.NodeJS.LTS

# macOS (Homebrew)
brew install node
```
Verify: `node --version` and `npm --version`

---

### 2. Rust (stable toolchain)
Install via [rustup.rs](https://rustup.rs):
```bash
# Windows / macOS / Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```
On **Windows**, use the installer from [rustup.rs](https://rustup.rs) instead.

Verify: `rustc --version` and `cargo --version`

---

### 3. Tauri System Dependencies

#### Windows
Install the **Microsoft C++ Build Tools** (required by Rust):
- Download from [visualstudio.microsoft.com/visual-cpp-build-tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- During install, select **"C++ build tools"** workload
- Also install **WebView2** (ships with Windows 11; Windows 10 users: install from [developer.microsoft.com/microsoft-edge/webview2](https://developer.microsoft.com/microsoft-edge/webview2/))

#### macOS
```bash
xcode-select --install
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

Full Tauri prerequisites: [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

---

### 4. Git
```bash
# Windows
winget install Git.Git

# macOS
brew install git
```

---

## Project Setup

```bash
# Clone the repository
git clone https://github.com/MTGMAD/StockFilo.git
cd StockFilo

# Install JavaScript / TypeScript dependencies
npm install
```

That's it — there is no `requirements.txt` because this is a Rust + Node project. All JS dependencies are managed by `npm` (see `package.json`) and all Rust dependencies are managed by `cargo` (see `src-tauri/Cargo.toml`). Cargo dependencies download automatically on first build.

---

## Running in Development

```bash
npm run tauri dev
```

This command:
1. Starts the **Vite** dev server (React frontend on `localhost:1420`)
2. Compiles the **Rust** backend with `cargo`
3. Opens the native desktop window with hot-reload enabled

> **First run takes longer** — Cargo needs to compile all Rust dependencies. Subsequent runs are much faster.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite frontend only (no native window) |
| `npm run build` | Type-check and build the frontend |
| `npm run tauri dev` | Full dev mode (Vite + Rust + native window) |
| `npm run tauri build` | Production build with native installers |

---

## Regenerating App Icons

If you update `app-icon.svg`, regenerate all platform icon sizes with:

```bash
npx tauri icon app-icon.svg --output src-tauri/icons
```

This produces PNG, ICO, ICNS, APPX, iOS, and Android icon assets.

---

## Project Structure

```
StockFilo/
├── src/                        # React / TypeScript frontend
│   ├── components/
│   │   ├── analysis/           # Per-ticker deep-dive view + mountain chart
│   │   ├── dashboard/          # Dashboard (novice + advanced modes)
│   │   ├── layout/             # Header + Sidebar
│   │   ├── portfolio/          # Purchases table + buy dialog
│   │   ├── settings/           # Theme, mode, CSV import/export
│   │   └── watchlist/          # Watchlist with live ticker search
│   ├── hooks/                  # useTheme, useInvestorMode, usePortfolio, etc.
│   ├── lib/                    # db.ts (Tauri commands), utils.ts
│   └── types/                  # Shared TypeScript interfaces
│
├── src-tauri/                  # Rust / Tauri backend
│   ├── src/
│   │   ├── commands/           # Tauri command handlers (stocks, portfolio)
│   │   ├── db/                 # SQLite migrations + models
│   │   ├── yahoo.rs            # Yahoo Finance price/chart/news fetching
│   │   └── main.rs             # Entry point
│   ├── icons/                  # Generated icon assets (do not edit manually)
│   ├── Cargo.toml              # Rust dependencies
│   └── tauri.conf.json         # Tauri app configuration
│
├── app-icon.svg                # Source SVG for icon generation
├── package.json                # JS dependencies + scripts
└── vite.config.ts              # Vite build configuration
```

---

## Troubleshooting

**`cargo` errors on first build**
- Make sure the Rust toolchain is installed: `rustup update stable`
- On Windows, verify the C++ Build Tools are installed

**WebView2 missing (Windows)**
- Install from [developer.microsoft.com/microsoft-edge/webview2](https://developer.microsoft.com/microsoft-edge/webview2/)

**`npm install` fails**
- Ensure Node.js v20+: `node --version`
- Delete `node_modules` and `package-lock.json`, then re-run `npm install`

**Port 1420 already in use**
- Change the port in `vite.config.ts` and `src-tauri/tauri.conf.json` (`devUrl`)
