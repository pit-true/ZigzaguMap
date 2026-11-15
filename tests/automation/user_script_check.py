"""利用者の JavaScript のスクリプト（Phase5 #405）を、写しのプロジェクトで確かめる。

  python tests/automation/user_script_check.py --rom <素の BPRJ> --project <写しの NeoDark-CFRU-main> [--exe <zigzagumap.exe>]

docs/userscripts の例（grass.js・count.js・sandbox_probe.js）を写しのプロジェクトの zigzagumap-scripts\\ に置く
（最後に消し、zigzagumap.json を元に戻す）。
- 何も有効にしていなければ Worker を作らない。管理の窓のチェックで zigzagumap.json に書いて動かす。
- grass.js: 草むら（0x00D）を置くと、そのマスの移動許可が 0C になる。スクリプトの変更は Ctrl+Z 1 回で戻る。
- count.js: 登録した操作が入力の窓で聞き、全マップのブロックを数えてログに出す。
- sandbox_probe.js: fetch・XMLHttpRequest・importScripts などと Tauri の入口が使えない。
- tools_probe.js: 塗りつぶし・マジック塗り・シフトが 1 回の「元に戻す」で戻り、ホバーとシフトのコールバックが届く。
- 止めると Worker が無くなる。
"""
from __future__ import annotations

import argparse
import os
import pathlib
import shutil
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[2]
EXAMPLES = ["grass.js", "count.js", "sandbox_probe.js", "tools_probe.js"]
failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def wait_for(fn, timeout: float = 15.0):
    t0 = time.time()
    while True:
        v = fn()
        if v or time.time() - t0 > timeout:
            return v
        time.sleep(0.1)


