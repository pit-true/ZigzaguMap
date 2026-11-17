//! 「使用中」の印（Phase7 #522）。ZigzaguMap がプロジェクトフォルダを開いている間だけ、一時フォルダの
//! `zigzagumap-in-use\<プロセスID>.json` に `{"pid": …, "project": "<フォルダの絶対パス>"}` を置く。
//! 画面なしの MCP サーバー（`tools/mcp`）がこれを読み、同じプロジェクトを開いている ZigzaguMap があれば書き換えを断る。
//! 警告の画面は無い（#509 は作らないことになったので、印だけの最小の形）。プロジェクトフォルダには何も足さない。

use std::path::PathBuf;

use serde_json::json;

/// 印を置くフォルダの名前（一時フォルダの下）。
pub const IN_USE_DIR: &str = "zigzagumap-in-use";

fn own_file() -> PathBuf {
    std::env::temp_dir().join(IN_USE_DIR).join(format!("{}.json", std::process::id()))
}

/// 開いているプロジェクトフォルダを印に書く（None なら印を消す）。失敗しても編集は止めない。
pub fn mark(project: Option<&str>) {
    let file = own_file();
    match project {
        Some(dir) => {
            if let Some(parent) = file.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let text = json!({"pid": std::process::id(), "project": dir}).to_string();
            let tmp = file.with_extension("tmp");
            if std::fs::write(&tmp, text).is_ok() {
                let _ = std::fs::rename(&tmp, &file);
            }
        }
        None => clear(),
    }
}

/// 印を消す（終了のとき）。
pub fn clear() {
    let _ = std::fs::remove_file(own_file());
}
