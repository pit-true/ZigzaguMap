"""Phase3 の接続と描画（列 A・B）を、素の ROM だけで確かめる。

  python tests/automation/connection_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--only 222,223]

- 222: 2 枚のマップへの paintBlocks を group で実行すると、両方に未出力の印が付き、出力で両方の JSON が書かれる。
  1 回の取り消しで両方が戻って印が消え、もう一度出力するとファイルが消える（ベース ROM と同じに戻ったため）。
- 223: 隣のマップの帯。マサラタウンで 1 番道路（上）と 21 番水道（下）の帯が出る。ずれが 0 でないマップも含め、帯の画素が
  隣のマップを開いたときの画像の同じ部分を暗くしたものと一致する。帯の上のダブルクリックでそのマップへ移る。
  設定（マップ全体・出さない）の切り替え、移動エリア・イベントのタブにも帯が出る、マップの切り替えの時間。
- 229: 角のつまみをドラッグして接続のずれを変える。マサラタウンの上の 1 番道路のつまみを 3 マス動かすと、両方の接続が +3 と -3 になり、
  両方に未出力の印が付く。1 回の取り消しで両方戻る。出力して開き直しても同じ。コネクションマネージャーでずれを変えても相手がそろう
  （設定で切ればそろえない）。
- 230: 辺のつまみの右クリックのメニュー。右の辺から新しいマップを作ってつなぐ（両側の接続、1 回の取り消しでマップも消える、
  出力して開き直しても残る）、左の辺に既存のマップ（3.1）をつなぐ（ずれは中央）、上の接続を消す（相手の逆の接続も）、
  ダイブ先をつなぐ（2 つ目はできない）。
- 225: マップの 3×2 を Ctrl＋右ドラッグで拾うと移動許可も持ち、左クリックで貼るとブロックと移動許可の両方が写る。
  「移動許可も貼る」を外すとブロックだけ写る。1 回の取り消しで戻る。Ctrl+C / Ctrl+V で貼る。
- 233: Ctrl＋左ドラッグの矩形塗り（5×4、2×2 のスタンプで 6×6 の敷き詰め、移動エリアタブの移動許可）と、Alt＋左ドラッグの
  2 マスの入れ替え。どれも 1 回の取り消しで戻る。Esc でドラッグを取りやめると何も変わらない。
- 231: 辺のつまみのドラッグでリサイズ。マサラタウンを左へ 3 広げると、イベントが 3 右へ、上下の接続のずれが +3、相手側が -3 になり、
  隣の帯との位置関係が変わらない（元の範囲の画像が同じ）。1 回の取り消しで全部戻る。出力して開き直しても同じ。右へ縮める・制限。
- 234: 境界をまたぐ描画。マサラタウンと 1 番道路の境界をまたいで 4×4 を矩形塗りすると両方のマップが変わり、1 回の取り消しで両方戻る。
  鉛筆のドラッグ・拾う・矩形の選択・入れ替え・移動エリアタブの矩形塗りも境界をまたぐ。帯の外には描かない。出力で両方の JSON。
- 232: Space でダイブ先を重ねる。素の BPRJ にはダイブの接続が無いので、マサラタウンから 1 番道路へダイブの接続を作って確かめる。
  接続が無いと知らせる。Space を押している間、カーソルのまわりに相手のマップが出て、ダブルクリックで相手を開く。離すと消える。
- 236: ミキシングバッグ。Ctrl＋パレットの左クリックで出し入れし、草 3 種を袋に入れて 6×6 を矩形塗りすると 3 種が混ざる。
  取り消しとやり直しで同じ絵に戻る。種を決めると同じ並びになる。Ctrl＋袋のクリックで空にする。
- 246: 接続している全マップの画像。マサラタウンから、つながっている屋外のマップ全部が接続のずれどおりに並ぶ（マサラタウンの部分の画素が
  マップの画像と同じ）。今のマップ 1 枚、イベントの有無、縮め方。作っている間と後のメモリ（専用ワーキングセット）を記録する。
  クリップボードには書かない（`clipboard` を付けない）。
- ほかの番号は、その issue を足すときに関数を足す（`CHECKS` の表）。
"""
from __future__ import annotations

import argparse
import base64
import io
import os
import pathlib
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

try:
    from PIL import Image, ImageChops
except ImportError:  # 画素の比べ合わせだけ飛ばす
    Image = None

failures: list[str] = []

PALLET = {"bank": 3, "map": 0}
ROUTE1 = {"bank": 3, "map": 19}


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if not shots:
        return
    png = z.call({"cmd": "screenshot"})
    (shots / name).write_bytes(base64.b64decode(png if isinstance(png, str) else png["png"]))


def map_json(bank: int, map_: int) -> str:
    return f"maps/{bank:02d}/{map_:02d}.json"


def written(result: dict, bank: int, map_: int, key: str = "written") -> bool:
    want = map_json(bank, map_).replace("/", "\\")
    return any(p.replace("/", "\\").lower().endswith(want.lower()) for p in result[key])


def check_222(z: Zigzagu, work: pathlib.Path, shots: pathlib.Path | None) -> None:
    out = work / "out222"
    out.mkdir(parents=True, exist_ok=True)
    z.call({"cmd": "selectMap", **PALLET})
    group = {
        "name": "group",
        "args": {
            "commands": [
                {"name": "paintBlocks", "args": {**PALLET, "cells": [{"x": 1, "y": 1, "block": 5}]}},
                {"name": "paintBlocks", "args": {**ROUTE1, "cells": [{"x": 2, "y": 2, "block": 6}]}},
            ]
        },
    }
    z.call({"cmd": "command", **group})
    st = z.call({"cmd": "state"})
    check("3.0" in st["dirty"] and "3.19" in st["dirty"], "2 枚のマップへの group で両方に未出力の印が付く")
    cells = z.call({"cmd": "cells"})
    check(cells["cells"][1 * cells["width"] + 1] & 0x3FF == 5, "表示中のマップが描き直される（配置が変わる）")
    z.call({"cmd": "undo"})
    st = z.call({"cmd": "state"})
    check("3.0" not in st["dirty"] and "3.19" not in st["dirty"], "1 回の取り消しで両方が戻り、印が消える（ベース ROM と同じに戻るため）")
    cells = z.call({"cmd": "cells"})
    check(cells["cells"][1 * cells["width"] + 1] & 0x3FF != 5, "取り消しで表示中のマップも描き直される")
    z.call({"cmd": "redo"})
    st = z.call({"cmd": "state"})
    check("3.0" in st["dirty"] and "3.19" in st["dirty"], "やり直しで両方にまた印が付く")
    r = z.call({"cmd": "export", "dir": str(out)})
    check(written(r, 3, 0) and written(r, 3, 19), "出力で両方のマップの JSON が書かれる")
    z.call({"cmd": "undo"})
    r = z.call({"cmd": "export", "dir": str(out)})
    check(written(r, 3, 0, "removed") and written(r, 3, 19, "removed"), "取り消して出力すると両方のファイルが消える（ベース ROM と同じ）")

