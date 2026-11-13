//! Rust 側はファイル入出力とウィンドウ管理だけを受け持つ。ROM の解析は TypeScript のコアで行う。

use tauri::ipc::Response;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// ROM を選ぶダイアログを出し、選ばれたパスを返す。キャンセルなら None。
#[tauri::command]
async fn pick_rom(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("GBA ROM", &["gba"])
        .blocking_pick_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// ROM を読み、バイト列のまま返す（JSON にしない）。ROM へは書き込まない。
#[tauri::command]
async fn read_rom(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("{path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![pick_rom, read_rom])
        .run(tauri::generate_context!())
        .expect("ZigzaguMap の起動に失敗しました");
}
