//! Rust 側はファイル入出力とウィンドウ管理だけを受け持つ。ROM の解析は TypeScript のコアで行う。

mod automation;
mod capture;
mod files;
mod offscreen;
mod pick;
mod profile;
mod project_fs;
mod system;
mod windows;

use std::sync::Arc;

use serde::Serialize;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

use automation::Automation;
use profile::Profile;
use project_fs::ProjectRoot;

/// 開発ビルドで自動操作を待ち受けるポート。
#[cfg(debug_assertions)]
const DEV_AUTOMATION_PORT: u16 = 17890;

/// 起動引数（`zigzagumap.exe [--automation <ポート>] [--profile <フォルダ>] [--project <フォルダ>] [ROM]`）。
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupArgs {
    /// 起動時に開く ROM。
    rom: Option<String>,
    /// 起動時に開くプロジェクトフォルダ（ROM と組で使う）。
    project: Option<String>,
    /// 自動操作のポート。
    automation: Option<u16>,
    /// 個人設定と WebView2 のデータの置き場所（`--profile`）。
    profile: Option<String>,
    /// `--automation` を付けて起動したか（開発ビルドの既定のポートは含まない）。
    #[serde(skip)]
    automation_requested: bool,
}

impl StartupArgs {
    fn parse() -> Self {
        let mut out = StartupArgs::default();
        let mut args = std::env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--automation" => {
                    out.automation_requested = true;
                    out.automation = args.next().and_then(|p| p.parse().ok());
                }
                "--project" => out.project = args.next(),
                "--profile" => out.profile = args.next(),
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

    /// 自動操作のため、画面外・非アクティブで出すか（開発ビルドは画面に出す）。
    pub(crate) fn offscreen(&self) -> bool {
        self.automation.is_some() && !cfg!(debug_assertions)
    }
}

/// 起動引数を返す。
#[tauri::command]
fn startup_args(args: State<'_, StartupArgs>) -> StartupArgs {
    args.inner().clone()
}

/// 自動操作で起動したときの WebView2 の引数（画面外・非アクティブでも描画を止めない）。
pub(crate) const AUTOMATION_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
     --disable-renderer-backgrounding --disable-background-timer-throttling --disable-backgrounding-occluded-windows";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut args = StartupArgs::parse();
    let profile = Profile::resolve(args.profile.as_deref(), args.automation_requested);
    // 画面には実際に使う置き場所を渡す（一時フォルダを含む。通常の場所なら None）。
    args.profile = profile.dir().map(|d| d.to_string_lossy().into_owned());
    let automation = Arc::new(Automation::new(args.automation));
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(args)
        .manage(profile)
        .manage(automation)
        .manage(ProjectRoot::default())
        .setup(|app| {
            let args = app.state::<StartupArgs>().inner().clone();
            let profile = app.state::<Profile>().inner().clone();
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("ZigzaguMap")
                .inner_size(1019.0, 704.0)
                .min_inner_size(640.0, 400.0);
            let builder = windows::prepare(builder, &args, &profile);
            if args.offscreen() {
                let window = builder.build()?;
                offscreen::park_and_show(&window);
            } else {
                // 位置を覚えていれば、見えない状態で作って当ててから出す（自動操作のときは覚えた位置を使わない）。
                let placement = if args.automation.is_none() { files::saved_window_placement(app.handle()) } else { None };
                let builder = if placement.is_some() { builder.visible(false) } else { builder.center() };
                let window = builder.build()?;
                if let Some(p) = placement {
                    files::apply_window_placement(&window, &p);
                    let _ = window.show();
                }
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
            windows::open_tool_window,
            windows::close_tool_window,
            pick::cursor_color,
            pick::window_pixel,
            automation::automation_capture,
        ])
        .build(tauri::generate_context!())
        .expect("ZigzaguMap の起動に失敗しました");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            handle.state::<Profile>().cleanup();
        }
    });
}
