"""画像からタイルとブロックを作る（Phase6 #443〜#446）を、素の ROM だけで確かめる。

  python tests/automation/tile_import_check.py --rom <素の BPRJ の写し> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--work <フォルダ>] [--only 443 444 ...]

- 443: `tileset.importImage` で見本の PNG を 3.0 の副へ取り込むと、計画どおりのブロックができ、最初のブロックを選び、スタンプができる。
  1 回の Ctrl+Z で元のタイルセットに戻る。新しい副タイルセットへ取り込むと組が付け替わり、出力すると New の tileset.json
  （TileCount は 16 の倍数）になる。色が多すぎる絵は書かずに paletteShortage を返し、減色すると入る。
- 444: ブロックエディタの タイル > 画像からタイルとブロックを作る… でウィザードを開き、見本の PNG を開いてメーターと計画を確かめ、
  5 ページを進んで「取り込む」で書ける（ブロックエディタで最初のブロックを選ぶ）。色が多すぎる絵では「次へ」で警告の窓が出て、
  キャンセルで留まり、「減色する」で減色して進む。閉じると窓が消える。
"""
from __future__ import annotations

import argparse
import base64
import json
import pathlib
import struct
import sys
import tempfile
import time
import zlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu, wait_window as wait_window_ready  # noqa: E402

failures: list[str] = []
PALLET = {"bank": 3, "map": 0}
BE = "block-editor"
TI = "tile-import"


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def save_shot(z: Zigzagu, shots: pathlib.Path | None, name: str, window: str | None = None) -> None:
    if not shots:
        return
    req: dict = {"cmd": "screenshot"}
    if window:
        req["window"] = window
    png = z.call(req)
    (shots / name).write_bytes(base64.b64decode(png if isinstance(png, str) else png["png"]))


def write_png(path: pathlib.Path, width: int, height: int, pixel) -> None:
    """`pixel(x, y)` が (r, g, b, a) の RGBA の PNG を書く。"""
    raw = b"".join(b"\x00" + b"".join(bytes(pixel(x, y)) for x in range(width)) for y in range(height))

    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    head = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", head) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


COLORS = [(248, 0, 248), (248, 248, 248), (200, 40, 40), (40, 160, 40), (40, 40, 200), (240, 200, 0), (0, 0, 0), (120, 72, 24), (0, 200, 200), (168, 168, 168), (248, 128, 160), (80, 80, 80)]


