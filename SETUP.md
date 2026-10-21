# Stockfolio — Developer Setup Guide

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

To build a Debian package that can be installed and run alongside existing
builds, run `./stockfolio-linux-deb-isolated`. Each invocation creates a unique
package, executable, desktop launcher, app identifier, data/config directories,
and keychain namespace. Its browser backend requests an unused loopback port.
The new app starts with separate data; existing portfolios are not copied.

The script runs in a separate process session at reduced CPU priority, using a
snapshot of the current source and private dependency and build directories.
Packages, checksums, build metadata, and logs are saved under
`.deb-builds.local/<build-id>/`. Existing build outputs are preserved. Set
`STOCKFOLIO_BUILD_JOBS` to override the default of four Rust compiler jobs.
The build needs the same host prerequisites as a normal Tauri build and can
also be launched from a Flatpak editor.

| Command | Description |
|---|---|
| `npm run dev` | Start Vite frontend only (no native window) |
| `npm run web` | Start the full local backend and browser app (desktop window hidden) |
| `npm run build` | Type-check and build the frontend |
| `npm run tauri dev` | Full dev mode (Vite + Rust + native window) |
| `npm run tauri build` | Production build with native installers |

### Using the browser app

Run `npm run web`, then open <http://127.0.0.1:1422/>. During development,
<http://localhost:1420/> also works with hot reload. The backend must stay
running; `npm run dev` by itself only serves the frontend.

The browser and desktop app use the same local SQLite database, storage
settings, and securely stored credentials. The browser backend listens only
on this computer. File imports use the browser's file picker, and exports
download files. Folder targets and database locations refer to this computer.
To use both interfaces together, start the desktop app and open either browser
URL; do not start a second backend against the same data directory.

### Safe sync and recovery

Adding a target or pressing **Review sync** opens a source-selection review.
It shows record counts for this device and the remote database. Choose
**Load remote database**, **Upload this device**, or **Cancel**. Saving a
configuration, canceling a review, and scheduled checks never replace either
copy. Existing targets require a fresh review after this safety upgrade.

Every replacement requires a one-use approval tied to the reviewed local and
remote versions. Approvals expire after ten minutes. If either copy changes,
refresh the review. Both-copy conflicts are shown explicitly; whole databases
are not merged automatically. Uploading over an existing remote requires
`REPLACE REMOTE`; an empty application requires `UPLOAD EMPTY DATABASE` plus
an explicit checkbox, even after earlier successful transfers.

Nextcloud/WebDAV uploads are staged and verified before a conditional MOVE
replaces the destination. Existing remotes require a strong ETag. A server
without that protection is blocked from overwriting an existing database.
New remote files use create-only conditions. Network errors during the final
move can leave the outcome uncertain; preserve backups and check the target
before retrying.

Verified local and remote recovery copies are kept in the application data
folder's `backups` directory. An upload also saves the previous remote in
`.stockfolio-backups` beside the sync file. These are separate versioned files
and are not automatically pruned. Under **Storage & Sync → Recovery Backups**,
refresh the list and choose **Review restore** to compare and restore a saved
copy. Stored SHA-256 verification records are checked again before a restore;
missing or mismatched verification records block automatic restoration.
Restoring requires approval, saves the current database first, and resets
all targets to require another source review. Local restores never upload to
Nextcloud. Keep independent backups as well; files on one disk or cloud account
cannot protect against loss of that entire storage location.

Only one backend may open a live database at a time. Changing the database
location copies a consistent snapshot, switches the live connection, and keeps
the original copy. It refuses to overwrite a database already at the destination.

For Nextcloud, copy the WebDAV address from Files settings and use a dedicated
app password from Personal settings → Security → Devices & sessions.

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
