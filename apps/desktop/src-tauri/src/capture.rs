//! ウィンドウ全体の画像を取る（自動操作の入口用）。前面に出さずに PrintWindow で描かせる。
//! 依存を増やさないよう、Win32 の関数は直接宣言し、PNG も無圧縮で自前に書く。

#[cfg(windows)]
mod win {
    use std::ffi::c_void;

    pub type Handle = *mut c_void;

    #[repr(C)]
    #[derive(Default)]
    pub struct Rect {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    #[repr(C)]
    pub struct BitmapInfoHeader {
        pub size: u32,
        pub width: i32,
        pub height: i32,
        pub planes: u16,
        pub bit_count: u16,
        pub compression: u32,
        pub size_image: u32,
        pub x_ppm: i32,
        pub y_ppm: i32,
        pub clr_used: u32,
        pub clr_important: u32,
    }

    #[repr(C)]
    pub struct BitmapInfo {
        pub header: BitmapInfoHeader,
        pub colors: [u32; 1],
    }

    #[link(name = "user32")]
    extern "system" {
        pub fn GetWindowRect(hwnd: Handle, rect: *mut Rect) -> i32;
        pub fn PrintWindow(hwnd: Handle, hdc: Handle, flags: u32) -> i32;
        pub fn GetDC(hwnd: Handle) -> Handle;
        pub fn ReleaseDC(hwnd: Handle, hdc: Handle) -> i32;
        pub fn ClientToScreen(hwnd: Handle, point: *mut Point) -> i32;
    }

    #[repr(C)]
    #[derive(Default)]
    pub struct Point {
        pub x: i32,
        pub y: i32,
    }

    #[link(name = "gdi32")]
    extern "system" {
        pub fn CreateCompatibleDC(hdc: Handle) -> Handle;
        pub fn CreateCompatibleBitmap(hdc: Handle, w: i32, h: i32) -> Handle;
        pub fn SelectObject(hdc: Handle, obj: Handle) -> Handle;
        pub fn GetDIBits(hdc: Handle, bmp: Handle, start: u32, lines: u32, bits: *mut c_void, info: *mut BitmapInfo, usage: u32) -> i32;
        pub fn DeleteObject(obj: Handle) -> i32;
        pub fn DeleteDC(hdc: Handle) -> i32;
    }

    #[link(name = "dwmapi")]
    extern "system" {
        pub fn DwmGetWindowAttribute(hwnd: Handle, attr: u32, value: *mut c_void, size: u32) -> i32;
    }

    /// DWMWA_EXTENDED_FRAME_BOUNDS（影を除いた見た目の枠）。
    pub const DWMWA_EXTENDED_FRAME_BOUNDS: u32 = 9;
    /// PW_RENDERFULLCONTENT（WebView2 などの合成された中身も描かせる）。
    pub const PW_RENDERFULLCONTENT: u32 = 2;
}

/// ウィンドウを BGRA で取り込み、(幅, 高さ, RGBA) を返す。影の部分は切り落とす。
#[cfg(windows)]
pub fn capture_window(hwnd: *mut std::ffi::c_void) -> Result<(u32, u32, Vec<u8>), String> {
    use std::ffi::c_void;
    use win::*;
    unsafe {
        let mut outer = Rect::default();
        if GetWindowRect(hwnd, &mut outer) == 0 {
            return Err("ウィンドウの大きさを取れません".into());
        }
        let mut visible = Rect::default();
        let has_frame = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut visible as *mut Rect as *mut c_void,
            std::mem::size_of::<Rect>() as u32,
        ) == 0;
        let w = outer.right - outer.left;
        let h = outer.bottom - outer.top;
        if w <= 0 || h <= 0 {
            return Err("ウィンドウが最小化されています".into());
        }
        let screen = GetDC(std::ptr::null_mut());
        let mem = CreateCompatibleDC(screen);
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bmp);
        let printed = PrintWindow(hwnd, mem, PW_RENDERFULLCONTENT);
        let mut info = BitmapInfo {
            header: BitmapInfoHeader {
                size: std::mem::size_of::<BitmapInfoHeader>() as u32,
                width: w,
                height: -h,
                planes: 1,
                bit_count: 32,
                compression: 0,
                size_image: 0,
                x_ppm: 0,
                y_ppm: 0,
                clr_used: 0,
                clr_important: 0,
            },
            colors: [0],
        };
        let mut bgra = vec![0u8; (w * h * 4) as usize];
        SelectObject(mem, old);
        let lines = GetDIBits(mem, bmp, 0, h as u32, bgra.as_mut_ptr() as *mut c_void, &mut info, 0);
        DeleteObject(bmp);
        DeleteDC(mem);
        ReleaseDC(std::ptr::null_mut(), screen);
        if printed == 0 || lines == 0 {
            return Err("ウィンドウの画像を取れませんでした".into());
        }
        // 影を除いた範囲に切り詰める。
        let frame = has_frame.then(|| (visible.left - outer.left, visible.top - outer.top, visible.right - outer.left, visible.bottom - outer.top));
        let (cx, cy, cw, ch) = frame_rect(w, h, frame);
        let mut rgba = Vec::with_capacity((cw * ch * 4) as usize);
        for y in cy..cy + ch {
            let row = ((y * w + cx) * 4) as usize;
            for px in bgra[row..row + (cw * 4) as usize].chunks_exact(4) {
                rgba.extend_from_slice(&[px[2], px[1], px[0], 255]);
            }
        }
        Ok((cw as u32, ch as u32, rgba))
    }
}

