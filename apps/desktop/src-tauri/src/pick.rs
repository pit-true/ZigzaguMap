//! パレットエディタの「色の選択」（スポイト）。マウスカーソルの下の画面の色と、左ボタンが押されているかを返す。
//! 自動操作用に、ウィンドウの画像（PrintWindow）の指定位置の色も返せる（画面外のウィンドウでも取れる）。

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::capture;

/// 拾った色（8 ビットの RGB）。`pressed` は左ボタンが押されているか。
#[derive(Serialize)]
pub struct PickedColor {
    r: u8,
    g: u8,
    b: u8,
    pressed: bool,
}

#[cfg(windows)]
mod win {
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Default)]
    pub struct Point {
        pub x: i32,
        pub y: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        pub fn GetCursorPos(point: *mut Point) -> i32;
        pub fn GetDC(hwnd: *mut c_void) -> *mut c_void;
        pub fn ReleaseDC(hwnd: *mut c_void, hdc: *mut c_void) -> i32;
        pub fn GetAsyncKeyState(key: i32) -> i16;
    }

    #[link(name = "gdi32")]
    extern "system" {
        pub fn GetPixel(hdc: *mut c_void, x: i32, y: i32) -> u32;
    }

    /// 左ボタン。
    pub const VK_LBUTTON: i32 = 1;
}

/// マウスカーソルの下の画面の色（AdvanceMap と同じく、画面上の任意の位置の色）。
#[tauri::command]
pub fn cursor_color() -> Result<PickedColor, String> {
    #[cfg(windows)]
    unsafe {
        use win::*;
        let mut p = Point::default();
        if GetCursorPos(&mut p) == 0 {
            return Err("カーソルの位置を取れません".into());
        }
        let dc = GetDC(std::ptr::null_mut());
        let c = GetPixel(dc, p.x, p.y);
        ReleaseDC(std::ptr::null_mut(), dc);
        let pressed = (GetAsyncKeyState(VK_LBUTTON) as u16 & 0x8000) != 0;
        if c == 0xffff_ffff {
            return Err("画面の色を取れません".into());
        }
        Ok(PickedColor { r: (c & 0xff) as u8, g: ((c >> 8) & 0xff) as u8, b: ((c >> 16) & 0xff) as u8, pressed })
    }
    #[cfg(not(windows))]
    Err("この OS では画面の色を取れません".into())
}

/// ウィンドウの画像（自動操作の screenshot と同じ範囲）の (x, y) の色。
#[tauri::command]
pub fn window_pixel(app: AppHandle, label: String, x: u32, y: u32) -> Result<PickedColor, String> {
    let window = app.get_webview_window(&label).ok_or("ウィンドウがありません")?;
    #[cfg(windows)]
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as *mut std::ffi::c_void;
    #[cfg(not(windows))]
    let hwnd = {
        let _ = &window;
        std::ptr::null_mut()
    };
    let (w, h, rgba) = capture::capture_window(hwnd)?;
    if x >= w || y >= h {
        return Err(format!("位置がウィンドウの外です: {x},{y}（{w}x{h}）"));
    }
    let at = ((y * w + x) * 4) as usize;
    Ok(PickedColor { r: rgba[at], g: rgba[at + 1], b: rgba[at + 2], pressed: false })
}
