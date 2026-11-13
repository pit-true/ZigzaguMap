//! 「スクリプトを開く」: 設定したスクリプトエディターを AdvanceMap と同じ引数で起動する。

use std::path::Path;
use std::process::Command;

/// `"<エディター>" "<ROM>"<区切り><オフセット>` で起動し、渡したコマンドラインを返す。
/// exe が無ければ `notFound`（画面側が「スクリプトエディタが見つかりません！」を出す）。
#[tauri::command]
pub fn launch_script_editor(program: String, rom: String, offset: String, separator: String) -> Result<String, String> {
    if !Path::new(&program).is_file() {
        return Err("notFound".into());
    }
    let args = format!("\"{rom}\"{separator}{offset}");
    let mut cmd = Command::new(&program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.raw_arg(&args);
    }
    #[cfg(not(windows))]
    {
        if separator == " " {
            cmd.arg(&rom).arg(&offset);
        } else {
            cmd.arg(format!("{rom}{separator}{offset}"));
        }
    }
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(format!("\"{program}\" {args}"))
}
