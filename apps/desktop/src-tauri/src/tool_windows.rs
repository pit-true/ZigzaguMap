//! 本物の別ウィンドウ（ブロックエディタ、パレットエディタ、ブロックパレット一括変更）を開く。
//! 中身は `tool.html`（メインとは別のバンドル）で、開いたときに初めて読み込む。閉じると WebView ごと破棄する。
//! 編集の状態はメインウィンドウが持ち、別ウィンドウとはイベント（`tool-request` / `tool-message`）でやり取りする。

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::{StartupArgs, AUTOMATION_BROWSER_ARGS};

/// 別ウィンドウのラベル（`capabilities/tools.json` の windows と同じ）。
const TOOL_LABELS: [&str; 3] = ["block-editor", "palette-editor", "block-adjust"];

/// 別ウィンドウを開く。既に開いていれば前に出す（自動操作のときは出さない）。新しく開いたら true。
/// 位置はメインウィンドウの中央（AdvanceMap の poMainFormCenter）。自動操作のときは画面外に出し、アクティブにしない。
#[tauri::command]
pub async fn open_tool_window(
    app: AppHandle,
    args: State<'_, StartupArgs>,
    label: String,
    title: String,
    width: f64,
    height: f64,
    resizable: bool,
) -> Result<bool, String> {
    if !TOOL_LABELS.contains(&label.as_str()) {
        return Err(format!("知らないウィンドウです: {label}"));
    }
    let automation = args.automation.is_some() && !cfg!(debug_assertions);
    if let Some(w) = app.get_webview_window(&label) {
        if !automation {
            let _ = w.set_focus();
        }
        return Ok(false);
    }
    let main = app.get_webview_window("main").ok_or("メインウィンドウがありません")?;
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("tool.html".into()))
        .title(title)
        .inner_size(width, height)
        .resizable(resizable)
        .maximizable(false)
        .minimizable(false)
        .parent(&main)
        .map_err(|e| e.to_string())?;
    if automation {
        // 別ウィンドウどうしが重ならないよう、ラベルごとにずらして画面外に置く。
        let index = TOOL_LABELS.iter().position(|l| *l == label).unwrap_or(0) as f64;
        builder = builder
            .position(-11000.0 + index * 1000.0, -12000.0)
            .focused(false)
            .additional_browser_args(AUTOMATION_BROWSER_ARGS);
    } else if let (Ok(pos), Ok(size), Ok(scale)) = (main.outer_position(), main.outer_size(), main.scale_factor()) {
        let x = (pos.x as f64 + (size.width as f64 - width * scale) / 2.0) / scale;
        let y = (pos.y as f64 + (size.height as f64 - height * scale) / 2.0) / scale;
        builder = builder.position(x.max(0.0), y.max(0.0));
    }
    let window = builder.build().map_err(|e| e.to_string())?;
    if automation {
        // 作るときの位置が画面外だと既定の位置に置かれることがあるので、作ったあとにもう一度画面外へ出す。
        let index = TOOL_LABELS.iter().position(|l| *l == label).unwrap_or(0) as i32;
        let _ = window.set_position(tauri::PhysicalPosition::new(-11000 + index * 1000, -12000));
    }
    let handle = app.clone();
    let closed = label.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            let _ = handle.emit_to("main", "tool-closed", &closed);
        }
    });
    Ok(true)
}

/// 別ウィンドウを閉じる（ROM を開き直したときなど）。開いていなければ何もしない。
#[tauri::command]
pub fn close_tool_window(app: AppHandle, label: String) {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.destroy();
    }
}
