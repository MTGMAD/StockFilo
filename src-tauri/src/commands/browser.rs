use std::path::Path;
use std::process::Command;

/// Finds a Chromium-based browser on Windows and launches the URL in --app mode.
/// App mode strips the address bar and tab strip, making it feel like an in-app
/// popup while still using the real browser engine with the user's login state/cookies.
#[tauri::command]
pub async fn open_browser_window(url: String, _title: String) -> Result<(), String> {
    launch_app_mode(&url)
}

fn launch_app_mode(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let pf86 =
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());

        // Chromium-based browsers that support --app mode, checked in preference order.
        let candidates = [
            // Edge (pre-installed on Windows 10/11)
            format!(r"{pf86}\Microsoft\Edge\Application\msedge.exe"),
            format!(r"{pf}\Microsoft\Edge\Application\msedge.exe"),
            format!(r"{local}\Microsoft\Edge\Application\msedge.exe"),
            // Chrome
            format!(r"{pf}\Google\Chrome\Application\chrome.exe"),
            format!(r"{pf86}\Google\Chrome\Application\chrome.exe"),
            format!(r"{local}\Google\Chrome\Application\chrome.exe"),
            // Brave
            format!(r"{pf}\BraveSoftware\Brave-Browser\Application\brave.exe"),
            format!(r"{local}\BraveSoftware\Brave-Browser\Application\brave.exe"),
            // Vivaldi
            format!(r"{local}\Vivaldi\Application\vivaldi.exe"),
            format!(r"{pf}\Vivaldi\Application\vivaldi.exe"),
        ];

        for exe in &candidates {
            if Path::new(exe).exists() {
                Command::new(exe)
                    .args([
                        format!("--app={url}").as_str(),
                        "--window-size=1024,768",
                        "--new-window",
                    ])
                    .spawn()
                    .map_err(|e| format!("Failed to launch browser: {e}"))?;
                return Ok(());
            }
        }

        // Fallback: no Chromium browser found — open in default browser normally.
        Command::new("cmd")
            .args(["/c", "start", "", url])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {e}"))?;

        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let candidates = [
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ];
        for exe in candidates {
            if Path::new(exe).exists() {
                Command::new(exe)
                    .args([
                        format!("--app={url}").as_str(),
                        "--window-size=1024,768",
                        "--new-window",
                    ])
                    .spawn()
                    .map_err(|e| format!("Failed to launch browser: {e}"))?;
                return Ok(());
            }
        }
        Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {e}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}
