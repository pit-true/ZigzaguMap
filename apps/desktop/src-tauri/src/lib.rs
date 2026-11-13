//! Rust 側はファイル入出力とウィンドウ管理だけを受け持つ。ROM の解析は TypeScript のコアで行う。

mod automation;
mod capture;
mod files;
mod project_fs;
mod script_editor;
mod system;

use std::sync::Arc;

use serde::Serialize;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

use automation::Automation;
use project_fs::ProjectRoot;

/// 開発ビルドで自動操作を待ち受けるポート。
#[cfg(debug_assertions)]
const DEV_AUTOMATION_PORT: u16 = 17890;

/// 起動引数（`zigzagumap.exe [--automation <ポート>] [--project <フォルダ>] [ROM]`）。
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupArgs {
    /// 起動時に開く ROM。
    rom: Option<String>,
    /// 起動時に開くプロジェクトフォルダ（ROM と組で使う）。
    project: Option<String>,
    /// 自動操作のポート。
    automation: Option<u16>,
}

impl StartupArgs {
    fn parse() -> Self {
        let mut out = StartupArgs::default();
        let mut args = std::env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--automation" => out.automation = args.next().and_then(|p| p.parse().ok()),
                "--project" => out.project = args.next(),
                _ if arg.starts_with("--") => {}
                _ => out.rom = Some(arg),
            }
        }
        #[cfg(debug_assertions)]
        if out.automation.is_none() {
            out.automation = Some(DEV_AUTOMATION_PORT);
        }
        out
    }
}

/// 起動引数を返す。
#[tauri::command]
fn startup_args(args: State<'_, StartupArgs>) -> StartupArgs {
    args.inner().clone()
}

/// 自動操作で起動したときの WebView2 の引数（画面外・非アクティブでも描画を止めない）。
const AUTOMATION_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
     --disable-renderer-backgrounding --disable-background-timer-throttling --disable-backgrounding-occluded-windows";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args = StartupArgs::parse();
    let automation = Arc::new(Automation::new(args.automation));
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(args)
        .manage(automation)
        .manage(ProjectRoot::default())
        .setup(|app| {
            let args = app.state::<StartupArgs>().inner().clone();
            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("ZigzaguMap")
                .inner_size(1019.0, 704.0)
                .min_inner_size(640.0, 400.0);
            // 自動操作のときは、ユーザーの操作を奪わないよう画面外に出し、アクティブにしない。
            if args.automation.is_some() && !cfg!(debug_assertions) {
                builder = builder
                    .position(-12000.0, -12000.0)
                    .focused(false)
                    .additional_browser_args(AUTOMATION_BROWSER_ARGS);
            } else {
                builder = builder.center();
            }
            let placement = if args.automation.is_none() { files::saved_window_placement(app.handle()) } else { None };
            if placement.is_some() {
                builder = builder.visible(false);
            }
            let window = builder.build()?;
            if let Some(p) = placement {
                files::apply_window_placement(&window, &p);
                let _ = window.show();
            }
            automation::start(app.handle().clone(), app.state::<Arc<Automation>>().inner().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            startup_args,
            files::pick_rom,
            files::pick_folder,
            files::ask_yes_no_cancel,
            files::show_message,
            files::read_rom,
            files::is_dir,
            files::load_settings,
            files::save_settings,
            system::pick_save_file,
            system::pick_open_file,
            system::write_file,
            system::file_exists,
            system::exe_path,
            system::launch_program,
            system::desktop_dir,
            system::create_shortcut,
            system::register_context_menu,
            system::unregister_context_menu,
            project_fs::project_set_root,
            project_fs::fs_read_text,
            project_fs::fs_write_text,
            project_fs::fs_write_bytes,
            project_fs::fs_read_bytes,
            project_fs::fs_exists,
            project_fs::fs_remove,
            project_fs::fs_list,
            automation::automation_port,
            automation::automation_reply,
            automation::automation_ready,
            automation::automation_capture,
            script_editor::launch_script_editor,
        ])
        .run(tauri::generate_context!())
        .expect("ZigzaguMap の起動に失敗しました");
}
