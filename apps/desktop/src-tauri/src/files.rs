//! ROM の読み込み、ダイアログ、個人設定（AppData）の読み書き。

use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::profile::Profile;
use crate::project_fs::display_path;
use crate::StartupArgs;

/// 個人設定のファイル名（app data dir 直下）。
const SETTINGS_FILE: &str = "settings.json";

/// 自動操作で起動しているときは、Windows のファイル・フォルダを選ぶダイアログを一切開かない（画面に出て操作を奪うため）。
/// 画面側は `queuePath` で予約した答えを使う。予約が無いままここに来たらエラーにする。
pub(crate) fn deny_native_dialog(args: &StartupArgs) -> Result<(), String> {
    if args.automation.is_some() {
        Err("自動操作中は Windows のファイルのダイアログを開きません（queuePath で選ぶパスを予約してください）".into())
    } else {
        Ok(())
    }
}

/// ROM を選ぶダイアログを出し、選ばれたパスを返す。キャンセルなら None。
#[tauri::command]
pub async fn pick_rom(window: WebviewWindow, args: State<'_, StartupArgs>) -> Result<Option<String>, String> {
    deny_native_dialog(&args)?;
    Ok(window
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("GBA ROM", &["gba"])
        .blocking_pick_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| display_path(&path)))
}

/// フォルダを選ぶダイアログを出す。キャンセルなら None。
#[tauri::command]
pub async fn pick_folder(window: WebviewWindow, args: State<'_, StartupArgs>, title: String) -> Result<Option<String>, String> {
    deny_native_dialog(&args)?;
    Ok(window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(title)
        .blocking_pick_folder()
        .and_then(|file| file.into_path().ok())
        .map(|path| display_path(&path)))
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

/// 個人設定を読む。無ければ空文字。置き場所はプロファイルで決まる（`--profile`、自動操作なら一時フォルダ）。
#[tauri::command]
pub fn load_settings(app: AppHandle) -> String {
    app.state::<Profile>()
        .settings_dir(&app)
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join(SETTINGS_FILE)).ok())
        .unwrap_or_default()
}

/// 個人設定を書く。
#[tauri::command]
pub fn save_settings(app: AppHandle, text: String) -> Result<(), String> {
    let dir = app.state::<Profile>().settings_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("settings.json.tmp");
    std::fs::write(&tmp, text.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(SETTINGS_FILE)).map_err(|e| e.to_string())
}

/// 個人設定に保存したウィンドウの位置と大きさ（物理ピクセル）。
#[derive(serde::Deserialize, Clone)]
pub struct WindowPlacement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    #[serde(default)]
    maximized: bool,
}

/// 個人設定からウィンドウの位置と大きさを読む。無いか壊れていれば None。
pub fn saved_window_placement(app: &AppHandle) -> Option<WindowPlacement> {
    let text = load_settings(app.clone());
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let p: WindowPlacement = serde_json::from_value(value.get("window")?.clone()).ok()?;
    (p.width >= 200 && p.height >= 150).then_some(p)
}

/// 位置と大きさを当てる。どのモニターにも重ならない位置なら中央に置く。
pub fn apply_window_placement(window: &WebviewWindow, p: &WindowPlacement) {
    use tauri::{PhysicalPosition, PhysicalSize};
    let visible = window.available_monitors().unwrap_or_default().iter().any(|m| {
        let pos = m.position();
        let size = m.size();
        p.x + 100 < pos.x + size.width as i32 && p.x + p.width as i32 > pos.x + 100 && p.y >= pos.y - 8 && p.y + 40 < pos.y + size.height as i32
    });
    let _ = window.set_size(PhysicalSize::new(p.width, p.height));
    if visible {
        let _ = window.set_position(PhysicalPosition::new(p.x, p.y));
    } else {
        let _ = window.center();
    }
    if p.maximized {
        let _ = window.maximize();
    }
}