def png_of(z: Zigzagu, req: dict):
    r = z.call(req)
    data = base64.b64decode(r if isinstance(r, str) else r["png"])
    return Image.open(io.BytesIO(data)).convert("RGB") if Image else data


# 隣の帯を暗くする割合（NeighborLayer.ts の NEIGHBOR_SHADE）
SHADE = 0.3


def bands_match(z: Zigzagu, bank: int, map_: int) -> tuple[bool, str]:
    """主マップの帯の画素が、隣のマップの同じ部分を暗くしたものと一致するか。"""
    z.call({"cmd": "selectMap", "bank": bank, "map": map_})
    st = z.call({"cmd": "neighbors.state", "wait": True})
    if Image is None:
        return True, "PIL が無いので画素は比べない"
    whole = png_of(z, {"cmd": "canvasPng", "target": "map", "neighbors": True})
    m = st["margins"]
    bad = []
    for n in st["neighbors"]:
        z.call({"cmd": "selectMap", "bank": n["bank"], "map": n["map"]})
        other = png_of(z, {"cmd": "canvasPng", "target": "map"})
        a, b = n["bandAt"], n["band"]
        got = whole.crop(((m["left"] + a["x"]) * 16, (m["top"] + a["y"]) * 16, (m["left"] + a["x"] + a["width"]) * 16, (m["top"] + a["y"] + a["height"]) * 16))
        want = other.crop((b["x"] * 16, b["y"] * 16, (b["x"] + b["width"]) * 16, (b["y"] + b["height"]) * 16)).point(lambda v: round(v * (1 - SHADE)))
        diff = max(hi for _lo, hi in ImageChops.difference(got, want).getextrema())
        if diff > 2:
            bad.append(f"{n['bank']}.{n['map']}（差 {diff}）")
    z.call({"cmd": "selectMap", "bank": bank, "map": map_})
    return not bad, "、".join(bad)


