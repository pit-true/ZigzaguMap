"""ファイルの変化の監視（Phase5 #404）を、写しのプロジェクトで確かめる。

  python tests/automation/project_watch_check.py --rom <素の BPRJ> --project <写しの NeoDark-CFRU-main> [--exe <zigzagumap.exe>]

写しのプロジェクトの `maps\\03\\00.json` の後ろに改行を足して「外で変わった」ことにする（最後に元の中身へ戻す）。
- 何も変えていなければ聞かない。外で変えると一覧を出して聞き、「いいえ」なら読み直さず、次は同じ変化で聞かない。
- 「はい」なら読み直し、開いていたマップ（3.0）を開き直す（履歴は空になる）。
- 未出力の変更があると、変更を捨てることを別に聞く。「いいえ」なら読み直さず、変更は残る。
- ZigzaguMap が出力したファイルは数えない（出力のあとに調べても聞かない）。
"""
from __future__ import annotations

import argparse
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def dialogs(z: Zigzagu) -> list[dict]:
    r = z.call({"cmd": "dialogs"})
    return [d for d in (r["dialogs"] if isinstance(r, dict) else r or []) if d.get("kind") == "app"]


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--project", required=True)
    ap.add_argument("--exe")
    args = ap.parse_args()
    target = pathlib.Path(args.project) / "maps" / "03" / "00.json"
    original = target.read_bytes()

    def touch(n: int) -> None:
        target.write_bytes(original + b"\n" * n)

    try:
        with tempfile.TemporaryDirectory(prefix="zzm-watch-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
            z.call({"cmd": "open", "rom": args.rom, "project": args.project})
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            st = z.call({"cmd": "projectWatch.state"})
            check(st["watched"] > 1, f"見るファイルを控えた（{st['watched']} 件）")
            r = z.call({"cmd": "projectWatch.check"})
            check(r["result"] is not None and not dialogs(z) and r["result"]["changes"]["changed"] == [], "何も変えていなければ聞かない")

            touch(1)
            z.call({"cmd": "projectWatch.check"})
            d = dialogs(z)
            check(len(d) == 1 and "maps/03/00.json" in d[0].get("text", ""), f"外で変えると一覧を出して聞く（{d and d[0].get('text', '')[:80]}）")
            z.call({"cmd": "dialog", "press": "no"})
            r = z.call({"cmd": "projectWatch.state", "wait": True})["result"]
            check(r and not r["reloaded"], "「いいえ」なら読み直さない")
            r = z.call({"cmd": "projectWatch.check"})["result"]
            check(r and not dialogs(z) and r["changes"]["changed"] == [], "同じ変化では二度は聞かない")

            touch(2)
            z.call({"cmd": "command", "name": "paintBlocks", "args": {"bank": 3, "map": 1, "cells": [{"x": 1, "y": 1, "block": 5}]}})
            z.call({"cmd": "projectWatch.check"})
            z.call({"cmd": "dialog", "press": "yes"})
            d = dialogs(z)
            check(len(d) == 1 and "3.1" in d[0].get("text", ""), f"未出力の変更があると、捨てることを別に聞く（{d and d[0].get('text', '')[:60]}）")
            z.call({"cmd": "dialog", "press": "no"})
            r = z.call({"cmd": "projectWatch.state", "wait": True})["result"]
            item = next((i for i in z.call({"cmd": "tree.list"}) if i["mapId"] == {"bank": 3, "map": 1}), None)
            check(bool(r) and not r["reloaded"] and bool(item) and item["dirty"], "「いいえ」なら読み直さず、変更は残る")
            z.call({"cmd": "undo"})

            touch(3)
            z.call({"cmd": "projectWatch.check"})
            z.call({"cmd": "dialog", "press": "yes"})
            if dialogs(z):
                z.call({"cmd": "dialog", "press": "yes"})
            r = z.call({"cmd": "projectWatch.state", "wait": True})["result"]
            m = z.call({"cmd": "state"})["map"]
            check(r and r["reloaded"], "「はい」なら読み直す")
            check(m and (m["bank"], m["map"]) == (3, 0), f"開いていたマップを開き直す（{m and (m['bank'], m['map'])}）")
            check(z.call({"cmd": "editHistory.state"})["position"] == 0, "読み直すと履歴は空")
            check(z.call({"cmd": "projectWatch.state"})["watched"] > 1, "読み直したあとも見る")

            # 自分で出力したファイルは数えない
            z.call({"cmd": "command", "name": "paintBlocks", "args": {"bank": 3, "map": 0, "cells": [{"x": 2, "y": 2, "block": 6}]}})
            z.call({"cmd": "export"}, timeout=300)
            r = z.call({"cmd": "projectWatch.check"})["result"]
            check(r is not None and not dialogs(z) and r["changes"]["changed"] == [], f"出力したファイルは数えない（{r and r['changes']}）")
    finally:
        target.write_bytes(original)
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
