"""履歴の窓（Phase5 #402）を、素の ROM だけで確かめる（出力しない）。

  python tests/automation/edit_history_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- Ctrl+E で開き、もう一度で閉じる。マップに 3 回ブロックを置くと、新しい順に「ブロックを塗る（3.0）」が 3 行と「（最初の状態）」。
- 行を押すとその位置まで戻す・進め、マップの配置も合う。やり直せる分は `redo`、今の位置は `current`。
- Ctrl+Z・Ctrl+Y でも一覧が直る。戻したあとに新しい操作をすると、やり直せる分が消える。
"""
from __future__ import annotations

import argparse
import base64
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu, shot  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def cells(z: Zigzagu) -> list[int]:
    return z.call({"cmd": "cells"})["cells"]


def hist(z: Zigzagu) -> dict:
    return z.call({"cmd": "editHistory.state"})


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
    with tempfile.TemporaryDirectory(prefix="zzm-hist-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": args.rom})
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})
        z.call({"cmd": "tab", "name": "map"})
        h = hist(z)
        check(not h["open"] and h["position"] == 0, "初めは閉じていて、位置は 0")
        check([r["text"] for r in h["rows"]] == ["（最初の状態）"] and h["rows"][0]["current"], "操作が無いときは「（最初の状態）」だけ")

        z.call({"cmd": "key", "key": "e", "ctrl": True})
        check(hist(z)["open"], "Ctrl+E で開く")
        w = z.call({"cmd": "state"})["map"]["width"]
        snaps = [cells(z)]
        for i, block in enumerate((0x10, 0x20, 0x30)):
            z.call({"cmd": "selectBlock", "block": block})
            z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [2 + i, 2]})
            snaps.append(cells(z))
        check(all((snaps[i + 1][2 * w + 2 + i] & 0x3FF) == b for i, b in enumerate((0x10, 0x20, 0x30))), "3 回ブロックを置いた")
        h = hist(z)
        texts = [r["text"] for r in h["rows"]]
        check(texts == ["ブロックを塗る（3.0）"] * 3 + ["（最初の状態）"], f"新しい順に 3 行と最初の状態（{texts}）")
        check(h["position"] == 3 and h["rows"][0]["current"], "いちばん上が今の位置")
        shot(z, shots, "history_3.png")

        r = z.call({"cmd": "editHistory.goTo", "position": 1})
        check(r["steps"] == 2 and r["position"] == 1, f"行を押すとそこまで戻す（{r['steps']} 回）")
        check(cells(z) == snaps[1], "戻した配置が 1 回目の後と同じ")
        check([x["redo"] for x in r["rows"]] == [True, True, False, False], "やり直せる 2 行は薄い（redo）")
        check([x["current"] for x in r["rows"]] == [False, False, True, False], "今の位置の行が強調される")
        shot(z, shots, "history_back.png")

        r = z.call({"cmd": "editHistory.goTo", "position": 3})
        check(r["position"] == 3 and cells(z) == snaps[3], "上の行を押すと進める")
        r = z.call({"cmd": "editHistory.goTo", "position": 0})
        check(r["position"] == 0 and cells(z) == snaps[0], "「（最初の状態）」で全部戻す")
        check(r["rows"][-1]["current"], "最初の状態の行が今の位置")

        z.call({"cmd": "key", "key": "y", "ctrl": True})
        check(hist(z)["position"] == 1, "Ctrl+Y でも一覧が直る")
        z.call({"cmd": "selectBlock", "block": 0x40})
        z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [6, 2]})
        h = hist(z)
        check(h["position"] == 2 and len(h["rows"]) == 3 and not any(x["redo"] for x in h["rows"]), "戻したあとの新しい操作で、やり直せる分が消える")
        z.call({"cmd": "key", "key": "z", "ctrl": True})
        check(hist(z)["position"] == 1 and hist(z)["rows"][0]["redo"], "Ctrl+Z でも一覧が直る")

        z.call({"cmd": "key", "key": "e", "ctrl": True})
        check(not hist(z)["open"], "もう一度 Ctrl+E で閉じる")
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