def check_223(z: Zigzagu, work: pathlib.Path, shots: pathlib.Path | None) -> None:
    z.call({"cmd": "selectMap", **PALLET})
    st = z.call({"cmd": "neighbors.state", "wait": True})
    got = {(n["side"], n["bank"], n["map"]) for n in st["neighbors"]}
    check(st["view"] == "band" and st["range"] == 8, "既定は境界から 8 ブロックの帯")
    check(("up", 3, 19) in got and ("down", 3, 39) in got, "マサラタウンの上に 1 番道路、下に 21 番水道の帯が出る")
    up = next(n for n in st["neighbors"] if n["map"] == 19)
    check(up["bandAt"] == {"x": 0, "y": -8, "width": 24, "height": 8} and st["margins"]["top"] == 8, "1 番道路の帯は主マップの上 8 マス")
    if shots:
        (shots / "p3c_223_pallet_band.png").write_bytes(base64.b64decode(z.call({"cmd": "canvasPng", "target": "map", "neighbors": True})["png"]))
    ok, why = bands_match(z, 3, 0)
    check(ok, f"マサラタウンの帯の画素が隣のマップと一致する {why}")
    # ずれ（offset）が 0 でない接続を持つマップを探して同じように比べる
    shifted = None
    for m in range(0, 60):
        try:
            z.call({"cmd": "selectMap", "bank": 3, "map": m})
        except Exception:  # noqa: BLE001
            continue
        s2 = z.call({"cmd": "neighbors.state", "wait": True})
        # 負のずれがあるマップを優先する（無ければ正のずれのもの）
        if any(n["offset"] != 0 for n in s2["neighbors"]):
            shifted = (3, m, [n["offset"] for n in s2["neighbors"]])
            if any(n["offset"] < 0 for n in s2["neighbors"]):
                break
    check(shifted is not None, f"ずれが 0 でない接続のマップがある {shifted}")
    if shifted:
        ok, why = bands_match(z, shifted[0], shifted[1])
        check(ok, f"ずれのあるマップ {shifted[0]}.{shifted[1]}（offset {shifted[2]}）の帯の画素が一致する {why}")
        if shots:
            (shots / f"p3c_223_offset_{shifted[0]}_{shifted[1]}.png").write_bytes(base64.b64decode(z.call({"cmd": "canvasPng", "target": "map", "neighbors": True})["png"]))
    # ダブルクリックで隣のマップへ
    z.call({"cmd": "selectMap", **PALLET})
    z.call({"cmd": "neighbors.state", "wait": True})
    z.call({"cmd": "mouse", "target": "map", "action": "dblclick", "cell": [5, -3]})
    check(z.call({"cmd": "state"})["map"]["map"] == 19, "帯の上のダブルクリックでそのマップ（1 番道路）を開く")
    # 移動エリア・イベントのタブにも出る
    z.call({"cmd": "selectMap", **PALLET})
    z.call({"cmd": "neighbors.state", "wait": True})
    for tab in ("movement", "event"):
        z.call({"cmd": "tab", "name": tab})
        img = png_of(z, {"cmd": "canvasPng", "target": tab, "neighbors": True})
        h = img.size[1] if Image else 0
        check(not Image or h == (20 + 16) * 16, f"{tab} のタブにも帯が出る（高さ {h}）")
        if shots and tab == "movement":
            (shots / "p3c_223_movement_band.png").write_bytes(base64.b64decode(z.call({"cmd": "canvasPng", "target": tab, "neighbors": True})["png"]))
    z.call({"cmd": "tab", "name": "map"})
    # 設定の切り替え（メニューの項目）
    z.call({"cmd": "action", "id": "neighbors.all"})
    st = z.call({"cmd": "neighbors.state", "wait": True})
    check(st["view"] == "all" and st["margins"]["top"] == 40, "表示 > 隣のマップ > マップ全体 で隣のマップ全体が出る")
    z.call({"cmd": "action", "id": "neighbors.off"})
    st = z.call({"cmd": "neighbors.state", "wait": True})
    check(st["neighbors"] == [] and st["margins"] == {"left": 0, "top": 0, "right": 0, "bottom": 0}, "出さない で帯も余白も消える")
    z.call({"cmd": "action", "id": "neighbors.band"})
    # 切り替えの時間（主マップを出すまでと、帯を描き終えるまで）
    switch, neigh = [], []
    for m in [0, 19, 1, 20, 2, 21, 3, 22, 4, 23, 0]:
        r = z.call({"cmd": "selectMap", "bank": 3, "map": m})
        st = z.call({"cmd": "neighbors.state", "wait": True})
        switch.append(r["switchMs"])
        neigh.append(st["neighborsMs"])
    switch_sorted, neigh_sorted = sorted(switch[1:]), sorted(neigh[1:])
    med = switch_sorted[len(switch_sorted) // 2]
    nmed = neigh_sorted[len(neigh_sorted) // 2]
    print(f"     切り替え 中央値 {med:.1f}ms 最大 {max(switch[1:]):.1f}ms / 帯まで 中央値 {nmed:.1f}ms 最大 {max(neigh[1:]):.1f}ms")
    check(med <= 100, f"マップの切り替え（主マップを出すまで）の中央値が 100ms 以内（{med:.1f}ms）")
    check(nmed <= 200, f"隣を描き終えるまでの中央値が 200ms 以内（{nmed:.1f}ms）")


def offset_to(z: Zigzagu, bank: int, map_: int, target: int) -> int | None:
    """マップ bank.map の、target（同じバンク）への接続のずれ（帯で見えているもの）。"""
    z.call({"cmd": "selectMap", "bank": bank, "map": map_})
    st = z.call({"cmd": "neighbors.state", "wait": True})
    return next((n["offset"] for n in st["neighbors"] if n["bank"] == bank and n["map"] == target), None)


def check_229(z: Zigzagu, work: pathlib.Path, shots: pathlib.Path | None) -> None:
    z.call({"cmd": "selectMap", **PALLET})
    z.call({"cmd": "neighbors.state", "wait": True})
    handles = z.call({"cmd": "connection.handles"})
    ids = {h["id"] for h in handles}
    check({"corner:0:start", "corner:0:end", "corner:1:start", "corner:1:end"} <= ids, f"帯の両端に角のつまみが出る {sorted(ids)}")
    z.call({"cmd": "mouse", "target": "connectionHandle", "handle": "corner:0:start", "action": "drag", "cell": [0, 0], "to": [3, 0]})
    st = z.call({"cmd": "state"})
    check("3.0" in st["dirty"] and "3.19" in st["dirty"], "両方のマップに未出力の印が付く")
    if shots:
        z.call({"cmd": "neighbors.state", "wait": True})
        (shots / "p3c_229_after_drag.png").write_bytes(base64.b64decode(z.call({"cmd": "canvasPng", "target": "map", "neighbors": True})["png"]))
    check(offset_to(z, 3, 0, 19) == 3 and offset_to(z, 3, 19, 0) == -3, "つまみを 3 マス動かすと、自分のずれが +3、相手のずれが -3 になる")
    z.call({"cmd": "undo"})
    check(offset_to(z, 3, 0, 19) == 0 and offset_to(z, 3, 19, 0) == 0, "1 回の取り消しで両方が戻る")
    st = z.call({"cmd": "state"})
    check("3.0" not in st["dirty"] and "3.19" not in st["dirty"], "取り消すと両方の印が消える")
    z.call({"cmd": "redo"})
    out = work / "out229"
    out.mkdir(parents=True, exist_ok=True)
    r = z.call({"cmd": "export", "dir": str(out)})
    check(written(r, 3, 0) and written(r, 3, 19), "出力で両方の JSON が書かれる")
    z.call({"cmd": "open", "rom": z.rom, "project": str(out)})
    check(offset_to(z, 3, 0, 19) == 3 and offset_to(z, 3, 19, 0) == -3, "出力したフォルダで開き直しても +3 と -3")
    # コネクションマネージャー（相手もそろえる。既定オン）
    z.call({"cmd": "selectMap", **PALLET})
    z.call({"cmd": "action", "id": "tools.connections"})
    z.call({"cmd": "setField", "id": "conn.offset", "value": "5"})
    z.call({"cmd": "click", "id": "conn.save"})
    check(offset_to(z, 3, 0, 19) == 5 and offset_to(z, 3, 19, 0) == -5, "コネクションマネージャーでずれを 5 にすると相手が -5 になる")
    z.call({"cmd": "undo"})
    check(offset_to(z, 3, 0, 19) == 3 and offset_to(z, 3, 19, 0) == -3, "マネージャーの変更も 1 回の取り消しで両方戻る")
    z.call({"cmd": "action", "id": "opt.alignConnections"})
    z.call({"cmd": "selectMap", **PALLET})
    z.call({"cmd": "setField", "id": "conn.offset", "value": "6"})
    z.call({"cmd": "click", "id": "conn.save"})
    check(offset_to(z, 3, 0, 19) == 6 and offset_to(z, 3, 19, 0) == -3, "設定でそろえないにすると、相手は変わらない")
    z.call({"cmd": "action", "id": "opt.alignConnections"})


def wait_dialog(z: Zigzagu, title: str, timeout: float = 10) -> dict | None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        for d in z.call({"cmd": "dialogs"})["dialogs"]:
            if d.get("title") == title:
                return d
        time.sleep(0.1)
    return None


def conns(z: Zigzagu, bank: int, map_: int) -> list[dict]:
    z.call({"cmd": "selectMap", "bank": bank, "map": map_})
    return z.call({"cmd": "neighbors.state", "wait": True})["connections"]


def open_main(z: Zigzagu) -> None:
    z.call({"cmd": "selectMap", **PALLET})
    z.call({"cmd": "neighbors.state", "wait": True})


def map_exists(z: Zigzagu, bank: int, map_: int) -> bool:
    try:
        z.call({"cmd": "selectMap", "bank": bank, "map": map_})
        return True
    except Exception:  # noqa: BLE001
        return False


def check_230(z: Zigzagu, work: pathlib.Path, shots: pathlib.Path | None) -> None:
    open_main(z)
    ids = {h["id"] for h in z.call({"cmd": "connection.handles"})}
    check({"edge:up", "edge:down", "edge:left", "edge:right"} <= ids, "主マップの 4 辺に辺のつまみが出る")
    items = {i["id"]: i for i in z.call({"cmd": "connection.menu", "side": "right"})}
    check({"newMap", "connect", "diveNew", "diveConnect", "emergeNew", "emergeConnect"} <= set(items), f"右クリックのメニューの項目 {sorted(items)}")
    if shots:
        shot(z, shots, "p3c_230_edge_menu.png")
    # 新しいマップを作ってつなぐ
    z.call({"cmd": "contextMenu.press", "id": "newMap"})
    d = wait_dialog(z, "新しいマップのバンク")
    check(d is not None and d.get("input") == "3", f"バンクを聞く（既定は今のマップのバンク 3）{d and d.get('input')}")
    if shots:
        shot(z, shots, "p3c_230_bank_dialog.png")
    z.call({"cmd": "dialog", "press": "ok"})
    st = z.call({"cmd": "neighbors.state", "wait": True})
    right = next((n for n in st["neighbors"] if n["side"] == "right"), None)
    check(right is not None and right["bank"] == 3 and right["offset"] == 0 and right["placement"]["width"] == 20 and right["placement"]["height"] == 20,
          f"右に新しいマップ（20×20、ずれ 0）がつながる {right and (right['bank'], right['map'], right['placement'])}")
    if right is None:
        return
    new = right["map"]
    st = z.call({"cmd": "state"})
    check(f"3.{new}" in st["dirty"] and "3.0" in st["dirty"], f"両方に未出力の印が付く {st['dirty']}")
    if shots:
        shot(z, shots, "p3c_230_new_map.png")
    back = conns(z, 3, new)
    check(back == [{"index": 0, "direction": 3, "offset": 0, "bank": 3, "map": 0}], f"新しいマップには左向きにマサラタウンへの接続がある {back}")
    z.call({"cmd": "undo"})
    check(not map_exists(z, 3, new) and all(c["direction"] != 4 for c in conns(z, 3, 0)), "1 回の取り消しで新しいマップも接続も消える")
    # 既存のマップとつなぐ（左に 3.1 トキワシティ）
    open_main(z)
    z.call({"cmd": "connection.menu", "side": "left"})
    z.call({"cmd": "contextMenu.press", "id": "connect"})
    check(wait_dialog(z, "つなぐマップ") is not None, "つなぐマップを選ぶダイアログが出る")
    if shots:
        z.call({"cmd": "dialog", "input": "トキワ"})
        shot(z, shots, "p3c_230_pick_map.png")
    z.call({"cmd": "dialog", "input": "3.1", "press": "ok"})
    time.sleep(0.3)
    mine = next((c for c in conns(z, 3, 0) if c["direction"] == 3), None)
    other = next((c for c in conns(z, 3, 1) if c["direction"] == 4 and c["map"] == 0), None)
    check(mine is not None and mine["map"] == 1 and other is not None and other["offset"] == -mine["offset"],
          f"左にトキワシティがつながり、相手に右向きの逆の接続（ずれは逆）ができる {mine} {other}")
    z.call({"cmd": "undo"})
    check(all(c["direction"] != 3 for c in conns(z, 3, 0)) and not any(c["map"] == 0 and c["direction"] == 4 for c in conns(z, 3, 1)), "取り消すと両方の接続が消える")
    # 接続を消す（上の 1 番道路）
    open_main(z)
    items = z.call({"cmd": "connection.menu", "side": "up"})
    rm = next((i for i in items if i["id"].startswith("remove:")), None)
    check(rm is not None and "3.19" in rm["label"], f"上の辺のメニューに「接続を消す（3.19 …）」がある {rm}")
    if rm:
        z.call({"cmd": "contextMenu.press", "id": rm["id"]})
        time.sleep(0.3)
        check(bool(z.call({"cmd": "dialogs"})["dialogs"]), "消す前に確かめる")
        z.call({"cmd": "dialog", "press": "yes"})
        time.sleep(0.3)
        check(all(c["map"] != 19 for c in conns(z, 3, 0)) and all(c["map"] != 0 for c in conns(z, 3, 19)), "消すと相手（1 番道路）の逆の接続も消える")
        z.call({"cmd": "undo"})
        check(any(c["map"] == 19 for c in conns(z, 3, 0)) and any(c["map"] == 0 for c in conns(z, 3, 19)), "1 回の取り消しで両方戻る")
    # ダイブ先をつなぐ
    open_main(z)
    z.call({"cmd": "connection.menu", "side": "down"})
    z.call({"cmd": "contextMenu.press", "id": "diveConnect"})
    wait_dialog(z, "ダイブ・浮上でつなぐマップ")
    z.call({"cmd": "dialog", "input": "3.40", "press": "ok"})
    time.sleep(0.3)
    dive = next((c for c in conns(z, 3, 0) if c["direction"] == 5), None)
    emerge = next((c for c in conns(z, 3, 40) if c["direction"] == 6), None)
    check(dive is not None and dive["map"] == 40 and emerge is not None and emerge["map"] == 0, f"ダイブ先をつなぐと、相手に浮上の接続ができる {dive} {emerge}")
    open_main(z)
    items = {i["id"]: i for i in z.call({"cmd": "connection.menu", "side": "down"})}
    check(not items["diveConnect"]["enabled"] and not items["diveNew"]["enabled"], "ダイブ先があると、ダイブの項目は押せない")
    z.call({"cmd": "key", "key": "Escape"})
    z.call({"cmd": "undo"})
    # 新しいマップを作って出力し、開き直す
    open_main(z)
    z.call({"cmd": "connection.menu", "side": "right"})
    z.call({"cmd": "contextMenu.press", "id": "newMap"})
    wait_dialog(z, "新しいマップのバンク")
    z.call({"cmd": "dialog", "press": "ok"})
    st = z.call({"cmd": "neighbors.state", "wait": True})
    right = next((n for n in st["neighbors"] if n["side"] == "right"), None)
    out = work / "out230"
    out.mkdir(parents=True, exist_ok=True)
    z.call({"cmd": "export", "dir": str(out)})
    z.call({"cmd": "open", "rom": z.rom, "project": str(out)})
    again = next((c for c in conns(z, 3, 0) if c["direction"] == 4), None)
    back = conns(z, 3, right["map"]) if right else []
    check(right is not None and again is not None and again["map"] == right["map"] and any(c["direction"] == 3 and c["map"] == 0 for c in back),
          "出力して開き直しても、新しいマップと両側の接続が残る")


def cells_of(z: Zigzagu) -> tuple[int, list[int]]:
    c = z.call({"cmd": "cells"})
    return c["width"], c["cells"]


def region(width: int, cells: list[int], x0: int, y0: int, w: int, h: int) -> list[int]:
    return [cells[(y0 + y) * width + x0 + x] for y in range(h) for x in range(w)]


def check_225(z: Zigzagu, work: pathlib.Path, shots: pathlib.Path | None) -> None:
    z.call({"cmd": "selectMap", **PALLET})
    z.call({"cmd": "tab", "name": "map"})
    width, before = cells_of(z)
    # 家の角（移動許可 0x01 と 0x0C が混ざる）
    src = region(width, before, 3, 5, 3, 2)
    r = z.call({"cmd": "mouse", "target": "map", "action": "drag", "button": "right", "ctrl": True, "cell": [3, 5], "to": [5, 6]})
    sel = r["block"]
    check(sel["width"] == 3 and sel["height"] == 2 and sel.get("movements") == [c >> 10 for c in src], f"Ctrl＋右ドラッグで 3×2 を拾うと移動許可も持つ {sel}")
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [10, 10]})
    _, after = cells_of(z)
    check(region(width, after, 10, 10, 3, 2) == src, "左クリックで貼るとブロックと移動許可の両方が写る")
    hist = z.call({"cmd": "state"})["history"]
    z.call({"cmd": "undo"})
    _, undone = cells_of(z)
    check(undone == before and z.call({"cmd": "state"})["history"] == hist - 1, "1 回の取り消しで戻る")
    if shots:
        shot(z, shots, "p3c_225_paste_movements.png")
    z.call({"cmd": "setField", "id": "map.pasteMovements", "value": False})
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [10, 10]})
    _, off = cells_of(z)
    got = region(width, off, 10, 10, 3, 2)
    old = region(width, before, 10, 10, 3, 2)
    check([c & 0x3FF for c in got] == [c & 0x3FF for c in src] and [c >> 10 for c in got] == [c >> 10 for c in old], "「移動許可も貼る」を外すとブロックだけ写る")
    z.call({"cmd": "undo"})
    z.call({"cmd": "setField", "id": "map.pasteMovements", "value": True})
    # Ctrl+C / Ctrl+V（マウスの位置に貼る）
    z.call({"cmd": "key", "key": "c", "ctrl": True})
    z.call({"cmd": "mouse", "target": "map", "action": "hover", "cell": [2, 14]})
    z.call({"cmd": "key", "key": "v", "ctrl": True})
    _, pasted = cells_of(z)
    check(region(width, pasted, 2, 14, 3, 2) == src, "Ctrl+C でコピーし、Ctrl+V でマウスの位置に移動許可ごと貼る")
    z.call({"cmd": "undo"})
    # パレットから選んだものは移動許可を持たない（ブロックだけ貼る）
    r = z.call({"cmd": "mouse", "target": "palette", "action": "click", "cell": [1, 0]})
    check("movements" not in r["block"], "パレットから選んだものは移動許可を持たない")


