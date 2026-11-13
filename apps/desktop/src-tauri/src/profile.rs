//! 個人設定と WebView2 のユーザーデータの置き場所（プロファイル）。
//!
//! - 通常の起動: 個人設定は `%APPDATA%\io.github.pit-true.zigzagumap\`、WebView2 は Tauri の既定の場所。
//! - `--profile <フォルダ>`: 個人設定も WebView2 のユーザーデータ（`<フォルダ>\EBWebView`）もそのフォルダに置く。
//! - `--automation` で `--profile` が無いとき: 一時フォルダ（`%TEMP%\zigzagumap-profile-<プロセスID>`）を作って使い、
//!   終了時に消す（通常の利用者の設定とデータには触れない）。

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};

/// 一時プロファイルのフォルダ名の頭。
const TEMP_PREFIX: &str = "zigzagumap-profile-";
/// 消し損ねた一時プロファイルを掃除するまでの時間。
const STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

/// 使うプロファイル。
#[derive(Clone, Debug, Default)]
pub struct Profile {
    /// 置き場所（None なら通常の場所）。
    dir: Option<PathBuf>,
    /// 終了時に消す一時フォルダか。
    temporary: bool,
}

impl Profile {
    /// 起動引数から決める。`explicit` は `--profile` の値、`automation` は `--automation` を付けたか。
    pub fn resolve(explicit: Option<&str>, automation: bool) -> Self {
        if let Some(dir) = explicit.filter(|d| !d.is_empty()) {
            let dir = absolute(Path::new(dir));
            let _ = std::fs::create_dir_all(&dir);
            return Self { dir: Some(dir), temporary: false };
        }
        if !automation {
            return Self::default();
        }
        sweep_stale_temp();
        let dir = std::env::temp_dir().join(format!("{TEMP_PREFIX}{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        Self { dir: Some(dir), temporary: true }
    }

    /// 置き場所（通常の場所なら None）。
    pub fn dir(&self) -> Option<&Path> {
        self.dir.as_deref()
    }

    /// 個人設定（settings.json）を置くフォルダ。
    pub fn settings_dir(&self, app: &AppHandle) -> Result<PathBuf, String> {
        match &self.dir {
            Some(d) => Ok(d.clone()),
            None => app.path().app_data_dir().map_err(|e| e.to_string()),
        }
    }

    /// WebView2 のユーザーデータのフォルダ（通常の場所なら None = Tauri の既定）。
    pub fn webview_dir(&self) -> Option<PathBuf> {
        self.dir.as_ref().map(|d| d.join("EBWebView"))
    }

    /// 一時フォルダなら消す（終了時）。WebView2 のプロセスは exe より少し後に終わり、それまでファイルを掴んでいるので、
    /// すぐに消せなければ、隠れたコマンドプロンプトに数秒待ってから消させる。
    pub fn cleanup(&self) {
        if !self.temporary {
            return;
        }
        let Some(dir) = &self.dir else { return };
        if std::fs::remove_dir_all(dir).is_ok() || !dir.exists() {
            return;
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            /// CREATE_NO_WINDOW（コンソールを出さない）。
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let script = format!("ping -n 6 127.0.0.1 >nul & rmdir /s /q \"{}\"", dir.display());
            let _ = std::process::Command::new("cmd").args(["/d", "/c"]).raw_arg(script).creation_flags(CREATE_NO_WINDOW).spawn();
        }
    }
}

fn absolute(p: &Path) -> PathBuf {
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().map(|c| c.join(p)).unwrap_or_else(|_| p.to_path_buf())
    }
}

/// 前の起動で消し損ねた一時プロファイル（1 日以上前のもの）を消す。
fn sweep_stale_temp() {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else { return };
    let now = SystemTime::now();
    for e in entries.flatten() {
        if !e.file_name().to_string_lossy().starts_with(TEMP_PREFIX) {
            continue;
        }
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > STALE_AFTER);
        if old {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}
