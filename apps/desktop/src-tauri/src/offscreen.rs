//! 自動操作で起動したときのウィンドウの出し方。ユーザーの操作を奪わないよう、作った時点から画面外・非アクティブにする。
//!
//! Tauri（tao）は画面外の位置を指定すると既定の位置（画面の中）で作り、見える状態で作ると一瞬そこに出る。
//! そこで見えない状態で作り、Win32 で画面外へ動かしてから、アクティブにせずに表示する（SW_SHOWNOACTIVATE）。
//! tao の `show()` はアクティブにしてしまうので使わない。

use tauri::WebviewWindow;

/// 画面外の位置（物理ピクセル）。
pub const PARK: i32 = -12000;

#[cfg(windows)]
mod win {
    use std::ffi::c_void;

    #[link(name = "user32")]
    extern "system" {
        pub fn SetWindowPos(hwnd: *mut c_void, after: *mut c_void, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        pub fn ShowWindow(hwnd: *mut c_void, cmd: i32) -> i32;
    }

    pub const SWP_NOSIZE: u32 = 0x0001;
    pub const SWP_NOZORDER: u32 = 0x0004;
    pub const SWP_NOACTIVATE: u32 = 0x0010;
    pub const SW_SHOWNOACTIVATE: i32 = 4;
}

/// 見えない状態で作ったウィンドウを画面外へ動かし、アクティブにせずに表示する。
pub fn park_and_show(window: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        let hwnd = hwnd.0;
        unsafe {
            win::SetWindowPos(hwnd, std::ptr::null_mut(), PARK, PARK, 0, 0, win::SWP_NOSIZE | win::SWP_NOZORDER | win::SWP_NOACTIVATE);
            win::ShowWindow(hwnd, win::SW_SHOWNOACTIVATE);
        }
        return;
    }
    let _ = window.set_position(tauri::PhysicalPosition::new(PARK, PARK));
    let _ = window.show();
}