def check_233(z: Zigzagu, work: pathlib.Path, shots: pathlib.Path | None) -> None:
    z.call({"cmd": "selectMap", **PALLET})
    z.call({"cmd": "tab", "name": "map"})
    width, before = cells_of(z)
    hist = z.call({"cmd": "state"})["history"]
    # 5×4 の矩形塗り
    z.call({"cmd": "selectBlock", "block": 5})
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "ctrl": True, "cell": [2, 2], "to": [6, 5]})
    _, after = cells_of(z)
    check(all(c & 0x3FF == 5 for c in region(width, after, 2, 2, 5, 4)) and region(width, after, 7, 2, 1, 4) == region(width, before, 7, 2, 1, 4),
          "Ctrl＋左ドラッグで 5×4 を塗る（外は変わらない）")
    check(z.call({"cmd": "state"})["history"] == hist + 1, "矩形塗りは 1 回の操作")
    z.call({"cmd": "undo"})
    check(cells_of(z)[1] == before, "1 回の取り消しで戻る")
    # 2×2 のスタンプで 6×6 を敷き詰める
    z.call({"cmd": "selectBlock", "blocks": [1, 2, 3, 4], "width": 2})
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "ctrl": True, "cell": [0, 8], "to": [5, 13]})
    _, after = cells_of(z)
    got = [c & 0x3FF for c in region(width, after, 0, 8, 6, 6)]
    want = [[1, 2], [3, 4]]
    check(got == [want[y % 2][x % 2] for y in range(6) for x in range(6)], "2×2 のスタンプで 6×6 を左上から敷き詰める")
    if shots:
        z.call({"cmd": "mouse", "target": "map", "action": "down", "ctrl": True, "cell": [12, 12]})
        z.call({"cmd": "mouse", "target": "map", "action": "move", "ctrl": True, "button": "left", "cell": [17, 15]})
        shot(z, shots, "p3c_233_rect_preview.png")
        z.call({"cmd": "key", "key": "Escape"})
        z.call({"cmd": "mouse", "target": "map", "action": "up", "ctrl": True, "cell": [17, 15]})
    z.call({"cmd": "undo"})
    check(cells_of(z)[1] == before, "敷き詰めも 1 回の取り消しで戻る")
    # Esc で取りやめ
    z.call({"cmd": "mouse", "target": "map", "action": "down", "ctrl": True, "cell": [2, 2]})
    z.call({"cmd": "mouse", "target": "map", "action": "move", "ctrl": True, "button": "left", "cell": [4, 4]})
    z.call({"cmd": "key", "key": "Escape"})
    z.call({"cmd": "mouse", "target": "map", "action": "up", "ctrl": True, "cell": [4, 4]})
    check(cells_of(z)[1] == before and z.call({"cmd": "state"})["history"] == hist, "Esc で矩形塗りのドラッグを取りやめると何も変わらない")
    # Alt＋左ドラッグで入れ替え
    a, b = (3, 5), (10, 10)
    va, vb = before[a[1] * width + a[0]], before[b[1] * width + b[0]]
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "alt": True, "cell": list(a), "to": list(b)})
    _, after = cells_of(z)
    check(after[a[1] * width + a[0]] == vb and after[b[1] * width + b[0]] == va and va != vb, "Alt＋左ドラッグで 2 マスのブロックと移動許可を入れ替える")
    z.call({"cmd": "undo"})
    check(cells_of(z)[1] == before, "入れ替えも 1 回の取り消しで戻る")
    # 移動エリアタブの矩形塗り
    z.call({"cmd": "tab", "name": "movement"})
    z.call({"cmd": "selectMovement", "value": 1})
    z.call({"cmd": "mouse", "target": "movement", "action": "drag", "ctrl": True, "cell": [2, 2], "to": [4, 3]})
    _, after = cells_of(z)
    got = region(width, after, 2, 2, 3, 2)
    check(all(c >> 10 == 1 for c in got) and [c & 0x3FF for c in got] == [c & 0x3FF for c in region(width, before, 2, 2, 3, 2)],
          "移動エリアタブの Ctrl＋左ドラッグで移動許可を矩形に塗る（ブロックは変えない）")
    z.call({"cmd": "undo"})
    check(cells_of(z)[1] == before, "移動許可の矩形塗りも 1 回の取り消しで戻る")
    z.call({"cmd": "tab", "name": "map"})


