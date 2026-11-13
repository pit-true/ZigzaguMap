// WebView2 の空のウィンドウだけを開く（ZigzaguMap の待機時メモリの下限を測るため。scripts/measure-memory.ps1 -Baseline）。
// 引数: --profile <フォルダ>（WebView2 のデータ）、--args "<追加の引数>"。画面外・非アクティブで表示する。
#![windows_subsystem = "windows"]
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[link(name = "user32")]
extern "system" {
    fn SetWindowPos(h: *mut std::ffi::c_void, a: *mut std::ffi::c_void, x: i32, y: i32, cx: i32, cy: i32, f: u32) -> i32;
    fn ShowWindow(h: *mut std::ffi::c_void, c: i32) -> i32;
}

fn main() {
    let mut profile = None;
    let mut extra = String::new();
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--profile" => profile = it.next(),
            "--args" => extra = it.next().unwrap_or_default(),
            _ => {}
        }
    }
    tauri::Builder::default()
        .setup(move |app| {
            let mut b = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .inner_size(1019.0, 704.0)
                .visible(false)
                .focused(false)
                .skip_taskbar(true);
            if let Some(p) = &profile {
                b = b.data_directory(p.into());
            }
            if !extra.is_empty() {
                b = b.additional_browser_args(&extra);
            }
            let w = b.build()?;
            let h = w.hwnd()?.0 as *mut std::ffi::c_void;
            unsafe {
                SetWindowPos(h, std::ptr::null_mut(), -12000, -12000, 0, 0, 0x1 | 0x4 | 0x10);
                ShowWindow(h, 4);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("baseline");
}
