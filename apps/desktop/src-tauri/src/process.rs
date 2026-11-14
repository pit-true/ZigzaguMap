//! 外部コマンドの実行（ビルド・幅検査）。
//!
//! - `process_spawn`: コマンドを作業フォルダで起動し、標準出力と標準エラーを 1 行ずつ、呼んだウィンドウへ
//!   イベント `process-output`（`{ id, stream, line }`）で送る。終わったら `process-exit`（`{ id, code }`）を送る。
//!   `process_kill` で止められる（子プロセスごと止める）。
//! - `process_copy`: ファイルを写す（ビルドの手順の `copy`）。
//!
//! 作業フォルダは、開いているプロジェクトフォルダからの相対パス（`..` で上へ出てもよい）か絶対パス。
//! コマンドは設定（zigzagumap.json）に書いたもので、画面には黒いコンソールのウィンドウを出さない。
//! Rust の crate は増やさず、標準ライブラリだけで作る。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, State, WebviewWindow};

use crate::project_fs::{display_path, ProjectRoot};

/// 動いているプロセス（呼んだ側が付けた ID → 子プロセス）。
#[derive(Default)]
pub struct Processes {
    running: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
}

/// 出力の 1 行。
#[derive(Clone, Serialize)]
struct OutputLine<'a> {
    id: &'a str,
    /// `stdout` か `stderr`。
    stream: &'a str,
    line: String,
}

/// 終わったとき。`code` は終了コード（止めたときなど、無ければ null）。
#[derive(Clone, Serialize)]
struct ExitInfo<'a> {
    id: &'a str,
    code: Option<i32>,
    /// `process_kill` で止めたか。
    killed: bool,
}

/// Windows でコンソールのウィンドウを出さない（CREATE_NO_WINDOW）。
#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn hide_console(_cmd: &mut Command) {}

/// 作業フォルダを決める。相対パスはプロジェクトフォルダから（`..` も可）。省略はプロジェクトフォルダ。
fn resolve_cwd(root: &ProjectRoot, cwd: Option<&str>) -> Result<PathBuf, String> {
    let base = root.dir();
    let dir = match cwd.filter(|c| !c.is_empty()) {
        Some(c) if Path::new(c).is_absolute() => PathBuf::from(c),
        Some(c) => base.ok_or("プロジェクトフォルダが開かれていません")?.join(c),
        None => base.ok_or("プロジェクトフォルダが開かれていません")?,
    };
    let dir = std::fs::canonicalize(&dir).map_err(|e| format!("{}: {e}", display_path(&dir)))?;
    if !dir.is_dir() {
        return Err(format!("フォルダではありません: {}", display_path(&dir)));
    }
    Ok(dir)
}

/// 出力のバイト列を文字列にする（UTF-8 として読めない部分は置き換える。行末の CR は外す）。
fn decode_line(bytes: &[u8]) -> String {
    let mut s = String::from_utf8_lossy(bytes).into_owned();
    while s.ends_with('\n') || s.ends_with('\r') {
        s.pop();
    }
    s
}

/// 1 本の出力を 1 行ずつ読んでイベントで送る。
fn pump<R: Read + Send + 'static>(window: WebviewWindow, id: String, stream: &'static str, reader: R) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let _ = window.emit_to(window.label(), "process-output", OutputLine { id: &id, stream, line: decode_line(&buf) });
                }
            }
        }
    })
}