def check_231(z: Zigzagu, work: pathlib.Path, shots: pathlib.Path | None) -> None:
    open_main(z)
    z.call({"cmd": "tab", "name": "event"})
    ev0 = z.call({"cmd": "event.state"})["events"]
    z.call({"cmd": "tab", "name": "map"})
    st0 = z.call({"cmd": "neighbors.state", "wait": True})
    m0 = st0["margins"]
    w0, h0 = z.call({"cmd": "state"})["map"]["width"], z.call({"cmd": "state"})["map"]["height"]
    img0 = png_of(z, {"cmd": "canvasPng", "target": "map", "neighbors": True})
    # 左へ 3 広げる（左の辺のつまみを左へ 3 マス）
    z.call({"cmd": "mouse", "target": "connectionHandle", "handle": "edge:left", "action": "drag", "cell": [0, 0], "to": [-3, 0]})
    time.sleep(0.3)
    s = z.call({"cmd": "state"})
    check(s["map"]["width"] == w0 + 3 and s["map"]["height"] == h0, f"左の辺のつまみで左へ 3 広がる（{s['map']['width']}×{s['map']['height']}）")
    z.call({"cmd": "tab", "name": "event"})
    ev1 = z.call({"cmd": "event.state"})["events"]
    z.call({"cmd": "tab", "name": "map"})
    moved = all(a["x"] == b["x"] + 3 and a["y"] == b["y"] for k in ("persons", "warps", "traps", "signs") for a, b in zip(ev1[k], ev0[k]))
    check(moved, "全イベントが 3 右へずれる")
    up = next(c for c in conns(z, 3, 0) if c["direction"] == 2)
    down = next(c for c in conns(z, 3, 0) if c["direction"] == 1)
    back_up = next(c for c in conns(z, 3, 19) if c["map"] == 0)
    back_down = next(c for c in conns(z, 3, 39) if c["map"] == 0)
    check(up["offset"] == 3 and down["offset"] == 3 and back_up["offset"] == -3 and back_down["offset"] == -3,
          f"上下の接続のずれが +3、相手側が -3 になる（{up['offset']}, {down['offset']}, {back_up['offset']}, {back_down['offset']}）")
    st = z.call({"cmd": "state"})
    check({"3.0", "3.19", "3.39"} <= set(st["dirty"]), f"自分と相手に未出力の印が付く {st['dirty']}")
    open_main(z)
    st1 = z.call({"cmd": "neighbors.state", "wait": True})
    m1 = st1["margins"]
    img1 = png_of(z, {"cmd": "canvasPng", "target": "map", "neighbors": True})
    if Image is not None:
        # 主マップの枠（1px）は左の辺の位置が変わるので、左端の 1 列は比べない
        box0 = (m0["left"] * 16 + 1, (m0["top"] - 8) * 16, (m0["left"] + w0) * 16, (m0["top"] + h0 + 8) * 16)
        box1 = ((m1["left"] + 3) * 16 + 1, (m1["top"] - 8) * 16, (m1["left"] + 3 + w0) * 16, (m1["top"] + h0 + 8) * 16)
        diff = max(hi for _lo, hi in ImageChops.difference(img0.crop(box0), img1.crop(box1)).getextrema())
        check(diff == 0, f"隣の帯との位置関係が変わらない（元の範囲と上下の帯の画像が同じ。差 {diff}）")
    if shots:
        shot(z, shots, "p3c_231_left_grown.png")
    z.call({"cmd": "undo"})
    s = z.call({"cmd": "state"})
    check(s["map"]["width"] == w0 and next(c for c in conns(z, 3, 0) if c["direction"] == 2)["offset"] == 0 and next(c for c in conns(z, 3, 19) if c["map"] == 0)["offset"] == 0,
          "1 回の取り消しで大きさと両側の接続が戻る")
    open_main(z)
    z.call({"cmd": "tab", "name": "event"})
    check(z.call({"cmd": "event.state"})["events"] == ev0, "取り消しでイベントも戻る")
    z.call({"cmd": "tab", "name": "map"})
    # 右へ 2 縮める（右の辺のつまみを左へ 2 マス）。右では接続もイベントも変えない
    open_main(z)
    z.call({"cmd": "mouse", "target": "connectionHandle", "handle": "edge:right", "action": "drag", "cell": [0, 0], "to": [-2, 0]})
    time.sleep(0.3)
    s = z.call({"cmd": "state"})
    check(s["map"]["width"] == w0 - 2 and next(c for c in conns(z, 3, 0) if c["direction"] == 2)["offset"] == 0, "右の辺で縮めると、接続のずれは変えない")
    z.call({"cmd": "undo"})
    # 4 マスより小さくはできない
    open_main(z)
    z.call({"cmd": "mouse", "target": "connectionHandle", "handle": "edge:down", "action": "drag", "cell": [0, 0], "to": [0, -100]})
    time.sleep(0.3)
    check(z.call({"cmd": "state"})["map"]["height"] == 4, "下の辺を大きく縮めても高さは 4 で止まる")
    z.call({"cmd": "undo"})
    # 出力して開き直す
    open_main(z)
    z.call({"cmd": "mouse", "target": "connectionHandle", "handle": "edge:left", "action": "drag", "cell": [0, 0], "to": [-3, 0]})
    time.sleep(0.3)
    out = work / "out231"
    out.mkdir(parents=True, exist_ok=True)
    z.call({"cmd": "export", "dir": str(out)})
    z.call({"cmd": "open", "rom": z.rom, "project": str(out)})
    open_main(z)
    s = z.call({"cmd": "state"})
    check(s["map"]["width"] == w0 + 3 and next(c for c in conns(z, 3, 0) if c["direction"] == 2)["offset"] == 3 and next(c for c in conns(z, 3, 19) if c["map"] == 0)["offset"] == -3,
          "出力して開き直しても大きさと両側の接続が同じ")