/// 影を除いた枠（ウィンドウの左上からの left, top, right, bottom）を、ウィンドウ（w x h）の中の (x, y, 幅, 高さ) にする。
fn frame_rect(w: i32, h: i32, frame: Option<(i32, i32, i32, i32)>) -> (i32, i32, i32, i32) {
    // 枠をウィンドウの内側に切り詰める。重ならない（大きさを取れていない）ときはウィンドウ全体にする。
    let Some((left, top, right, bottom)) = frame else { return (0, 0, w, h) };
    let (l, t) = (left.clamp(0, w), top.clamp(0, h));
    let (r, b) = (right.clamp(0, w), bottom.clamp(0, h));
    if r <= l || b <= t {
        return (0, 0, w, h);
    }
    (l, t, r - l, b - t)
}

/// ウィンドウのクライアント領域の矩形（物理ピクセル）を切り出す（パネルだけの画像用）。
#[cfg(windows)]
pub fn capture_client_rect(hwnd: *mut std::ffi::c_void, x: i32, y: i32, w: i32, h: i32) -> Result<(u32, u32, Vec<u8>), String> {
    use std::ffi::c_void;
    use win::*;
    let (fw, fh, rgba) = capture_window(hwnd)?;
    // capture_window は影を除いた枠（無ければウィンドウ全体）の左上から始まる。
    let (ox, oy) = unsafe {
        let mut outer = Rect::default();
        GetWindowRect(hwnd, &mut outer);
        let mut visible = Rect::default();
        let has_frame = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut visible as *mut Rect as *mut c_void,
            std::mem::size_of::<Rect>() as u32,
        ) == 0;
        let origin = if has_frame { (visible.left, visible.top) } else { (outer.left, outer.top) };
        let mut client = Point::default();
        ClientToScreen(hwnd, &mut client);
        (client.x - origin.0, client.y - origin.1)
    };
    crop_rgba(fw, fh, &rgba, ox + x, oy + y, w, h)
}

/// RGBA の画像（fw x fh）から矩形を切り出す。画像からはみ出す分は切り詰め、画像と重ならなければ Err（落ちない）。
pub fn crop_rgba(fw: u32, fh: u32, rgba: &[u8], x: i32, y: i32, w: i32, h: i32) -> Result<(u32, u32, Vec<u8>), String> {
    let (fw, fh) = (fw as i64, fh as i64);
    if (rgba.len() as i64) < fw * fh * 4 {
        return Err("ウィンドウの画像が足りません".into());
    }
    let (x, y) = (x as i64, y as i64);
    let left = x.max(0);
    let top = y.max(0);
    let right = (x + (w as i64).max(0)).min(fw);
    let bottom = (y + (h as i64).max(0)).min(fh);
    if right <= left || bottom <= top {
        return Err(format!("部品がウィンドウに見えていません（{x},{y} の {w}x{h}。ウィンドウは {fw}x{fh}）"));
    }
    let (cw, ch) = (right - left, bottom - top);
    let mut out = Vec::with_capacity((cw * ch * 4) as usize);
    for row in top..bottom {
        let start = ((row * fw + left) * 4) as usize;
        out.extend_from_slice(&rgba[start..start + (cw * 4) as usize]);
    }
    Ok((cw as u32, ch as u32, out))
}

#[cfg(not(windows))]
pub fn capture_client_rect(_hwnd: *mut std::ffi::c_void, _x: i32, _y: i32, _w: i32, _h: i32) -> Result<(u32, u32, Vec<u8>), String> {
    Err("この OS ではウィンドウの画像を取れません".into())
}

#[cfg(not(windows))]
pub fn capture_window(_hwnd: *mut std::ffi::c_void) -> Result<(u32, u32, Vec<u8>), String> {
    Err("この OS ではウィンドウの画像を取れません".into())
}

