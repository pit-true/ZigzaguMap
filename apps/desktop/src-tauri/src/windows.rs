//! 別ウィンドウ（ワールドマップエディターなどの道具のウィンドウ）を開く。
//! 中身は別ウィンドウ用の入口 tool.html（tool.ts）で、画面側がウィンドウのラベルを見て組み立てる。

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::automation::Automation;
use crate::offscreen;
use crate::profile::Profile;
use crate::{StartupArgs, AUTOMATION_BROWSER_ARGS, BROWSER_ARGS};

/// メインと道具のウィンドウに共通の設定（WebView2 のデータの置き場所と追加の引数、自動操作なら画面外で作る準備）。
/// WebView2 は同じユーザーデータのフォルダを使うウィンドウどうしで同じ引数でないと作れないので、ここにまとめる。
/// 自動操作のときは見えない状態で作り、作ったあと `offscreen::park_and_show` で画面外に出す。
pub(crate) fn prepare<'a, R: Runtime, M: Manager<R>>(
    mut builder: WebviewWindowBuilder<'a, R, M>,
    args: &StartupArgs,
    profile: &Profile,
) -> WebviewWindowBuilder<'a, R, M> {
    if let Some(dir) = profile.webview_dir() {
        builder = builder.data_directory(dir);
    }
    if args.offscreen() {
        builder.visible(false).focused(false).skip_taskbar(true).additional_browser_args(AUTOMATION_BROWSER_ARGS)
    } else {
        builder.additional_browser_args(BROWSER_ARGS)
    }
}

/// 道具のウィンドウを開く。同じラベルのウィンドウがあれば前に出すだけ。
/// メインウィンドウを親にする（メインより手前に出て、メインを閉じると一緒に閉じる）。大きさは固定。
/// 自動操作で起動したときは、メインと同じく画面外に出してアクティブにしない。
/// Windows では同期のコマンドでウィンドウを作ると止まるため async にしている。
#[tauri::command]
pub async fn open_tool_window(
    app: AppHandle,
    args: State<'_, StartupArgs>,
    profile: State<'_, Profile>,
    label: String,
    title: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let offscreen = args.offscreen();
    if let Some(window) = app.get_webview_window(&label) {
        if offscreen {
            offscreen::park_and_show(&window);
        } else {
            let _ = window.show();
            if args.automation.is_none() {
                let _ = window.set_focus();
            }
        }
        return Ok(());
    }
    let main = app.get_webview_window("main").ok_or("メインウィンドウがありません")?;
    // 中身は別ウィンドウ用の入口（tool.html）。メインの画面のコードは読み込まない。
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("tool.html".into()))
        .title(title)
        .inner_size(width, height)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .parent(&main)
        .map_err(|e| e.to_string())?;
    let builder = prepare(builder, &args, &profile);
    let window = if offscreen {
        let window = builder.build().map_err(|e| e.to_string())?;
        offscreen::park_and_show(&window);
        window
    } else {
        builder.center().build().map_err(|e| e.to_string())?
    };
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
