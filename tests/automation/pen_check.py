"""Phase4 の描く道具（3 層のブロックの選び方と置けない規則、自動ペン、マップ作成補助）を、素の ROM と写しで確かめる。

  python tests/automation/pen_check.py --rom <素の BPRJ の写し> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--work <作業フォルダ>] [--only <名前> ...]

- 起動は --automation・--profile（一時フォルダ）・画面外。ROM には書き込まない。タイルセットの編集はメモリの上だけ
  （出力しない）。マップ作成補助のパーツは --work（既定は一時フォルダ）の maps\\autopen\\ に書く。
- 見ること（`--only` で選べる。名前は下の CHECKS の鍵）:
  - triple: 3 層のブロック（#300・#301）。0x010 を 3 層にすると、パレットで 0x011 を押すと 0x010 が選ばれ、矩形の選択で 0x011 が
    書かないマスになる。0x011 は鉛筆・矩形塗り・境界ブロックに置けず、ステータスバーに理由が出る。置かれている 0x011 には印が付く。
  - autopen: 自動ペン（#310・#311）。
  - autopenBand: 隣のマップの帯の上での自動ペン（マサラタウンの上の 1 番道路）。帯の上だけ・境界をまたぐドラッグのどちらも、
    隣のマップに書かれ、1 回の操作・1 回の取り消しで戻る。
  - assist: マップ作成補助の窓（#312・#313）。
"""
from __future__ import annotations

import argparse
import base64
import pathlib
import sys
import tempfile
import time

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

    # マップ作成補助の窓のブロック一覧（#338）: 0x011 を押すと 0x010 を選び、矩形に入った 0x011 は空き（上の取り消しで 3 層も戻ったので、もう一度）
    make_triple(z, 0x10)
    open_assist(z)
    win(z, {"cmd": "pointer", "id": "assist.source", "type": "down", "x": 1 * 32 + 8, "y": 2 * 32 + 8})
    win(z, {"cmd": "pointer", "id": "assist.source", "type": "up", "x": 1 * 32 + 8, "y": 2 * 32 + 8})
    p = win(z, {"cmd": "state"})["picked"]
    check(p == {"x": 0, "y": 2, "width": 1, "height": 1, "blocks": [0x10]}, f"窓のブロック一覧で 0x011 を押すと 0x010 が選ばれる（{p}）")
    win(z, {"cmd": "pointer", "id": "assist.source", "type": "down", "x": 8, "y": 2 * 32 + 8})
    win(z, {"cmd": "pointer", "id": "assist.source", "type": "up", "x": 2 * 32 + 8, "y": 2 * 32 + 8})
    p = win(z, {"cmd": "state"})["picked"]
    check(p is not None and p["blocks"] == [0x10, None, 0x12], f"窓の矩形に入った 0x011 は空き（{p}）")
    if shots:
        save_png(win(z, {"cmd": "canvasPng", "id": "assist.source"}), shots / "pen_triple_assist.png")
    win(z, {"cmd": "close"})
    z.call({"cmd": "undo"})


def block_at(cells: list[int], w: int, x: int, y: int) -> int:
    return cells[y * w + x] & 0x3FF


