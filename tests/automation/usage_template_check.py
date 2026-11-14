"""使われている番号の索引（#227）とひな形・トレーナー（#243〜#245）を、素の ROM だけで確かめる（プロジェクトフォルダは開かない）。

  python tests/automation/usage_template_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>]

- 見ること: 索引を作り終え、素の ROM のスクリプトで使われているフラグ（0x28 など）・隠しアイテムの番号（1）・トレーナーの番号が使用中になり、
  未使用の最小のフラグが 0x21 で使っている場所が無い。トレーナーの一覧（743 件の表）が読め、自動生成は同じ種なら同じ結果。
  プロジェクトフォルダが無いので「未使用」ボタンは出ず、右クリックに「ここにひな形を置く」は出ず、スクリプトを書くひな形は置けない。
- 写しでの置く・出力・ビルド・ROM の中身は `tests/realcopy/run.py --template` で確かめる。
"""
from __future__ import annotations

import argparse
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import AppError, Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    args = ap.parse_args()
    with tempfile.TemporaryDirectory(prefix="zzm-usage-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": args.rom})
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})
        z.call({"cmd": "tab", "name": "event"})
        st = z.call({"cmd": "usage.state", "wait": True}, timeout=300)
        check(st["ready"] and st["error"] is None and st["stats"]["maps"] > 400, f"素の ROM の全マップから索引を作る（{st['stats']}、{st['counts']}）")
        nxt = z.call({"cmd": "usage.next", "kind": "flag"})["value"]
        check(nxt == 0x21 and z.call({"cmd": "usage.find", "kind": "flag", "value": nxt})["sites"] == [], "未使用の最小のフラグは 0x21 で、使っている場所が無い")
        rom_flag = None
        for v in range(0x22, 0x100):
            sites = z.call({"cmd": "usage.find", "kind": "flag", "value": v})["sites"]
            if any(s["source"] == "rom" for s in sites):
                rom_flag = (v, sites)
                break
        check(rom_flag is not None, f"素の ROM のスクリプトで使うフラグが使用中になる（{rom_flag and (hex(rom_flag[0]), [s['where'] for s in rom_flag[1]][:2])}）")
        hid = z.call({"cmd": "usage.find", "kind": "hiddenItem", "value": 1})["sites"]
        check(any(s["source"] == "event" for s in hid), "隠しアイテムの番号 1 は看板で使用中")
        trainers = z.call({"cmd": "trainer.list"}, timeout=120)
        check(len(trainers) == 742 and all(t["partySize"] >= 0 for t in trainers), f"トレーナーの一覧（{len(trainers)} 件）")
        used_t = [t for t in trainers if t["uses"] > 0]
        check(len(used_t) > 100, f"スクリプトで使われているトレーナーが印付き（{len(used_t)} 件）")
        g1 = z.call({"cmd": "trainer.generate", "bank": 3, "map": 19, "seed": 7})
        g2 = z.call({"cmd": "trainer.generate", "bank": 3, "map": 19, "seed": 7})
        check(g1["party"] == g2["party"] and 1 <= len(g1["party"]) <= 3, f"自動生成は同じ種なら同じ（{g1['party']}）")
        z.call({"cmd": "event.select", "kind": "person", "index": 0})
        f = z.call({"cmd": "getField", "id": "event.person.flagUnused"})
        check(not f["visible"], "プロジェクトフォルダが無いと「未使用」ボタンは出ない")
        z.call({"cmd": "mouse", "target": "event", "cell": [1, 1], "action": "rightClick"})
        check(z.call({"cmd": "contextMenu.state"}) is None, "プロジェクトフォルダが無いと空いたマスの右クリックのメニューは出ない")
        try:
            z.call({"cmd": "template.place", "kind": "person", "x": 1, "y": 1})
            check(False, "プロジェクトフォルダが無いとスクリプトを書くひな形は置けない")
        except AppError as e:
            check("プロジェクトフォルダ" in str(e), f"プロジェクトフォルダが無いとスクリプトを書くひな形は置けない（{e}）")
        lst = z.call({"cmd": "template.list"})
        check([t["id"] for t in lst] == ["person", "sign", "tile", "hiddenItem", "itemGiver", "mart", "trainer"], "ひな形は 7 種類")
    print(f"\n失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
