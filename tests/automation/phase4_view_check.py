"""Phase4 の列 3（表示・一覧・調査。#304〜#308・#315・#316）を確かめる。

  python tests/automation/phase4_view_check.py --rom <素の BPRJ> [--project <CFRU-JP のフォルダの写し>] [--exe <zigzagumap.exe>]
      [--shots <フォルダ>] [--only <名前> ...]

- 起動は --automation・--profile（一時フォルダ）・画面外。ROM と写しには書き込まない（出力しない）。
- 見ること（`--only` で選べる。名前は下の CHECKS の鍵）:
  - events: イベントの種類ごとの表示（隠した種類は描かず、クリックで選ばれない）、イベントの濃さ（印の濃さが変わり、
    設定に残る）、右クリックの「ここに○○を追加」（1 回の Ctrl+Z で消える）。`--project` があれば「ここに落とし物を追加」も
    （見た目と向きが全マップでいちばん多いもの、フラグが未使用の最小）。
"""
from __future__ import annotations

import argparse
import base64
import io
import pathlib
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def png_bytes(data) -> bytes:
    png = data if isinstance(data, str) else data.get("png") or data.get("data")
    return base64.b64decode(png)


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str, part: str | None = None) -> None:
    if not shots:
        return
    data = z.call({"cmd": "ui.shot", "id": part}) if part else z.call({"cmd": "screenshot"})
    (shots / name).write_bytes(png_bytes(data))


