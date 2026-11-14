"""Phase4 の描く道具（3 層のブロックの選び方と置けない規則、自動ペン、マップ作成補助）を、素の ROM と写しで確かめる。

  python tests/automation/pen_check.py --rom <素の BPRJ の写し> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--work <作業フォルダ>] [--only <名前> ...]

- 起動は --automation・--profile（一時フォルダ）・画面外。ROM には書き込まない。タイルセットの編集はメモリの上だけ
  （出力しない）。マップ作成補助のパーツは --work（既定は一時フォルダ）の maps\\autopen\\ に書く。
- 見ること（`--only` で選べる。名前は下の CHECKS の鍵）:
  - triple: 3 層のブロック（#300・#301）。0x010 を 3 層にすると、パレットで 0x011 を押すと 0x010 が選ばれ、矩形の選択で 0x011 が
    書かないマスになる。0x011 は鉛筆・矩形塗り・境界ブロックに置けず、ステータスバーに理由が出る。置かれている 0x011 には印が付く。
  - autopen: 自動ペン（#310・#311）。
  - assist: マップ作成補助の窓（#312・#313）。
"""
from __future__ import annotations

import argparse
import base64
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []
PRIMARY = 0x08298B44


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def save_png(data, path: pathlib.Path) -> None:
    png = data if isinstance(data, str) else data.get("png") or data.get("data")
    path.write_bytes(base64.b64decode(png))


def canvas(z: Zigzagu, shots: pathlib.Path | None, name: str, target: str) -> None:
    if shots:
        save_png(z.call({"cmd": "canvasPng", "target": target}), shots / name)


def screenshot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if shots:
        save_png(z.call({"cmd": "screenshot"}), shots / name)


def selection(z: Zigzagu) -> dict:
    return z.call({"cmd": "state"})["selection"]


def make_triple(z: Zigzagu, block: int) -> None:
    """主タイルセットの `block` を 3 層にする（メモリの上だけ。取り消せる）。"""
    info = z.call({"cmd": "blockInfo", "block": block})
    attr = (info["attribute"] & 0x0FFFFFFF) | 0x30000000
    z.call({"cmd": "command", "name": "setBlock", "args": {"tileset": PRIMARY, "secondary": False, "block": block, "attribute": attr}})


def check_triple(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    make_triple(z, 0x10)
    info = z.call({"cmd": "blockInfo", "block": 0x11})
    check(info["tripleChild"] is True, "0x011 が 3 層の次の番号になる")

    # パレット（1 行 8 個）: 0x011 は (1, 2)
    r = z.call({"cmd": "mouse", "target": "palette", "action": "click", "cell": [1, 2]})
    check(selection(z)["blocks"] == [0x10], "パレットで 0x011 を押すと 0x010 が選ばれる")
    check("3層" in z.call({"cmd": "state"})["status"]["left"], "ステータスバーに「3層」が出る")
    canvas(z, shots, "pen_triple_palette.png", "palette")
    # 矩形の選択（Ctrl＋右ドラッグ）: (0,2)〜(0,3) は右端が 3 層なので幅 2、0x011 は書かないマス
    z.call({"cmd": "mouse", "target": "palette", "action": "drag", "button": "right", "ctrl": True, "cell": [0, 2], "to": [0, 3]})
    s = selection(z)
    check(s["width"] == 2 and s["height"] == 2, f"矩形の右端が 3 層なら 1 マス広げる（{s['width']}×{s['height']}）")
    check(s.get("holes") == [False, True, False, False], f"矩形の 0x011 は書かないマス（{s.get('holes')}）")

    before = z.call({"cmd": "cells"})["cells"]
    w = z.call({"cmd": "state"})["map"]["width"]
    # 鉛筆: 0x011 だけの選択は書かれない
    z.call({"cmd": "selectBlock", "block": 0x11})
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [2, 2]})
    after = z.call({"cmd": "cells"})["cells"]
    check(after == before, "鉛筆で 0x011 を置けない")
    st = z.call({"cmd": "state"})["status"]
    check(st["error"] and "3層" in st["left"], f"書けなかった理由がステータスバーに出る（{st['left']}）")
    # 矩形塗り（Ctrl＋左ドラッグ）で 2×1 の [0x010, 0x011]: 0x010 だけ書かれる
    z.call({"cmd": "selectBlock", "blocks": [0x10, 0x11], "width": 2})
    hist = z.call({"cmd": "state"})["history"]
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "ctrl": True, "cell": [2, 2], "to": [3, 2]})
    after = z.call({"cmd": "cells"})["cells"]
    check((after[2 * w + 2] & 0x3FF) == 0x10 and after[2 * w + 3] == before[2 * w + 3], "矩形塗りで 0x010 だけ書き、0x011 のマスは今のまま")
    check(z.call({"cmd": "state"})["history"] == hist + 1, "1 回の操作になる")
    z.call({"cmd": "undo"})
    # 境界ブロック
    border = z.call({"cmd": "cells"})["border"]
    z.call({"cmd": "selectBlock", "block": 0x11})
    z.call({"cmd": "mouse", "target": "border", "action": "click", "cell": [0, 0]})
    check(z.call({"cmd": "cells"})["border"] == border, "境界ブロックにも 0x011 を置けない")

    # 置かれている 0x011（コマンドで直接置く）には印が付く
    z.call({"cmd": "command", "name": "paintBlocks", "args": {"bank": 3, "map": 0, "cells": [{"x": 4, "y": 4, "block": 0x11}]}})
    t = z.call({"cmd": "tripleChildCells"})
    check({"x": 4, "y": 4} in t["cells"] and {"x": 4, "y": 4} in t["marked"], f"置かれている 0x011 に印（{t['marked']}）")
    # 拾うと 0x010 が選ばれる
    z.call({"cmd": "mouse", "target": "map", "action": "rightClick", "cell": [4, 4]})
    check(selection(z)["blocks"] == [0x10], "マップの 0x011 を拾うと 0x010 が選ばれる")
    screenshot(z, shots, "pen_triple_marks.png")
    z.call({"cmd": "setting", "key": "tripleChildMarks", "value": False})
    z.call({"cmd": "action", "id": "view.grid"})
    z.call({"cmd": "action", "id": "view.grid"})
    check(z.call({"cmd": "tripleChildCells"})["marked"] == [], "表示メニューで印を消せる")
    z.call({"cmd": "setting", "key": "tripleChildMarks", "value": True})
    z.call({"cmd": "undo"})
    z.call({"cmd": "undo"})


CHECKS = {"triple": check_triple}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    ap.add_argument("--work")
    ap.add_argument("--only", nargs="*")
    a = ap.parse_args()
    shots = pathlib.Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="zzm-pen-", ignore_cleanup_errors=True) as profile, tempfile.TemporaryDirectory(prefix="zzm-penw-", ignore_cleanup_errors=True) as tmpwork:
        work = pathlib.Path(a.work) if a.work else pathlib.Path(tmpwork)
        ctx = {"rom": a.rom, "work": work}
        with Zigzagu(a.exe, profile=profile, extra=["--mute-audio"]) as z:
            z.call({"cmd": "resize", "width": 1280, "height": 900})
            z.call({"cmd": "open", "rom": a.rom})
            for name, fn in CHECKS.items():
                if a.only and name not in a.only:
                    continue
                print(f"== {name}")
                fn(z, shots, ctx)
    print("失敗: " + str(len(failures)))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
