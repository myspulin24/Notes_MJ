// Hide the console window on Windows in release builds. In a debug build the
// console is where `T3_DEBUG=1` logging goes, so keep it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    notes_mj_lib::run()
}
