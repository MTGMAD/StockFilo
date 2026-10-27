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
pub async fn open_dividend_in_calendar(ticker: String, dividend_date: i64) -> Result<(), String> {
    let ts = if dividend_date > 10_000_000_000 { dividend_date / 1000 } else { dividend_date };

    let start = Utc
        .timestamp_opt(ts, 0)
        .single()
        .ok_or_else(|| "Invalid dividend date timestamp".to_string())?;
    // All-day event: use DATE value type
    let end = start + chrono::Duration::days(1);
    let now = Utc::now();
    let safe_ticker = ticker
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>();

    let uid = format!("{}-dividend-{}@stockfolio", safe_ticker, ts);
    let ics = format!(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Stockfolio//Dividend//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nBEGIN:VEVENT\r\nUID:{uid}\r\nDTSTAMP:{}\r\nDTSTART;VALUE=DATE:{}\r\nDTEND;VALUE=DATE:{}\r\nSUMMARY:{} Dividend Payout\r\nDESCRIPTION:Dividend payout reminder for {}.\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        now.format("%Y%m%dT%H%M%SZ"),
        start.format("%Y%m%d"),
        end.format("%Y%m%d"),
        ticker,
        ticker
    );

    let mut path = std::env::temp_dir();
    path.push(format!("stockfolio-dividend-{}-{}.ics", safe_ticker, ts));

    let mut file = File::create(&path)
        .map_err(|e| format!("Failed to create calendar invite: {e}"))?;
    file.write_all(ics.as_bytes())
        .map_err(|e| format!("Failed to write calendar invite: {e}"))?;

    open_calendar_invite(&path)
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

    let uid = format!("{}-{}@stockfolio", safe_ticker, event_at_seconds);
    let ics = format!(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Stockfolio//Earnings Call//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nBEGIN:VEVENT\r\nUID:{uid}\r\nDTSTAMP:{}\r\nDTSTART:{}\r\nDTEND:{}\r\nSUMMARY:{} Earnings Call\r\nDESCRIPTION:Earnings call reminder for {}.\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        now.format("%Y%m%dT%H%M%SZ"),
        start.format("%Y%m%dT%H%M%SZ"),
        end.format("%Y%m%dT%H%M%SZ"),
        ticker,
        ticker
    );

    let mut path = std::env::temp_dir();
    path.push(format!("stockfolio-earnings-{}-{}.ics", safe_ticker, event_at_seconds));

    let mut file = File::create(&path)
        .map_err(|e| format!("Failed to create calendar invite: {e}"))?;
    file.write_all(ics.as_bytes())
        .map_err(|e| format!("Failed to write calendar invite: {e}"))?;

    open_calendar_invite(&path)
}

/// A generic file opener can resolve text/calendar to a text editor through its
/// text/plain fallback. Launch a calendar handler explicitly on Linux instead.
fn open_calendar_invite(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use gio::prelude::*;
        // Honour the OS associations first, then its recommendations. Some
        // desktop setups have an installed calendar but no MIME association;
        // discover those through GIO as a final fallback, without changing it.
        let candidates = ["text/calendar", "application/ics", "text/x-vcalendar"]
            .iter()
            .filter_map(|mime| gio::AppInfo::default_for_type(mime, false))
            .chain(gio::AppInfo::default_for_uri_scheme("webcal"))
            .chain(gio::AppInfo::recommended_for_type("text/calendar"))
            .chain(gio::AppInfo::all().into_iter().filter(|app| app.should_show()));
        let calendar = select_calendar_app(candidates)
            .ok_or_else(|| "No calendar app is configured to import events. Install a calendar app and set it as the default for calendar (.ics) files, then try again.".to_string())?;

        return calendar
            .launch(&[gio::File::for_path(path)], None::<&gio::AppLaunchContext>)
            .map_err(|e| format!("Could not open your calendar app: {e}"));
    }

    #[cfg(target_os = "windows")]
    let status = Command::new("cmd")
        .args(["/c", "start", "", path.to_string_lossy().as_ref()])
        .status();

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(path).status();

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let status = status.map_err(|e| format!("Could not open your calendar app: {e}"))?;
        return if status.success() {
            Ok(())
        } else {
            Err("Could not open your calendar app. Set a default app for calendar (.ics) files and try again.".into())
        };
    }

    #[allow(unreachable_code)]
    Err("Opening calendar events is not supported on this platform.".into())
}

#[cfg(target_os = "linux")]
fn select_calendar_app(candidates: impl IntoIterator<Item = gio::AppInfo>) -> Option<gio::AppInfo> {
    candidates.into_iter().find(is_calendar_app)
}

#[cfg(target_os = "linux")]
fn is_calendar_app(app: &gio::AppInfo) -> bool {
    use gio::prelude::*;
    // Require an explicit calendar format. Text editors that inherit support
    // through text/plain are not calendar importers, even if listed as default.
    app.supported_types().iter().any(|mime| {
        matches!(mime.as_str(), "text/calendar" | "application/ics" | "text/x-vcalendar")
    })
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


#[cfg(all(test, target_os = "linux"))]
mod calendar_tests {
    use super::*;
    use gio::prelude::*;

    fn app_with_types(types: &str) -> gio::AppInfo {
        let key = gio::glib::KeyFile::new();
        key.load_from_data(
            &format!("[Desktop Entry]\nType=Application\nName=Calendar launch test\nExec=/bin/true %F\nMimeType={types}\n"),
            gio::glib::KeyFileFlags::NONE,
        ).unwrap();
        gio::DesktopAppInfo::from_keyfile(&key).unwrap().upcast()
    }

    #[test]
    fn prefers_os_default_over_other_installed_calendars() {
        let preferred = app_with_types("text/calendar;");
        let alternative = app_with_types("text/calendar;");
        let selected = select_calendar_app([preferred.clone(), alternative]).unwrap();
        assert_eq!(selected, preferred);
    }

    #[test]
    fn finds_installed_calendar_when_default_is_a_text_editor() {
        let editor = app_with_types("text/plain;");
        let calendar = app_with_types("text/calendar;");
        let selected = select_calendar_app([editor, calendar.clone()]).unwrap();
        assert_eq!(selected, calendar);
    }

    #[test]
    fn no_calendar_does_not_launch_a_text_editor() {
        assert!(select_calendar_app([app_with_types("text/plain;")]).is_none());
        assert!(select_calendar_app([]).is_none());
    }

    #[test]
    fn rejects_text_editor_fallback() {
        assert!(!is_calendar_app(&app_with_types("text/plain;application/x-zerosize;")));
    }

    #[test]
    fn accepts_calendar_importers() {
        for mime in ["text/calendar", "application/ics", "text/x-vcalendar"] {
            assert!(is_calendar_app(&app_with_types(&format!("{mime};"))));
        }
    }

    #[test]
    fn rejects_browser_that_only_handles_webcal_links() {
        assert!(!is_calendar_app(&app_with_types("text/html;x-scheme-handler/webcal;")));
    }
}