def map_cells(z: Zigzagu, bank: int, map_: int) -> tuple[int, list[int]]:
    c = z.call({"cmd": "cells", "bank": bank, "map": map_})
    return c["width"], c["cells"]


def check_234(z: Zigzagu, work: pathlib.Path, shots: pathlib.Path | None) -> None:
    open_main(z)
    z.call({"cmd": "tab", "name": "map"})
    pw, p0 = map_cells(z, 3, 0)
    rw, r0 = map_cells(z, 3, 19)
    rh = len(r0) // rw
    hist = z.call({"cmd": "state"})["history"]
    # 4×4 の矩形塗り（主マップの上 2 行と、1 番道路の下 2 行）
    z.call({"cmd": "selectBlock", "block": 5})
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "ctrl": True, "cell": [2, 1], "to": [5, -2]})
    _, p1 = map_cells(z, 3, 0)
    _, r1 = map_cells(z, 3, 19)
    check(all(c & 0x3FF == 5 for c in region(pw, p1, 2, 0, 4, 2)) and all(c & 0x3FF == 5 for c in region(rw, r1, 2, rh - 2, 4, 2)),
          "境界をまたいで 4×4 を矩形塗りすると、マサラタウンと 1 番道路の両方が変わる")
    st = z.call({"cmd": "state"})
    check(st["history"] == hist + 1 and {"3.0", "3.19"} <= set(st["dirty"]), "1 回の操作で、両方に未出力の印が付く")
    if shots:
        z.call({"cmd": "neighbors.state", "wait": True})
        (shots / "p3c_234_cross_fill.png").write_bytes(base64.b64decode(z.call({"cmd": "canvasPng", "target": "map", "neighbors": True})["png"]))
    out = work / "out234"
    out.mkdir(parents=True, exist_ok=True)
    r = z.call({"cmd": "export", "dir": str(out)})
    check(written(r, 3, 0) and written(r, 3, 19), "出力で両方の JSON が書かれる")
    z.call({"cmd": "undo"})
    check(map_cells(z, 3, 0)[1] == p0 and map_cells(z, 3, 19)[1] == r0, "1 回の取り消しで両方が戻る")
    # 鉛筆のドラッグで境界をまたぐ（1 回の操作）
    hist = z.call({"cmd": "state"})["history"]
    z.call({"cmd": "selectBlock", "block": 6})
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [8, 1], "to": [8, -2], "steps": 6})
    _, p1 = map_cells(z, 3, 0)
    _, r1 = map_cells(z, 3, 19)
    ok = p1[1 * pw + 8] & 0x3FF == 6 and p1[8] & 0x3FF == 6 and r1[(rh - 1) * rw + 8] & 0x3FF == 6 and r1[(rh - 2) * rw + 8] & 0x3FF == 6
    check(ok and z.call({"cmd": "state"})["history"] == hist + 1, "鉛筆のドラッグも境界をまたぎ、1 回の操作にまとまる")
    z.call({"cmd": "undo"})
    check(map_cells(z, 3, 0)[1] == p0 and map_cells(z, 3, 19)[1] == r0, "鉛筆のドラッグも 1 回の取り消しで両方戻る")
    # 帯の上で拾う
    r = z.call({"cmd": "mouse", "target": "map", "action": "rightClick", "cell": [10, -1]})
    check(r["block"]["blocks"] == [r0[(rh - 1) * rw + 10] & 0x3FF], "帯の上の右クリックで、隣のマップのブロックを拾う")
    # 矩形の選択が境界をまたぐ
    r = z.call({"cmd": "mouse", "target": "map", "action": "drag", "button": "right", "ctrl": True, "cell": [3, -1], "to": [4, 0]})
    want = [r0[(rh - 1) * rw + 3], r0[(rh - 1) * rw + 4], p0[3], p0[4]]
    check(r["block"]["blocks"] == [c & 0x3FF for c in want] and r["block"]["movements"] == [c >> 10 for c in want], "Ctrl＋右ドラッグの矩形の選択も境界をまたぐ")
    # 入れ替えが境界をまたぐ
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "alt": True, "cell": [1, 1], "to": [1, -1]})
    _, p1 = map_cells(z, 3, 0)
    _, r1 = map_cells(z, 3, 19)
    check(p1[pw + 1] == r0[(rh - 1) * rw + 1] and r1[(rh - 1) * rw + 1] == p0[pw + 1], "Alt＋左ドラッグの入れ替えも境界をまたぐ")
    z.call({"cmd": "undo"})
    # 帯の外には描かない
    hist = z.call({"cmd": "state"})["history"]
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [3, -9]})
    check(z.call({"cmd": "state"})["history"] == hist and map_cells(z, 3, 19)[1] == r0, "帯の外（境界から 8 マスより向こう）には描かない")
    # 移動エリアタブの矩形塗りも境界をまたぐ
    z.call({"cmd": "tab", "name": "movement"})
    z.call({"cmd": "selectMovement", "value": 1})
    z.call({"cmd": "mouse", "target": "movement", "action": "drag", "ctrl": True, "cell": [2, 0], "to": [3, -1]})
    _, p1 = map_cells(z, 3, 0)
    _, r1 = map_cells(z, 3, 19)
    check(all(c >> 10 == 1 for c in region(pw, p1, 2, 0, 2, 1)) and all(c >> 10 == 1 for c in region(rw, r1, 2, rh - 1, 2, 1)), "移動エリアタブの矩形塗りも境界をまたぐ")
    z.call({"cmd": "undo"})
    check(map_cells(z, 3, 0)[1] == p0 and map_cells(z, 3, 19)[1] == r0, "移動許可の矩形塗りも 1 回の取り消しで両方戻る")
    z.call({"cmd": "tab", "name": "map"})


