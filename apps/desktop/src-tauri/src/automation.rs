//! 自動操作の入口（テスト用）。開発ビルドか `--automation <ポート>` を付けたときだけ、
//! 127.0.0.1 で HTTP の POST（本文は JSON）を受け付ける。通常の起動では待ち受けない。
//!
//! - `{"cmd":"screenshot"}`、`{"cmd":"windows"}`、`{"cmd":"exit"}` は Rust 側で処理する。
//! - それ以外は画面（TypeScript）へ `automation-request` で渡し、`automation_reply` の返事を返す。
//! - `"window": "<ラベル>"` を付けると、そのウィンドウ（ワールドマップエディターなど）へ
//!   `automation-request-window` で渡す（メインの購読と混ざらないよう名前を分けている）。
//!   screenshot に付けるとそのウィンドウを撮る。

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::capture;

/// 画面側の返事を待つ時間。
const REPLY_TIMEOUT: Duration = Duration::from_secs(120);

/// 自動操作の状態。
#[derive(Default)]
pub struct Automation {
    port: Option<u16>,
    next_id: AtomicU64,
    /// 要求を受け取れる状態になったウィンドウのラベル。
    ready: Mutex<HashSet<String>>,
    pending: Mutex<HashMap<u64, Sender<String>>>,
}

impl Automation {
    pub fn new(port: Option<u16>) -> Self {
        Self { port, ..Default::default() }
    }

    fn is_ready(&self, label: &str) -> bool {
        self.ready.lock().map(|r| r.contains(label)).unwrap_or(false)
    }

    /// ウィンドウを閉じたときに受け付けを外す。
    pub fn forget(&self, label: &str) {
        if let Ok(mut r) = self.ready.lock() {
            r.remove(label);
        }
    }
}

/// 待ち受けているポート（無効なら None）。画面はこれを見て購読するかを決める。
#[tauri::command]
pub fn automation_port(state: State<'_, Arc<Automation>>) -> Option<u16> {
    state.port
}

/// 画面が要求を受け取れるようになったことを知らせる（呼んだウィンドウごと）。
#[tauri::command]
pub fn automation_ready(window: WebviewWindow, state: State<'_, Arc<Automation>>) {
    if let Ok(mut r) = state.ready.lock() {
        r.insert(window.label().to_string());
    }
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
    let label = request.get("window").and_then(Value::as_str).unwrap_or("main").to_string();
    match cmd {
        "windows" => respond(&mut stream, &json!({"ok": true, "result": windows(app, state)}).to_string()),
        "screenshot" => {
            let reply = match screenshot(app, &label) {
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
        _ if !state.is_ready(&label) => {
            let error = if app.get_webview_window(&label).is_some() { "画面の準備ができていません".to_string() } else { format!("ウィンドウ {label} は開いていません") };
            respond(&mut stream, &json!({"ok": false, "error": error}).to_string())
        }
        _ => {
            let id = state.next_id.fetch_add(1, Ordering::Relaxed);
            let (tx, rx) = channel();
            if let Ok(mut p) = state.pending.lock() {
                p.insert(id, tx);
            }
            let event = if label == "main" { "automation-request" } else { "automation-request-window" };
            let _ = app.emit_to(label.as_str(), event, json!({"id": id, "request": request}));
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

/// 開いているウィンドウの一覧（ラベル、題名、表示中か、自動操作を受け付けるか）。
fn windows(app: &AppHandle, state: &Automation) -> Value {
    let mut list: Vec<Value> = app
        .webview_windows()
        .into_iter()
        .map(|(label, w)| {
            json!({
                "label": label,
                "title": w.title().unwrap_or_default(),
                "visible": w.is_visible().unwrap_or(false),
                "ready": state.is_ready(&label),
            })
        })
        .collect();
    list.sort_by(|a, b| a["label"].as_str().cmp(&b["label"].as_str()));
    Value::Array(list)
}

fn screenshot(app: &AppHandle, label: &str) -> Result<Value, String> {
    let window = app.get_webview_window(label).ok_or(format!("ウィンドウ {label} がありません"))?;
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