/// RGBA を PNG（無圧縮の deflate）にする。
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let mut raw = Vec::with_capacity((width as usize * 4 + 1) * height as usize);
    for y in 0..height as usize {
        raw.push(0);
        let row = y * width as usize * 4;
        raw.extend_from_slice(&rgba[row..row + width as usize * 4]);
    }
    let mut z = vec![0x78, 0x01];
    let mut chunks = raw.chunks(0xffff).peekable();
    if chunks.peek().is_none() {
        z.extend_from_slice(&[1, 0, 0, 0xff, 0xff]);
    }
    while let Some(chunk) = chunks.next() {
        let last = chunks.peek().is_none();
        let len = chunk.len() as u16;
        z.push(if last { 1 } else { 0 });
        z.extend_from_slice(&len.to_le_bytes());
        z.extend_from_slice(&(!len).to_le_bytes());
        z.extend_from_slice(chunk);
    }
    z.extend_from_slice(&adler32(&raw).to_be_bytes());

    let mut out = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    write_chunk(&mut out, b"IHDR", &ihdr);
    write_chunk(&mut out, b"IDAT", &z);
    write_chunk(&mut out, b"IEND", &[]);
    out
}

fn write_chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let start = out.len();
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let crc = crc32(&out[start..]);
    out.extend_from_slice(&crc.to_be_bytes());
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for chunk in data.chunks(5552) {
        for &x in chunk {
            a += x as u32;
            b += a;
        }
        a %= 65521;
        b %= 65521;
    }
    (b << 16) | a
}

/// Base64（標準、パディングあり）。
pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 4x3 の画像。画素 (x, y) の R に x、G に y を入れる。
    fn image() -> Vec<u8> {
        let mut v = Vec::new();
        for y in 0..3u8 {
            for x in 0..4u8 {
                v.extend_from_slice(&[x, y, 0, 255]);
            }
        }
        v
    }

    fn corner(out: &(u32, u32, Vec<u8>)) -> (u8, u8) {
        (out.2[0], out.2[1])
    }

    #[test]
    fn crop_inside() {
        let out = crop_rgba(4, 3, &image(), 1, 1, 2, 2).unwrap();
        assert_eq!((out.0, out.1, corner(&out)), (2, 2, (1, 1)));
        assert_eq!(out.2.len(), 2 * 2 * 4);
    }

    #[test]
    fn crop_clips_overhang() {
        // 下と右にはみ出す（スクロールする枠の中の長い部品）
        let out = crop_rgba(4, 3, &image(), 2, 1, 10, 10).unwrap();
        assert_eq!((out.0, out.1, corner(&out)), (2, 2, (2, 1)));
        // 左と上にはみ出す
        let out = crop_rgba(4, 3, &image(), -5, -2, 7, 4).unwrap();
        assert_eq!((out.0, out.1, corner(&out)), (2, 2, (0, 0)));
    }

    #[test]
    fn crop_outside_is_error() {
        for (x, y, w, h) in [(0, 3, 4, 5), (0, 100, 4, 5), (4, 0, 2, 2), (10, 10, 1, 1), (-10, 0, 5, 3), (0, -10, 4, 5), (0, 0, 0, 0), (1, 1, -5, -5)] {
            assert!(crop_rgba(4, 3, &image(), x, y, w, h).is_err(), "{x},{y},{w},{h}");
        }
    }

    #[test]
    fn crop_extreme_values_do_not_panic() {
        for (x, y, w, h) in [(i32::MAX, i32::MAX, i32::MAX, i32::MAX), (i32::MIN, i32::MIN, i32::MAX, i32::MAX), (i32::MIN, 0, i32::MIN, 1), (1, 1, i32::MAX, i32::MAX)] {
            let _ = crop_rgba(4, 3, &image(), x, y, w, h);
        }
    }

    #[test]
    fn crop_short_buffer_is_error() {
        assert!(crop_rgba(4, 3, &image()[..20], 0, 0, 4, 3).is_err());
    }

    #[test]
    fn frame_inside_window() {
        // 影を除いた枠。ウィンドウ（100x80）の中に収まる
        assert_eq!(frame_rect(100, 80, Some((8, 1, 92, 72))), (8, 1, 84, 71));
        // 枠がウィンドウの外（最小化の直後など）でも落ちない
        assert_eq!(frame_rect(100, 80, Some((100, 80, 50, 50))), (0, 0, 100, 80));
        assert_eq!(frame_rect(100, 80, Some((-50, -50, -10, -10))), (0, 0, 100, 80));
        assert_eq!(frame_rect(100, 80, None), (0, 0, 100, 80));
    }
}
