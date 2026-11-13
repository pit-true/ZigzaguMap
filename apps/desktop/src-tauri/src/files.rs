//! ROM の読み込み、ダイアログ、個人設定（AppData）の読み書き。

use tauri::ipc::Response;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};

use crate::project_fs::display_path;

/// 個人設定のファイル名（app data dir 直下）。
const SETTINGS_FILE: &str = "settings.json";

/// ROM を選ぶダイアログを出し、選ばれたパスを返す。キャンセルなら None。
#[tauri::command]
pub async fn pick_rom(window: WebviewWindow) -> Option<String> {
    window
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("GBA ROM", &["gba"])
        .blocking_pick_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| display_path(&path))
}

/// フォルダを選ぶダイアログを出す。キャンセルなら None。
#[tauri::command]
pub async fn pick_folder(window: WebviewWindow, title: String) -> Option<String> {
    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(title)
        .blocking_pick_folder()
        .and_then(|file| file.into_path().ok())
        .map(|path| display_path(&path))
}

/// 「はい／いいえ／キャンセル」の質問を出す。戻り値は "yes" / "no" / "cancel"。
#[tauri::command]
pub async fn ask_yes_no_cancel(window: WebviewWindow, title: String, message: String) -> String {
    let result = window
        .dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .parent(&window)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            "はい".into(),
            "いいえ".into(),
            "キャンセル".into(),
        ))
        .blocking_show_with_result();
    match result {
        MessageDialogResult::Yes => "yes",
        MessageDialogResult::No => "no",
        MessageDialogResult::Custom(s) if s == "はい" => "yes",
        MessageDialogResult::Custom(s) if s == "いいえ" => "no",
        _ => "cancel",
    }
    .to_string()
}

/// 情報・エラーのメッセージを出す（OK のみ）。
#[tauri::command]
pub async fn show_message(window: WebviewWindow, title: String, message: String, error: bool) {
    window
        .dialog()
        .message(message)
        .title(title)
        .kind(if error { MessageDialogKind::Error } else { MessageDialogKind::Info })
        .parent(&window)
        .blocking_show();
}

/// ROM を読み、バイト列のまま返す（JSON にしない）。ROM へは書き込まない。
#[tauri::command]
pub async fn read_rom(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| format!("{path}: {e}"))
}

/// パスがフォルダか。
#[tauri::command]
pub fn is_dir(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

/// 個人設定を読む。無ければ空文字。
#[tauri::command]
pub fn load_settings(app: AppHandle) -> String {
    app.path()
        .app_data_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join(SETTINGS_FILE)).ok())
        .unwrap_or_default()
}

/// 個人設定を書く。
#[tauri::command]
pub fn save_settings(app: AppHandle, text: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("settings.json.tmp");
    std::fs::write(&tmp, text.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(SETTINGS_FILE)).map_err(|e| e.to_string())
}