def cell(z: Zigzagu, x: int, y: int) -> tuple[int, int]:
    c = z.call({"cmd": "cells"})
    v = c["cells"][y * c["width"] + x]
    return v & 0x3FF, v >> 10


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--project", required=True)
    ap.add_argument("--exe")
    args = ap.parse_args()
    project = pathlib.Path(args.project)
    folder = project / "zigzagumap-scripts"
    config = project / "zigzagumap.json"
    original_config = config.read_bytes() if config.exists() else None
    if folder.exists():
        raise SystemExit(f"{folder} がすでにあります")
    folder.mkdir()
    for name in EXAMPLES:
        shutil.copyfile(REPO / "docs" / "userscripts" / name, folder / name)
    try:
        with tempfile.TemporaryDirectory(prefix="zzm-uscript-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
            z.call({"cmd": "open", "rom": args.rom, "project": str(project)})
            st = z.call({"cmd": "userScripts.state", "wait": True})
            check(st["files"] == sorted(EXAMPLES) and st["enabled"] == [] and not st["active"], f"有効なものが無ければ Worker を作らない（{st['files']}）")
            heap_off = z.call({"cmd": "state"})["jsHeap"]

            z.call({"cmd": "action", "id": "scripts.manage"})
            for name in EXAMPLES:
                z.call({"cmd": "setField", "id": f"userScripts.enable.{name}", "value": True})
                wait_for(lambda: name in z.call({"cmd": "userScripts.state", "wait": True})["enabled"])
            st = z.call({"cmd": "userScripts.state", "wait": True})
            check(st["active"] and st["enabled"] == sorted(EXAMPLES) and not st["loadErrors"], f"チェックで有効にして動かす（{st['enabled']}、{st['loadErrors']}）")
            check(any(a["id"] == "countBlocks" for a in st["actions"]), "count.js の操作が登録される")
            saved = config.read_text(encoding="utf-8")
            check('"userScripts"' in saved and "grass.js" in saved, "有効にしたものを zigzagumap.json に書く")
            heap_on = z.call({"cmd": "state"})["jsHeap"]
            z.call({"cmd": "dialog", "press": "close"})

            # grass.js
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            z.call({"cmd": "command", "name": "paintMovement", "args": {"bank": 3, "map": 0, "cells": [{"x": 5, "y": 5, "movement": 1}]}})
            before = z.call({"cmd": "editHistory.state"})["position"]
            z.call({"cmd": "command", "name": "paintBlocks", "args": {"bank": 3, "map": 0, "cells": [{"x": 5, "y": 5, "block": 0x00D}]}})
            got = wait_for(lambda: cell(z, 5, 5) == (0x00D, 0x0C))
            check(bool(got), f"草むらを置くと移動許可が 0C になる（{cell(z, 5, 5)}）")
            h = z.call({"cmd": "editHistory.state"})
            check(h["position"] == before + 2, f"スクリプトの変更は 1 つの操作（位置 {before} → {h['position']}）")
            z.call({"cmd": "undo"})
            check(cell(z, 5, 5) == (0x00D, 1), f"Ctrl+Z 1 回でスクリプトの変更だけ戻る（{cell(z, 5, 5)}）")
            z.call({"cmd": "undo"})
            z.call({"cmd": "undo"})

            # sandbox_probe.js
            st = z.call({"cmd": "userScripts.run", "action": "probe"})
            probe = next((l["text"] for l in reversed(st["logs"]) if "probe:" in l["text"]), "")
            check("usable=[]" in probe and "tauri=false" in probe, f"ファイルや外部とのやり取りの関数と Tauri の入口が無い（{probe}）")

            # count.js（入力の窓で答える）
            z.call({"cmd": "userScripts.run", "action": "countBlocks", "wait": False})
            wait_for(lambda: z.call({"cmd": "dialogs"})["dialogs"] if isinstance(z.call({"cmd": "dialogs"}), dict) else z.call({"cmd": "dialogs"}))
            z.call({"cmd": "dialog", "input": "00D", "press": "ok"})
            line = wait_for(lambda: next((l["text"] for l in z.call({"cmd": "userScripts.state"})["logs"] if "ブロック 00D は" in l["text"]), None), 120)
            check(bool(line), f"全マップのブロックを数える（{line}）")

            # tools_probe.js（塗りつぶし・マジック塗り・シフト・コールバック）
            base = z.call({"cmd": "cells"})
            w = base["width"]
            pos = z.call({"cmd": "editHistory.state"})["position"]
            st = z.call({"cmd": "userScripts.run", "action": "fill"})
            line = next((l["text"] for l in reversed(st["logs"]) if "fill:" in l["text"]), "")
            after = z.call({"cmd": "cells"})["cells"]
            # 塗りつぶしで (0, 0) につながったマスを 0x001 にし、マジック塗りで 0x001 のマスを全部 0x002 にする
            flood = int(line.split("flood=")[1].split(" ")[0]) if "flood=" in line else -1
            ones = sum(1 for v in base["cells"] if v & 0x3FF == 1) if base["cells"][0] & 0x3FF != 1 else 0
            twos = sum(1 for v in after if v & 0x3FF == 2) - sum(1 for v in base["cells"] if v & 0x3FF == 2)
            check(flood >= 1 and f"magic={ones + flood}" in line and twos == ones + flood and (after[0] & 0x3FF) == 2, f"塗りつぶしとマジック塗り（{line}、元の 0x001 は {ones} マス）")
            check(z.call({"cmd": "editHistory.state"})["position"] == pos + 1, "塗りつぶしとマジック塗りで 1 つの操作")
            z.call({"cmd": "undo"})
            check(z.call({"cmd": "cells"})["cells"] == base["cells"], "1 回の「元に戻す」で戻る")
            z.call({"cmd": "userScripts.run", "action": "shift"})
            after = z.call({"cmd": "cells"})["cells"]
            ok = all(after[y * w + (x + 1) % w] == base["cells"][y * w + x] for y in range(base["height"]) for x in range(w))
            check(ok, "シフトで右へ 1 マスずれ、はみ出た列は左に回る")
            z.call({"cmd": "undo"})
            z.call({"cmd": "command", "name": "shiftMap", "args": {"bank": 3, "map": 0, "dx": 2, "dy": -1}})
            for c in ([3, 3], [4, 4], [5, 4]):
                z.call({"cmd": "mouse", "target": "map", "action": "hover", "cell": c})
            st = z.call({"cmd": "userScripts.run", "action": "report"})
            line = next((l["text"] for l in reversed(st["logs"]) if "report:" in l["text"]), "")
            check('"dx":2' in line and '"dy":-1' in line, f"マップシフトのコールバック（{line}）")
            hovers = int(line.split("hovers=")[1].split(" ")[0]) if "hovers=" in line else 0
            check(hovers >= 3, f"ホバーのマスのコールバック（{hovers} 回）")
            z.call({"cmd": "undo"})

            # ツール > ユーザースクリプト のメニューと、ショートカットの変更で決めたキー
            items = [i for i in z.call({"cmd": "menu.list"}) if (i.get("id") or "").startswith("scripts.run.")]
            labels = [i["path"][-1] for i in items]
            check(labels[:2] == ["全マップのブロックを数える", "使えない関数を確かめる"], f"ツール > ユーザースクリプト に登録した操作が並ぶ（{labels}）")
            z.call({"cmd": "action", "id": "opt.shortcuts"})
            z.call({"cmd": "click", "id": "shortcuts.scripts.run.2.0"})
            z.call({"cmd": "key", "key": "k", "ctrl": True, "shift": True, "id": "shortcuts.scripts.run.2.0"})
            z.call({"cmd": "dialog", "press": "ok"})
            keys = z.call({"cmd": "shortcuts.state"})["keys"]
            check(keys.get("scripts.run.2") == "Ctrl+Shift+K", f"2 番目の操作にキーを決められる（{keys.get('scripts.run.2')}）")
            before = sum(1 for l in z.call({"cmd": "userScripts.state"})["logs"] if "probe:" in l["text"])
            z.call({"cmd": "key", "key": "K", "ctrl": True, "shift": True})
            got = wait_for(lambda: sum(1 for l in z.call({"cmd": "userScripts.state"})["logs"] if "probe:" in l["text"]) > before)
            check(bool(got), "決めたキーで操作が動く")
            item = next((i for i in z.call({"cmd": "menu.list"}) if i.get("id") == "scripts.run.2"), {})
            check("Ctrl+Shift+K" in str(item.get("shortcut", "")), f"メニューにキーが出る（{item.get('shortcut')}）")

            st = z.call({"cmd": "userScripts.stop"})
            check(not st["active"], "止めると Worker が無くなる")
            print(f"     JavaScript のヒープ: スクリプトなし {heap_off} MB、4 つ有効 {heap_on} MB")
    finally:
        shutil.rmtree(folder, ignore_errors=True)
        if original_config is None:
            config.unlink(missing_ok=True)
        else:
            config.write_bytes(original_config)
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