def check_232(z: Zigzagu, work: pathlib.Path, shots: pathlib.Path | None) -> None:
    open_main(z)
    z.call({"cmd": "tab", "name": "map"})
    z.call({"cmd": "key", "key": " ", "type": "down"})
    st = z.call({"cmd": "neighbors.state", "wait": True})
    status = z.call({"cmd": "state"})["status"]["left"]
    check(st["dive"] is None and "ダイブ" in status, f"ダイブ・浮上の接続が無ければ知らせる（{status}）")
    z.call({"cmd": "key", "key": " ", "type": "up"})
    # 1 番道路の左上の画像（重ねたときに見えるはずのもの）
    z.call({"cmd": "selectMap", **ROUTE1})
    route = png_of(z, {"cmd": "canvasPng", "target": "map"})
    open_main(z)
    z.call({"cmd": "command", "name": "connectMaps", "args": {**PALLET, "direction": 5, "offset": 0, "targetBank": 3, "targetMap": 19}})
    open_main(z)
    pallet = png_of(z, {"cmd": "canvasPng", "target": "map"})
    z.call({"cmd": "mouse", "target": "map", "action": "hover", "cell": [10, 10]})
    z.call({"cmd": "key", "key": " ", "type": "down"})
    st = z.call({"cmd": "neighbors.state", "wait": True})
    check(st["dive"] == {"id": {"bank": 3, "map": 19}, "direction": 5}, f"Space を押している間、ダイブ先を重ねる {st['dive']}")
    img = png_of(z, {"cmd": "canvasPng", "target": "map"})
    if Image is not None:
        box = (10 * 16, 10 * 16, 11 * 16, 11 * 16)
        diff = max(hi for _lo, hi in ImageChops.difference(img.crop(box), route.crop(box)).getextrema())
        far = (20 * 16, 2 * 16, 21 * 16, 3 * 16)
        same_far = max(hi for _lo, hi in ImageChops.difference(img.crop(far), pallet.crop(far)).getextrema())
        changed = max(hi for _lo, hi in ImageChops.difference(img.crop(box), pallet.crop(box)).getextrema())
        check(diff == 0 and same_far == 0 and changed != 0, f"カーソルのまわりは相手のマップ、離れたところは主マップ（差 {diff}・{same_far}・{changed}）")
    if shots:
        shot(z, shots, "p3c_232_dive_overlay.png")
    z.call({"cmd": "key", "key": " ", "type": "up"})
    check(z.call({"cmd": "neighbors.state", "wait": True})["dive"] is None, "Space を離すと消える")
    # イベントタブでも重ね、ダブルクリックで相手を開く
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "mouse", "target": "event", "action": "hover", "cell": [5, 5]})
    z.call({"cmd": "key", "key": " ", "type": "down"})
    check(z.call({"cmd": "neighbors.state", "wait": True})["dive"] is not None, "イベントタブでも重ねる")
    z.call({"cmd": "mouse", "target": "event", "action": "dblclick", "cell": [5, 5]})
    time.sleep(0.3)
    check(z.call({"cmd": "state"})["map"]["map"] == 19, "重ねているときのダブルクリックで相手のマップを開く")
    z.call({"cmd": "key", "key": " ", "type": "up"})
    z.call({"cmd": "tab", "name": "map"})