def check_autopen(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    st = z.call({"cmd": "autopen.state"})
    names = [p["name"] for p in st["parts"]]
    check("池（岩の岸）" in names and "木" in names, f"素の BPRJ の主タイルセットに既定のパーツ（{names}）")
    z.call({"cmd": "key", "key": "p"})
    st = z.call({"cmd": "autopen.state"})
    check(st["active"] is True, "P で自動ペンがオンになる")
    check(0x12B in st["tinted"], "自動で描けるブロックにパレットで色を重ねる")
    canvas(z, shots, "pen_autopen_palette.png", "palette")
    z.call({"cmd": "autopen.set", "size": 3})
    z.call({"cmd": "selectBlock", "block": 0x12B})
    check(z.call({"cmd": "autopen.state"})["part"] == "池（岩の岸）", "水を選ぶと池のパーツで描く")
    hist = z.call({"cmd": "state"})["history"]
    before = z.call({"cmd": "cells"})
    w = before["width"]
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [9, 13], "to": [13, 13], "steps": 2})
    after = z.call({"cmd": "cells"})["cells"]
    row = lambda y: [block_at(after, w, x, y) for x in range(8, 15)]  # noqa: E731
    check(row(12) == [0x120] + [0x123] * 5 + [0x121], f"上の辺（{[hex(b) for b in row(12)]}）")
    check(row(13) == [0x12A] + [0x12B] * 5 + [0x12C], f"真ん中（{[hex(b) for b in row(13)]}）")
    check(row(14) == [0x132] + [0x133] * 5 + [0x134], f"下の辺（{[hex(b) for b in row(14)]}）")
    check(z.call({"cmd": "state"})["history"] == hist + 1, "1 回のドラッグで 1 回の操作")
    check(after[13 * w + 10] >> 10 == 4, f"移動許可は使用回数でいちばん多い値（{after[13 * w + 10] >> 10:#x}）")
    # 下へ伸ばすと内角が出る
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [9, 14], "to": [9, 17], "steps": 3})
    after2 = z.call({"cmd": "cells"})["cells"]
    corners = {block_at(after2, w, x, y) for x in range(7, 16) for y in range(11, 20)}
    check(0x130 in corners or 0x131 in corners, "凹んだ形で内角が出る")
    screenshot(z, shots, "pen_autopen_pond.png")
    z.call({"cmd": "undo"})
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells"})["cells"] == before["cells"], "2 回の Ctrl+Z で元に戻る")

    # 偶数の筆は、マスの中の位置で寄せる側を決める
    z.call({"cmd": "autopen.set", "size": 2, "fraction": [0.2, 0.2]})
    z.call({"cmd": "selectBlock", "block": 0x00D})
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [9, 13]})
    c = z.call({"cmd": "cells"})["cells"]
    check(all(block_at(c, w, x, y) == 0x00D for x in (8, 9) for y in (12, 13)), "偶数の筆は左上へ寄せる（マスの左上の半分）")
    z.call({"cmd": "undo"})
    z.call({"cmd": "autopen.set", "size": 1, "fraction": None})

    # 木: 縦横に描くと先端・つなぎ目・端が付く
    z.call({"cmd": "selectBlock", "block": 0x01C})
    for cell in ([8, 12], [10, 12], [8, 14], [10, 14]):
        z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": cell})
    t = z.call({"cmd": "cells"})["cells"]
    trow = lambda y: [block_at(t, w, x, y) for x in range(8, 12)]  # noqa: E731
    check(trow(11) == [0x0E, 0x0F, 0x0E, 0x0F], f"木の先端（{[hex(b) for b in trow(11)]}）")
    check(trow(12) == [0x1E, 0x1F, 0x1E, 0x1F], f"真上に木が無い上の段（{[hex(b) for b in trow(12)]}）")
    check(trow(13) == [0x16, 0x15, 0x14, 0x17], f"つなぎ目と森の端（{[hex(b) for b in trow(13)]}）")
    check(trow(15) == [0x26, 0x25, 0x24, 0x27], f"下の段（{[hex(b) for b in trow(15)]}）")
    screenshot(z, shots, "pen_autopen_tree.png")
    for _ in range(4):
        z.call({"cmd": "undo"})

    # 部品: 押した所を左上にして 1 回置く
    z.call({"cmd": "selectBlock", "block": 0x048})
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [3, 12], "to": [6, 14]})
    p = z.call({"cmd": "cells"})["cells"]
    check(block_at(p, w, 3, 12) == 0x048 and block_at(p, w, 7, 15) == 0x19F, "部品は押した所を左上にして 1 回置く")
    z.call({"cmd": "undo"})
    # パーツに無いブロックはふつうの鉛筆
    z.call({"cmd": "selectBlock", "block": 0x001})
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [9, 13]})
    check(block_at(z.call({"cmd": "cells"})["cells"], w, 9, 13) == 0x001, "パーツに無いブロックはふつうに描く")
    z.call({"cmd": "undo"})
    z.call({"cmd": "key", "key": "P"})
    check(z.call({"cmd": "autopen.state"})["active"] is False, "P でオフに戻る")


def map_cells(z: Zigzagu, bank: int, map_: int) -> tuple[int, list[int]]:
    c = z.call({"cmd": "cells", "bank": bank, "map": map_})
    return c["width"], c["cells"]


