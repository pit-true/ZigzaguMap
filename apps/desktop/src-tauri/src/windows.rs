//! 別ウィンドウ（ワールドマップエディターなどの道具のウィンドウ）を開く。
//! 中身は別ウィンドウ用の入口 tool.html（tool.ts）で、画面側がウィンドウのラベルを見て組み立てる。

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::automation::Automation;
use crate::files;
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

/// 大きさを変えられるウィンドウの指定（スクリプトエディタなど）。省略すると大きさ固定。
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResizeOptions {
    /// 最小の大きさ（論理ピクセル）。
    min_width: Option<f64>,
    min_height: Option<f64>,
    /// 前回の位置と大きさ（物理ピクセル。メインが個人設定から渡す）。自動操作のときは使わない。
    placement: Option<files::WindowPlacement>,
    /// 動かしたり大きさを変えたりしたら、メインへ `tool-placement`（`{ label, x, y, width, height, maximized }`）を送る
    /// （メインが個人設定に残す。個人設定を書くのはメインだけにするため）。
    remember: Option<bool>,
}

/// `tool-placement` の中身（物理ピクセル）。
#[derive(Clone, serde::Serialize)]
struct PlacementEvent {
    label: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

/// 道具のウィンドウを開く。同じラベルのウィンドウがあれば前に出すだけ。
/// メインウィンドウを親にする（メインより手前に出て、メインを閉じると一緒に閉じる）。
/// `resize` を渡すと大きさを変えられ、最大化もできる（渡さなければ大きさ固定）。
/// 自動操作で起動したときは、メインと同じく画面外に出してアクティブにしない。
/// Windows では同期のコマンドでウィンドウを作ると止まるため async にしている。
// Tauri のコマンドは引数がそのまま画面側の名前になるので、構造体にまとめない。
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn open_tool_window(
    app: AppHandle,
    args: State<'_, StartupArgs>,
    profile: State<'_, Profile>,
    label: String,
    title: String,
    width: f64,
    height: f64,
    resize: Option<ResizeOptions>,
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
    let resizable = resize.is_some();
    let resize = resize.unwrap_or_default();
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("tool.html".into()))
        .title(title)
        .inner_size(width, height)
        .resizable(resizable)
        .maximizable(resizable)
        .minimizable(false)
        .parent(&main)
        .map_err(|e| e.to_string())?;
    if let (Some(w), Some(h)) = (resize.min_width, resize.min_height) {
        builder = builder.min_inner_size(w, h);
    }
    let builder = prepare(builder, &args, &profile);
    // 自動操作のときは覚えた位置を使わない（画面外に出す）。
    let placement = if args.automation.is_none() { resize.placement } else { None };
    let window = if offscreen {
        let window = builder.build().map_err(|e| e.to_string())?;
        offscreen::park_and_show(&window);
        window
    } else if let Some(p) = placement {
        let window = builder.visible(false).build().map_err(|e| e.to_string())?;
        files::apply_window_placement(&window, &p);
        let _ = window.show();
        window
    } else {
        builder.center().build().map_err(|e| e.to_string())?
    };
    let remember = resize.remember == Some(true) && args.automation.is_none();
    // 閉じたら自動操作の受け付けを外し（開き直したときに画面の準備を待つため）、メインへ知らせる。
    let state = app.state::<Arc<Automation>>().inner().clone();
    let handle = app.clone();
    let watched = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Destroyed => {
            state.forget(&label);
            let _ = handle.emit_to("main", "tool-closed", &label);
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) if remember => {
            if watched.is_minimized().unwrap_or(false) {
                return;
            }
            let (Ok(pos), Ok(size)) = (watched.outer_position(), watched.inner_size()) else { return };
            let maximized = watched.is_maximized().unwrap_or(false);
            let event = PlacementEvent { label: label.clone(), x: pos.x, y: pos.y, width: size.width, height: size.height, maximized };
            let _ = handle.emit_to("main", "tool-placement", event);
        }
        _ => {}
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
