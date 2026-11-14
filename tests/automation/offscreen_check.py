"""自動操作で起動したウィンドウが、作られた時点から画面外・非アクティブであることを確かめる。

  python tests/automation/offscreen_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--project <CFRU-JP のフォルダの写し>]

SetWinEventHook でこのプロセスのトップレベルのウィンドウの表示・移動・前面化を全部記録しながら、
起動 → ROM を開く → マップを開く → ワールドマップエディター・ブロックエディタ（とパレットエディタ）を開いて閉じる → 終了 を行い、
（`--project` を渡すと ROM と一緒に開き、大きさを変えられるスクリプトエディタも開いて閉じる。フォルダには書き込まない）
- 見えている状態で、どこかのモニターに少しでも重なった瞬間があるか
- 前面（アクティブ）になった瞬間があるか
を調べる。どちらも無ければ合格（終了コード 0）。
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wt
import os
import pathlib
import sys
import tempfile
import shutil
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

user32 = ctypes.windll.user32
EVENT_SYSTEM_FOREGROUND = 0x0003
EVENT_OBJECT_CREATE = 0x8000
EVENT_OBJECT_SHOW = 0x8002
EVENT_OBJECT_LOCATIONCHANGE = 0x800B
WINEVENT_OUTOFCONTEXT = 0x0000
OBJID_WINDOW = 0
GA_ROOT = 2
WM_QUIT = 0x0012
GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020

WinEventProc = ctypes.WINFUNCTYPE(None, wt.HANDLE, wt.DWORD, wt.HWND, wt.LONG, wt.LONG, wt.DWORD, wt.DWORD)
MonitorEnumProc = ctypes.WINFUNCTYPE(wt.BOOL, wt.HMONITOR, wt.HDC, ctypes.POINTER(wt.RECT), wt.LPARAM)
user32.SetWinEventHook.restype = wt.HANDLE
user32.GetAncestor.restype = wt.HWND


def monitors() -> list[tuple[int, int, int, int]]:
    out = []

    def cb(_h, _dc, r, _p):
        out.append((r.contents.left, r.contents.top, r.contents.right, r.contents.bottom))
        return True

    user32.EnumDisplayMonitors(None, None, MonitorEnumProc(cb), 0)
    return out


def title(hwnd) -> str:
    buf = ctypes.create_unicode_buffer(256)
    user32.GetWindowTextW(hwnd, buf, 256)
    return buf.value


def class_name(hwnd) -> str:
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


class Watcher(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.pids: set[int] = set()
        self.events: list[dict] = []
        self.tid = 0
        self.ready = threading.Event()
        self.mons = monitors()

    def run(self):
        self.tid = ctypes.windll.kernel32.GetCurrentThreadId()

        def cb(_hook, event, hwnd, id_object, _id_child, _thread, _time):
            if id_object != OBJID_WINDOW or not hwnd:
                return
            pid = wt.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if pid.value not in self.pids:
                return
            if user32.GetAncestor(hwnd, GA_ROOT) != hwnd:
                return  # 子ウィンドウ（WebView2 の描画面など）は親の位置に従うので見ない
            ex = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            if ex & WS_EX_LAYERED and ex & WS_EX_TRANSPARENT:
                return  # tao の内部の窓（Tao Thread Event Target）。透明でクリックも素通りし、利用者には見えない
            r = wt.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(r))
            self.events.append({"t": time.time(), "event": event, "hwnd": hwnd, "title": title(hwnd), "class": class_name(hwnd),
                                "visible": bool(user32.IsWindowVisible(hwnd)),
                                "rect": (r.left, r.top, r.right, r.bottom)})

        self._cb = WinEventProc(cb)
        hooks = [user32.SetWinEventHook(lo, hi, None, self._cb, 0, 0, WINEVENT_OUTOFCONTEXT)
                 for lo, hi in ((EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
                                (EVENT_OBJECT_CREATE, EVENT_OBJECT_LOCATIONCHANGE))]
        self.ready.set()
        msg = wt.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))
        for h in hooks:
            user32.UnhookWinEvent(h)

    def stop(self):
        user32.PostThreadMessageW(self.tid, WM_QUIT, 0, 0)

    def problems(self) -> list[str]:
        out = []
        for e in self.events:
            l, t, r, b = e["rect"]
            if e["event"] == EVENT_SYSTEM_FOREGROUND:
                out.append(f"前面になった: {e['title']!r} {e['rect']}")
            elif e["visible"] and r > l and b > t and any(l < mr and r > ml and t < mb and b > mt for ml, mt, mr, mb in self.mons):
                out.append(f"画面内に見えた: {e['title']!r}（{e['class']}） {e['rect']}（出来事 0x{e['event']:04X}）")
        return out


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--project")
    a = ap.parse_args()
    w = Watcher()
    w.start()
    w.ready.wait()
    profile = pathlib.Path(tempfile.mkdtemp(prefix="zzm-offscreen-"))
    z = Zigzagu(a.exe, profile=profile)
    # 起動の直後から記録するため、プロセス ID は起動するとすぐに登録する（下の start の中では間に合わないので先に作る）
    orig_popen = __import__("subprocess").Popen

    class P(orig_popen):  # type: ignore[misc, valid-type]
        def __init__(self, *args, **kw):
            super().__init__(*args, **kw)
            w.pids.add(self.pid)

    import zz as zzmod
    zzmod.subprocess.Popen = P  # type: ignore[assignment]
    try:
        z.start()
        z.call({"cmd": "open", "rom": a.rom, **({"project": a.project} if a.project else {})})
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})
        z.call({"cmd": "action", "id": "tools.worldMap"})
        z.call({"cmd": "action", "id": "tools.blockEditor"})
        for _ in range(50):
            labels = {x["label"]: x for x in z.call({"cmd": "windows"})}
            if labels.get("block-editor", {}).get("ready") and labels.get("world-map", {}).get("ready"):
                break
            time.sleep(0.2)
        try:
            z.call({"cmd": "action", "id": "palette.editor", "window": "block-editor"})
        except Exception as e:  # noqa: BLE001
            print("パレットエディタは開けませんでした:", e)
        if a.project:
            first = sorted(pathlib.Path(a.project, "assembly/overworld_scripts").glob("*.s"))[0].name
            z.call({"cmd": "script.open", "path": f"assembly/overworld_scripts/{first}", "line": 1})
            for _ in range(50):
                if any(x["label"] == "script-editor" and x["ready"] for x in z.call({"cmd": "windows"})):
                    break
                time.sleep(0.2)
            else:
                print("スクリプトエディタが開きませんでした")
        time.sleep(1.5)
        for label in ("script-editor", "palette-editor", "block-editor", "world-map"):
            try:
                z.call({"cmd": "close", "window": label})
            except Exception:  # noqa: BLE001
                pass
        time.sleep(1.0)
        wins = z.call({"cmd": "windows"})
        print("終了前のウィンドウ:", [x["label"] for x in wins])
    finally:
        z.stop()
        zzmod.subprocess.Popen = orig_popen  # type: ignore[assignment]
        time.sleep(0.5)
        w.stop()
        shutil.rmtree(profile, ignore_errors=True)
    shown = {e["title"] for e in w.events if e["event"] == EVENT_OBJECT_SHOW}
    print(f"記録した出来事 {len(w.events)} 件、表示されたウィンドウ: {sorted(shown)}")
    probs = w.problems()
    for p in probs[:20]:
        print("失敗:", p)
    print("合格" if not probs else f"失敗 {len(probs)} 件")
    return 1 if probs else 0


if __name__ == "__main__":
    sys.exit(main())
