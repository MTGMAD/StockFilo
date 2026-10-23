//! The app icon chosen in Settings. It becomes the window icon on every
//! platform. On Linux it also replaces the launcher and dock icon for this
//! user, by shadowing the packaged icon in the user's own icon directory.
use tauri::{image::Image, include_image, AppHandle, Manager};

use crate::commands::config::{update_config, AppConfig};

pub const DEFAULT: &str = "violet";
const CHOICES: [&str; 2] = [DEFAULT, "warm"];

fn window_icon(choice: &str) -> Image<'static> {
    match choice {
        "warm" => include_image!("icons/warm/128x128@2x.png"),
        _ => include_image!("icons/128x128@2x.png"),
    }
}

/// Applies `choice` to every open window and, on Linux, the launcher.
pub fn apply(app: &AppHandle, choice: &str) -> Result<(), String> {
    let icon = window_icon(choice);
    for window in app.webview_windows().values() {
        window.set_icon(icon.clone()).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    launcher::apply(choice)?;
    Ok(())
}

#[tauri::command]
pub fn set_app_icon(app: AppHandle, icon: String) -> Result<AppConfig, String> {
    if !CHOICES.contains(&icon.as_str()) {
        return Err(format!("Unknown app icon '{icon}'"));
    }
    let config = update_config(&app, |config| config.app_icon = (icon != DEFAULT).then(|| icon.clone()))?;
    apply(&app, &icon)?;
    Ok(config)
}

#[cfg(target_os = "linux")]
mod launcher {
    use std::fs;
    use std::path::{Path, PathBuf};

    /// The sizes the .deb installs under /usr/share/icons/hicolor.
    const WARM: [(&str, &[u8]); 3] = [
        ("32x32", include_bytes!("../../icons/warm/32x32.png")),
        ("128x128", include_bytes!("../../icons/warm/128x128.png")),
        ("256x256@2", include_bytes!("../../icons/warm/128x128@2x.png")),
    ];

    /// The user's icon directory is searched before /usr/share, so an icon of
    /// the same name there wins. Removing it brings the packaged icon back.
    pub fn apply(choice: &str) -> Result<(), String> {
        let Some(theme) = data_home().map(|data| data.join("icons/hicolor")) else { return Ok(()) };
        apply_in(&theme, &icon_name()?, choice)
    }

    fn apply_in(theme: &Path, name: &str, choice: &str) -> Result<(), String> {
        let failed = |e: std::io::Error| format!("Could not update the launcher icon: {e}");
        for (size, bytes) in WARM {
            let path = theme.join(size).join("apps").join(format!("{name}.png"));
            if choice == "warm" {
                fs::create_dir_all(path.parent().unwrap()).map_err(failed)?;
                fs::write(&path, bytes).map_err(failed)?;
            } else if let Err(e) = fs::remove_file(&path) {
                if e.kind() != std::io::ErrorKind::NotFound { return Err(failed(e)); }
            }
        }
        // Desktops rescan an icon theme when its directory's timestamp changes.
        if let Ok(dir) = fs::File::open(theme) { let _ = dir.set_modified(std::time::SystemTime::now()); }
        Ok(())
    }

    fn data_home() -> Option<PathBuf> {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|path| path.is_absolute())
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
    }

    /// The packaged .desktop file names its icon after the executable.
    fn icon_name() -> Result<String, String> {
        std::env::current_exe().ok().and_then(|exe| exe.file_stem().map(|stem| stem.to_string_lossy().into_owned()))
            .ok_or_else(|| "Could not find the app's executable name".into())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn choosing_the_default_removes_only_the_shadowing_icons() {
            let theme = std::env::temp_dir().join(format!("stockfolio-icons-{}", uuid::Uuid::new_v4()));
            let other = theme.join("32x32/apps/other.png");
            fs::create_dir_all(other.parent().unwrap()).unwrap();
            fs::write(&other, b"other app").unwrap();
            apply_in(&theme, "stockfolio", "warm").unwrap();
            for (size, bytes) in WARM {
                assert_eq!(fs::read(theme.join(size).join("apps/stockfolio.png")).unwrap(), bytes);
            }
            apply_in(&theme, "stockfolio", "violet").unwrap();
            for (size, _) in WARM { assert!(!theme.join(size).join("apps/stockfolio.png").exists()); }
            assert!(other.exists());
            apply_in(&theme, "stockfolio", "violet").unwrap();
            fs::remove_dir_all(theme).unwrap();
        }
    }
}