def check_autopen_band(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    """隣のマップの帯の上での自動ペン（マサラタウン 3.0 の上の帯が 1 番道路 3.19）。"""
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    z.call({"cmd": "neighbors.state", "wait": True})
    pw, p0 = map_cells(z, 3, 0)
    rw, r0 = map_cells(z, 3, 19)
    rh = len(r0) // rw
    z.call({"cmd": "key", "key": "p"})
    z.call({"cmd": "autopen.set", "size": 3})
    z.call({"cmd": "selectBlock", "block": 0x12B})
    # 主マップの中で 1 回押したときの 3×3（比べる元）
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [10, 10]})
    _, pm = map_cells(z, 3, 0)
    want = [block_at(pm, pw, x, y) for y in range(9, 12) for x in range(9, 12)]
    z.call({"cmd": "undo"})
    # 境界をまたぐドラッグ（主マップ → 帯。1 番道路を初めて書くので、読み込みを待ってから書く）は 1 回の操作で、1 回の取り消しで両方戻る
    hist = z.call({"cmd": "state"})["history"]
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [10, 2], "to": [10, -3], "steps": 5})
    time.sleep(0.5)  # 隣のマップを編集用に読み込むのを待つ
    _, p1 = map_cells(z, 3, 0)
    _, r1 = map_cells(z, 3, 19)
    check(block_at(r1, rw, 10, rh - 1) == 0x12B and block_at(p1, pw, 10, 0) == 0x12B, "境界をまたいで描くと、両方のマップに水が続く")
    check(z.call({"cmd": "state"})["history"] == hist + 1, "境界をまたぐドラッグも 1 回の操作")
    screenshot(z, shots, "pen_autopen_band_cross.png")
    z.call({"cmd": "undo"})
    check(map_cells(z, 3, 19)[1] == r0 and map_cells(z, 3, 0)[1] == p0, "1 回の取り消しで両方のマップが戻る")
    # 帯の上だけ（1 番道路の下から 4 行目を中心に 3×3）
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [10, -4]})
    time.sleep(0.5)  # 隣のマップを編集用に読み込むのを待つ
    _, p1 = map_cells(z, 3, 0)
    _, r1 = map_cells(z, 3, 19)
    got = [block_at(r1, rw, x, y) for y in range(rh - 5, rh - 2) for x in range(9, 12)]
    check(0x12B in want and got == want, f"帯の上の自動ペンで、主マップと同じ池を 1 番道路に描く（{[hex(b) for b in got]}、主マップ {[hex(b) for b in want]}）")
    check(p1 == p0, "帯の上だけで描いたときは主マップは変わらない")
    st = z.call({"cmd": "state"})
    check(st["history"] == hist + 1 and "3.19" in st["dirty"], f"1 回の操作で 1 番道路に未出力の印（{st['history'] - hist}、{st['dirty']}）")
    if shots:
        (shots / "pen_autopen_band.png").write_bytes(base64.b64decode(z.call({"cmd": "canvasPng", "target": "map", "neighbors": True})["png"]))
    z.call({"cmd": "undo"})
    check(map_cells(z, 3, 19)[1] == r0 and map_cells(z, 3, 0)[1] == p0, "1 回の取り消しで帯の上の自動ペンが戻る")
    z.call({"cmd": "key", "key": "P"})


def win(z: Zigzagu, cmd: dict):
    return z.call({**cmd, "window": "map-assist"})


def open_assist(z: Zigzagu, need_parts: bool = True) -> dict:
    """ツール > マップ作成補助 を開き、窓が答えるまで待つ（`need_parts` ならパーツの一覧が届くまで）。"""
    r = z.call({"cmd": "action", "id": "tools.mapAssist"})
    for _ in range(100):
        try:
            st = win(z, {"cmd": "state"})
            if st["parts"] or not need_parts:
                return st
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.2)
    raise SystemExit(f"マップ作成補助の窓が開きません（{r}）")


