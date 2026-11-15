"""ふつうに閉じたときに、直前に変えた個人設定が残ることを確かめる（Phase5 #406）。

  python tests/automation/close_settings_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>]

個人設定の書き込みは 300ms 待ってまとめるので、変えてすぐ閉じると書かれないおそれがある。次の 3 つの閉じ方で、
道具（B で塗りつぶし）・グリッドの表示・カーソルの枠・ショートカット（鉛筆を Q に）を変えて、待たずに閉じ、
--profile のフォルダの settings.json にその値が入っていることを確かめる。
- × ボタン（ウィンドウに WM_CLOSE を送る。× を押したときと同じ閉じる頼み）
- ファイル > 終了（`action` の `file.exit`）
- 自動操作の `exit`
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wt
import json
import os
import pathlib
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def main_windows(pid: int) -> list[int]:
    """プロセスの見えているメインのウィンドウ（題名が ZigzaguMap で始まるもの）。"""
    user32 = ctypes.windll.user32
    found: list[int] = []
    proto = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

    def cb(hwnd, _):
        p = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value == pid and user32.IsWindowVisible(hwnd) and user32.GetWindow(hwnd, 4) == 0:  # GW_OWNER
            buf = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, buf, 256)
            if buf.value.startswith("ZigzaguMap"):
                found.append(hwnd)
        return True

    user32.EnumWindows(proto(cb), 0)
    return found


def change(z: Zigzagu) -> None:
    """設定を変える（どれも待たない）。"""
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    z.call({"cmd": "action", "id": "opt.shortcuts"})
    z.call({"cmd": "click", "id": "shortcuts.tool.pencil.0"})
    z.call({"cmd": "key", "id": "shortcuts.tool.pencil.0", "key": "q"})
    z.call({"cmd": "dialog", "press": "ok"})
    z.call({"cmd": "key", "key": "b"})
    z.call({"cmd": "action", "id": "view.grid"})
    z.call({"cmd": "action", "id": "view.cursorFrame"})


def close_by(z: Zigzagu, how: str) -> None:
    proc = z.proc
    assert proc is not None
    if how == "x":
        wins = main_windows(proc.pid)
        check(len(wins) == 1, f"× で閉じるウィンドウが見つかる（{len(wins)}）")
        for h in wins:
            ctypes.windll.user32.PostMessageW(h, 0x0010, 0, 0)  # WM_CLOSE
    elif how == "exit-menu":
        try:
            z.call({"cmd": "action", "id": "file.exit"}, timeout=10)
        except Exception:  # noqa: BLE001  閉じる途中で返事が来ないことがある
            pass
    else:
        z.call({"cmd": "exit"}, timeout=10)
    try:
        proc.wait(20)
    except Exception:  # noqa: BLE001
        pass
    check(proc.poll() is not None, f"{how}: 閉じる（終了コード {proc.poll()}）")


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    args = ap.parse_args()
    for how in ("x", "exit-menu", "exit"):
        with tempfile.TemporaryDirectory(prefix="zz-close-") as profile:
            z = Zigzagu(pathlib.Path(args.exe) if args.exe else None, profile=profile, extra=[args.rom])
            z.start()
            try:
                for _ in range(100):
                    if z.call({"cmd": "state"}).get("map"):
                        break
                    time.sleep(0.2)
                change(z)
                close_by(z, how)
            finally:
                if z.proc and z.proc.poll() is None:
                    z.stop()
                z.proc = None
            path = pathlib.Path(profile) / "settings.json"
            saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
            check(saved.get("paintTool") == "fill", f"{how}: 道具（{saved.get('paintTool')}）")
            check(saved.get("grid") is True, f"{how}: グリッドの表示（{saved.get('grid')}）")
            check(saved.get("cursorFrame") is True, f"{how}: カーソルの枠（{saved.get('cursorFrame')}）")
            check((saved.get("shortcuts") or {}).get("tool.pencil") == ["Q"], f"{how}: ショートカット（{saved.get('shortcuts')}）")
            time.sleep(1)
    print(f"\n失敗 {len(failures)} 件")
    for f in failures:
        print("  " + f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