/// コマンドを起動し、出力を 1 行ずつ呼んだウィンドウへ送る。`id` は呼んだ側が付ける（同じ ID が動いていればエラー）。
/// 起動できたら作業フォルダの絶対パスを返す。Python の出力は UTF-8 にする（PYTHONUTF8=1、PYTHONIOENCODING=utf-8）。
#[tauri::command]
pub fn process_spawn(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    processes: State<'_, Arc<Processes>>,
    id: String,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<String, String> {
    let dir = resolve_cwd(&root, cwd.as_deref())?;
    let mut running = processes.running.lock().map_err(|e| e.to_string())?;
    if running.contains_key(&id) {
        return Err(format!("同じ ID のコマンドが動いています: {id}"));
    }
    let mut cmd = Command::new(&command);
    if let Some(path) = std::env::var_os("PATH") {
        // Microsoft Store の python / python3 の代わりの exe（WindowsApps）を外す。DPE の make.py は python3 があればそれを呼び、
        // 代わりの exe は何もせずに終わるため（tests/realcopy の builder と Chronos の build.py も同じことをしている）
        let kept: Vec<PathBuf> = std::env::split_paths(&path)
            .filter(|p| !p.to_string_lossy().to_ascii_lowercase().contains(r"\microsoft\windowsapps"))
            .collect();
        if let Ok(joined) = std::env::join_paths(kept) {
            cmd.env("PATH", joined);
        }
    }
    cmd.args(&args)
        .current_dir(&dir)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("{command}: {e}"))?;
    let out = child.stdout.take().map(|r| pump(window.clone(), id.clone(), "stdout", r));
    let err = child.stderr.take().map(|r| pump(window.clone(), id.clone(), "stderr", r));
    let child = Arc::new(Mutex::new(child));
    running.insert(id.clone(), child.clone());
    drop(running);

    let processes = processes.inner().clone();
    std::thread::spawn(move || {
        // 出力を読み終えてから終了を待つ（最後の行より先に終了が届かないように）。
        if let Some(h) = out {
            let _ = h.join();
        }
        if let Some(h) = err {
            let _ = h.join();
        }
        let code = loop {
            let status = child.lock().ok().and_then(|mut c| c.try_wait().ok().flatten());
            if let Some(s) = status {
                break s.code();
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        };
        let killed = processes.running.lock().map(|mut r| r.remove(&id).is_none()).unwrap_or(false);
        let _ = window.emit_to(window.label(), "process-exit", ExitInfo { id: &id, code, killed });
    });
    Ok(display_path(&dir))
}

/// 子プロセスを木ごと止める（python が起こした孫のプロセスも止めるため、Windows では taskkill /T を使う）。
fn kill_tree(child: &Mutex<Child>) {
    let Ok(mut c) = child.lock() else { return };
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &c.id().to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
        hide_console(&mut cmd);
        let _ = cmd.status();
    }
    let _ = c.kill();
}

/// 動いているコマンドを止める（子プロセスも止める）。無ければ false。
#[tauri::command]
pub fn process_kill(processes: State<'_, Arc<Processes>>, id: String) -> Result<bool, String> {
    let Some(child) = processes.running.lock().map_err(|e| e.to_string())?.remove(&id) else {
        return Ok(false);
    };
    kill_tree(&child);
    Ok(true)
}

/// 動いているコマンドの ID。
#[tauri::command]
pub fn process_running(processes: State<'_, Arc<Processes>>) -> Vec<String> {
    processes.running.lock().map(|r| r.keys().cloned().collect()).unwrap_or_default()
}

/// ファイルを写す（ビルドの手順の `copy`。ND の CFRU の test.gba を DPE の BPRJ0.gba にする）。
/// `from` と `to` は `cwd`（プロジェクトフォルダからの相対パスか絶対パス）からの相対パスか絶対パス。写した大きさを返す。
#[tauri::command]
pub fn process_copy(root: State<'_, ProjectRoot>, from: String, to: String, cwd: Option<String>) -> Result<u64, String> {
    let dir = resolve_cwd(&root, cwd.as_deref())?;
    let src = dir.join(&from);
    let dest = dir.join(&to);
    if !src.is_file() {
        return Err(format!("写すファイルがありません: {}", display_path(&src)));
    }
    let parent = dest.parent().ok_or("写し先が不正です")?;
    if !parent.is_dir() {
        return Err(format!("写し先のフォルダがありません: {}", display_path(parent)));
    }
    std::fs::copy(&src, &dest).map_err(|e| format!("{} → {}: {e}", display_path(&src), display_path(&dest)))
}

/// ビルドが書いたログを読む（Chronos の build.py は、失敗した段のログのパスだけを出す）。`path` は `cwd` の下のファイルに限る
/// （絶対パスでも、`cwd` の外なら断る）。4MB を超える分は読まない。UTF-8 として読めないバイトは置き換える。
#[tauri::command]
pub fn process_read_text(root: State<'_, ProjectRoot>, path: String, cwd: Option<String>) -> Result<String, String> {
    let dir = resolve_cwd(&root, cwd.as_deref())?;
    let file = std::fs::canonicalize(dir.join(&path)).map_err(|e| format!("{path}: {e}"))?;
    if !file.starts_with(&dir) || !file.is_file() {
        return Err(format!("作業フォルダの中のファイルではありません: {}", display_path(&file)));
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&file)
        .and_then(|f| f.take(4 * 1024 * 1024).read_to_end(&mut bytes))
        .map_err(|e| format!("{}: {e}", display_path(&file)))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// 終了時に動いているコマンドを止める。
pub fn kill_all(processes: &Processes) {
    let children: Vec<Arc<Mutex<Child>>> = processes.running.lock().map(|mut r| r.drain().map(|(_, c)| c).collect()).unwrap_or_default();
    for child in children {
        kill_tree(&child);
    }
}
