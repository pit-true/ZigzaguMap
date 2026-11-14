//! プロジェクトフォルダのファイル入出力（TypeScript の ProjectFs の実体）。
//! 読み書きできるのは、開いたプロジェクトフォルダの配下だけ。パスは `/` 区切りの相対パスで受け取る。

use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use tauri::ipc::Response;
use tauri::State;

/// 開いているプロジェクトフォルダ（無ければ None）。
#[derive(Default)]
pub struct ProjectRoot(Mutex<Option<PathBuf>>);

impl ProjectRoot {
    /// 相対パスをプロジェクトフォルダ配下の絶対パスにする。フォルダ外を指すものは拒む。
    fn resolve(&self, relative: &str) -> Result<PathBuf, String> {
        let root = self
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or_else(|| "プロジェクトフォルダが開かれていません".to_string())?;
        let rel = Path::new(relative);
        if rel.is_absolute() {
            return Err(format!("絶対パスは使えません: {relative}"));
        }
        for c in rel.components() {
            match c {
                Component::Normal(_) | Component::CurDir => {}
                _ => return Err(format!("プロジェクトフォルダの外は指せません: {relative}")),
            }
        }
        Ok(root.join(rel))
    }

    /// 開いているプロジェクトフォルダ（外部コマンドの作業フォルダの基準）。
    pub(crate) fn dir(&self) -> Option<PathBuf> {
        self.0.lock().ok().and_then(|r| r.clone())
    }

    /// プロジェクトフォルダが開かれているか。
    fn is_open(&self) -> bool {
        self.0.lock().map(|r| r.is_some()).unwrap_or(false)
    }
}

/// プロジェクトフォルダを設定する（None で閉じる）。フォルダでなければエラー。設定したフォルダの絶対パスを返す。
#[tauri::command]
pub fn project_set_root(root: State<'_, ProjectRoot>, path: Option<String>) -> Result<Option<String>, String> {
    let next = match path {
        None => None,
        Some(p) => {
            let dir = std::fs::canonicalize(&p).map_err(|e| format!("{p}: {e}"))?;
            if !dir.is_dir() {
                return Err(format!("フォルダではありません: {p}"));
            }
            Some(dir)
        }
    };
    let shown = next.as_ref().map(|d| display_path(d));
    *root.0.lock().map_err(|e| e.to_string())? = next;
    Ok(shown)
}

/// テキストファイルを UTF-8 で読む。
#[tauri::command]
pub fn fs_read_text(root: State<'_, ProjectRoot>, path: String) -> Result<String, String> {
    let full = root.resolve(&path)?;
    std::fs::read_to_string(&full).map_err(|e| format!("{path}: {e}"))
}

/// テキストファイルを UTF-8（BOM なし）で書く。一時ファイルに書いてから置き換える。
#[tauri::command]
pub fn fs_write_text(root: State<'_, ProjectRoot>, path: String, text: String) -> Result<(), String> {
    let full = root.resolve(&path)?;
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{path}: {e}"))?;
    }
    let tmp = full.with_extension("tmp");
    std::fs::write(&tmp, text.as_bytes()).map_err(|e| format!("{path}: {e}"))?;
    std::fs::rename(&tmp, &full).map_err(|e| format!("{path}: {e}"))
}

/// バイナリファイルを書く（tiles.png など）。パスはヘッダー `path`（URL エンコード）、中身は本文のバイト列。
/// 一時ファイルに書いてから置き換える。
#[tauri::command]
pub fn fs_write_bytes(root: State<'_, ProjectRoot>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let path = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .map(crate::system::percent_decode)
        .ok_or("path がありません")?;
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("本文がバイト列ではありません".into());
    };
    let full = root.resolve(&path)?;
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{path}: {e}"))?;
    }
    let tmp = full.with_extension("tmp");
    std::fs::write(&tmp, data).map_err(|e| format!("{path}: {e}"))?;
    std::fs::rename(&tmp, &full).map_err(|e| format!("{path}: {e}"))
}

/// バイナリファイルを読む（JSON にせず生のバイト列で返す）。
#[tauri::command]
pub fn fs_read_bytes(root: State<'_, ProjectRoot>, path: String) -> Result<Response, String> {
    let full = root.resolve(&path)?;
    std::fs::read(&full).map(Response::new).map_err(|e| format!("{path}: {e}"))
}

/// ファイルかフォルダがあるか。プロジェクトフォルダが無ければ false。
#[tauri::command]
pub fn fs_exists(root: State<'_, ProjectRoot>, path: String) -> Result<bool, String> {
    if !root.is_open() {
        return Ok(false);
    }
    Ok(root.resolve(&path)?.exists())
}

/// ファイルを消す。無ければ何もしない。
#[tauri::command]
pub fn fs_remove(root: State<'_, ProjectRoot>, path: String) -> Result<(), String> {
    let full = root.resolve(&path)?;
    match std::fs::remove_file(&full) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{path}: {e}")),
    }
}

/// フォルダの中の名前（名前順）。フォルダが無ければ空。
#[tauri::command]
pub fn fs_list(root: State<'_, ProjectRoot>, path: String) -> Result<Vec<String>, String> {
    if !root.is_open() {
        return Ok(Vec::new());
    }
    let full = root.resolve(&path)?;
    let Ok(entries) = std::fs::read_dir(&full) else {
        return Ok(Vec::new());
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    Ok(names)
}

/// ファイルの更新日時と大きさ（`fs_stat`）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    /// 更新日時（UNIX 時刻のミリ秒）。
    modified_ms: f64,
    /// 大きさ（バイト）。
    size: u64,
    /// フォルダか。
    dir: bool,
}

/// ファイルの更新日時と大きさ。無ければ null（外部の変更を見つけるのに使う）。
#[tauri::command]
pub fn fs_stat(root: State<'_, ProjectRoot>, path: String) -> Result<Option<FileStat>, String> {
    if !root.is_open() {
        return Ok(None);
    }
    let full = root.resolve(&path)?;
    let Ok(meta) = std::fs::metadata(&full) else {
        return Ok(None);
    };
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    Ok(Some(FileStat { modified_ms, size: meta.len(), dir: meta.is_dir() }))
}

/// `\\?\` を外した表示用のパス。
pub fn display_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}
