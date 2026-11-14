//! 画像をクリップボードへ渡す（Phase3 #246。接続している全マップの画像・マップの画像のコピー）。
//! 依存を増やさず、Win32 の API で CF_DIB（32 ビット、下から上）と、登録した "PNG" の形式の両方を置く。

use tauri::ipc::{InvokeBody, Request};

fn header_u32(request: &Request<'_>, name: &str) -> Result<u32, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u32>().ok())
        .ok_or_else(|| format!("{name} がありません"))
}

/// 画像をクリップボードへ置く。ヘッダー `width`・`height`・`png-length`、本文は PNG（`png-length` バイト）のあとに RGBA。
#[tauri::command]
pub fn clipboard_write_image(request: Request<'_>) -> Result<(), String> {
    let width = header_u32(&request, "width")?;
    let height = header_u32(&request, "height")?;
    let png_len = header_u32(&request, "png-length")? as usize;
    let InvokeBody::Raw(data) = request.body() else {
        return Err("本文がバイト列ではありません".into());
    };
    let rgba_len = width as usize * height as usize * 4;
    if width == 0 || height == 0 || data.len() != png_len + rgba_len {
        return Err("画像の大きさが合いません".into());
    }
    platform::write(width, height, &data[..png_len], &data[png_len..])
}

/// 32 ビットの DIB（BITMAPINFOHEADER と、下の行から並べた BGRA）を作る。
pub fn dib32(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let row = width as usize * 4;
    let mut out = Vec::with_capacity(40 + rgba.len());
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(width as i32).to_le_bytes());
    out.extend_from_slice(&(height as i32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&(rgba.len() as u32).to_le_bytes());
    out.extend_from_slice(&[0u8; 16]);
    for y in (0..height as usize).rev() {
        for px in rgba[y * row..(y + 1) * row].chunks_exact(4) {
            out.extend_from_slice(&[px[2], px[1], px[0], px[3]]);
        }
    }
    out
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;

    const CF_DIB: u32 = 8;
    const GMEM_MOVEABLE: u32 = 0x0002;

    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(hwnd: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, mem: *mut c_void) -> *mut c_void;
        fn RegisterClipboardFormatW(name: *const u16) -> u32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(flags: u32, bytes: usize) -> *mut c_void;
        fn GlobalLock(mem: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(mem: *mut c_void) -> i32;
        fn GlobalFree(mem: *mut c_void) -> *mut c_void;
    }

    /// バイト列を、クリップボードに渡せる移動可能なメモリに写す。
    unsafe fn global(bytes: &[u8]) -> Result<*mut c_void, String> {
        let mem = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
        if mem.is_null() {
            return Err("メモリを確保できません".into());
        }
        let p = GlobalLock(mem) as *mut u8;
        if p.is_null() {
            GlobalFree(mem);
            return Err("メモリを確保できません".into());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
        GlobalUnlock(mem);
        Ok(mem)
    }

    pub fn write(width: u32, height: u32, png: &[u8], rgba: &[u8]) -> Result<(), String> {
        let dib = super::dib32(width, height, rgba);
        unsafe {
            // ほかのアプリが開いていることがあるので、少し待ってやり直す
            let mut opened = false;
            for _ in 0..10 {
                if OpenClipboard(std::ptr::null_mut()) != 0 {
                    opened = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            if !opened {
                return Err("クリップボードを開けません".into());
            }
            let result = (|| {
                EmptyClipboard();
                let dib_mem = global(&dib)?;
                if SetClipboardData(CF_DIB, dib_mem).is_null() {
                    GlobalFree(dib_mem);
                    return Err("クリップボードに画像を置けません".to_string());
                }
                if !png.is_empty() {
                    let name: Vec<u16> = "PNG".encode_utf16().chain(std::iter::once(0)).collect();
                    let format = RegisterClipboardFormatW(name.as_ptr());
                    if format != 0 {
                        let png_mem = global(png)?;
                        if SetClipboardData(format, png_mem).is_null() {
                            GlobalFree(png_mem);
                        }
                    }
                }
                Ok(())
            })();
            CloseClipboard();
            result
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn write(_width: u32, _height: u32, _png: &[u8], _rgba: &[u8]) -> Result<(), String> {
        Err("この OS ではクリップボードに画像を置けません".into())
    }
}

#[cfg(test)]
mod tests {
    use super::dib32;

    #[test]
    fn dib_is_bottom_up_bgra() {
        // 1×2 の画像（上が赤、下が青）
        let rgba = [255, 0, 0, 255, 0, 0, 255, 255];
        let dib = dib32(1, 2, &rgba);
        assert_eq!(dib.len(), 40 + 8);
        assert_eq!(&dib[0..4], &40u32.to_le_bytes());
        assert_eq!(&dib[14..16], &32u16.to_le_bytes());
        // 下の行（青）が先、BGRA の順
        assert_eq!(&dib[40..44], &[255, 0, 0, 255]);
        assert_eq!(&dib[44..48], &[0, 0, 255, 255]);
    }
}
