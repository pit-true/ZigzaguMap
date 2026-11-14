"""イベントの削除（#220）を、素の ROM だけで確かめる（プロジェクトフォルダは開かない）。

  python tests/automation/event_delete_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- 見ること: イベントの箱を右クリックすると「イベントを削除」「スクリプトを開く」のメニューが出る（フライトポジションでは削除を押せない）。
  「イベントを削除」・Delete キー・「イベントの削除」ボタンのどれでも確認のダイアログが出て、キャンセルなら何も変わらない。
  プロジェクトフォルダが無いので、ダイアログは「範囲は記録できない」と知らせ、削除ではオブジェクトだけを消す（maps\\rom_erase.json は作らない）。
  1 回の元に戻すで戻り、やり直すとまた消える。ワープと隠しアイテムの看板も消せる。
- `.s` の記述と ROM の範囲の記録は、写しのテスト（`tests/realcopy/run.py --delete`）で確かめる。
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


def wait_dialog(z: Zigzagu, title: str, timeout: float = 10) -> dict | None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        for d in z.call({"cmd": "dialogs"})["dialogs"]:
            if d.get("title") == title:
                return d
        time.sleep(0.1)
    return None


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
    with tempfile.TemporaryDirectory(prefix="zzm-delete-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": args.rom})
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})
        z.call({"cmd": "tab", "name": "event"})
        st = z.call({"cmd": "event.state"})
        counts = st["counts"]
        p = st["events"]["persons"][0]

        # 右クリックのメニュー
        z.call({"cmd": "mouse", "target": "event", "cell": [p["x"], p["y"]], "action": "rightClick"})
        menu = z.call({"cmd": "contextMenu.state"})
        check(bool(menu) and [i["id"] for i in menu["items"]] == ["delete", "openScript"], "人の箱の右クリックで「イベントを削除」「スクリプトを開く」が出る")
        check(z.call({"cmd": "event.state"})["kind"] == "person" and z.call({"cmd": "event.state"})["index"] == 0, "右クリックした人が選ばれる")
        shot(z, shots, "delete-1-context-menu.png")
        r = z.call({"cmd": "contextMenu.press", "id": "delete"})
        d = wait_dialog(z, "イベントを削除")
        check(d is not None and "記録できません" in d["text"], "確認のダイアログに、プロジェクトが無いので範囲を記録できないと出る")
        shot(z, shots, "delete-3-confirm-rom-only.png")
        z.call({"cmd": "dialog", "press": "cancel"})
        check(z.call({"cmd": "event.state"})["counts"] == counts, "キャンセルなら何も変わらない")
        check(z.call({"cmd": "contextMenu.state"}) is None, "メニューは閉じている")

        # Delete キーで消す
        z.call({"cmd": "event.select", "kind": "person", "index": 0})
        z.call({"cmd": "key", "key": "Delete"})
        check(wait_dialog(z, "イベントを削除") is not None, "Delete キーでも確認のダイアログが出る")
        z.call({"cmd": "dialog", "press": "ok"})
        time.sleep(0.3)
        after = z.call({"cmd": "event.state"})["counts"]
        check(after["persons"] == counts["persons"] - 1, "削除で人が 1 人減る")
        check(z.call({"cmd": "romErase.state"})["ranges"] == [], "プロジェクトが無いので範囲は記録しない")
        z.call({"cmd": "undo"})
        check(z.call({"cmd": "event.state"})["counts"] == counts, "1 回の元に戻すで戻る")
        z.call({"cmd": "redo"})
        check(z.call({"cmd": "event.state"})["counts"]["persons"] == counts["persons"] - 1, "やり直すとまた消える")
        z.call({"cmd": "undo"})

        # 「イベントの削除」ボタン（ワープ）
        z.call({"cmd": "event.select", "kind": "warp", "index": 0})
        z.call({"cmd": "click", "id": "event.remove"})
        d = wait_dialog(z, "イベントを削除")
        check(d is not None and "スクリプト" not in d["text"].split("\n", 3)[-1], "ボタンでも確認のダイアログが出る（ワープはオブジェクトだけ）")
        z.call({"cmd": "dialog", "press": "ok"})
        time.sleep(0.3)
        check(z.call({"cmd": "event.state"})["counts"]["warps"] == counts["warps"] - 1, "ワープを消せる")
        z.call({"cmd": "undo"})

        # 計画（自動操作の入口）
        plan = z.call({"cmd": "event.deletePlan", "kind": "person", "index": 0})
        check(plan["project"] is False and plan["romNote"] == "noProject" and plan["files"] == [], "event.deletePlan: プロジェクトが無いときは範囲を記録しない計画")
        r = z.call({"cmd": "event.delete", "kind": "sign", "index": 0, "confirm": False})
        check(r["ok"] and r["counts"]["signs"] == counts["signs"] - 1, "event.delete（confirm: false）で確かめずに消せる")
        z.call({"cmd": "undo"})
        check(z.call({"cmd": "event.state"})["counts"] == counts, "最後に元の数に戻る")
    print(f"\n失敗 {len(failures)} 件")
    for f in failures:
        print("  " + f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