def check_assist(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    work = ctx["work"]
    z.call({"cmd": "open", "rom": ctx["rom"], "project": str(work)})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    # 池を描いてから縁を崩す
    z.call({"cmd": "autopen.set", "active": True, "size": 3})
    z.call({"cmd": "selectBlock", "block": 0x12B})
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [9, 13], "to": [13, 13], "steps": 2})
    z.call({"cmd": "autopen.set", "active": False})
    good = z.call({"cmd": "cells"})["cells"]
    w = z.call({"cmd": "state"})["map"]["width"]
    z.call({"cmd": "command", "name": "paintBlocks", "args": {"bank": 3, "map": 0, "cells": [{"x": 10, "y": 12, "block": 0x12B}, {"x": 14, "y": 13, "block": 0x12B}, {"x": 11, "y": 14, "block": 0x12B}]}})
    broken = z.call({"cmd": "cells"})["cells"]
    # メインで範囲を選ぶ（Ctrl＋右ドラッグ）
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "button": "right", "ctrl": True, "cell": [7, 11], "to": [15, 15]})
    st = open_assist(z)
    check("池（岩の岸）" in [p["name"] for p in st["parts"]], "マップ作成補助の窓にパーツの一覧が出る")
    check(st["range"] == {"x": 7, "y": 11, "width": 9, "height": 5}, f"メインで選んだ範囲が出る（{st['range']}）")
    hist = z.call({"cmd": "state"})["history"]
    win(z, {"cmd": "click", "id": "assist.tidy"})
    fixed = z.call({"cmd": "cells"})["cells"]
    check(fixed == good, "範囲を整えると崩れた縁が直る")
    check(z.call({"cmd": "state"})["history"] == hist + 1, "範囲を整えるのは 1 回の操作")
    screenshot(z, shots, "pen_assist_main.png")
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "cells"})["cells"] == broken, "メインの 1 回の Ctrl+Z で戻る")
    # 選んだパーツで範囲を塗る（草むら）
    names = [p["name"] for p in win(z, {"cmd": "state"})["parts"]]
    win(z, {"cmd": "setField", "id": "assist.parts", "value": names.index("草むら")})
    win(z, {"cmd": "click", "id": "assist.fill"})
    g = z.call({"cmd": "cells"})["cells"]
    check(all((g[y * w + x] & 0x3FF) == 0x00D for x in range(7, 16) for y in range(11, 16)), "選んだパーツで範囲を塗る")
    z.call({"cmd": "undo"})
    # パーツを作って保存する（面。ブロック一覧の 0x001 を入れる）
    win(z, {"cmd": "click", "id": "assist.add.fill"})
    win(z, {"cmd": "pointer", "id": "assist.source", "type": "down", "x": 48, "y": 16})
    win(z, {"cmd": "pointer", "id": "assist.source", "type": "up", "x": 48, "y": 16})
    win(z, {"cmd": "click", "id": "assist.put"})
    win(z, {"cmd": "setField", "id": "assist.name", "value": "テストの面"})
    shot_w = win(z, {"cmd": "state"})
    check(shot_w["picked"] == {"x": 1, "y": 0, "width": 1, "height": 1, "blocks": [0x001]} and "Blocks" in [p for p in shot_w["parts"] if p["name"] == "テストの面"][0]["slots"], "左で選んだ所を枠に入れる")
    if shots:
        save_png(z.call({"cmd": "screenshot", "window": "map-assist"}), shots / "pen_assist_window.png")
    win(z, {"cmd": "click", "id": "assist.save"})
    path = pathlib.Path(work) / "maps" / "autopen" / "primary_298B44.json"
    check(path.exists() and "テストの面" in path.read_text(encoding="utf-8"), "保存すると maps/autopen に書く")
    check("テストの面" in [p["name"] for p in z.call({"cmd": "autopen.state"})["parts"]], "保存したパーツを自動ペンで使える")
    # マップから候補を作る（#313）
    win(z, {"cmd": "click", "id": "assist.analyze"})
    auto: list = []
    for _ in range(150):
        st = win(z, {"cmd": "state"})
        auto = [p for p in st["parts"] if p["name"].startswith("自動: ")]
        if auto:
            break
        time.sleep(0.2)
    check(any(p["kind"] == "edge" for p in auto) and any(p["role"] == "grass" for p in auto) and any(p["role"] == "tree" for p in auto), f"候補に水の縁・草むら・森が出る（{len(auto)} 個）")
    win(z, {"cmd": "close"})
    ctx["saved_path"] = path


def check_assist_reopen(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "open", "rom": ctx["rom"], "project": str(ctx["work"])})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    check("テストの面" in [p["name"] for p in z.call({"cmd": "autopen.state"})["parts"]], "開き直しても保存したパーツが残る")


CHECKS = {"triple": check_triple, "autopen": check_autopen, "autopenBand": check_autopen_band, "assist": check_assist, "assistReopen": check_assist_reopen}


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
    with tempfile.TemporaryDirectory(prefix="zzm-penw-", ignore_cleanup_errors=True) as tmpwork:
        work = pathlib.Path(a.work) if a.work else pathlib.Path(tmpwork)
        ctx = {"rom": a.rom, "work": work}
        for name, fn in CHECKS.items():
            if a.only and name not in a.only:
                continue
            print(f"== {name}")
            # 確かめることごとに起動し直す（開き直しを確かめるため。個人設定も別の一時フォルダ）
            with tempfile.TemporaryDirectory(prefix="zzm-pen-", ignore_cleanup_errors=True) as profile:
                with Zigzagu(a.exe, profile=profile, extra=["--mute-audio"]) as z:
                    z.call({"cmd": "resize", "width": 1280, "height": 900})
                    z.call({"cmd": "open", "rom": a.rom})
                    fn(z, shots, ctx)
    print("失敗: " + str(len(failures)))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
