//! 別ウィンドウ（ワールドマップエディターなどの道具のウィンドウ）を開く。
//! 中身はメインと同じ index.html で、画面側がウィンドウのラベルを見て組み立てる。

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::automation::Automation;
use crate::{StartupArgs, AUTOMATION_BROWSER_ARGS};

/// 道具のウィンドウを開く。同じラベルのウィンドウがあれば前に出すだけ。
/// メインウィンドウを親にする（メインより手前に出て、メインを閉じると一緒に閉じる）。大きさは固定。
/// 自動操作で起動したときは、メインと同じく画面外に出してアクティブにしない。
/// Windows では同期のコマンドでウィンドウを作ると止まるため async にしている。
#[tauri::command]
pub async fn open_tool_window(
    app: AppHandle,
    args: State<'_, StartupArgs>,
    label: String,
    title: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let automation = args.automation.is_some();
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        if !automation {
            let _ = window.set_focus();
        }
        return Ok(());
    }
    let main = app.get_webview_window("main").ok_or("メインウィンドウがありません")?;
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())
        .title(title)
        .inner_size(width, height)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .parent(&main)
        .map_err(|e| e.to_string())?;
    if automation && !cfg!(debug_assertions) {
        builder = builder
            .position(-12000.0, -12000.0)
            .focused(false)
            .additional_browser_args(AUTOMATION_BROWSER_ARGS);
    } else {
        builder = builder.center();
    }
    let window = builder.build().map_err(|e| e.to_string())?;
    if automation && !cfg!(debug_assertions) {
        // 作るときの位置が画面外だと既定の位置（画面の中）に置かれることがあるので、作ったあとにもう一度画面外へ出す。
        let _ = window.set_position(tauri::PhysicalPosition::new(-12000, -12000));
    }
    // 閉じたら自動操作の受け付けを外し（開き直したときに画面の準備を待つため）、メインへ知らせる。
    let state = app.state::<Arc<Automation>>().inner().clone();
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            state.forget(&label);
            let _ = handle.emit_to("main", "tool-closed", &label);
        }
    });
    Ok(())
}

/// 道具のウィンドウを閉じる（ROM を開き直したときなど）。開いていなければ何もしない。
#[tauri::command]
pub fn close_tool_window(app: AppHandle, label: String) {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.destroy();
    }
}