def check_236(z: Zigzagu, work: pathlib.Path, shots: pathlib.Path | None) -> None:
    open_main(z)
    z.call({"cmd": "tab", "name": "map"})
    # Ctrl＋パレットの左クリックで出し入れ（パレットの 1 行目の 3 つ）
    for x in (1, 2, 3):
        z.call({"cmd": "mouse", "target": "palette", "action": "click", "ctrl": True, "cell": [x, 0]})
    st = z.call({"cmd": "bag.state"})
    check(len(st["blocks"]) == 3, f"Ctrl＋パレットの左クリックで袋に入る {st['blocks']}")
    z.call({"cmd": "mouse", "target": "palette", "action": "click", "ctrl": True, "cell": [3, 0]})
    check(len(z.call({"cmd": "bag.state"})["blocks"]) == 2, "もう一度 Ctrl＋左クリックすると袋から出る")
    # 草 3 種（種を決める）で 6×6 を矩形塗り
    width, before = cells_of(z)
    grass = [0x0D, 0x0E, 0x0F]
    z.call({"cmd": "bag.set", "blocks": grass, "seed": 42})
    z.call({"cmd": "selectBlock", "block": grass[0]})
    check(z.call({"cmd": "bag.state"})["active"], "袋の中のブロックを選ぶと袋を使う")
    if shots:
        shot(z, shots, "p3c_236_bag.png")
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "ctrl": True, "cell": [2, 2], "to": [7, 7]})
    _, after = cells_of(z)
    got = [c & 0x3FF for c in region(width, after, 2, 2, 6, 6)]
    check(set(got) == set(grass), f"6×6 に 3 種が混ざる {sorted(set(got))}")
    z.call({"cmd": "undo"})
    check(cells_of(z)[1] == before, "1 回の取り消しで戻る")
    z.call({"cmd": "redo"})
    check(cells_of(z)[1] == after, "やり直すと同じ絵に戻る")
    z.call({"cmd": "undo"})
    # 同じ種なら同じ並び
    z.call({"cmd": "bag.set", "blocks": grass, "seed": 42})
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "ctrl": True, "cell": [2, 2], "to": [7, 7]})
    check(cells_of(z)[1] == after, "同じ種なら同じ並びになる")
    z.call({"cmd": "undo"})
    # 袋に無いブロックを選ぶと袋を使わない
    z.call({"cmd": "selectBlock", "block": 5})
    check(not z.call({"cmd": "bag.state"})["active"], "袋に無いブロックを選ぶと袋を使わない")
    # Ctrl＋袋のクリックで空にする
    z.call({"cmd": "mouse", "id": "map.bag", "action": "click", "ctrl": True, "px": [4, 4]})
    check(z.call({"cmd": "bag.state"})["blocks"] == [], "Ctrl＋袋のクリックで空にする")


def private_ws_mb(pid: int) -> float | None:
    """exe と子孫のプロセスの専用ワーキングセットの合計（MB。psutil が無ければ None）。"""
    try:
        import psutil
    except ImportError:
        return None
    root = psutil.Process(pid)
    total = 0
    for p in [root, *root.children(recursive=True)]:
        try:
            info = p.memory_full_info()
            total += getattr(info, "private", 0) or info.uss
        except Exception:  # noqa: BLE001
            pass
    return round(total / 1048576, 1)


def check_246(z: Zigzagu, work: pathlib.Path, shots: pathlib.Path | None) -> None:
    open_main(z)
    z.call({"cmd": "tab", "name": "map"})
    pallet = png_of(z, {"cmd": "canvasPng", "target": "map"})
    time.sleep(3)
    before = private_ws_mb(z.proc.pid)
    r = z.call({"cmd": "image.composite", "events": "none", "png": True}, timeout=600)
    right_after = private_ws_mb(z.proc.pid)
    maps = {(m["bank"], m["map"]): m for m in r["maps"]}
    print(f"     全マップ: {len(r['maps'])} 枚、{r['width']}×{r['height']}（1/{r['scale']}）、範囲 {r['bounds']}、ヒープ {r['heapMb']}MB")
    check((3, 19) in maps and (3, 39) in maps and maps[(3, 19)]["y"] == -40 and maps[(3, 39)]["y"] == 20 and len(r["maps"]) > 10,
          f"マサラタウンから、つながっている屋外のマップが接続のずれどおりに並ぶ（{len(r['maps'])} 枚）")
    b = r["bounds"]
    check(r["width"] == -(-b["width"] * 16 // r["scale"]) and r["height"] == -(-b["height"] * 16 // r["scale"]), "画像の大きさは並べた範囲 × 16 画素（縮めたら割る）")
    if Image is not None and r["png"]:
        img = Image.open(io.BytesIO(base64.b64decode(r["png"]))).convert("RGB")
        if shots:
            img.save(shots / "p3c_246_composite.png")
        if r["scale"] == 1:
            x0, y0 = -b["x"] * 16, -b["y"] * 16
            diff = max(hi for _lo, hi in ImageChops.difference(img.crop((x0, y0, x0 + pallet.size[0], y0 + pallet.size[1])), pallet).getextrema())
            check(diff == 0, f"マサラタウンの部分の画素がマップの画像と同じ（差 {diff}）")
        else:
            check(True, f"辺が 16,384 画素を超えるので 1/{r['scale']} に縮めた")
    time.sleep(6)
    settled = private_ws_mb(z.proc.pid)
    print(f"     メモリ（専用ワーキングセット）: 前 {before}MB、作った直後 {right_after}MB、6 秒後 {settled}MB")
    if before is not None and settled is not None:
        check(settled - before < 30, f"作ったあと、メモリが元の近くへ戻る（増え {settled - before:.1f}MB）")
    one = z.call({"cmd": "image.composite", "whole": False, "events": "none"})
    check(one["width"] == 24 * 16 and one["height"] == 20 * 16 and len(one["maps"]) == 1, "今のマップ 1 枚の画像")
    ev = z.call({"cmd": "image.composite", "whole": False, "events": "all", "png": True})
    no = z.call({"cmd": "image.composite", "whole": False, "events": "none", "png": True})
    pe = z.call({"cmd": "image.composite", "whole": False, "events": "persons", "png": True})
    check(ev["png"] != no["png"] and pe["png"] != no["png"] and pe["png"] != ev["png"], "イベントなし・人だけ・全部で画像が違う")
    half = z.call({"cmd": "image.composite", "whole": False, "scale": 2})
    check(half["width"] == 12 * 16 and half["height"] == 10 * 16, "縮めると 1/2 の大きさ")


CHECKS = {"222": check_222, "223": check_223, "229": check_229, "230": check_230, "225": check_225, "233": check_233, "231": check_231, "234": check_234, "232": check_232, "236": check_236, "246": check_246}


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    ap.add_argument("--only", help="確かめる issue の番号（カンマ区切り）")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    only = args.only.split(",") if args.only else list(CHECKS)
    with tempfile.TemporaryDirectory(prefix="zzm-conn-", ignore_cleanup_errors=True) as tmp:
        work = pathlib.Path(tmp)
        for number in only:
            print(f"== #{number}")
            # issue ごとに起動し直す（前の確認の状態を持ち越さない）
            with Zigzagu(args.exe, profile=work / f"profile{number}", extra=["--mute-audio"]) as z:
                z.rom = args.rom
                z.call({"cmd": "open", "rom": args.rom})
                CHECKS[number](z, work, shots)
    print(f"\n失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