def pixels(png: bytes) -> tuple[int, int, bytes]:
    """PNG を (幅, 高さ, RGBA) にする（標準ライブラリだけで読む。フィルタ 0〜4、8 ビット RGBA か RGB）。"""
    import struct
    import zlib

    pos = 8
    width = height = 0
    color = 6
    raw = b""
    while pos < len(png):
        length, kind = struct.unpack(">I4s", png[pos : pos + 8])
        body = png[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            width, height, _depth, color = struct.unpack(">IIBB", body[:10])
        elif kind == b"IDAT":
            raw += body
        pos += 12 + length
    data = zlib.decompress(raw)
    bpp = 4 if color == 6 else 3
    stride = width * bpp
    out = bytearray()
    prev = bytearray(stride)
    i = 0
    for _ in range(height):
        f = data[i]
        line = bytearray(data[i + 1 : i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        prev = line
        if bpp == 4:
            out += line
        else:
            for x in range(width):
                out += line[x * 3 : x * 3 + 3] + b"\xff"
    return width, height, bytes(out)


def cell_rgba(img: tuple[int, int, bytes], cx: int, cy: int, size: int = 16) -> bytes:
    w, _h, data = img
    out = bytearray()
    for y in range(cy * size, cy * size + size):
        out += data[(y * w + cx * size) * 4 : (y * w + cx * size + size) * 4]
    return bytes(out)


def event_png(z: Zigzagu) -> tuple[int, int, bytes]:
    return pixels(png_bytes(z.call({"cmd": "canvasPng", "target": "event"})))


# ---- #304 ----


def check_events(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "event"})
    st = z.call({"cmd": "event.state"})
    events = st["events"]
    warp = events["warps"][0]
    person = events["persons"][0]
    base = event_png(z)
    # 表示 > イベントの種類
    items = {i["id"]: i for i in z.call({"cmd": "menu.list"}) if i.get("id")}
    ids = [f"view.eventKind.{k}" for k in ("person", "sign", "trap", "warp")]
    check(all(i in items and items[i]["checked"] for i in ids), "表示 > イベントの種類 の 4 項目があり、初めは全部チェック")
    z.call({"cmd": "menu.run", "id": "view.eventKind.warp"})
    items = {i["id"]: i for i in z.call({"cmd": "menu.list"}) if i.get("id")}
    check(not items["view.eventKind.warp"]["checked"], "ワープのチェックが外れる")
    hidden = event_png(z)
    check(cell_rgba(base, warp["x"], warp["y"]) != cell_rgba(hidden, warp["x"], warp["y"]), "隠したワープの印が描かれない")
    check(cell_rgba(base, person["x"], person["y"]) == cell_rgba(hidden, person["x"], person["y"]), "人の印はそのまま")
    z.call({"cmd": "event.select", "kind": "person", "index": 0})
    z.call({"cmd": "mouse", "target": "event", "action": "click", "cell": [warp["x"], warp["y"]]})
    sel = z.call({"cmd": "event.state"})
    check(sel["kind"] != "warp", f"隠したワープのマスを押しても選ばれない（{sel['kind']} {sel['index']}）")
    shot(z, shots, "view_events_hidden.png")
    z.call({"cmd": "menu.run", "id": "view.eventKind.warp"})
    check(cell_rgba(event_png(z), warp["x"], warp["y"]) == cell_rgba(base, warp["x"], warp["y"]), "ワープを表示に戻すと元の絵")
    # イベントの濃さ
    z.call({"cmd": "menu.run", "id": "view.opacity"})
    f = z.call({"cmd": "getField", "id": "view.eventOpacity.slider"})
    check(f["visible"] and z.call({"cmd": "getField", "id": "view.eventOpacity.value"})["value"] == "100%", "濃さの窓にイベントの濃さ（初め 100%）")
    z.call({"cmd": "setField", "id": "view.eventOpacity.slider", "value": "20"})
    light = event_png(z)
    check(cell_rgba(light, person["x"], person["y"]) != cell_rgba(base, person["x"], person["y"]), "濃さを 20% にすると人の印が変わる")
    st = z.call({"cmd": "state"})
    check(abs(st["settings"]["eventOpacity"] - 0.2) < 1e-6, f"設定に 0.2 が残る（{st['settings'].get('eventOpacity')}）")
    check(abs(st["settings"]["movementOpacity"] - 0.3) < 1e-6, "移動エリアの透明度は変わらない")
    shot(z, shots, "view_event_opacity.png")
    z.call({"cmd": "setField", "id": "view.eventOpacity.slider", "value": "0"})
    check(z.call({"cmd": "getField", "id": "view.eventOpacity.value"})["value"] == "10%", "いちばん薄くて 10%")
    z.call({"cmd": "setField", "id": "view.eventOpacity.slider", "value": "100"})
    z.call({"cmd": "click", "id": "view.opacity.close"})
    # 右クリックの「ここに○○を追加」
    doc_w, doc_h = st["map"]["width"], st["map"]["height"]
    free = next((x, y) for y in range(doc_h) for x in range(doc_w) if not any(e["x"] == x and e["y"] == y for k in events.values() for e in k))
    before = z.call({"cmd": "event.state"})["counts"]
    for kind, key in (("person", "persons"), ("sign", "signs"), ("trap", "traps"), ("warp", "warps")):
        z.call({"cmd": "mouse", "target": "event", "action": "rightClick", "cell": list(free)})
        menu = z.call({"cmd": "contextMenu.state"})
        ids = [i["id"] for i in (menu or {}).get("items", [])]
        check(f"add.{kind}" in ids, f"右クリックに add.{kind} がある（{ids}）")
        z.call({"cmd": "contextMenu.press", "id": f"add.{kind}"})
        time.sleep(0.2)
        after = z.call({"cmd": "event.state"})
        check(after["counts"][key] == before[key] + 1 and after["kind"] == kind, f"{kind} が 1 つ増えて選ばれる")
        added = after["events"][key][-1]
        check((added["x"], added["y"]) == free, f"{kind} を押したマス {free} に置く")
        z.call({"cmd": "undo"})
        time.sleep(0.2)
        check(z.call({"cmd": "event.state"})["counts"][key] == before[key], f"1 回の Ctrl+Z で {kind} が消える")
    if ctx.get("project"):
        check_item_ball(z, free, before)


def check_item_ball(z: Zigzagu, free: tuple[int, int], before: dict) -> None:
    z.call({"cmd": "mouse", "target": "event", "action": "rightClick", "cell": list(free)})
    ids = [i["id"] for i in (z.call({"cmd": "contextMenu.state"}) or {}).get("items", [])]
    check("add.itemBall" in ids, "プロジェクトがあると「ここに落とし物を追加」が出る")
    z.call({"cmd": "contextMenu.press", "id": "add.itemBall"})
    t0 = time.time()
    after = z.call({"cmd": "event.state"})
    while after["counts"]["persons"] == before["persons"] and time.time() - t0 < 60:
        time.sleep(0.5)
        after = z.call({"cmd": "event.state"})
    ball = after["events"]["persons"][-1]
    check(after["counts"]["persons"] == before["persons"] + 1, "落とし物の人が 1 つ増える")
    check((ball["graphicsId"], ball["movementType"]) == (92, 8), f"見た目と向きはいちばん多いもの（{ball['graphicsId']}, {ball['movementType']}）")
    check(ball["flag"] > 0, f"フラグは未使用の最小（0x{ball['flag']:X}）")
    check(any(b["personIndex"] == before["persons"] for b in after.get("itemBalls", [])), "落とし物の登録がある")
    z.call({"cmd": "undo"})
    time.sleep(0.3)
    check(z.call({"cmd": "event.state"})["counts"]["persons"] == before["persons"], "1 回の Ctrl+Z で落とし物が消える")


CHECKS = {
    "events": check_events,
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--project")
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    names = args.only or list(CHECKS)
    with tempfile.TemporaryDirectory(prefix="zzm-p4view-", ignore_cleanup_errors=True) as profile:
        with Zigzagu(pathlib.Path(args.exe) if args.exe else None, profile=profile) as z:
            z.call({"cmd": "open", "rom": args.rom, **({"project": args.project} if args.project else {})}, timeout=120)
            ctx = {"project": args.project, "rom": args.rom}
            for name in names:
                print(f"== {name}")
                try:
                    CHECKS[name](z, shots, ctx)
                except Exception as e:  # noqa: BLE001
                    check(False, f"{name}: 例外 {e!r}")
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
