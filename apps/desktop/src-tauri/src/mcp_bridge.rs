//! MCP の窓口（Phase7 #521）。設定 > MCP の窓口 をオンにしたときだけ、127.0.0.1 の空いているポートで待ち受け、
//! ポートと合言葉（画面が起動ごとに作る乱数）を個人設定のフォルダの `mcp.json` に書く。閉じるときに消す。
//!
//! - MCP サーバー（`tools/mcp` の `zigzagumap-mcp.mjs`。exe の外）が `mcp.json` を読んでつなぐ。
//! - 受け付けるのは `POST /`、`Authorization: Bearer <合言葉>`、本文 `{"tool": 名前, "arguments": {...}}` だけ。
//!   合言葉が違う・無い、ブラウザから（`Origin` がある）、`Host` が 127.0.0.1 / localhost でない頼みは断る。
//! - 道具の中身と許可（書き換え・出力）は画面（TypeScript）が決める。ここは `mcp-request` で渡して返事を待つだけ。
//! - 自動操作の入口（`automation.rs`）とは別のポートと別の命令。自動操作の命令（マウス・キー・任意のコマンド）は通らない。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::profile::Profile;

/// 窓口のことを書くファイル（個人設定のフォルダ）。
pub const MCP_FILE: &str = "mcp.json";
/// 画面の返事を待つ時間。
const REPLY_TIMEOUT: Duration = Duration::from_secs(120);
/// 読み取りの待ち時間（頼みを送らずにつなぎっぱなしの相手で止まらないように）。
const READ_TIMEOUT: Duration = Duration::from_secs(10);
/// 本文の上限（矩形の書き込みでも足りる大きさ）。
const MAX_BODY: usize = 4 * 1024 * 1024;
/// ヘッダーの行数の上限。
const MAX_HEADERS: usize = 64;

/// 開いている窓口。
struct Running {
    port: u16,
    token: String,
    file: PathBuf,
    stop: Arc<AtomicBool>,
}

/// MCP の窓口の状態。
#[derive(Default)]
pub struct McpBridge {
    running: Mutex<Option<Running>>,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, Sender<String>>>,
}

impl McpBridge {
    /// 窓口を閉じ、`mcp.json` を消す（自分が書いたものだけ）。
    pub fn shutdown(&self) {
        let running = self.running.lock().ok().and_then(|mut r| r.take());
        if let Some(r) = running {
            r.stop.store(true, Ordering::SeqCst);
            // accept で止まっているスレッドを起こす
            let _ = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, r.port)), Duration::from_millis(200));
            remove_own_file(&r.file, &r.token);
        }
    }
}

/// 窓口を開く。`token` は画面が作った合言葉（32 文字以上の 16 進）。開いたポートを返す（もう開いていれば今のポート）。
#[tauri::command]
pub fn mcp_bridge_start(app: AppHandle, state: State<'_, Arc<McpBridge>>, token: String) -> Result<u16, String> {
    if token.len() < 32 || !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("合言葉の形が違います".into());
    }
    let mut guard = state.running.lock().map_err(|e| e.to_string())?;
    if let Some(r) = guard.as_ref() {
        return Ok(r.port);
    }
    let dir = app.state::<Profile>().settings_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|e| format!("MCP の窓口を開けません: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let file = dir.join(MCP_FILE);
    let info = json!({"version": 1, "port": port, "token": token, "pid": std::process::id()});
    let tmp = dir.join("mcp.json.tmp");
    std::fs::write(&tmp, info.to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    *guard = Some(Running { port, token: token.clone(), file, stop: stop.clone() });
    drop(guard);
    let bridge = state.inner().clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            let Ok(stream) = stream else { continue };
            let app = app.clone();
            let bridge = bridge.clone();
            let token = token.clone();
            std::thread::spawn(move || {
                if let Err(e) = handle(stream, &app, &bridge, &token, port) {
                    eprintln!("MCP の窓口: {e}");
                }
            });
        }
    });
    Ok(port)
}

/// 窓口を閉じる。
#[tauri::command]
pub fn mcp_bridge_stop(state: State<'_, Arc<McpBridge>>) {
    state.shutdown();
}

/// 開いているポート（閉じていれば None）。
#[tauri::command]
pub fn mcp_bridge_port(state: State<'_, Arc<McpBridge>>) -> Option<u16> {
    state.running.lock().ok().and_then(|r| r.as_ref().map(|r| r.port))
}

/// 画面からの返事。`body` は JSON の文字列。
#[tauri::command]
pub fn mcp_bridge_reply(state: State<'_, Arc<McpBridge>>, id: u64, body: String) {
    if let Some(tx) = state.pending.lock().ok().and_then(|mut p| p.remove(&id)) {
        let _ = tx.send(body);
    }
}

/// 自分の合言葉が書いてある `mcp.json` だけを消す（ほかの ZigzaguMap が書き直したものは残す）。
fn remove_own_file(file: &PathBuf, token: &str) {
    let ours = std::fs::read_to_string(file)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .is_some_and(|v| v.get("token").and_then(Value::as_str) == Some(token));
    if ours {
        let _ = std::fs::remove_file(file);
    }
}

/// 受け取った頼み（ヘッダーで要るものと本文）。
struct Request {
    method: String,
    host: Option<String>,
    origin: bool,
    authorization: Option<String>,
    body: Vec<u8>,
}

