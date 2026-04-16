use std::path::Path;
use std::process::Command;
use std::{fs::File, io::Write};
use tauri::{AppHandle, Manager};
use chrono::{TimeZone, Utc};

struct BrowserGeometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// Reads the main window's position/size and calculates a browser window that fits
/// within it while leaving the app visible around the edges.
fn browser_geometry(app: &AppHandle) -> BrowserGeometry {
    let fallback = BrowserGeometry { x: 60, y: 60, width: 900, height: 700 };

    let Some(win) = app.get_webview_window("main") else {
        return fallback;
    };
    let (Ok(scale), Ok(pos), Ok(size)) = (
        win.scale_factor(),
        win.outer_position(),
        win.outer_size(),
    ) else {
        return fallback;
    };

    // Convert physical pixels → logical pixels (what --window-size/position expect).
    let log_w = (size.width as f64 / scale) as u32;
    let log_h = (size.height as f64 / scale) as u32;
    let log_x = (pos.x as f64 / scale) as i32;
    let log_y = (pos.y as f64 / scale) as i32;

    // 82% of app size so the app frame is visible on all sides; minimum 600×500.
    let offset = 40i32;
    BrowserGeometry {
        x: log_x + offset,
        y: log_y + offset,
        width: ((log_w as f64 * 0.82) as u32).max(600),
        height: ((log_h as f64 * 0.82) as u32).max(500),
    }
}

/// Finds a Chromium-based browser on the system and launches the URL in --app mode.
/// App mode strips the address bar and tab strip while using the real browser profile
/// (cookies, logins, extensions all intact).
#[tauri::command]
pub async fn open_browser_window(app: AppHandle, url: String, _title: String) -> Result<(), String> {
    let geo = browser_geometry(&app);
    launch_app_mode(&url, &geo)
}

#[tauri::command]
pub async fn open_earnings_call_in_calendar(ticker: String, event_at: i64) -> Result<(), String> {
    let event_at_seconds = if event_at > 10_000_000_000 { event_at / 1000 } else { event_at };

    let start = Utc
        .timestamp_opt(event_at_seconds, 0)
        .single()
        .ok_or_else(|| "Invalid earnings event timestamp".to_string())?;
    let end = start + chrono::Duration::hours(1);
    let now = Utc::now();
    let safe_ticker = ticker
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>();

    let uid = format!("{}-{}@stockfilo", safe_ticker, event_at_seconds);
    let ics = format!(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//StockFilo//Earnings Call//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nBEGIN:VEVENT\r\nUID:{uid}\r\nDTSTAMP:{}\r\nDTSTART:{}\r\nDTEND:{}\r\nSUMMARY:{} Earnings Call\r\nDESCRIPTION:Earnings call reminder for {}.\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        now.format("%Y%m%dT%H%M%SZ"),
        start.format("%Y%m%dT%H%M%SZ"),
        end.format("%Y%m%dT%H%M%SZ"),
        ticker,
        ticker
    );

    let mut path = std::env::temp_dir();
    path.push(format!("stockfilo-earnings-{}-{}.ics", safe_ticker, event_at_seconds));

    let mut file = File::create(&path)
        .map_err(|e| format!("Failed to create calendar invite: {e}"))?;
    file.write_all(ics.as_bytes())
        .map_err(|e| format!("Failed to write calendar invite: {e}"))?;

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "", path.to_string_lossy().as_ref()])
            .spawn()
            .map_err(|e| format!("Failed to open calendar invite: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open calendar invite: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open calendar invite: {e}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}

fn launch_app_mode(url: &str, geo: &BrowserGeometry) -> Result<(), String> {
    let size_arg = format!("--window-size={},{}", geo.width, geo.height);
    let pos_arg = format!("--window-position={},{}", geo.x, geo.y);
    let app_arg = format!("--app={url}");

    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let pf86 = std::env::var("ProgramFiles(x86)")
            .unwrap_or_else(|_| r"C:\Program Files (x86)".into());

        let candidates = [
            format!(r"{pf86}\Microsoft\Edge\Application\msedge.exe"),
            format!(r"{pf}\Microsoft\Edge\Application\msedge.exe"),
            format!(r"{local}\Microsoft\Edge\Application\msedge.exe"),
            format!(r"{pf}\Google\Chrome\Application\chrome.exe"),
            format!(r"{pf86}\Google\Chrome\Application\chrome.exe"),
            format!(r"{local}\Google\Chrome\Application\chrome.exe"),
            format!(r"{pf}\BraveSoftware\Brave-Browser\Application\brave.exe"),
            format!(r"{local}\BraveSoftware\Brave-Browser\Application\brave.exe"),
            format!(r"{local}\Vivaldi\Application\vivaldi.exe"),
            format!(r"{pf}\Vivaldi\Application\vivaldi.exe"),
        ];

        for exe in &candidates {
            if Path::new(exe).exists() {
                Command::new(exe)
                    .args([&app_arg, &size_arg, &pos_arg, "--new-window"])
                    .spawn()
                    .map_err(|e| format!("Failed to launch browser: {e}"))?;
                return Ok(());
            }
        }

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
                    .args([&app_arg, &size_arg, &pos_arg, "--new-window"])
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

