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


# ---- #305 ----


def check_seams(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    # 素の BPRJ で、接続先のタイルセットの組が違って崩れるマスのあるマップを探す
    found = None
    for bank, map_ in ((3, 0), (3, 19), (3, 1), (3, 20), (3, 2), (3, 21), (3, 3), (3, 22), (3, 4), (3, 23)):
        z.call({"cmd": "selectMap", "bank": bank, "map": map_})
        st = z.call({"cmd": "seams.state", "wait": True})
        if st["issues"]:
            found = (bank, map_, st)
            break
    check(found is not None, f"崩れるマスのある接続を持つマップが見つかる（{found[:2] if found else None}）")
    if not found:
        return
    bank, map_, st = found
    issue = st["issues"][0]
    check(st["status"] == f"注意: 接続 {len(st['issues'])} か所", f"ステータスバーに注意が出る（{st['status']!r}）")
    check(issue["count"] > 0 and all(c["x"] < 0 or c["y"] < 0 or c["x"] >= 0 for c in issue["cells"]), f"接続 {issue['index']}（{issue['side']}）に {issue['count']} マス")
    z.call({"cmd": "tab", "name": "map"})
    z.call({"cmd": "neighbors.state", "wait": True})
    z.call({"cmd": "scroll", "target": "map", "to": "end" if issue["side"] in ("down", "right") else "start"})
    shot(z, shots, "view_seams_band.png")
    z.call({"cmd": "click", "id": "status.seams"})
    time.sleep(0.3)
    dialogs = z.call({"cmd": "state"})["dialogs"]
    check(any(d.get("title") == "接続の境目の注意" for d in dialogs), "押すと一覧が出る")
    shot(z, shots, "view_seams_list.png")
    z.call({"cmd": "dialog", "press": "ok"})
    # 主マップのタイルセットの組を相手と同じにすると、その接続の注意が消える
    target = next(c for c in st["connections"] if c["index"] == issue["index"])
    z.call({"cmd": "command", "name": "setTilesets", "args": {"bank": bank, "map": map_, "primary": target["primary"], "secondary": target["secondary"]}})
    after = z.call({"cmd": "seams.state", "wait": True})
    check(all(i["index"] != issue["index"] for i in after["issues"]), "同じ組にすると、その接続の注意が消える")
    z.call({"cmd": "undo"})
    again = z.call({"cmd": "seams.state", "wait": True})
    check(any(i["index"] == issue["index"] for i in again["issues"]), "元に戻すとまた出る")
    # 組が同じ接続しかないマップ（マサラタウンの家の中など）では出ない
    z.call({"cmd": "selectMap", "bank": 4, "map": 1})
    st = z.call({"cmd": "seams.state", "wait": True})
    check(st["status"] is None, "接続の無いマップでは注意が出ない")


def check_filter(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    def maps() -> list[dict]:
        return [i for i in z.call({"cmd": "tree.list"}) if i.get("mapId") and i["key"].startswith("h")]

    z.call({"cmd": "tree.filter", "text": "場所:58"})
    shown = maps()
    check(len(shown) > 0, f"場所:58 で {len(shown)} 枚")
    regions = {(m["mapId"]["bank"], m["mapId"]["map"]) for m in shown}
    check((3, 0) in regions, "場所:58（マサラタウン）に 3.0 が入る")
    check(all(not i["key"].startswith("f/") for i in z.call({"cmd": "tree.list"})), "マップファイルの項目は出ない")
    shot(z, shots, "view_filter_region.png", "tree.filter")
    z.call({"cmd": "tree.filter", "text": "場所:58,59"})
    check(len(maps()) > len(shown), "場所:58,59 は 58 だけより多い")
    z.call({"cmd": "tree.filter", "text": "場所:58 3.0"})
    check([(m["mapId"]["bank"], m["mapId"]["map"]) for m in maps()] == [(3, 0)], "名前の語と並べて使える")
    info = z.call({"cmd": "catalog.get", "bank": 3, "map": 0})
    z.call({"cmd": "tree.filter", "text": f"地形:{info['layoutId']:X}"})
    layout = [(m["mapId"]["bank"], m["mapId"]["map"]) for m in maps()]
    check((3, 0) in layout and all(z.call({"cmd": "catalog.get", "bank": b, "map": m})["layoutId"] == info["layoutId"] for b, m in layout),
          f"地形:{info['layoutId']:X} で同じ配置のマップだけ（{layout[:5]}）")
    shared = z.call({"cmd": "catalog.get", "bank": 5, "map": 4})
    z.call({"cmd": "tree.filter", "text": f"地形:{shared['layoutId']:X}"})
    check(len(maps()) == 17, f"素の BPRJ の 5.4 の配置は 17 枚で共有（{len(maps())} 枚）")
    z.call({"cmd": "tree.filter", "text": ""})
    check(len(maps()) > 300, "消すと全部に戻る")


# ---- #306 ----


def check_town(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "tree.filter", "text": ""})
    check(not z.call({"cmd": "town.state"})["open"], "初めは小窓を出さない（既定オフ）")
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "menu.run", "id": "view.townMap"})
    st = z.call({"cmd": "town.state", "wait": True})
    check(st["open"] and st["loaded"], "表示 > タウンマップの小窓で出て、読み込む")
    check(st["region"] == 0x58 and st["frame"] is not None and st["page"] == 0, f"マサラタウン（0x58）に枠（{st['frame']}、面 {st['page']}）")
    shot(z, shots, "view_town_mini.png", "town")
    frame1 = st["frame"]
    z.call({"cmd": "selectMap", "bank": 3, "map": 1})
    st = z.call({"cmd": "town.state", "wait": True})
    check(st["frame"] is not None and st["frame"] != frame1, f"マップを切り替えると枠が動く（{frame1} → {st['frame']}）")
    # ナナシマ（1 のしま 3.8 など）は別の面
    z.call({"cmd": "selectMap", "bank": 3, "map": 12})
    st = z.call({"cmd": "town.state", "wait": True})
    check(st["page"] != 0 or st["frame"] is None, f"1 のしまでは面が変わる（面 {st['page']}）")
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    st = z.call({"cmd": "town.state", "wait": True})
    f = st["frame"]
    picked = z.call({"cmd": "town.pick", "x": f["x"], "y": f["y"]})
    check(picked["region"] == 0x58 and picked["filter"] == "場所:58", f"マスを押すと一覧を場所:58 で絞る（{picked}）")
    items = [i for i in z.call({"cmd": "tree.list"}) if i.get("mapId") and i["key"].startswith("h")]
    check(len(items) > 0 and all(z.call({"cmd": "catalog.get", **i["mapId"]})["region"] == 0x58 for i in items), f"一覧が絞られる（{len(items)} 枚）")
    # マウスを乗せると地名
    z.call({"cmd": "mouse", "id": "town.canvas", "action": "hover", "px": [32 + f["x"] * 8 + 4, 32 + f["y"] * 8 + 4]})
    st = z.call({"cmd": "town.state"})
    check(st["hovered"] == 0x58 and "58" in (st["label"] or ""), f"マウスを乗せると地名を出す（{st['label']!r}）")
    z.call({"cmd": "tree.filter", "text": ""})
    z.call({"cmd": "menu.run", "id": "view.townMap"})
    st = z.call({"cmd": "town.state"})
    check(not st["open"] and not st["loaded"], "隠すと読み込んだものを捨てる")
    check(z.call({"cmd": "state"})["settings"]["showTownMap"] is False, "設定に残る（オフ）")


