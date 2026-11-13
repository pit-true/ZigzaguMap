//! 自動操作の入口（テスト用）。開発ビルドか `--automation <ポート>` を付けたときだけ、
//! 127.0.0.1 で HTTP の POST（本文は JSON）を受け付ける。通常の起動では待ち受けない。
//!
//! - `{"cmd":"screenshot"}` と `{"cmd":"exit"}` は Rust 側で処理する。
//! - それ以外は画面（TypeScript）へ `automation-request` で渡し、`automation_reply` の返事を返す。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::capture;

/// 画面側の返事を待つ時間。
const REPLY_TIMEOUT: Duration = Duration::from_secs(120);

/// 自動操作の状態。
#[derive(Default)]
pub struct Automation {
    port: Option<u16>,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, Sender<String>>>,
}

impl Automation {
    pub fn new(port: Option<u16>) -> Self {
        Self { port, ..Default::default() }
    }
}

/// 待ち受けているポート（無効なら None）。画面はこれを見て購読するかを決める。
#[tauri::command]
pub fn automation_port(state: State<'_, Arc<Automation>>) -> Option<u16> {
    state.port
}

/// 画面からの返事。`body` は JSON の文字列。
#[tauri::command]
pub fn automation_reply(state: State<'_, Arc<Automation>>, id: u64, body: String) {
    if let Some(tx) = state.pending.lock().ok().and_then(|mut p| p.remove(&id)) {
        let _ = tx.send(body);
    }
}

/// 待ち受けを始める（別スレッド）。
pub fn start(app: AppHandle, state: Arc<Automation>) {
    let Some(port) = state.port else { return };
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", port)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("自動操作の入口を開けません (127.0.0.1:{port}): {e}");
                return;
            }
        };
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            let state = state.clone();
            std::thread::spawn(move || {
                if let Err(e) = handle(stream, &app, &state) {
                    eprintln!("自動操作: {e}");
                }
            });
        }
    });
}

fn handle(mut stream: TcpStream, app: &AppHandle, state: &Automation) -> std::io::Result<()> {
    let body = read_request(&mut stream)?;
    let request: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => return respond(&mut stream, &json!({"ok": false, "error": format!("JSON が読めません: {e}")}).to_string()),
    };
    let cmd = request.get("cmd").and_then(Value::as_str).unwrap_or("");
    match cmd {
        "screenshot" => {
            let reply = match screenshot(app) {
                Ok(v) => json!({"ok": true, "result": v}),
                Err(e) => json!({"ok": false, "error": e}),
            };
            respond(&mut stream, &reply.to_string())
        }
        "exit" => {
            respond(&mut stream, &json!({"ok": true}).to_string())?;
            app.exit(0);
            Ok(())
        }
        _ => {
            let id = state.next_id.fetch_add(1, Ordering::Relaxed);
            let (tx, rx) = channel();
            if let Ok(mut p) = state.pending.lock() {
                p.insert(id, tx);
            }
            let _ = app.emit_to("main", "automation-request", json!({"id": id, "request": request}));
            let reply = rx
                .recv_timeout(REPLY_TIMEOUT)
                .unwrap_or_else(|_| json!({"ok": false, "error": "画面からの返事がありません"}).to_string());
            if let Ok(mut p) = state.pending.lock() {
                p.remove(&id);
            }
            respond(&mut stream, &reply)
        }
    }
}

fn screenshot(app: &AppHandle) -> Result<Value, String> {
    let window = app.get_webview_window("main").ok_or("ウィンドウがありません")?;
    #[cfg(windows)]
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as *mut std::ffi::c_void;
    #[cfg(not(windows))]
    let hwnd = {
        let _ = &window;
        std::ptr::null_mut()
    };
    let (w, h, rgba) = capture::capture_window(hwnd)?;
    let png = capture::encode_png(w, h, &rgba);
    Ok(json!({"width": w, "height": h, "png": capture::base64(&png)}))
}

/// HTTP の要求を読み、本文を返す（ヘッダーは Content-Length だけを見る）。
fn read_request(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut length = 0usize;
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse().unwrap_or(0);
            }
        }
    }
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body)?;
    Ok(String::from_utf8_lossy(&body).into_owned())
}

fn respond(stream: &mut TcpStream, body: &str) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()
}
