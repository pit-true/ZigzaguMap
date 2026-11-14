"""Phase3 の接続と描画（列 A・B）を、素の ROM だけで確かめる。

  python tests/automation/connection_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--only 222,223]

- 222: 2 枚のマップへの paintBlocks を group で実行すると、両方に未出力の印が付き、出力で両方の JSON が書かれる。
  1 回の取り消しで両方が戻って印が消え、もう一度出力するとファイルが消える（ベース ROM と同じに戻ったため）。
- 223: 隣のマップの帯。マサラタウンで 1 番道路（上）と 21 番水道（下）の帯が出る。ずれが 0 でないマップも含め、帯の画素が
  隣のマップを開いたときの画像の同じ部分を暗くしたものと一致する。帯の上のダブルクリックでそのマップへ移る。
  設定（マップ全体・出さない）の切り替え、移動エリア・イベントのタブにも帯が出る、マップの切り替えの時間。
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


CHECKS = {"222": check_222, "223": check_223}


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
                z.call({"cmd": "open", "rom": args.rom})
                CHECKS[number](z, work, shots)
    print(f"\n失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
