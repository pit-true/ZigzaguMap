"""AdvanceMap 1.92 automation harness that never touches the user's real input.

AdvanceMap is launched on a separate, invisible Win32 desktop (CreateDesktop +
STARTUPINFO.lpDesktop). This Python thread joins that desktop
(SetThreadDesktop) and drives the app only with window messages
(PostMessage/SendMessage). Screenshots use PrintWindow, so nothing is ever
shown on the user's screen and the real mouse/keyboard are never used.

See README.md for usage.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import os
import pathlib
import subprocess
import time
from dataclasses import dataclass, field

from PIL import Image

# Paths come from environment variables (nothing is stored in the repository):
#   ZZM_WORK    work folder outside the repository (default: current directory)
#   ZZM_AM_DIR  AdvanceMap copy for this worker (default: <work>/am192)
#   ZZM_ROM     ROM copy opened by start() (default: <work>/rom/BPRJ_work.gba)
#   ZZM_SHOTS   screenshot folder for shot()/shot_comp() (default: <work>/shots)
# Each parallel worker should use its own AdvanceMap copy and ROM copy (make_worker.py).
WORK = pathlib.Path(os.environ.get("ZZM_WORK", os.getcwd()))
AM_DIR = pathlib.Path(os.environ.get("ZZM_AM_DIR", WORK / "am192"))
AM_EXE = AM_DIR / "AdvanceMap.exe"
ROM_WORK = pathlib.Path(os.environ.get("ZZM_ROM", WORK / "rom" / "BPRJ_work.gba"))
SHOTS = pathlib.Path(os.environ.get("ZZM_SHOTS", WORK / "shots"))

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

# ---------------------------------------------------------------- prototypes
LRESULT = ctypes.c_ssize_t
WPARAM = ctypes.c_size_t
LPARAM = ctypes.c_ssize_t
user32.SendMessageW.restype = LRESULT
user32.SendMessageW.argtypes = [wt.HWND, wt.UINT, WPARAM, LPARAM]
user32.SendMessageTimeoutW.restype = LRESULT
user32.SendMessageTimeoutW.argtypes = [wt.HWND, wt.UINT, WPARAM, LPARAM, wt.UINT, wt.UINT, ctypes.POINTER(ctypes.c_size_t)]
user32.PostMessageW.argtypes = [wt.HWND, wt.UINT, WPARAM, LPARAM]
user32.PostMessageW.restype = wt.BOOL
user32.CreateDesktopW.restype = wt.HANDLE
user32.CreateDesktopW.argtypes = [wt.LPCWSTR, wt.LPCWSTR, ctypes.c_void_p, wt.DWORD, wt.DWORD, ctypes.c_void_p]
user32.OpenDesktopW.restype = wt.HANDLE
user32.SetThreadDesktop.argtypes = [wt.HANDLE]
user32.GetThreadDesktop.restype = wt.HANDLE
user32.CloseDesktop.argtypes = [wt.HANDLE]
WNDENUMPROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, LPARAM)
user32.EnumDesktopWindows.argtypes = [wt.HANDLE, WNDENUMPROC, LPARAM]
user32.EnumChildWindows.argtypes = [wt.HWND, WNDENUMPROC, LPARAM]
user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
user32.GetMenu.restype = wt.HMENU
user32.GetMenu.argtypes = [wt.HWND]
user32.GetSubMenu.restype = wt.HMENU
user32.GetSubMenu.argtypes = [wt.HMENU, ctypes.c_int]
user32.GetMenuItemCount.argtypes = [wt.HMENU]
user32.GetMenuItemID.argtypes = [wt.HMENU, ctypes.c_int]
user32.GetMenuItemID.restype = wt.UINT
user32.GetMenuStringW.argtypes = [wt.HMENU, wt.UINT, wt.LPWSTR, ctypes.c_int, wt.UINT]
user32.GetMenuState.argtypes = [wt.HMENU, wt.UINT, wt.UINT]
user32.GetMenuState.restype = wt.UINT
user32.PrintWindow.argtypes = [wt.HWND, wt.HDC, wt.UINT]
user32.GetWindowDC.argtypes = [wt.HWND]
user32.GetWindowDC.restype = wt.HDC
user32.GetDC.argtypes = [wt.HWND]
user32.GetDC.restype = wt.HDC
user32.ReleaseDC.argtypes = [wt.HWND, wt.HDC]
user32.GetParent.restype = wt.HWND
user32.GetParent.argtypes = [wt.HWND]
user32.GetAncestor.restype = wt.HWND
user32.GetAncestor.argtypes = [wt.HWND, wt.UINT]
user32.GetWindow.restype = wt.HWND
user32.GetWindow.argtypes = [wt.HWND, wt.UINT]
user32.GetDlgCtrlID.argtypes = [wt.HWND]
user32.GetDlgItem.restype = wt.HWND
user32.GetDlgItem.argtypes = [wt.HWND, ctypes.c_int]
user32.IsWindowVisible.argtypes = [wt.HWND]
user32.IsWindowEnabled.argtypes = [wt.HWND]
user32.IsWindow.argtypes = [wt.HWND]
user32.GetClassNameW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
user32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.GetClientRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.MapWindowPoints.argtypes = [wt.HWND, wt.HWND, ctypes.POINTER(wt.POINT), wt.UINT]
user32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]
user32.GetWindowLongW.argtypes = [wt.HWND, ctypes.c_int]
user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
gdi32.CreateCompatibleDC.restype = wt.HDC
gdi32.CreateCompatibleDC.argtypes = [wt.HDC]
gdi32.CreateCompatibleBitmap.restype = wt.HBITMAP
gdi32.CreateCompatibleBitmap.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int]
gdi32.SelectObject.restype = wt.HGDIOBJ
gdi32.SelectObject.argtypes = [wt.HDC, wt.HGDIOBJ]
gdi32.DeleteObject.argtypes = [wt.HGDIOBJ]
gdi32.DeleteDC.argtypes = [wt.HDC]
gdi32.BitBlt.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.HDC, ctypes.c_int, ctypes.c_int, wt.DWORD]
gdi32.GetDIBits.argtypes = [wt.HDC, wt.HBITMAP, wt.UINT, wt.UINT, ctypes.c_void_p, ctypes.c_void_p, wt.UINT]
kernel32.OpenProcess.restype = wt.HANDLE
kernel32.VirtualAllocEx.restype = ctypes.c_void_p
kernel32.VirtualAllocEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, wt.DWORD]
kernel32.VirtualFreeEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD]
kernel32.ReadProcessMemory.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
kernel32.WriteProcessMemory.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
kernel32.TerminateProcess.argtypes = [wt.HANDLE, wt.UINT]
kernel32.WaitForSingleObject.argtypes = [wt.HANDLE, wt.DWORD]
kernel32.WaitForInputIdle = user32.WaitForInputIdle
user32.WaitForInputIdle.argtypes = [wt.HANDLE, wt.DWORD]
user32.AttachThreadInput.argtypes = [wt.DWORD, wt.DWORD, wt.BOOL]
user32.SetKeyboardState.argtypes = [ctypes.c_void_p]
user32.GetKeyboardState.argtypes = [ctypes.c_void_p]
user32.GetFocus.restype = wt.HWND
user32.SetFocus.restype = wt.HWND
user32.SetFocus.argtypes = [wt.HWND]
user32.SetForegroundWindow.argtypes = [wt.HWND]
user32.GetSysColor.argtypes = [ctypes.c_int]

# ---------------------------------------------------------------- constants
WM_SETTEXT, WM_GETTEXT, WM_GETTEXTLENGTH = 0x000C, 0x000D, 0x000E
WM_CLOSE, WM_COMMAND, WM_NOTIFY = 0x0010, 0x0111, 0x004E
WM_KEYDOWN, WM_KEYUP, WM_CHAR, WM_SYSKEYDOWN = 0x0100, 0x0101, 0x0102, 0x0104
WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_LBUTTONDBLCLK = 0x0200, 0x0201, 0x0202, 0x0203
WM_RBUTTONDOWN, WM_RBUTTONUP, WM_MBUTTONDOWN = 0x0204, 0x0205, 0x0207
WM_MOUSEWHEEL, WM_HSCROLL, WM_VSCROLL = 0x020A, 0x0114, 0x0115
WM_GETFONT = 0x0031
WM_SYSCOMMAND = 0x0112
WM_INITMENUPOPUP = 0x0117
WM_CONTEXTMENU = 0x007B
MK_LBUTTON, MK_RBUTTON, MK_SHIFT, MK_CONTROL = 1, 2, 4, 8
BM_CLICK, BM_GETCHECK, BM_SETCHECK = 0x00F5, 0x00F0, 0x00F1
CB_GETCOUNT, CB_GETCURSEL, CB_SETCURSEL, CB_GETLBTEXT, CB_GETLBTEXTLEN = 0x0146, 0x0147, 0x014E, 0x0148, 0x0149
CB_SHOWDROPDOWN = 0x014F
CBN_SELCHANGE, CBN_CLOSEUP = 1, 8
LB_GETCOUNT, LB_GETTEXT, LB_GETTEXTLEN, LB_GETCURSEL, LB_SETCURSEL = 0x018B, 0x0189, 0x018A, 0x0188, 0x0186
LBN_SELCHANGE, LBN_DBLCLK = 1, 2
EN_CHANGE = 0x0300
MF_BYPOSITION = 0x400
MF_CHECKED, MF_GRAYED, MF_DISABLED, MF_POPUP, MF_SEPARATOR = 0x8, 0x1, 0x2, 0x10, 0x800
PW_CLIENTONLY, PW_RENDERFULLCONTENT = 1, 2
SRCCOPY = 0x00CC0020
GW_OWNER, GA_ROOT = 4, 2
TV_FIRST = 0x1100
TVM_GETNEXTITEM, TVM_SELECTITEM, TVM_GETITEMW, TVM_GETCOUNT, TVM_EXPAND, TVM_ENSUREVISIBLE = TV_FIRST + 10, TV_FIRST + 11, TV_FIRST + 62, TV_FIRST + 5, TV_FIRST + 2, TV_FIRST + 20
TVM_GETITEMRECT = TV_FIRST + 4
TVGN_ROOT, TVGN_NEXT, TVGN_CHILD, TVGN_CARET = 0, 1, 4, 9
TVIF_TEXT, TVIF_HANDLE, TVIF_STATE, TVIF_CHILDREN = 1, 0x10, 8, 0x40
TCM_FIRST = 0x1300
TCM_GETITEMCOUNT, TCM_GETITEMW, TCM_GETCURSEL, TCM_SETCURSEL, TCM_GETITEMRECT, TCM_SETCURFOCUS = TCM_FIRST + 4, TCM_FIRST + 60, TCM_FIRST + 11, TCM_FIRST + 12, TCM_FIRST + 10, TCM_FIRST + 48
TCIF_TEXT = 1
TTM_GETTEXTW = 0x0400 + 56
TB_BUTTONCOUNT, TB_GETBUTTON, TB_GETITEMRECT, TB_GETBUTTONTEXTW = 0x0418, 0x0417, 0x041D, 0x044B
TB_GETTOOLTIPS = 0x0423
SB_GETPARTS, SB_GETTEXTW, SB_GETTEXTLENGTHW = 0x0406, 0x040D, 0x040C
UDM_GETPOS32, UDM_SETPOS32, UDM_GETRANGE32 = 0x0472, 0x0471, 0x0470
TBM_GETPOS = 0x0400
DESKTOP_ALL = 0x01FF
STARTF_USESHOWWINDOW = 1


def _cls(h: int) -> str:
    b = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(h, b, 256)
    return b.value


def _text(h: int) -> str:
    """WM_GETTEXT with a timeout (works across processes, also for edits)."""
    n = ctypes.c_size_t()
    if not user32.SendMessageTimeoutW(h, WM_GETTEXTLENGTH, 0, 0, 2, 2000, ctypes.byref(n)):
        return ""
    ln = int(n.value) + 1
    if ln > 1 << 20:
        ln = 1 << 20
    b = ctypes.create_unicode_buffer(ln + 1)
    user32.SendMessageTimeoutW(h, WM_GETTEXT, ln, ctypes.cast(b, ctypes.c_void_p).value, 2, 2000, ctypes.byref(n))
    return b.value


def _rect(h: int) -> tuple[int, int, int, int]:
    r = wt.RECT()
    user32.GetWindowRect(h, ctypes.byref(r))
    return (r.left, r.top, r.right, r.bottom)


def _crect(h: int) -> tuple[int, int, int, int]:
    r = wt.RECT()
    user32.GetClientRect(h, ctypes.byref(r))
    return (r.left, r.top, r.right, r.bottom)


def MAKELPARAM(lo: int, hi: int) -> int:
    return ((hi & 0xFFFF) << 16) | (lo & 0xFFFF)


@dataclass
class Ctrl:
    hwnd: int
    cls: str
    text: str
    id: int
    rect: tuple  # relative to top-level window's left/top (screen-rect based)
    visible: bool
    enabled: bool
    depth: int
    children: list = field(default_factory=list)

    def line(self) -> str:
        x, y, r, b = self.rect
        flags = ("" if self.visible else " hidden") + ("" if self.enabled else " disabled")
        t = self.text.replace("\r", "\\r").replace("\n", "\\n")
        if len(t) > 80:
            t = t[:77] + "..."
        return f"{'  ' * self.depth}{self.cls} id={self.id} [{x},{y} {r - x}x{b - y}]{flags} \"{t}\" hwnd={self.hwnd:#x}"


class RemoteMem:
    """Memory block inside the AdvanceMap process (for common-control messages)."""

    def __init__(self, hproc, size: int = 4096):
        self.hproc, self.size = hproc, size
        self.addr = kernel32.VirtualAllocEx(hproc, None, size, 0x3000, 0x04)
        if not self.addr:
            raise ctypes.WinError(ctypes.get_last_error())

    def write(self, data: bytes, off: int = 0):
        n = ctypes.c_size_t()
        buf = ctypes.create_string_buffer(data, len(data))
        kernel32.WriteProcessMemory(self.hproc, self.addr + off, buf, len(data), ctypes.byref(n))

    def read(self, size: int, off: int = 0) -> bytes:
        n = ctypes.c_size_t()
        buf = ctypes.create_string_buffer(size)
        kernel32.ReadProcessMemory(self.hproc, self.addr + off, buf, size, ctypes.byref(n))
        return buf.raw

    def free(self):
        if self.addr:
            kernel32.VirtualFreeEx(self.hproc, self.addr, 0, 0x8000)
            self.addr = None


class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [("hProcess", wt.HANDLE), ("hThread", wt.HANDLE), ("dwProcessId", wt.DWORD), ("dwThreadId", wt.DWORD)]


class STARTUPINFOW(ctypes.Structure):
    _fields_ = [("cb", wt.DWORD), ("lpReserved", wt.LPWSTR), ("lpDesktop", wt.LPWSTR), ("lpTitle", wt.LPWSTR),
                ("dwX", wt.DWORD), ("dwY", wt.DWORD), ("dwXSize", wt.DWORD), ("dwYSize", wt.DWORD),
                ("dwXCountChars", wt.DWORD), ("dwYCountChars", wt.DWORD), ("dwFillAttribute", wt.DWORD),
                ("dwFlags", wt.DWORD), ("wShowWindow", wt.WORD), ("cbReserved2", wt.WORD),
                ("lpReserved2", ctypes.c_void_p), ("hStdInput", wt.HANDLE), ("hStdOutput", wt.HANDLE), ("hStdError", wt.HANDLE)]


kernel32.CreateProcessW.argtypes = [wt.LPCWSTR, wt.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, wt.BOOL, wt.DWORD,
                                    ctypes.c_void_p, wt.LPCWSTR, ctypes.POINTER(STARTUPINFOW), ctypes.POINTER(PROCESS_INFORMATION)]


class AM:
    """One AdvanceMap instance on a private hidden desktop."""

    def __init__(self, desktop_name: str | None = None, hidden: bool = True,
                 am_dir: str | os.PathLike | None = None, shots: str | os.PathLike | None = None,
                 mute: bool = True):
        self.hidden = hidden
        # 起動した AdvanceMap の中の音を鳴らす関数（MessageBeep・PlaySound など）を無効にする（mute.py）。既定で有効
        self.mute = mute and os.environ.get("ZZM_AM_SOUND") != "1"
        self.muter = None
        self.am_dir = pathlib.Path(am_dir) if am_dir else AM_DIR
        self.shots = pathlib.Path(shots) if shots else SHOTS
        self.desktop_name = desktop_name or f"ZZM_AM_{os.getpid()}"
        self.hdesk = None
        self.orig_desk = user32.GetThreadDesktop(kernel32.GetCurrentThreadId())
        self.pi = None
        self.pid = 0
        self.main = 0
        self.log: list[str] = []

    # ------------------------------------------------------------ lifecycle
    def start(self, rom: str | os.PathLike | None = ROM_WORK, wait: float = 20.0):
        # forget per-process caches from a previous run (process handle, VCL property name)
        self._hp = None
        self.__dict__.pop("_ctlprop", None)
        if self.hidden and not self.hdesk:
            self.hdesk = user32.CreateDesktopW(self.desktop_name, None, None, 0, DESKTOP_ALL | 0x000F0000, None)
            if not self.hdesk:
                raise ctypes.WinError(ctypes.get_last_error())
            if not user32.SetThreadDesktop(self.hdesk):
                raise ctypes.WinError(ctypes.get_last_error())
        si = STARTUPINFOW()
        si.cb = ctypes.sizeof(si)
        if self.hidden:
            si.lpDesktop = "WinSta0\\" + self.desktop_name
        cmd = f'"{self.am_dir / "AdvanceMap.exe"}"' + (f' "{rom}"' if rom else "")
        pi = PROCESS_INFORMATION()
        ok = kernel32.CreateProcessW(None, ctypes.create_unicode_buffer(cmd), None, None, False, 0, None,
                                     str(self.am_dir), ctypes.byref(si), ctypes.byref(pi))
        if not ok:
            raise ctypes.WinError(ctypes.get_last_error())
        self.pi, self.pid = pi, pi.dwProcessId
        user32.WaitForInputIdle(pi.hProcess, 10000)
        if self.mute:
            self.silence()
        t0 = time.time()
        while time.time() - t0 < wait:
            m = self.find_main()
            if m:
                self.main = m
                break
            time.sleep(0.2)
        return self

    def silence(self) -> list[str]:
        """このプロセスの音を鳴らす関数を無効にする（まだのものだけ）。書き換えた関数の名前を返す。"""
        from mute import Muter
        if self.muter is None or self.muter.pid != self.pid:
            if self.muter:
                self.muter.close()
            self.muter = Muter(self.pid)
        done = self.muter.mute()
        if done:
            self.log.append("音を止めた: " + ", ".join(done))
        return done

    def sound_counts(self) -> dict[str, int]:
        """無効にした関数が呼ばれた回数（鳴らずに済んだ回数）。"""
        return self.muter.counts() if self.muter else {}

    def alive(self) -> bool:
        return bool(self.pi) and kernel32.WaitForSingleObject(self.pi.hProcess, 0) == 0x102

    def kill(self):
        """Terminate only the AdvanceMap process this object started."""
        if self.pi and self.alive():
            kernel32.TerminateProcess(self.pi.hProcess, 1)
            kernel32.WaitForSingleObject(self.pi.hProcess, 5000)
        self.main = 0

    def close(self, timeout: float = 5.0):
        if self.alive():
            for w in self.windows():
                pass
            if self.main:
                user32.PostMessageW(self.main, WM_CLOSE, 0, 0)
            t0 = time.time()
            while self.alive() and time.time() - t0 < timeout:
                self.dismiss_dialogs(button_pref=("いいえ", "&No", "No", "OK"))
                time.sleep(0.3)
        self.kill()

    def shutdown(self):
        """Kill AdvanceMap and destroy the hidden desktop."""
        self.kill()
        if self.hdesk:
            user32.SetThreadDesktop(self.orig_desk)
            user32.CloseDesktop(self.hdesk)
            self.hdesk = None

    def restart(self, rom=ROM_WORK):
        self.kill()
        time.sleep(0.5)
        return self.start(rom)

    # ------------------------------------------------------------ windows
    def windows(self, visible_only: bool = True) -> list[int]:
        """Top-level windows of the AdvanceMap process on our desktop."""
        out = []

        def cb(h, _):
            pid = wt.DWORD()
            user32.GetWindowThreadProcessId(h, ctypes.byref(pid))
            if pid.value == self.pid and (not visible_only or user32.IsWindowVisible(h)):
                out.append(h)
            return True

        if self.hdesk:
            user32.EnumDesktopWindows(self.hdesk, WNDENUMPROC(cb), 0)
        else:
            user32.EnumWindows(WNDENUMPROC(cb), 0)
        return out

    def describe(self, h) -> str:
        x, y, r, b = _rect(h)
        return f"{h:#x} {_cls(h)} \"{_text(h)}\" [{x},{y} {r - x}x{b - y}]"

    def find_main(self) -> int:
        for h in self.windows():
            if _cls(h) in ("TAMMainForm", "TForm1") or (_text(h).startswith("Advance") and _cls(h).startswith("TForm")):
                return h
        return 0

    def find_window(self, title: str | None = None, cls: str | None = None, exclude=(), timeout: float = 0.0) -> int:
        t0 = time.time()
        while True:
            for h in self.windows():
                if h in exclude:
                    continue
                if title is not None and title not in _text(h):
                    continue
                if cls is not None and _cls(h) != cls:
                    continue
                return h
            if time.time() - t0 >= timeout:
                return 0
            time.sleep(0.15)

    def dialogs(self) -> list[int]:
        return [h for h in self.windows() if _cls(h) == "#32770" or (h != self.main and _cls(h) not in ("TApplication",))]

    def wait_new_window(self, before: list[int], timeout: float = 5.0) -> int:
        t0 = time.time()
        while time.time() - t0 < timeout:
            for h in self.windows():
                if h not in before and _cls(h) not in ("TApplication", "tooltips_class32", "TPUtilWindow"):
                    return h
            time.sleep(0.1)
        return 0

    # ------------------------------------------------------------ controls
    def tree(self, top: int | None = None) -> Ctrl:
        top = top or self.main
        ox, oy, _, _ = _rect(top)

        def mk(h, d):
            x, y, r, b = _rect(h)
            return Ctrl(h, _cls(h), _text(h), user32.GetDlgCtrlID(h), (x - ox, y - oy, r - ox, b - oy),
                        bool(user32.IsWindowVisible(h)), bool(user32.IsWindowEnabled(h)), d)

        root = mk(top, 0)

        def rec(node):
            kids = []

            def cb(h, _):
                if user32.GetParent(h) == node.hwnd:
                    kids.append(h)
                return True

            user32.EnumChildWindows(node.hwnd, WNDENUMPROC(cb), 0)
            for h in kids:
                c = mk(h, node.depth + 1)
                node.children.append(c)
                rec(c)

        rec(root)
        return root

    def tree_text(self, top: int | None = None) -> str:
        lines = []

        def walk(n):
            lines.append(n.line())
            for c in n.children:
                walk(c)

        walk(self.tree(top))
        return "\n".join(lines)

    def flat(self, top: int | None = None) -> list[Ctrl]:
        out = []

        def walk(n):
            out.append(n)
            for c in n.children:
                walk(c)

        walk(self.tree(top))
        return out

    def find_ctrl(self, top=None, cls=None, text=None, visible=True, index=0, pred=None) -> int:
        hits = [c for c in self.flat(top) if (cls is None or c.cls == cls) and (text is None or text in c.text)
                and (not visible or c.visible) and (pred is None or pred(c))]
        return hits[index].hwnd if len(hits) > index else 0

    # ------------------------------------------------------------ input
    def post(self, h, msg, wp=0, lp=0):
        user32.PostMessageW(h, msg, wp, lp)

    def send(self, h, msg, wp=0, lp=0, timeout_ms=3000) -> int:
        r = ctypes.c_size_t()
        user32.SendMessageTimeoutW(h, msg, wp, lp, 2, timeout_ms, ctypes.byref(r))
        return r.value

    def click_button(self, h, wait=0.3):
        """BM_CLICK via PostMessage (does not block if a modal dialog opens)."""
        self.post(h, BM_CLICK)
        time.sleep(wait)

    def click(self, h, x, y, button="left", keys=0, double=False, wait=0.15):
        """Client-coordinate click via posted mouse messages. keys: MK_SHIFT|MK_CONTROL."""
        lp = MAKELPARAM(x, y)
        down, up, mk = (WM_LBUTTONDOWN, WM_LBUTTONUP, MK_LBUTTON) if button == "left" else (WM_RBUTTONDOWN, WM_RBUTTONUP, MK_RBUTTON)
        self.post(h, WM_MOUSEMOVE, keys, lp)
        self.post(h, down, mk | keys, lp)
        self.post(h, up, keys, lp)
        if double:
            self.post(h, WM_LBUTTONDBLCLK, mk | keys, lp)
            self.post(h, up, keys, lp)
        time.sleep(wait)
        self.idle()

    def drag(self, h, x0, y0, x1, y1, button="left", keys=0, steps=8, wait=0.15):
        down, up, mk = (WM_LBUTTONDOWN, WM_LBUTTONUP, MK_LBUTTON) if button == "left" else (WM_RBUTTONDOWN, WM_RBUTTONUP, MK_RBUTTON)
        self.post(h, WM_MOUSEMOVE, keys, MAKELPARAM(x0, y0))
        self.post(h, down, mk | keys, MAKELPARAM(x0, y0))
        for i in range(1, steps + 1):
            x = x0 + (x1 - x0) * i // steps
            y = y0 + (y1 - y0) * i // steps
            self.post(h, WM_MOUSEMOVE, mk | keys, MAKELPARAM(x, y))
            time.sleep(0.01)
        self.post(h, up, keys, MAKELPARAM(x1, y1))
        time.sleep(wait)
        self.idle()

    def key(self, h, vk, ctrl=False, shift=False, alt=False, wait=0.1):
        """Posted key press. Ctrl/Shift are applied through the target thread's
        keyboard state (AttachThreadInput + SetKeyboardState) so VCL's
        GetKeyState() sees them. This only touches the hidden desktop's input
        queue, not the user's keyboard."""
        mods = [(0x11, ctrl), (0x10, shift), (0x12, alt)]
        need = any(m for _, m in mods)
        if need:
            self._set_mods({vk_: on for vk_, on in mods})
        if alt:
            self.post(h, WM_SYSKEYDOWN, vk, 1 | (1 << 29))
        else:
            self.post(h, WM_KEYDOWN, vk, 1)
        self.post(h, WM_KEYUP, vk, 1 | (3 << 30))
        time.sleep(wait)
        self.idle()
        if need:
            self._set_mods({0x11: False, 0x10: False, 0x12: False})

    def _set_mods(self, mods: dict):
        tid = user32.GetWindowThreadProcessId(self.main, None)
        me = kernel32.GetCurrentThreadId()
        if user32.AttachThreadInput(me, tid, True):
            ks = (ctypes.c_ubyte * 256)()
            user32.GetKeyboardState(ks)
            for vk, on in mods.items():
                ks[vk] = 0x80 if on else 0
                lr = {0x11: (0xA2, 0xA3), 0x10: (0xA0, 0xA1), 0x12: (0xA4, 0xA5)}[vk]
                ks[lr[0]] = 0x80 if on else 0
            user32.SetKeyboardState(ks)
            user32.AttachThreadInput(me, tid, False)

    def type_text(self, h, s: str, wait=0.05):
        for ch in s:
            self.post(h, WM_CHAR, ord(ch), 1)
        time.sleep(wait)
        self.idle()

    def set_text(self, h, s: str, notify=True):
        """WM_SETTEXT with a timeout (the Edit itself notifies EN_CHANGE, so VCL OnChange fires)."""
        # Timeouts everywhere: an OnChange handler may open a modal warning box,
        # which would otherwise block this thread together with AdvanceMap.
        b = ctypes.create_unicode_buffer(s)
        r = ctypes.c_size_t()
        user32.SendMessageTimeoutW(h, WM_SETTEXT, 0, ctypes.cast(b, ctypes.c_void_p).value, 2, 3000, ctypes.byref(r))
        # An Edit control already sends EN_CHANGE to its parent on WM_SETTEXT,
        # so VCL OnChange fires once. `notify` is kept for compatibility only.
        time.sleep(0.1)
        self.idle(1000)

    def get_text(self, h) -> str:
        return _text(h)

    def check(self, h) -> int:
        return self.send(h, BM_GETCHECK)

    # ------------------------------------------------------------ combo/list
    def combo_items(self, h) -> list[str]:
        n = self.send(h, CB_GETCOUNT)
        if n > 100000:
            return []
        out = []
        for i in range(n):
            ln = self.send(h, CB_GETLBTEXTLEN, i)
            b = ctypes.create_unicode_buffer(ln + 2)
            user32.SendMessageW(h, CB_GETLBTEXT, i, ctypes.cast(b, ctypes.c_void_p).value)
            out.append(b.value)
        return out

    def combo_sel(self, h) -> int:
        r = self.send(h, CB_GETCURSEL)
        return r if r < 1 << 31 else -1

    def combo_select(self, h, index: int):
        """CB_SETCURSEL then CBN_SELCHANGE to the parent (fires VCL OnChange)."""
        self.send(h, CB_SETCURSEL, index)
        par = user32.GetParent(h)
        self.send(par, WM_COMMAND, (CBN_SELCHANGE << 16) | (user32.GetDlgCtrlID(h) & 0xFFFF), h)
        self.idle()

    def list_items(self, h) -> list[str]:
        n = self.send(h, LB_GETCOUNT)
        out = []
        for i in range(min(n, 100000)):
            ln = self.send(h, LB_GETTEXTLEN, i)
            b = ctypes.create_unicode_buffer(ln + 2)
            user32.SendMessageW(h, LB_GETTEXT, i, ctypes.cast(b, ctypes.c_void_p).value)
            out.append(b.value)
        return out

    def list_select(self, h, index: int, dbl=False):
        self.send(h, LB_SETCURSEL, index)
        par = user32.GetParent(h)
        self.send(par, WM_COMMAND, (LBN_SELCHANGE << 16) | (user32.GetDlgCtrlID(h) & 0xFFFF), h)
        if dbl:
            self.send(par, WM_COMMAND, (LBN_DBLCLK << 16) | (user32.GetDlgCtrlID(h) & 0xFFFF), h)
        self.idle()

    # ------------------------------------------------------------ remote memory
    def _hproc(self):
        if not hasattr(self, "_hp") or not self._hp:
            self._hp = kernel32.OpenProcess(0x0008 | 0x0010 | 0x0020 | 0x0400, False, self.pid)
        return self._hp

    def remote(self, size=4096) -> RemoteMem:
        return RemoteMem(self._hproc(), size)

    def read_mem(self, addr, size) -> bytes:
        n = ctypes.c_size_t()
        buf = ctypes.create_string_buffer(size)
        kernel32.ReadProcessMemory(self._hproc(), addr, buf, size, ctypes.byref(n))
        return buf.raw[:n.value]

    def vcl_name(self, h) -> str:
        """Delphi component Name of a window (via the VCL 'ControlOfs' window
        property -> TComponent.FName in the AdvanceMap process)."""
        import struct
        if not hasattr(self, "_ctlprop"):
            tid = user32.GetWindowThreadProcessId(self.main, None)
            self._ctlprop = f"ControlOfs{0x400000:08X}{tid:08X}"
            user32.GetPropW.restype = wt.HANDLE
            user32.GetPropW.argtypes = [wt.HWND, wt.LPCWSTR]
        obj = user32.GetPropW(h, self._ctlprop)
        if not obj:
            return ""
        try:
            p = struct.unpack("<I", self.read_mem(obj + 8, 4))[0]
            if not p:
                return ""
            ln = struct.unpack("<I", self.read_mem(p - 4, 4))[0]
            if ln > 200:
                return ""
            return self.read_mem(p, ln).decode("cp932", "replace")
        except Exception:
            return ""

    # Delphi 7 object layout (found empirically in AdvanceMap 1.92):
    #   TComponent: +0 VMT, +4 FOwner, +8 FName, +0xC FTag, +0x10 FComponents(TList)
    #   TControl:   +0x30 FParent, +0x40 Left, +0x44 Top, +0x48 Width, +0x4C Height,
    #               +0x57 Visible, +0x58 Enabled, +0x64 FText (PChar), +0x80 FHint
    #   TList:      +4 items, +8 count;  VMT-44: class name (shortstring)
    def _u32(self, a):
        import struct
        b = self.read_mem(a, 4)
        return struct.unpack("<I", b)[0] if len(b) == 4 else 0

    def _astr(self, p):
        if not p:
            return ""
        ln = self._u32(p - 4)
        return self.read_mem(p, ln).decode("cp932", "replace") if 0 < ln < 4096 else ""

    def _cstr(self, p):
        if not p:
            return ""
        return self.read_mem(p, 512).split(b"\0")[0].decode("cp932", "replace")

    def _clsname(self, obj):
        vmt = self._u32(obj)
        p = self._u32(vmt - 44)
        n = self.read_mem(p, 1)
        return self.read_mem(p + 1, n[0]).decode("ascii", "replace") if n else "?"

    def _is_control(self, obj) -> bool:
        """True if the class derives from TControl (walk VMT parent chain)."""
        vmt = self._u32(obj)
        for _ in range(40):
            p = self._u32(vmt - 44)
            n = self.read_mem(p, 1)
            name = self.read_mem(p + 1, n[0]).decode("ascii", "replace") if n else ""
            if name == "TControl":
                return True
            par = self._u32(vmt - 36)  # vmtParent (pointer to pointer)
            if not par:
                return False
            vmt = self._u32(par)
            if not vmt:
                return False
        return False

    def vcl_dump(self, top=None) -> list[dict]:
        """All components owned (recursively) by a form, with VCL properties read
        from process memory. Works for graphic controls without a window
        (TLabel, TImage, TDXPaintBox, TBevel) and for not-yet-shown pages."""
        top = top or self.main
        self.vcl_name(top)
        objhw = {}
        for c in self.flat(top):
            o = user32.GetPropW(c.hwnd, self._ctlprop)
            if o:
                objhw[o] = c
        root = user32.GetPropW(top, self._ctlprop)
        out, seen = [], set()
        if not root:  # not a VCL form (e.g. a Windows message box)
            return out

        def walk(owner, depth):
            lst = self._u32(owner + 0x10)
            if not lst:
                return
            items, cnt = self._u32(lst + 4), self._u32(lst + 8)
            for i in range(min(cnt, 5000)):
                o = self._u32(items + 4 * i)
                if not o or o in seen:
                    continue
                seen.add(o)
                d = dict(obj=o, cls=self._clsname(o), name=self._astr(self._u32(o + 8)),
                         tag=self._u32(o + 0xC), owner_depth=depth)
                if self._is_control(o):
                    import struct
                    par = self._u32(o + 0x30)
                    l, t, w, h = struct.unpack("<iiii", self.read_mem(o + 0x40, 16))
                    d.update(parent=self._astr(self._u32(par + 8)) if par else "", left=l, top=t, width=w, height=h,
                             visible=bool(self.read_mem(o + 0x57, 1)[0]), enabled=bool(self.read_mem(o + 0x58, 1)[0]),
                             text=self._cstr(self._u32(o + 0x64)), hint=self._astr(self._u32(o + 0x80)))
                    if o in objhw:
                        c = objhw[o]
                        d["hwnd"] = c.hwnd
                        d["text"] = c.text
                        d["wincls"] = c.cls
                out.append(d)
                walk(o, depth + 1)

        walk(root, 0)
        return out

    SKIP_CLS = ("TSpinButton", "TTimerSpeedButton")

    def controls_md(self, top=None, only_visible=False, with_items=True) -> str:
        """Markdown table of all VCL controls of a window: name, class, parent,
        position/size, visible/enabled, caption/text, hint, combo contents."""
        rows = ["| 名前 | クラス | 親 | 位置(x,y) | 大きさ | 表示 | 有効 | 文字列 | ヒント |", "|---|---|---|---|---|---|---|---|---|"]
        combos = []
        for d in self.vcl_dump(top):
            if "left" not in d or d["cls"] in self.SKIP_CLS:
                continue
            if only_visible and not d["visible"]:
                continue
            t = (d.get("text") or "").replace("|", "\\|").replace("\r\n", " ").replace("\n", " ")
            if len(t) > 60:
                t = t[:57] + "..."
            rows.append(f"| {d['name']} | {d['cls']} | {d['parent']} | {d['left']},{d['top']} | {d['width']}x{d['height']} | "
                        f"{'○' if d['visible'] else '×'} | {'○' if d['enabled'] else '×'} | {t} | {d.get('hint', '')} |")
            if with_items and d.get("wincls") == "TComboBox" and d.get("hwnd"):
                items = self.combo_items(d["hwnd"])
                if items:
                    combos.append((d["name"], self.combo_sel(d["hwnd"]), items))
            if with_items and d.get("wincls") == "TListBox" and d.get("hwnd"):
                items = self.list_items(d["hwnd"])
                if items:
                    combos.append((d["name"] + " (list)", -1, items))
        out = "\n".join(rows)
        for name, sel, items in combos:
            out += f"\n\n**{name}** の選択肢（{len(items)}件、選択中 {sel}）:\n\n"
            if len(items) > 40:
                out += "```\n" + "\n".join(f"{i}: {s}" for i, s in enumerate(items)) + "\n```"
            else:
                out += "\n".join(f"- {i}: {s}" for i, s in enumerate(items))
        return out

    def shown(self, obj) -> bool:
        """True if the control and all its parents have Visible set (the control is on screen:
        a hidden TTabPage or a hidden panel of the header tab hides everything inside it)."""
        for _ in range(64):
            if not obj:
                return True
            if not self.read_mem(obj + 0x57, 1)[:1] == b"\x01":
                return False
            obj = self._u32(obj + 0x30)
        return True

    def tab_page_of(self, obj) -> tuple[int, int] | None:
        """(notebook hwnd, page index) of the TTabbedNotebook page that holds a control, or None."""
        o = self._u32(obj + 0x30)
        for _ in range(64):
            if not o:
                return None
            if self._clsname(o) == "TTabPage":
                nb = self._u32(o + 0x30)
                dump = self.vcl_dump()
                hw = next((d.get("hwnd") for d in dump if d["obj"] == nb), 0)
                pages = [d["obj"] for d in dump if d.get("cls") == "TTabPage" and self._u32(d["obj"] + 0x30) == nb]
                return (hw, pages.index(o)) if hw and o in pages else None
            o = self._u32(o + 0x30)
        return None

    def comp(self, name: str, top=None, parent: str | None = None) -> dict:
        """One component's live properties by Delphi name (see vcl_dump).
        Several controls can share a name (the event frames all have Txt_PosX, the wild and header tabs
        both have Cbo_Typ): the one on screen wins, then one with a window, then the first."""
        tops = [top] if top else [self.main] + [w for w in self.windows() if w != self.main]
        found = []
        for t in tops:
            for d in self.vcl_dump(t):
                if d["name"] == name and (parent is None or d.get("parent") == parent):
                    d["top_hwnd"] = t
                    found.append(d)
        if not found:
            raise KeyError(name)
        # 表示中のものが複数あれば、フォームが直接持つもの（フレームの中の同名の部品より浅いもの）
        shown = sorted((d for d in found if "left" in d and self.shown(d["obj"])), key=lambda d: d.get("owner_depth", 0))
        if shown:
            return shown[0]
        for d in found:
            if d.get("hwnd"):
                return d
        return found[0]

    def with_page(self, name, fn, top=None):
        """Run fn(comp) with the TTabbedNotebook page that holds `name` shown (VCL creates the
        windows of a page only when it is shown). The previous page is shown again afterwards."""
        d = self.comp(name, top)
        if d.get("hwnd") and self.shown(d["obj"]):
            return fn(d)
        pg = self.tab_page_of(d["obj"])
        if not pg:
            if not d.get("hwnd"):
                raise KeyError(f"{name} is hidden (not on a notebook page; e.g. the other view of the header tab)")
            return fn(d)
        nb, idx = pg
        cur = self.send(nb, TCM_GETCURSEL)
        self.tab_select(nb, idx)
        time.sleep(0.3)
        try:
            d = self.comp(name, top)
            if not d.get("hwnd"):
                raise KeyError(f"{name} has no window even on its page")
            return fn(d)
        finally:
            if cur != idx and cur < 64:
                self.tab_select(nb, cur)
                time.sleep(0.2)

    def _host(self, d: dict):
        """For a (possibly windowless) control: (host hwnd, x offset, y offset)
        so that host-client coords = control coords + offset."""
        if d.get("hwnd"):
            return d["hwnd"], 0, 0
        x, y = d["left"], d["top"]
        o = self._u32(d["obj"] + 0x30)
        top = d.get("top_hwnd") or self.main
        objhw = {user32.GetPropW(c.hwnd, self._ctlprop): c.hwnd for c in self.flat(top)}
        while o and o not in objhw:
            import struct
            l, t = struct.unpack("<ii", self.read_mem(o + 0x40, 8))
            x, y = x + l, y + t
            o = self._u32(o + 0x30)
        return objhw.get(o, 0), x, y

    def click_comp(self, name, x, y, button="left", keys=0, double=False, top=None):
        """Click inside a component (also TImage/TDXPaintBox/TLabel without a window)."""
        h, ox, oy = self._host(self.comp(name, top))
        self.click(h, ox + x, oy + y, button=button, keys=keys, double=double)

    def drag_comp(self, name, x0, y0, x1, y1, button="left", keys=0, top=None):
        h, ox, oy = self._host(self.comp(name, top))
        self.drag(h, ox + x0, oy + y0, ox + x1, oy + y1, button=button, keys=keys)

    def shot_comp(self, shotname, name, top=None, margin=0):
        """Screenshot cropped to one component (windowless ones too)."""
        d = self.comp(name, top)
        topw = d["top_hwnd"]
        h, ox, oy = self._host(d)
        img = self.capture(topw)
        tl = wt.POINT(ox, oy)
        user32.MapWindowPoints(h, 0, ctypes.byref(tl), 1)
        wl, wt_, _, _ = _rect(topw)
        x0, y0 = tl.x - wl, tl.y - wt_
        # clip to the visible part of the host window
        hl, ht, hr, hb = _rect(h)
        box = (max(x0, hl - wl) - margin, max(y0, ht - wt_) - margin,
               min(x0 + d["width"], hr - wl) + margin, min(y0 + d["height"], hb - wt_) + margin)
        if box[2] <= box[0] or box[3] <= box[1]:
            return None  # component is outside its parent's visible area
        p = self.shots / f"{shotname}.png"
        p.parent.mkdir(parents=True, exist_ok=True)
        img.crop(box).save(p)
        return p

    def by_name(self, name: str, top=None) -> int:
        """Find a control by its Delphi component name (e.g. 'Txt_MapBreite')."""
        tops = [top] if top else self.windows()
        for t in tops:
            for c in self.flat(t):
                if self.vcl_name(c.hwnd) == name:
                    return c.hwnd
        return 0

    def names(self, top=None) -> dict:
        """{component name: hwnd} for a top-level window."""
        out = {}
        for c in self.flat(top or self.main):
            n = self.vcl_name(c.hwnd)
            if n:
                out.setdefault(n, c.hwnd)
        return out

    # ------------------------------------------------------------ menus
    def menu_items(self, hmenu=None, path=()) -> list[dict]:
        """Walk the main menu. Returns dicts: path, text, id, checked, grayed, popup."""
        if hmenu is None:
            hmenu = user32.GetMenu(self.main)
        out = []
        n = user32.GetMenuItemCount(hmenu)
        for i in range(n):
            b = ctypes.create_unicode_buffer(512)
            user32.GetMenuStringW(hmenu, i, b, 512, MF_BYPOSITION)
            st = user32.GetMenuState(hmenu, i, MF_BYPOSITION)
            sub = user32.GetSubMenu(hmenu, i)
            mid = user32.GetMenuItemID(hmenu, i)
            item = dict(path=path + (b.value,), text=b.value, id=(None if sub else mid), pos=i,
                        checked=bool(st & MF_CHECKED), grayed=bool(st & (MF_GRAYED | MF_DISABLED)),
                        separator=bool(st & MF_SEPARATOR) and not sub, popup=bool(sub))
            out.append(item)
            if sub:
                out.extend(self.menu_items(sub, path + (b.value,)))
        return out

    def refresh_menu_states(self):
        """Ask VCL to update check/enable states (it does so on WM_INITMENUPOPUP)."""
        hm = user32.GetMenu(self.main)
        for i in range(user32.GetMenuItemCount(hm)):
            sub = user32.GetSubMenu(hm, i)
            if sub:
                self.send(self.main, WM_INITMENUPOPUP, sub, i)

    @staticmethod
    def _norm(s: str) -> str:
        s = s.split("\t")[0].replace("&", "")
        import re
        return re.sub(r"\(\w\)$", "", s).strip()

    def menu(self, *path: str, post=True, wait=0.5, hwnd=None) -> int:
        """Run a main-menu command by its label path, e.g. am.menu('ファイル', 'ROMを開く').
        Labels are compared without '&', accelerator text and '(X)'. `hwnd`: another form's menu bar."""
        want = tuple(self._norm(p) for p in path)
        win = hwnd or self.main
        for it in self.menu_items(user32.GetMenu(win)):
            if tuple(self._norm(p) for p in it["path"]) == want and it["id"] is not None:
                (self.post if post else self.send)(win, WM_COMMAND, it["id"], 0)
                time.sleep(wait)
                return it["id"]
        raise KeyError(path)

    def popup_menus(self) -> list[int]:
        """Visible popup menu windows (#32768) on our desktop."""
        out = []

        def cb(h, _):
            if _cls(h) == "#32768" and user32.IsWindowVisible(h):
                out.append(h)
            return True

        user32.EnumDesktopWindows(self.hdesk, WNDENUMPROC(cb), 0) if self.hdesk else user32.EnumWindows(WNDENUMPROC(cb), 0)
        return out

    # ------------------------------------------------------------ treeview
    def tv_items(self, htv) -> list[dict]:
        """All items of a SysTreeView32: dict(hitem, text, depth, parent)."""
        rm = self.remote(4096)
        try:
            out = []

            def get_text(hitem):
                # TVITEMW (64-bit target? AdvanceMap is 32-bit) -> use 32-bit layout
                import struct
                textaddr = rm.addr + 256
                tv = struct.pack("<IIIIIiiiiI", TVIF_TEXT | TVIF_HANDLE | TVIF_CHILDREN, hitem, 0, 0, textaddr, 260, 0, 0, 0, 0)
                rm.write(tv)
                self.send(htv, TVM_GETITEMW, 0, rm.addr)
                raw = rm.read(520, 256)
                ch = struct.unpack("<IIIIIiiiiI", rm.read(40))[8]
                return raw.decode("utf-16-le", "replace").split("\x00")[0], ch

            def walk(h, depth, parent):
                while h:
                    t, ch = get_text(h)
                    out.append(dict(hitem=h, text=t, depth=depth, parent=parent, children=ch))
                    c = self.send(htv, TVM_GETNEXTITEM, TVGN_CHILD, h)
                    if c:
                        walk(c, depth + 1, h)
                    h = self.send(htv, TVM_GETNEXTITEM, TVGN_NEXT, h)

            walk(self.send(htv, TVM_GETNEXTITEM, TVGN_ROOT, 0), 0, 0)
            return out
        finally:
            rm.free()

    def tv_select(self, htv, hitem, dblclick=False):
        """Select a tree item; VCL gets TVN_SELCHANGED from the control itself.
        With dblclick, a posted double click at the item's rectangle is sent."""
        self.send(htv, TVM_ENSUREVISIBLE, 0, hitem)
        self.send(htv, TVM_SELECTITEM, TVGN_CARET, hitem)
        self.idle()
        if dblclick:
            r = self.tv_item_rect(htv, hitem)
            if r:
                x, y = (r[0] + r[2]) // 2, (r[1] + r[3]) // 2
                self.click(htv, x, y)
                self.click(htv, x, y, double=True)

    def tv_item_rect(self, htv, hitem):
        import struct
        rm = self.remote(64)
        try:
            rm.write(struct.pack("<I", hitem))
            ok = self.send(htv, TVM_GETITEMRECT, 1, rm.addr)
            return struct.unpack("<iiii", rm.read(16)) if ok else None
        finally:
            rm.free()

    # ------------------------------------------------------------ tab control
    def tabs(self, htab) -> list[str]:
        import struct
        n = self.send(htab, TCM_GETITEMCOUNT)
        rm = self.remote(1024)
        out = []
        try:
            for i in range(n):
                rm.write(struct.pack("<IIIIiii", TCIF_TEXT, 0, 0, rm.addr + 64, 200, 0, 0))
                self.send(htab, TCM_GETITEMW, i, rm.addr)
                out.append(rm.read(400, 64).decode("utf-16-le", "replace").split("\x00")[0])
        finally:
            rm.free()
        return out

    def tab_rect(self, htab, i):
        import struct
        rm = self.remote(64)
        try:
            self.send(htab, TCM_GETITEMRECT, i, rm.addr)
            return struct.unpack("<iiii", rm.read(16))
        finally:
            rm.free()

    def tab_select(self, htab, index_or_text):
        """Switch tabs by a posted click on the tab header (VCL sees the normal
        TCN_SELCHANGING/TCN_SELCHANGE notifications)."""
        import struct
        i = index_or_text
        if isinstance(i, str):
            i = [k for k, t in enumerate(self.tabs(htab)) if index_or_text in t][0]
        # 1) posted click on the tab header (what a user does; VCL switches the page)
        l, t, r, b = self.tab_rect(htab, i)
        self.click(htab, (l + r) // 2, (t + b) // 2, wait=0.3)
        if self.send(htab, TCM_GETCURSEL) == i:
            return True
        # 2) fallback: TCN_SELCHANGING / TCM_SETCURSEL / TCN_SELCHANGE notifications
        par = user32.GetParent(htab)
        cid = user32.GetDlgCtrlID(htab)
        rm = self.remote(64)
        try:
            rm.write(struct.pack("<IIi", htab, cid, -552))  # TCN_SELCHANGING
            self.send(par, WM_NOTIFY, cid, rm.addr)
            self.send(htab, TCM_SETCURSEL, i)
            rm.write(struct.pack("<IIi", htab, cid, -551))  # TCN_SELCHANGE
            self.send(par, WM_NOTIFY, cid, rm.addr)
        finally:
            rm.free()
        time.sleep(0.3)
        self.idle()
        return self.send(htab, TCM_GETCURSEL) == i

    # ------------------------------------------------------------ toolbar/status
    def toolbar_buttons(self, htb) -> list[dict]:
        import struct
        n = self.send(htb, TB_BUTTONCOUNT)
        rm = self.remote(1024)
        out = []
        try:
            for i in range(n):
                self.send(htb, TB_GETBUTTON, i, rm.addr)
                bmp, cmd, state, style = struct.unpack("<iiBB", rm.read(10))
                self.send(htb, TB_GETITEMRECT, i, rm.addr + 64)
                r = struct.unpack("<iiii", rm.read(16, 64))
                out.append(dict(index=i, image=bmp, cmd=cmd, state=state, style=style, rect=r))
        finally:
            rm.free()
        return out

    def status_texts(self, hsb) -> list[str]:
        n = self.send(hsb, SB_GETPARTS, 0, 0)
        out = []
        rm = self.remote(4096)
        try:
            for i in range(max(n, 1)):
                ln = self.send(hsb, SB_GETTEXTLENGTHW, i) & 0xFFFF
                self.send(hsb, SB_GETTEXTW, i, rm.addr)
                out.append(rm.read(ln * 2 + 2).decode("utf-16-le", "replace").split("\x00")[0])
        finally:
            rm.free()
        return out

    # ------------------------------------------------------------ waiting
    def idle(self, timeout_ms=3000):
        """Wait until the GUI thread has processed queued messages."""
        if self.main:
            r = ctypes.c_size_t()
            user32.SendMessageTimeoutW(self.main, 0, 0, 0, 2, timeout_ms, ctypes.byref(r))

    def hung(self) -> bool:
        r = ctypes.c_size_t()
        return not user32.SendMessageTimeoutW(self.main, 0, 0, 0, 2, 8000, ctypes.byref(r))

    # ------------------------------------------------------------ dialogs
    def msgboxes(self) -> list[int]:
        return [h for h in self.windows() if _cls(h) == "#32770"]

    def dialog_info(self, h) -> dict:
        texts = [c.text for c in self.flat(h) if c.cls == "Static" and c.text]
        buttons = [c.text for c in self.flat(h) if c.cls == "Button" and c.visible]
        return dict(hwnd=h, title=_text(h), texts=texts, buttons=buttons)

    def press(self, dlg, label: str, wait=0.4) -> bool:
        for c in self.flat(dlg):
            if c.cls in ("Button", "TButton", "TBitBtn") and c.visible and self._norm(c.text) == self._norm(label):
                self.click_button(c.hwnd, wait)
                return True
        return False

    def dismiss_dialogs(self, button_pref=("OK", "はい", "&Yes", "Yes"), log=True) -> list[dict]:
        seen = []
        for h in self.msgboxes():
            info = self.dialog_info(h)
            seen.append(info)
            if log:
                self.log.append(f"dialog: {info}")
            for lbl in button_pref:
                if self.press(h, lbl):
                    break
            else:
                user32.PostMessageW(h, WM_CLOSE, 0, 0)
        return seen

    def file_dialog(self, path: str, timeout=5.0) -> bool:
        """Fill a common Open/Save dialog's file-name box and press OK."""
        t0 = time.time()
        while time.time() - t0 < timeout:
            for h in self.msgboxes():
                edit = user32.GetDlgItem(h, 0x47C)  # cmb13 (combo with edit)
                target = 0
                if edit:
                    target = self.find_ctrl(edit, cls="Edit") or edit
                else:
                    target = user32.GetDlgItem(h, 0x480)  # edt1
                if target:
                    self.set_text(target, str(path), notify=False)
                    time.sleep(0.2)
                    ok = user32.GetDlgItem(h, 1)
                    self.send(h, WM_COMMAND, 1, ok)
                    time.sleep(0.5)
                    return True
            time.sleep(0.2)
        return False

    # ------------------------------------------------------------ screenshots
    def capture(self, h, client=False) -> Image.Image:
        """PrintWindow into a bitmap (works on the hidden desktop)."""
        l, t, r, b = _crect(h) if client else _rect(h)
        w, hh = r - l, b - t
        if w <= 0 or hh <= 0:
            return Image.new("RGB", (1, 1))
        hdc = user32.GetDC(0)
        mdc = gdi32.CreateCompatibleDC(hdc)
        bmp = gdi32.CreateCompatibleBitmap(hdc, w, hh)
        old = gdi32.SelectObject(mdc, bmp)
        ok = user32.PrintWindow(h, mdc, (PW_CLIENTONLY if client else 0) | PW_RENDERFULLCONTENT)
        if not ok:
            user32.PrintWindow(h, mdc, PW_CLIENTONLY if client else 0)
        img = self._bmp_to_image(mdc, bmp, w, hh)
        gdi32.SelectObject(mdc, old)
        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(mdc)
        user32.ReleaseDC(0, hdc)
        return img

    def capture_dc(self, h) -> Image.Image:
        """BitBlt from the window's own DC (fallback; content must be painted)."""
        l, t, r, b = _rect(h)
        w, hh = r - l, b - t
        wdc = user32.GetWindowDC(h)
        mdc = gdi32.CreateCompatibleDC(wdc)
        bmp = gdi32.CreateCompatibleBitmap(wdc, w, hh)
        old = gdi32.SelectObject(mdc, bmp)
        gdi32.BitBlt(mdc, 0, 0, w, hh, wdc, 0, 0, SRCCOPY)
        img = self._bmp_to_image(mdc, bmp, w, hh)
        gdi32.SelectObject(mdc, old)
        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(mdc)
        user32.ReleaseDC(h, wdc)
        return img

    @staticmethod
    def _bmp_to_image(mdc, bmp, w, h) -> Image.Image:
        import struct
        bih = struct.pack("<IiiHHIIiiII", 40, w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
        hdr = ctypes.create_string_buffer(bih, 44 + 1024)
        buf = ctypes.create_string_buffer(w * h * 4)
        gdi32.GetDIBits(mdc, bmp, 0, h, buf, hdr, 0)
        return Image.frombuffer("RGB", (w, h), buf.raw, "raw", "BGRX", 0, 1)

    def shot(self, name: str, h=None, crop_ctrl=None, client=False) -> pathlib.Path:
        """Save a PNG under shots/<name>.png. crop_ctrl: crop to a child control."""
        h = h or self.main
        img = self.capture(h, client=client)
        if crop_ctrl:
            ox, oy, _, _ = _rect(h)
            x, y, r, b = _rect(crop_ctrl)
            img = img.crop((x - ox, y - oy, r - ox, b - oy))
        p = self.shots / f"{name}.png"
        p.parent.mkdir(parents=True, exist_ok=True)
        img.save(p)
        return p

    def shot_ctrl(self, name: str, h) -> pathlib.Path:
        """Screenshot one control (own PrintWindow, falls back to cropping its top window)."""
        top = user32.GetAncestor(h, GA_ROOT)
        return self.shot(name, top, crop_ctrl=h)

    # ------------------------------------------------------------ geometry
    def to_client(self, h, sx, sy):
        p = wt.POINT(sx, sy)
        user32.MapWindowPoints(0, h, ctypes.byref(p), 1)
        return p.x, p.y

    def move_window(self, h, x, y, w=None, hgt=None):
        l, t, r, b = _rect(h)
        user32.SetWindowPos(h, 0, x, y, w or (r - l), hgt or (b - t), 0x0004 | 0x0010)


    # ============================================================ AdvanceMap-specific
    TABS = {"map": 0, "move": 1, "event": 2, "wild": 3, "header": 4}

    def status(self) -> list[str]:
        return self.status_texts(self.by_name("Status"))

    def notebook(self) -> int:
        return self.by_name("TabbedNotebook1")

    def tab(self, which):
        """which: 0-4, 'map'/'move'/'event'/'wild'/'header' or the Japanese caption."""
        if isinstance(which, str) and which in self.TABS:
            which = self.TABS[which]
        ok = self.tab_select(self.notebook(), which)
        time.sleep(0.3)
        return ok

    def map_items(self) -> list[dict]:
        return self.tv_items(self.by_name("MapList"))

    def select_map(self, bank: int, mapno: int, timeout=5.0) -> bool:
        """Open map bank.map from the map list (same as double-clicking it)."""
        tv = self.by_name("MapList")
        key = f"({bank}.{mapno})"
        its = [i for i in self.tv_items(tv) if i["text"].endswith(key)]
        if not its:
            raise KeyError(key)
        self.tv_select(tv, its[0]["hitem"])
        self.key(tv, 0x0D)  # Enter opens the selected map (selection alone does not)
        want = f"{bank}.{mapno}"
        t0 = time.time()
        tried_dbl = False
        while time.time() - t0 < timeout:
            st = self.status()
            if st and st[0].endswith(want) and "完了" in st[0]:
                return True
            if not tried_dbl and time.time() - t0 > 0.8:
                self.tv_select(tv, its[0]["hitem"], dblclick=True)
                tried_dbl = True
            time.sleep(0.2)
        return False

    def open_rom(self, path=ROM_WORK, timeout=15.0) -> bool:
        """ファイル > ROMを開く, fill the Open dialog, wait for the map list."""
        before = self.windows()
        self.menu("ファイル", "ROMを開く")
        if not self.file_dialog(str(path)):
            return False
        t0 = time.time()
        while time.time() - t0 < timeout:
            st = self.status()
            if st and "ROMの読込完了" in st[0]:
                return True
            time.sleep(0.3)
        return False

    def map_geom(self) -> dict:
        """MapBox geometry: dict(left, top, width, height, block) in ScrollBox1 coords."""
        d = self.comp("MapBox")
        return d

    def _block_px(self, comp, bx, by, block=16):
        return bx * block + block // 2, by * block + block // 2

    def map_click(self, bx, by, button="left", keys=0, comp="MapBox", block=None, double=False):
        """Click block (bx, by) on a map canvas. comp: MapBox (マップ), GehBox (移動エリア),
        EventBox (イベント). block = pixel size of one block (16, or 32 when zoomed)."""
        d = self.comp(comp)
        block = block or self._guess_block(comp, d)
        h, ox, oy = self._host(d)
        x, y = self._block_px(d, bx, by, block)
        self.click(h, ox + x, oy + y, button=button, keys=keys, double=double)

    def map_drag(self, b0, b1, button="left", keys=0, comp="MapBox", block=None):
        d = self.comp(comp)
        block = block or self._guess_block(comp, d)
        h, ox, oy = self._host(d)
        x0, y0 = self._block_px(d, *b0, block)
        x1, y1 = self._block_px(d, *b1, block)
        self.drag(h, ox + x0, oy + y0, ox + x1, oy + y1, button=button, keys=keys)

    def _guess_block(self, comp, d):
        try:
            w = int(self.get_text(self.by_name("Txt_MapBreite")) or 0)
        except ValueError:
            w = 0
        if w and d["width"] >= w * 32:
            return 32
        return 16

    def palette_click(self, index, keys=0, button="left", comp="BlockPalette", per_row=8, block=None):
        """Click block number `index` in the block palette (8 per row by default)."""
        d = self.comp(comp)
        block = block or (32 if d["width"] >= per_row * 32 else 16)
        h, ox, oy = self._host(d)
        x = (index % per_row) * block + block // 2
        y = (index // per_row) * block + block // 2
        self.click(h, ox + x, oy + y, button=button, keys=keys)

    def edit(self, name, value=None, top=None) -> str:
        """Read (value=None) or write an input box by Delphi name."""
        def go(d):
            h = d["hwnd"]
            if value is not None:
                self.set_text(h, str(value))
            return self.get_text(h)
        return self.with_page(name, go, top)

    def checkbox(self, name, value=None, top=None) -> bool:
        """Read (value=None) or set a check box / radio button by Delphi name (BM_CLICK fires OnClick)."""
        def go(d):
            h = d["hwnd"]
            if value is not None and bool(self.check(h)) != bool(value):
                self.click_button(h, 0.3)
            return bool(self.check(h))
        return self.with_page(name, go, top)

    def spin(self, name, value: int, top=None) -> str:
        """Set a TSpinEdit like a user: WM_SETTEXT alone does not fire its OnChange in AdvanceMap,
        so put the neighbour value in and press the arrow key (Up/Down) once."""
        def go(d):
            h = d["hwnd"]
            v = int(value)
            if v < 255:
                self.set_text(h, str(v + 1))
                self.key(h, 0x28)  # VK_DOWN
            else:
                self.set_text(h, str(v - 1))
                self.key(h, 0x26)  # VK_UP
            time.sleep(0.2)
            self.idle()
            return self.get_text(h)
        return self.with_page(name, go, top)

    def combo(self, name, select=None, top=None):
        """Return (items, selected index) of a combo by Delphi name; optionally select
        (an int is the position; a str selects the first item containing it)."""
        def go(d):
            h = d["hwnd"]
            if select is not None:
                i = select
                if isinstance(select, str):
                    i = [k for k, t in enumerate(self.combo_items(h)) if select in t][0]
                self.combo_select(h, int(i))
            return self.combo_items(h), self.combo_sel(h)
        return self.with_page(name, go, top)

    def button(self, name, top=None, wait=0.5):
        self.with_page(name, lambda d: self.click_button(d["hwnd"], wait), top)


cls_of, text_of, rect_of, client_rect_of = _cls, _text, _rect, _crect
