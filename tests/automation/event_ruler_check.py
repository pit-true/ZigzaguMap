"""ルーラーと人の数の上限の警告（Phase5 #400）を、素の ROM だけで確かめる（出力しない）。

  python tests/automation/event_ruler_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- ルーラー: イベントタブで Shift＋右ドラッグの間だけ出て、横と縦のマス数がステータスバーと `event.state` の `ruler` に合う。
  離すと消え、右クリックのメニューは出ない。イベントは動かない。Shift なしの右クリックと、同じマスで離した Shift＋右クリックは
  今までどおりメニューを出す。
- 上限: 人を 65 個にすると、イベント数の設定の欄とステータスバーに赤い文が出る。64 個に戻すと消える。
"""
from __future__ import annotations

import argparse
import base64
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


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if not shots:
        return
    png = z.call({"cmd": "screenshot"})
    (shots / name).write_bytes(base64.b64decode(png if isinstance(png, str) else png["png"]))


def menu_ids(z: Zigzagu) -> list[str]:
    return [i["id"] for i in (z.call({"cmd": "contextMenu.state"}) or {}).get("items", [])]


def close_menu(z: Zigzagu) -> None:
    if z.call({"cmd": "contextMenu.state"}):
        z.call({"cmd": "key", "key": "Escape"})


def set_persons(z: Zigzagu, n: int) -> None:
    z.call({"cmd": "setField", "id": "event.manager.persons", "value": n})
    z.call({"cmd": "click", "id": "event.manager.apply"})
    time.sleep(0.2)


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="zzm-ruler-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": args.rom})
        z.call({"cmd": "setting", "key": "showClones", "value": False})
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})
        z.call({"cmd": "tab", "name": "event"})
        st = z.call({"cmd": "event.state"})
        before = st["events"]
        p = st["events"]["persons"][0]
        a, b = (p["x"], p["y"]), (p["x"] + 5, p["y"] - 3)

        # ルーラー（人の上から始めても人はつかまない）
        z.call({"cmd": "mouse", "target": "event", "action": "move", "cell": list(a)})
        z.call({"cmd": "mouse", "target": "event", "action": "down", "cell": list(a), "button": "right", "shift": True})
        z.call({"cmd": "mouse", "target": "event", "action": "move", "cell": list(b), "button": "right", "shift": True})
        st = z.call({"cmd": "event.state"})
        check(st["ruler"] == {"dx": 5, "dy": 3}, f"ルーラーの横と縦のマス数が合う（{st['ruler']}）")
        status = z.call({"cmd": "selection"})["status"]
        left = status["left"] if isinstance(status, dict) else str(status)
        check("横 5 マス・縦 3 マス" in left, f"ステータスバーに距離を出す（{left}）")
        shot(z, shots, "event_ruler_1.png")
        z.call({"cmd": "mouse", "target": "event", "action": "up", "cell": list(b), "button": "right", "shift": True})
        st = z.call({"cmd": "event.state"})
        check(st["ruler"] is None, "離すとルーラーが消える")
        check(not menu_ids(z), "ルーラーを離したときは右クリックのメニューを出さない")
        check(st["events"] == before, "ルーラーではイベントは動かない")
        close_menu(z)

        # 同じマスで離した Shift＋右クリックと、ふつうの右クリックはメニューを出す
        z.call({"cmd": "mouse", "target": "event", "action": "rightClick", "cell": list(a), "shift": True})
        check("delete" in menu_ids(z), "同じマスで離した Shift＋右クリックはメニューを出す")
        close_menu(z)
        z.call({"cmd": "mouse", "target": "event", "action": "rightClick", "cell": list(a)})
        check("delete" in menu_ids(z), "ふつうの右クリックは今までどおりメニューを出す")
        close_menu(z)

        # 人の数の上限
        counts = z.call({"cmd": "event.state"})["counts"]
        check(not z.call({"cmd": "getField", "id": "status.eventLimit"})["visible"], f"人が {counts['persons']} 個のときは注意を出さない")
        set_persons(z, 65)
        f = z.call({"cmd": "getField", "id": "status.eventLimit"})
        check(f["visible"] and "65" in f["value"], f"人を 65 個にするとステータスバーに注意が出る（{f['value']}）")
        m = z.call({"cmd": "getField", "id": "event.manager.limit"})
        check(m["visible"] and "64" in m["value"], f"イベント数の設定の欄に赤い文が出る（{m['value']}）")
        shot(z, shots, "event_limit_65.png")
        set_persons(z, 64)
        check(not z.call({"cmd": "getField", "id": "status.eventLimit"})["visible"], "64 個なら注意は出ない")
        check(not z.call({"cmd": "getField", "id": "event.manager.limit"})["visible"], "64 個なら欄の赤い文も出ない")
        z.call({"cmd": "undo"})
        z.call({"cmd": "undo"})
        check(z.call({"cmd": "event.state"})["counts"] == counts, "元に戻すと元の数")
        check(not z.call({"cmd": "getField", "id": "status.eventLimit"})["visible"], "元に戻すと注意も消える")
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
