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
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import AppError, Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def check_trainer_edit(z: Zigzagu) -> None:
    """トレーナーをあとから直す窓（#274）。窓で名前と手持ちを直すと trainers.json に入り、1 回の取り消しで戻る。ROM の値に戻すと消える。"""
    rom1 = z.call({"cmd": "trainer.get", "id": 1})
    z.call({"cmd": "trainer.edit", "id": 1})
    time.sleep(0.5)
    dlg = [d for d in z.call({"cmd": "dialogs"})["dialogs"] if d.get("kind") == "app"]
    check(bool(dlg) and "トレーナーを編集" in dlg[-1]["title"], f"トレーナーを直す窓が出る（{[d.get('title') for d in dlg]}）")
    check(z.call({"cmd": "getField", "id": "trainerEdit.name"})["value"] == rom1["name"], "窓の名前の欄は ROM の値")
    z.call({"cmd": "setField", "id": "trainerEdit.name", "value": "テスト"})
    z.call({"cmd": "setField", "id": "trainerEdit.party", "value": "0x10 12, 0x13 11"})
    z.call({"cmd": "dialog", "press": "ok"})
    time.sleep(0.3)
    j = z.call({"cmd": "trainer.json"})
    t1 = next((t for t in j["trainers"] if t["id"] == 1), None)
    check(t1 is not None and t1["name"] == "テスト" and [(m["species"], m["level"]) for m in t1["party"]] == [(0x10, 12), (0x13, 11)] and t1["trainerClass"] == rom1["trainerClass"],
          f"直した値が trainers.json に入る（{t1 and (t1['name'], t1['party'])}）")
    check(j["modified"], "trainers.json が未出力になる")
    z.call({"cmd": "undo"})
    check(not any(t["id"] == 1 for t in z.call({"cmd": "trainer.json"})["trainers"]), "1 回の取り消しで trainers.json から消える")
    z.call({"cmd": "redo"})
    z.call({"cmd": "trainer.edit", "id": 1})
    time.sleep(0.5)
    z.call({"cmd": "dialog", "press": "revert"})
    time.sleep(0.3)
    check(not any(t["id"] == 1 for t in z.call({"cmd": "trainer.json"})["trainers"]), "「ROM の値に戻す」で trainers.json から消える")
    # 人の右クリックの「トレーナーを編集」（素の ROM のトレーナー: トキワの森 3.? ではなく、番号はスクリプトから探す）
    z.call({"cmd": "selectMap", "bank": 1, "map": 0})
    z.call({"cmd": "tab", "name": "event"})
    persons = z.call({"cmd": "event.state"})["events"]["persons"]
    found = None
    for i, p in enumerate(persons):
        if p.get("trainerType", 0) != 0:
            found = (i, z.call({"cmd": "trainer.idForPerson", "index": i})["id"])
            break
    check(found is not None and found[1] is not None and found[1] > 0, f"トレーナーの人のスクリプトから番号が分かる（{found}）")


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
        check_trainer_edit(z)
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})
        z.call({"cmd": "tab", "name": "event"})
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
