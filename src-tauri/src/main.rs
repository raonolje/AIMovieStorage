// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == "--mcp") {
        if let Err(error) = aimoviestorage_lib::run_mcp() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    aimoviestorage_lib::run();
}
