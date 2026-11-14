//! 保存ダイアログ・任意の場所へのファイルの書き込み・ショートカットとエクスプローラーの右クリックへの登録。
//! どれもユーザーが選んだ場所か、ユーザーが確認したあとにだけ呼ばれる（画面側で確認ダイアログを出す）。

use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::ipc::Request;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::files::deny_native_dialog;
use crate::project_fs::display_path;
use crate::StartupArgs;

/// ファイルの種類（名前と拡張子。拡張子に "*" を入れると全部）。
#[derive(Deserialize)]
pub struct Filter {
    name: String,
    extensions: Vec<String>,
}

fn with_filters(
    mut b: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
    filters: &[Filter],
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    for f in filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        b = b.add_filter(&f.name, &exts);
    }
    b
}

/// 「名前を付けて保存」。キャンセルなら None。
#[tauri::command]
pub async fn pick_save_file(
    window: WebviewWindow,
    args: State<'_, StartupArgs>,
    title: String,
    filters: Vec<Filter>,
    directory: Option<String>,
    file_name: Option<String>,
) -> Result<Option<String>, String> {
    deny_native_dialog(&args)?;
    let mut b = with_filters(window.dialog().file().set_parent(&window).set_title(title), &filters);
    if let Some(d) = directory.filter(|d| Path::new(d).is_dir()) {
        b = b.set_directory(d);
    }
    if let Some(n) = file_name {
        b = b.set_file_name(n);
    }
    Ok(b.blocking_save_file().and_then(|f| f.into_path().ok()).map(|p| display_path(&p)))
}

/// 「ファイルを開く」。キャンセルなら None。
#[tauri::command]
pub async fn pick_open_file(
    window: WebviewWindow,
    args: State<'_, StartupArgs>,
    title: String,
    filters: Vec<Filter>,
    directory: Option<String>,
    file_name: Option<String>,
) -> Result<Option<String>, String> {
    deny_native_dialog(&args)?;
    let mut b = with_filters(window.dialog().file().set_parent(&window).set_title(title), &filters);
    if let Some(d) = directory.filter(|d| Path::new(d).is_dir()) {
        b = b.set_directory(d);
    }
    if let Some(n) = file_name {
        b = b.set_file_name(n);
    }
    Ok(b.blocking_pick_file().and_then(|f| f.into_path().ok()).map(|p| display_path(&p)))
}

/// ファイルを書く。パスはヘッダー `path`（URL エンコード）、中身は本文のバイト列。
#[tauri::command]
pub fn write_file(request: Request<'_>) -> Result<(), String> {
    let path = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .ok_or("path がありません")?;
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("本文がバイト列ではありません".into());
    };
    std::fs::write(&path, data).map_err(|e| format!("{path}: {e}"))
}

/// ファイルがあるか（フォルダは false）。
#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

/// exe のパス。
#[tauri::command]
pub fn exe_path() -> Result<String, String> {
    std::env::current_exe().map(|p| display_path(&p)).map_err(|e| e.to_string())
}

/// デスクトップのフォルダ。
#[tauri::command]
pub fn desktop_dir(app: AppHandle) -> Result<String, String> {
    app.path().desktop_dir().map(|p| display_path(&p)).map_err(|e| e.to_string())
}

/// ショートカット（.lnk）を作る。`arguments` は対象に渡す引数。
#[tauri::command]
pub fn create_shortcut(link: String, target: String, arguments: String) -> Result<(), String> {
    let script = format!(
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.Arguments='{}';$s.WorkingDirectory='{}';$s.Save()",
        ps_quote(&link),
        ps_quote(&target),
        ps_quote(&arguments),
        ps_quote(&parent_of(&target)),
    );
    run_hidden("powershell", &["-NoProfile", "-NonInteractive", "-Command", &script])
}

/// エクスプローラーの .gba の右クリックに「ZigzaguMapで開く」を登録する（現在のユーザーだけ）。
#[tauri::command]
pub fn register_context_menu(label: String) -> Result<(), String> {
    let exe = exe_path()?;
    let key = CONTEXT_MENU_KEY;
    run_hidden("reg", &["add", key, "/ve", "/d", &label, "/f"])?;
    run_hidden("reg", &["add", key, "/v", "Icon", "/d", &exe, "/f"])?;
    run_hidden("reg", &["add", &format!("{key}\\command"), "/ve", "/d", &format!("\"{exe}\" \"%1\""), "/f"])
}

/// 右クリックの登録を外す。
#[tauri::command]
pub fn unregister_context_menu() -> Result<(), String> {
    run_hidden("reg", &["delete", CONTEXT_MENU_KEY, "/f"])
}

/// 右クリックの登録先（HKCU の .gba の右クリック項目）。
const CONTEXT_MENU_KEY: &str = r"HKCU\Software\Classes\SystemFileAssociations\.gba\shell\ZigzaguMap";

fn run_hidden(program: &str, args: &[&str]) -> Result<(), String> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        /// CREATE_NO_WINDOW（コンソールを出さない）。
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().map_err(|e| format!("{program}: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("{program}: {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}

fn ps_quote(s: &str) -> String {
    s.replace('\'', "''")
}

fn parent_of(path: &str) -> String {
    PathBuf::from(path).parent().map(display_path).unwrap_or_default()
}

/// `%XX` を戻す（ヘッダーに日本語のパスを載せるため、画面側で encodeURIComponent している）。
pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