fn handle(mut stream: TcpStream, app: &AppHandle, bridge: &McpBridge, token: &str, port: u16) -> std::io::Result<()> {
    stream.set_read_timeout(Some(READ_TIMEOUT))?;
    let request = match read_request(&mut stream) {
        Ok(r) => r,
        Err(e) => return respond(&mut stream, 400, &json!({"error": e}).to_string()),
    };
    if let Err((status, message)) = check(&request, token, port) {
        return respond(&mut stream, status, &json!({"error": message}).to_string());
    }
    let parsed: Value = match serde_json::from_slice(&request.body) {
        Ok(v) => v,
        Err(e) => return respond(&mut stream, 400, &json!({"error": format!("JSON が読めません: {e}")}).to_string()),
    };
    let Some(tool) = parsed.get("tool").and_then(Value::as_str) else {
        return respond(&mut stream, 400, &json!({"error": "tool がありません"}).to_string());
    };
    let arguments = parsed.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let reply = forward(app, bridge, json!({"tool": tool, "arguments": arguments}));
    respond(&mut stream, 200, &reply)
}

/// 合言葉・ブラウザからでないこと・宛先を確かめる。
fn check(request: &Request, token: &str, port: u16) -> Result<(), (u16, &'static str)> {
    if request.method != "POST" {
        return Err((405, "POST だけを受け付けます"));
    }
    // ブラウザのページからの頼み（Origin が付く）は断る
    if request.origin {
        return Err((403, "ブラウザからの頼みは受け付けません"));
    }
    // 名前の解決を書き換えて 127.0.0.1 へ向ける手口（DNS rebinding）に備え、宛先の名前を確かめる
    let host_ok = request.host.as_deref().is_some_and(|h| h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}"));
    if !host_ok {
        return Err((403, "宛先が違います"));
    }
    let given = request.authorization.as_deref().and_then(|a| a.strip_prefix("Bearer ")).unwrap_or("");
    if !same_secret(given.as_bytes(), token.as_bytes()) {
        return Err((401, "合言葉が違います"));
    }
    Ok(())
}

/// 長さと中身を、途中で抜けずに比べる（合言葉を 1 文字ずつ当てられないように）。
fn same_secret(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// 画面へ渡して返事を待つ。
fn forward(app: &AppHandle, bridge: &McpBridge, payload: Value) -> String {
    let id = bridge.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = channel();
    if let Ok(mut p) = bridge.pending.lock() {
        p.insert(id, tx);
    }
    let _ = app.emit_to("main", "mcp-request", json!({"id": id, "request": payload}));
    let reply = rx
        .recv_timeout(REPLY_TIMEOUT)
        .unwrap_or_else(|_| json!({"isError": true, "content": [{"type": "text", "text": "ZigzaguMap の画面から返事がありません"}]}).to_string());
    if let Ok(mut p) = bridge.pending.lock() {
        p.remove(&id);
    }
    reply
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| e.to_string())?;
    let method = line.split_whitespace().next().unwrap_or("").to_string();
    let mut request = Request { method, host: None, origin: false, authorization: None, body: Vec::new() };
    let mut length = 0usize;
    for _ in 0..MAX_HEADERS {
        line.clear();
        if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
            break;
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        let Some((name, value)) = trimmed.split_once(':') else { continue };
        let value = value.trim();
        match name.to_ascii_lowercase().as_str() {
            "content-length" => length = value.parse().map_err(|_| "Content-Length が読めません".to_string())?,
            "host" => request.host = Some(value.to_ascii_lowercase()),
            "origin" => request.origin = true,
            "authorization" => request.authorization = Some(value.to_string()),
            _ => {}
        }
    }
    if length > MAX_BODY {
        return Err(format!("本文が大きすぎます（{length} バイト）"));
    }
    request.body = vec![0u8; length];
    reader.read_exact(&mut request.body).map_err(|e| e.to_string())?;
    Ok(request)
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        _ => "Method Not Allowed",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, host: Option<&str>, origin: bool, auth: Option<&str>) -> Request {
        Request {
            method: method.into(),
            host: host.map(String::from),
            origin,
            authorization: auth.map(String::from),
            body: Vec::new(),
        }
    }

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn accepts_only_the_right_token_and_host() {
        let ok = request("POST", Some("127.0.0.1:5000"), false, Some(&format!("Bearer {TOKEN}")));
        assert!(check(&ok, TOKEN, 5000).is_ok());
        let localhost = request("POST", Some("localhost:5000"), false, Some(&format!("Bearer {TOKEN}")));
        assert!(check(&localhost, TOKEN, 5000).is_ok());
        assert_eq!(check(&request("POST", Some("127.0.0.1:5000"), false, None), TOKEN, 5000).unwrap_err().0, 401);
        assert_eq!(check(&request("POST", Some("127.0.0.1:5000"), false, Some("Bearer 0123")), TOKEN, 5000).unwrap_err().0, 401);
        assert_eq!(check(&request("POST", Some("evil.example:5000"), false, Some(&format!("Bearer {TOKEN}"))), TOKEN, 5000).unwrap_err().0, 403);
        assert_eq!(check(&request("POST", Some("127.0.0.1:5000"), true, Some(&format!("Bearer {TOKEN}"))), TOKEN, 5000).unwrap_err().0, 403);
        assert_eq!(check(&request("GET", Some("127.0.0.1:5000"), false, Some(&format!("Bearer {TOKEN}"))), TOKEN, 5000).unwrap_err().0, 405);
    }

    #[test]
    fn compares_secrets() {
        assert!(same_secret(b"abc", b"abc"));
        assert!(!same_secret(b"abc", b"abd"));
        assert!(!same_secret(b"abc", b"abcd"));
    }
}
