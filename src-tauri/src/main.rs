// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // These must be set before WebKit initialises on Linux.
    // Without them the app exits immediately when launched from a desktop
    // shortcut (no terminal environment), because GPU compositing fails.
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("GDK_BACKEND", "x11");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        std::env::set_var("WEBKIT_DISABLE_GPU_PROCTYPES", "1");
        std::env::set_var("LIBGL_ALWAYS_INDIRECT", "1");
    }

    stockfolio_lib::run();
}