# ---- #307 ----


def check_pointers(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    items = {i["id"]: i for i in z.call({"cmd": "menu.list"}) if i.get("id")}
    check(items.get("tools.pointers", {}).get("shortcut") == "Ctrl+Shift+P", "ツール > ポインタ一覧（Ctrl+Shift+P）")
    z.call({"cmd": "key", "key": "P", "ctrl": True, "shift": True})
    time.sleep(0.5)
    st = z.call({"cmd": "pointers.state"})
    check(st["open"] and len(st["rows"]) > 10, f"Ctrl+Shift+P で開き、{len(st['rows'])} 行")
    head = st["rows"][0]
    check(head["kind"] == "header" and len(head["bytes"]) == 4, f"先頭はマップの表の行（{head['location']:X} → {head['value']:X}）")
    check(head["bytes"] == [head["value"] & 255, (head["value"] >> 8) & 255, (head["value"] >> 16) & 255, head["value"] >> 24], "バイト列はリトルエンディアン")
    shot(z, shots, "view_pointers.png", "pointers")
    # 3.0 のヘッダーの場所を探すと、マップの表の中の 1 か所
    r = z.call({"cmd": "pointers.search", "address": head["value"] - 0x08000000}, timeout=120)
    check(len(r["hits"]) == 1 and r["hits"][0]["offset"] == head["location"], f"3.0 のヘッダーの参照元は 1 か所（{[h['offset'] for h in r['hits']]}）")
    check("3.0 のヘッダー" in r["hits"][0]["place"], f"場所の名前（{r['hits'][0]['place']}）")
    check(r["maxGapMs"] < 200, f"探している間も画面が止まらない（いちばん長い止まり {r['maxGapMs']}ms、{r['ms']:.1f}ms、{r['chunks']} 回）")
    ctx.setdefault("timings", []).append(("base", r["ms"], r["chunks"], r["maxGapMs"]))
    shot(z, shots, "view_pointers_search.png", "pointers")
    # ほかの ROM のファイル
    other = z.call({"cmd": "pointers.search", "address": head["value"], "rom": ctx["rom"]}, timeout=120)
    check(len(other["hits"]) >= 1 and other["rom"] == ctx["rom"], f"ほかの ROM のファイルでも探せる（{len(other['hits'])} か所）")
    # 行を選ぶとイベントが選ばれる（逆も）
    st = z.call({"cmd": "pointers.state"})
    rows = st["rows"]
    people = [i for i, p in enumerate(rows) if p["kind"] in ("personScript", "signScript", "trapScript")]
    check(len(people) > 0, f"イベントのスクリプトの行がある（{len(people)} 行）")
    pi = people[-1] if people else None
    if pi is not None:
        want = {"personScript": "person", "signScript": "sign", "trapScript": "trap"}[rows[pi]["kind"]]
        z.call({"cmd": "pointers.select", "row": pi})
        ev = z.call({"cmd": "event.state"})
        check(z.call({"cmd": "state"})["tab"] == "event" and ev["kind"] == want and ev["index"] == rows[pi]["index"], f"行を選ぶとイベントタブで{want} {rows[pi]['index']} が選ばれる")
        first = people[0]
        fk = {"personScript": "person", "signScript": "sign", "trapScript": "trap"}[rows[first]["kind"]]
        z.call({"cmd": "event.select", "kind": fk, "index": rows[first]["index"]})
        sel = z.call({"cmd": "pointers.state"})["selected"]
        check(sel == first, f"イベントタブで {fk} {rows[first]['index']} を選ぶと行も選ばれる（{sel}）")
        z.call({"cmd": "mouse", "id": f"pointers.row.{pi}", "action": "rightClick", "px": [4, 4]})
        menu = z.call({"cmd": "contextMenu.state"}) or {}
        check([i["id"] for i in menu.get("items", [])] == ["copyValue", "copyBytes", "copyLocation"], "行の右クリックにコピーの項目")
        z.call({"cmd": "contextMenu.press", "id": "copyBytes"})
        want = " ".join(f"{b:02X}" for b in rows[pi]["bytes"])
        check(z.call({"cmd": "pointers.state"})["lastCopied"] == want, f"バイト列をコピー（{want}）")
    z.call({"cmd": "click", "id": "pointers.close"})
    check(not z.call({"cmd": "pointers.state"})["open"], "閉じる")


# ---- #308 ----


def info(z: Zigzagu) -> str:
    return z.call({"cmd": "getField", "id": "status.info"})["value"]


def check_palette(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    z.call({"cmd": "mouse", "target": "palette", "action": "hover", "cell": [1, 0]})
    text = info(z)
    check("ブロック 0x001 タイルセット1" in text and "挙動:" in text and "重ね方:" in text, f"パレットに乗せると情報が出る（{text!r}）")
    z.call({"cmd": "mouse", "target": "palette", "action": "hover", "cell": [0, 80]})
    check("ブロック 0x280 タイルセット2" in info(z), f"副は「タイルセット2」（{info(z)!r}）")
    # 3 層のブロックを作って乗せる（取り消す）
    tiles = z.call({"cmd": "seams.state"})["tilesets"]
    z.call({"cmd": "command", "name": "setTripleLayer", "args": {"tileset": tiles["primary"], "secondary": False, "block": 16, "attribute": 0x30000000}})
    z.call({"cmd": "mouse", "target": "palette", "action": "hover", "cell": [0, 2]})
    text = info(z)
    check("重ね方: 30-トリプルレイヤー" in text and "3 枚目はブロック 0x011" in text, f"3 層は「重ね方: トリプルレイヤー」（{text!r}）")
    z.call({"cmd": "mouse", "target": "palette", "action": "hover", "cell": [1, 2]})
    check("0x010 の 3 枚目に使われる" in info(z), f"3 層の次の番号（{info(z)!r}）")
    shot(z, shots, "view_palette_info.png")
    z.call({"cmd": "undo"})
    # 最近使ったブロック
    z.call({"cmd": "mouse", "target": "palette", "action": "click", "cell": [3, 0]})
    z.call({"cmd": "mouse", "target": "palette", "action": "click", "cell": [0, 80]})
    z.call({"cmd": "mouse", "target": "palette", "action": "click", "cell": [5, 0]})
    z.call({"cmd": "mouse", "target": "map", "action": "rightClick", "cell": [5, 5]})
    picked = z.call({"cmd": "state"})["selection"]["blocks"][0]
    r = z.call({"cmd": "recent.state"})["blocks"]
    check(r[:4] == [picked, 5, 0x280, 3] or (picked == 5 and r[:3] == [5, 0x280, 3]), f"パレットとスポイトのブロックが新しい順に並ぶ（{[hex(b) for b in r]}、拾ったのは {picked:#x}）")
    shot(z, shots, "view_recent_blocks.png", "map.recent")
    # 2 件目（ブロック 5 か 0x280）を押すと選び直し、パレットの選択も動く
    second = r[1]
    z.call({"cmd": "mouse", "id": "map.recent.canvas", "action": "click", "px": [16 + 2 + 4, 8]})
    sel = z.call({"cmd": "state"})["selection"]["blocks"]
    check(sel == [second], f"押すと選び直す（{[hex(b) for b in sel]}）")
    # 主タイルセットが同じで副が違うマップに移ると、副のブロックは消える
    base = z.call({"cmd": "seams.state"})["tilesets"]
    for m in (1, 2, 3, 4, 5, 6):
        z.call({"cmd": "selectMap", "bank": 3, "map": m})
        t2 = z.call({"cmd": "seams.state"})["tilesets"]
        if t2["primary"] == base["primary"] and t2["secondary"] != base["secondary"]:
            break
    r2 = z.call({"cmd": "recent.state"})["blocks"]
    check(0x280 not in r2 and 3 in r2, f"組が変わると使えないもの（副）を消す（{[hex(b) for b in r2]}）")
    # TS1 と TS2 の境目
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    on = pixels(png_bytes(z.call({"cmd": "canvasPng", "target": "palette"})))
    z.call({"cmd": "menu.run", "id": "view.paletteBoundary"})
    off = pixels(png_bytes(z.call({"cmd": "canvasPng", "target": "palette"})))
    check(cell_rgba(on, 0, 80) != cell_rgba(off, 0, 80) and cell_rgba(on, 0, 40) == cell_rgba(off, 0, 40), "境目の線と見出しが出て、表示メニューで消せる")
    z.call({"cmd": "menu.run", "id": "view.paletteBoundary"})
    z.call({"cmd": "scroll", "target": "palette", "y": 80 * 16 - 60})
    shot(z, shots, "view_palette_boundary.png")
    # 移動許可の説明
    z.call({"cmd": "tab", "name": "movement"})
    z.call({"cmd": "mouse", "target": "movementPalette", "action": "hover", "cell": [0, 0x0E]})
    check("ゲームでは通れない。奇数を使う" in info(z), f"通行 2 の値に注意（{info(z)!r}）")
    z.call({"cmd": "mouse", "target": "movementPalette", "action": "click", "cell": [0, 0x0C]})
    check("通れる・高さ 3" in info(z), f"選ぶと説明（{info(z)!r}）")
    shot(z, shots, "view_movement_info.png")


# ---- #315 ----


def check_thumbs(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    st = z.call({"cmd": "thumbs.state"})
    check(not st["enabled"] and st["maps"] == 0 and st["rows"] == 0, "既定はオフで、何も作らない")
    items = {i["id"]: i for i in z.call({"cmd": "menu.list"}) if i.get("id")}
    check("view.treeThumbnails" in items and not items["view.treeThumbnails"]["checked"], "表示 > マップ一覧にサムネイルを出す（チェックなし）")
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "menu.run", "id": "view.treeThumbnails"})
    # 作っている最中に切り替えても 100ms 以内
    during = []
    for m in (1, 2, 3, 4, 5, 0):
        time.sleep(0.2)
        r = z.call({"cmd": "selectMap", "bank": 3, "map": m})
        during.append(r.get("switchMs", 0))
    running = z.call({"cmd": "thumbs.state"})["running"]
    check(max(during) < 100, f"作っている最中の切り替えも 100ms 以内（{[round(t, 1) for t in during]}、最中か {running}）")
    st = z.call({"cmd": "thumbs.state", "wait": True})
    total = len([i for i in z.call({"cmd": "tree.list"}) if i.get("mapId") and i["key"].startswith("h")])
    check(st["maps"] == total and st["images"] < st["maps"], f"全マップ {st['maps']} 枚（{total}）、絵は {st['images']} 枚（配置が同じものは使い回す）、{st['ms']:.0f}ms")
    ctx.setdefault("timings", []).append(("thumbs", st["ms"], st["maps"], st["images"]))
    check(st["rows"] > 0, f"開いている枝の行に描く（{st['rows']} 行）")
    shot(z, shots, "view_tree_thumbnails.png")
    # 作り終えたあとの切り替え
    times = []
    for m in (1, 2, 3, 0):
        r = z.call({"cmd": "selectMap", "bank": 3, "map": m})
        times.append(r.get("switchMs", 0))
    check(max(times) < 100, f"オンでもマップの切り替えは 100ms 以内（{[round(t, 1) for t in times]}）")
    z.call({"cmd": "menu.run", "id": "view.treeThumbnails"})
    st = z.call({"cmd": "thumbs.state"})
    check(not st["enabled"] and st["maps"] == 0 and st["rows"] == 0, "オフにすると捨てて、行からも消える")


# ---- #316 ----


def check_zoom(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 19})
    z.call({"cmd": "tab", "name": "map"})
    st = z.call({"cmd": "state"})
    w, h = st["map"]["width"], st["map"]["height"]
    s1 = z.call({"cmd": "zoom.state"})
    check(s1["zoom"] == 1 and s1["layer"]["width"] == w * 16 and s1["scale"] == 1, f"初めは 1 倍（{s1['layer']}）")
    center = [w // 2, h // 2]
    drifts = []
    for want in (2, 3, 4, 5, 6, 7, 8):
        r = z.call({"cmd": "zoom.wheel", "cell": center, "delta": -1})
        drifts.append(r["drift"])
        check(r["zoom"] == want, f"Ctrl＋ホイールで {want} 倍（{r['zoom']}）")
    r = z.call({"cmd": "zoom.wheel", "cell": center, "delta": -1})
    check(r["zoom"] == 8, "8 倍より大きくならない")
    s8 = z.call({"cmd": "zoom.state"})
    check(s8["layer"]["width"] == w * 32 and s8["scale"] == 4, f"8 倍でも重ね描きは 2 倍の大きさ（{s8['layer']}、CSS で 4 倍）")
    check(abs(s8["scrollSize"]["width"] - w * 128) <= w * 128 * 0.2 + 8 * 128 * 2, f"スクロールの大きさは 8 倍（{s8['scrollSize']}）")
    check(max(drifts) <= 3, f"マウスの位置のマスが動かない（ずれ {drifts}px）")
    check(z.call({"cmd": "state"})["settings"]["mapZoom"]["map"] == 8, "倍率を個人設定に残す")
    shot(z, shots, "view_zoom8.png")
    # 8 倍で描く（マウスの位置からマスを正しく求める）
    z.call({"cmd": "selectBlock", "block": 9})
    cell = [center[0] + 1, center[1]]
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": cell})
    cells = z.call({"cmd": "cells"})["cells"]
    got = cells[cell[1] * w + cell[0]] & 0x3FF
    check(got == 9, f"8 倍でも押したマスに描く（{got}）")
    z.call({"cmd": "undo"})
    cells = z.call({"cmd": "cells"})["cells"]
    # 中ボタンのドラッグでスクロール
    before = z.call({"cmd": "zoom.state"})["scroll"]
    z.call({"cmd": "mouse", "id": "map-tab-view", "action": "drag", "button": "middle", "px": [300, 200], "toPx": [200, 150], "steps": 4})
    after = z.call({"cmd": "zoom.state"})["scroll"]
    check(after["left"] - before["left"] == 100 and after["top"] - before["top"] == 50, f"中ボタンのドラッグでスクロール（{before} → {after}）")
    check(z.call({"cmd": "cells"})["cells"] == cells, "中ボタンでは描かない")
    # 8 倍のまま切り替え
    times = []
    for m in (0, 1, 19):
        times.append(z.call({"cmd": "selectMap", "bank": 3, "map": m}).get("switchMs", 0))
    check(max(times) < 100, f"8 倍でもマップの切り替えは 100ms 以内（{[round(t, 1) for t in times]}）")
    ctx.setdefault("timings", []).append(("zoom8 switch", max(times)))
    # イベントタブも 8 倍にして、イベントを押して選ぶ
    z.call({"cmd": "tab", "name": "event"})
    for _ in range(7):
        z.call({"cmd": "zoom.wheel", "tab": "event", "cell": center, "delta": -1})
    ev = z.call({"cmd": "event.state"})
    p = ev["events"]["persons"][-1] if ev["events"]["persons"] else None
    if p:
        z.call({"cmd": "event.select", "kind": "sign", "index": 0})
        z.call({"cmd": "mouse", "target": "event", "action": "click", "cell": [p["x"], p["y"]]})
        ev2 = z.call({"cmd": "event.state"})
        check(ev2["kind"] == "person", f"8 倍のイベントタブで人を押すと選べる（{ev2['kind']} {ev2['index']}）")
    shot(z, shots, "view_zoom8_event.png")
    # メニューの「拡大表示」は今までどおり 1 倍と 2 倍
    z.call({"cmd": "tab", "name": "map"})
    z.call({"cmd": "menu.run", "id": "zoom.map"})
    s = z.call({"cmd": "zoom.state"})
    check(s["zoom"] == 1 and s["layer"]["width"] == w * 16, f"メニューの拡大表示を押すと 1 倍に戻る（{s['zoom']}）")
    z.call({"cmd": "menu.run", "id": "zoom.map"})
    s = z.call({"cmd": "zoom.state"})
    check(s["zoom"] == 2 and s["scale"] == 1, f"もう一度で 2 倍（{s['zoom']}）")
    z.call({"cmd": "menu.run", "id": "zoom.map"})
    z.call({"cmd": "menu.run", "id": "zoom.event"})
    z.call({"cmd": "menu.run", "id": "zoom.event"})


CHECKS = {
    "events": check_events,
    "zoom": check_zoom,
    "thumbs": check_thumbs,
    "palette": check_palette,
    "pointers": check_pointers,
    "seams": check_seams,
    "filter": check_filter,
    "town": check_town,
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