def sample(x: int, y: int) -> tuple[int, int, int, int]:
    """48×32 の見本（左上は透明色のマゼンタ。縞・市松・単色、透明のマス）。"""
    cx, cy = x // 16, y // 16
    if (cx, cy) == (2, 1) or (x, y) == (0, 0):
        c = 0
    elif cx == 0:
        c = 1 + (x + y) % 4
    elif cx == 1:
        c = 5 + ((x // 4 + y // 4) % 2) * 2
    else:
        c = 8 + (y // 4) % 4 if x % 16 >= 2 else 0
    return (*COLORS[c], 255)


def be(z: Zigzagu, req: dict, window: str = BE):
    return z.call({**req, "window": window})


def snap(z: Zigzagu) -> dict:
    return be(z, {"cmd": "snapshot"})["snapshot"]


def wait_window(z: Zigzagu, label: str) -> None:
    if not wait_window_ready(z, label, timeout=16):
        raise RuntimeError(f"窓が開きません: {label}")

def open_window(z: Zigzagu, action: str, label: str) -> None:
    z.call({"cmd": "action", "id": action})
    wait_window(z, label)


def wait_snap(z: Zigzagu, cond, tries: int = 50) -> dict:
    s = snap(z)
    for _ in range(tries):
        if cond(s):
            return s
        time.sleep(0.1)
        s = snap(z)
    return s


def selected_block(z: Zigzagu) -> int:
    return z.call({"cmd": "state"})["selection"]["blocks"][0]


def check_443(z: Zigzagu, shots: pathlib.Path | None, work: pathlib.Path) -> None:
    png = work / "sample.png"
    write_png(png, 48, 32, sample)
    s0 = snap(z)
    r = z.call({"cmd": "tileset.importImage", "paths": [str(png)], "target": "secondary", "stamp": "取り込み443"})
    plan = r["plan"]
    t = plan["tiles"]
    print(f"     計画: 新しいタイル {t['created']}・使い回し {t['reused']}・反転 {t['flipped']}、ブロック {plan['blocks']['needed']}、本 {plan['palettes']['opened']}、{plan['ms']}ms")
    check(r["done"] and plan["ok"], f"443: 3.0 の副へ取り込める（{[p['code'] for p in plan['problems']]}）")
    check(plan["blocks"]["needed"] == 4 and plan["blocks"]["skipped"] == 1 and plan["blocks"]["merged"] == 1, f"443: 6 マスのうち透明の 1 マスを除き、同じ 2 マスをまとめて 4 ブロック（{plan['blocks']}）")
    s1 = wait_snap(z, lambda s: s["secondary"]["blocks"] != s0["secondary"]["blocks"])
    check(s1["secondary"]["blocks"] != s0["secondary"]["blocks"], "443: ブロックエディタの写しにも出る")
    check(selected_block(z) == plan["firstBlock"], f"443: 最初のブロックを選ぶ（{plan['firstBlock']:#x}）")
    stamps = z.call({"cmd": "stamps.list"})
    check(r["stamp"] == "取り込み443" and "取り込み443" in [s["name"] for s in stamps["all"]], "443: 画像の並びのスタンプを作る")
    cells = [{"x": i % plan["cellsWide"], "y": i // plan["cellsWide"], "block": b} for i, b in enumerate(plan["cells"]) if b >= 0]
    z.call({"cmd": "command", "name": "paintBlocks", "args": {**PALLET, "cells": cells}})
    if shots:
        (shots / "443_painted.png").write_bytes(base64.b64decode(z.call({"cmd": "canvasPng", "target": "map"})["png"]))
    z.call({"cmd": "undo"})
    z.call({"cmd": "undo"})
    s2 = wait_snap(z, lambda s: s["secondary"]["blocks"] == s0["secondary"]["blocks"])
    check(s2["secondary"] == s0["secondary"], "443: 1 回の Ctrl+Z で元のタイルセットに戻る")

    # 新しい副タイルセット
    r = z.call({"cmd": "tileset.importImage", "paths": [str(png)], "target": "newSecondary"})
    check(r["done"], "443: 新しい副タイルセットへ取り込める")
    s3 = wait_snap(z, lambda s: s["secondary"]["pointer"] != s0["secondary"]["pointer"])
    check(s3["secondary"]["pointer"] == r["pointer"], f"443: 3.0 の組が新しい副タイルセットに付け替わる（{r['pointer']:#x}）")
    out = work / "export"
    out.mkdir(parents=True, exist_ok=True)
    res = z.call({"cmd": "export", "dir": str(out)})
    written = [w.replace("\\", "/") for w in (res.get("written", []) if isinstance(res, dict) else [])]
    name = f"secondary_{(r['pointer'] - 0x08000000):07X}/tileset.json"
    tj = [w for w in written if w.endswith(name)]
    check(len(tj) == 1, f"443: maps/tilesets/{name} を出力する")
    if tj:
        p = pathlib.Path(tj[0]) if pathlib.Path(tj[0]).is_absolute() else out / tj[0]
        data = json.loads(p.read_text(encoding="utf-8"))
        check(data.get("New") is True and data["TileCount"] % 16 == 0, f"443: New で TileCount が 16 の倍数（{data['TileCount']}）")
    z.call({"cmd": "undo"})
    s4 = wait_snap(z, lambda s: s["secondary"]["pointer"] == s0["secondary"]["pointer"])
    check(s4["secondary"]["pointer"] == s0["secondary"]["pointer"], "443: 1 回の Ctrl+Z で元の組に戻る")

    # 色が多すぎる絵（16 色ずつの帯を 8 本。副の本は 6 本まで）
    many = work / "many.png"
    write_png(many, 128, 16, lambda x, y: ((x // 16) * 30, (x % 16) * 16, y * 8, 255))
    r = z.call({"cmd": "tileset.importImage", "paths": [str(many)], "target": "secondary", "transparent": None})
    check(not r["done"] and r["plan"]["paletteShortage"], f"443: 色が多すぎる絵は書かずに本が足りないと返す（{[p['code'] for p in r['plan']['problems']]}）")
    check(snap(z)["secondary"] == s0["secondary"], "443: 書かなかったときはタイルセットが変わらない")
    r = z.call({"cmd": "tileset.importImage", "paths": [str(many)], "target": "secondary", "transparent": None, "options": {"reduce": True}})
    check(r["done"] and (r["plan"]["reduction"] or {}).get("changedPixels", 0) > 0, f"443: 減色すると取り込める（{r['plan']['reduction']}）")
    z.call({"cmd": "undo"})
    wait_snap(z, lambda s: s["secondary"] == s0["secondary"])


def ti(z: Zigzagu, req: dict):
    return z.call({**req, "window": TI})


def ti_state(z: Zigzagu) -> dict:
    return ti(z, {"cmd": "tileImport.wait"})


def ti_open(z: Zigzagu, slot: int, path: pathlib.Path) -> dict:
    ti(z, {"cmd": "queuePath", "path": str(path)})
    ti(z, {"cmd": "click", "id": f"ti.open.{slot}"})
    for _ in range(100):
        st = ti_state(z)
        if st["files"][slot] and not st["computing"] and (st["plan"] or st["error"]):
            return st
        time.sleep(0.1)
    return ti_state(z)


def ti_dialogs(z: Zigzagu) -> list:
    r = ti(z, {"cmd": "dialogs"})
    return r["dialogs"] if isinstance(r, dict) else r


def ti_next(z: Zigzagu, answer: str | None = None) -> dict:
    """「次へ」を押す（警告の窓が出たら `answer` で答える）。"""
    ti(z, {"cmd": "click", "id": "ti.next"})
    if answer:
        for _ in range(50):
            if ti_dialogs(z):
                break
            time.sleep(0.1)
        d = ti_dialogs(z)
        if d:
            ti(z, {"cmd": "dialog", "press": answer})
    time.sleep(0.2)
    return ti_state(z)


def check_444(z: Zigzagu, shots: pathlib.Path | None, work: pathlib.Path) -> None:
    png = work / "sample.png"
    write_png(png, 48, 32, sample)
    s0 = snap(z)
    be(z, {"cmd": "action", "id": "tiles.importImage"})
    wait_window(z, TI)
    st = ti_open(z, 0, png)
    plan = st["plan"]
    check(not ti(z, {"cmd": "getField", "id": "ti.run"})["enabled"], "444: 確認のページに進むまでは取り込めない")
    check(plan is not None and plan["ok"], f"444: 画像を開くと計画ができる（{st['error']}）")
    if not plan:
        return
    check(plan["blocks"]["needed"] == 4 and plan["tiles"]["created"] > 0, f"444: ブロック {plan['blocks']['needed']}・新しいタイル {plan['tiles']['created']}")
    meter = ti(z, {"cmd": "getField", "id": "ti.meter.blocks"})
    check("使う 4" in str(meter), f"444: ブロックのメーターに使う数が出る（{meter}）")
    save_shot(z, shots, "444_page1.png", TI)
    for page in range(1, 5):
        st = ti_next(z)
        check(st["page"] == page, f"444: 次へで {page + 1} ページ目へ進む")
        save_shot(z, shots, f"444_page{page + 1}.png", TI)
        if page == 2:
            ti(z, {"cmd": "setField", "id": "ti.mode", "value": 1})
            ti_state(z)
            ti(z, {"cmd": "click", "id": "ti.pickBase"})
            ti(z, {"cmd": "pointer", "id": "ti.picker", "type": "down", "x": 5, "y": 5})
            ti(z, {"cmd": "dialog", "press": "ok"})
            chosen = ti_state(z)
            check(chosen["options"]["baseBlock"] == 0, "445: 一覧から選んだ下地が設定に入る")
            preview = ti(z, {"cmd": "canvasPng", "id": "ti.methodPreview"})
            check(preview["width"] == 96, "445: 下地・絵・人物を重ねた見本を描く")
            ti(z, {"cmd": "setField", "id": "ti.mode", "value": 0})
            ti_state(z)
        if page == 3:
            ti(z, {"cmd": "pointer", "id": "ti.place.source", "type": "down", "x": 5, "y": 5})
            ti(z, {"cmd": "pointer", "id": "ti.place.source", "type": "up", "x": 517, "y": 1509})
            manual = ti_state(z)
            check(manual["plan"]["locals"][0] == 376, f"446: 選んだマスを指定の番号へ置く（{manual['plan']['locals']}）")
            plan = manual["plan"]
    ti(z, {"cmd": "setField", "id": "ti.stampName", "value": "取り込み444"})
    ti(z, {"cmd": "click", "id": "ti.run"})
    s1 = wait_snap(z, lambda s: s["secondary"]["blocks"] != s0["secondary"]["blocks"])
    check(s1["secondary"]["blocks"] != s0["secondary"]["blocks"], "444: 取り込むとタイルセットが変わる")
    time.sleep(0.3)
    st = ti_state(z)
    check("取り込みました" in st["status"], f"444: 窓の下に取り込んだことが出る（{st['status']}）")
    check(selected_block(z) == plan["firstBlock"], "444: 最初のブロックを選ぶ")
    check(be(z, {"cmd": "state"})["block"] == plan["firstBlock"], "444: ブロックエディタでも最初のブロックを選ぶ")
    check("取り込み444" in [x["name"] for x in z.call({"cmd": "stamps.list"})["all"]], "444: スタンプができる")
    z.call({"cmd": "undo"})
    wait_snap(z, lambda s: s["secondary"] == s0["secondary"])
    check(snap(z)["secondary"] == s0["secondary"], "444: 1 回の Ctrl+Z で戻る")

    # 色が多すぎる絵: 警告の窓
    many = work / "many.png"
    write_png(many, 128, 16, lambda x, y: ((x // 16) * 30, (x % 16) * 16, y * 8, 255))
    ti(z, {"cmd": "click", "id": "ti.back"})
    ti(z, {"cmd": "click", "id": "ti.back"})
    ti(z, {"cmd": "click", "id": "ti.back"})
    ti(z, {"cmd": "click", "id": "ti.back"})
    ti(z, {"cmd": "setField", "id": "ti.transparentMode", "value": 2})
    st = ti_open(z, 0, many)
    check(st["page"] == 0 and st["plan"] and st["plan"]["paletteShortage"], "444: 色が多すぎる絵ではパレットが足りない")
    ti(z, {"cmd": "click", "id": "ti.next"})
    d = []
    for _ in range(50):
        d = ti_dialogs(z)
        if d:
            break
        time.sleep(0.1)
    check(bool(d) and "パレット" in json.dumps(d, ensure_ascii=False), f"444: 次へで警告の窓が出る（{d[:1]}）")
    save_shot(z, shots, "444_shortage.png", TI)
    if d:
        text = json.dumps(d, ensure_ascii=False)
        check("使用中" in text and "空き" in text, "444: 警告の窓に今のパレットの数（使用中・空き）が出る")
        ti(z, {"cmd": "dialog", "press": "cancel"})
        time.sleep(0.2)
        check(ti_state(z)["page"] == 0, "444: キャンセルでは進まない")
    st = ti_next(z, "reduce")
    check(st["page"] == 1 and st["options"]["reduce"] and st["plan"]["ok"], f"444: 減色するで減色して 2 ページ目へ進む（{st['plan']['reduction'] if st['plan'] else None}）")
    save_shot(z, shots, "444_reduced.png", TI)
    info = ti(z, {"cmd": "getField", "id": "ti.reduceInfo"})
    check("変わった画素" in str(info), f"444: 変わった画素の数が出る（{info}）")
    ti(z, {"cmd": "close"})
    time.sleep(0.5)
    check(not any(w["label"] == TI for w in z.call({"cmd": "windows"})), "444: 閉じると窓が消える")
    check(snap(z)["secondary"] == s0["secondary"], "444: 取り込まずに閉じるとタイルセットは変わらない")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--rom", required=True)
    p.add_argument("--exe")
    p.add_argument("--shots")
    p.add_argument("--only", nargs="*")
    p.add_argument("--work", help="作業フォルダ（省略で一時フォルダ）")
    a = p.parse_args()
    shots = pathlib.Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    work = pathlib.Path(a.work) if a.work else pathlib.Path(tempfile.mkdtemp(prefix="zzm-tileimport-"))
    work.mkdir(parents=True, exist_ok=True)
    profile = pathlib.Path(tempfile.mkdtemp(prefix="zzm-profile-"))
    only = set(a.only or [])

    def want(n: str) -> bool:
        return not only or n in only

    with Zigzagu(a.exe, profile=profile) as z:
        z.call({"cmd": "open", "rom": a.rom})
        z.call({"cmd": "selectMap", **PALLET})
        open_window(z, "tools.blockEditor", BE)
        if want("443"):
            check_443(z, shots, work)
        if want("444"):
            check_444(z, shots, work)

    print()
    print("失敗なし" if not failures else f"失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
