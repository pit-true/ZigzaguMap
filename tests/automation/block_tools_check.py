"""ブロックエディタ・パレットエディタの Phase5 の操作（#393〜#397）を、素の ROM だけで確かめる。

  python tests/automation/block_tools_check.py --rom <素の BPRJ の写し> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--only 393 394 ...]

- 393: タイル一覧のドラッグで 2×2 を選び、8 マスに 1 回で置ける。左右反転で並びと各タイルが反転する。
  Ctrl＋左クリックでパレットだけ変わる。右ドラッグで反転とパレットごと拾って置ける。ホバーで窓の下に情報が出る。
  「変更」で 1 回の Ctrl+Z で戻る。
- 394: Ctrl+C / Ctrl+V でブロックを貼り付け、1 回の Ctrl+Z で戻る。切り取りで空になり、戻る。
  入れ替え（X）で副の 2 つを入れ替え、番号も付け替えるとマップの見た目が同じで、1 回で戻る。付け替えないと見た目が変わる。
  出力すると 3.0 の配置の番号が付け替わっている（`--work` の下）。
- 395: 表示 > 使用回数の数がマップタブの使用回数（`blockUsage` の `count`）と同じ。未使用のブロックの印が使用回数 0 と合う。
  未使用のタイルが、ブロックから数えた値と合い、ブロックを切り取ると数え直す。ブロック一覧の画像を、選んだ範囲と幅の PNG に書き出せる。
- 396: パレットエディタの 16 進の RGB の欄で 15 ビットに丸めて入る。表示 > 未使用の色がタイルとブロックから数えた値と合う。
  ツール > 色の使用箇所… の行を押すとブロックエディタでそのブロックを選ぶ。JASC-PAL・GIMP の .gpl・Adobe の .act を読み、16 色でなければエラー。
  読み込んだ色の反映が 1 回の Ctrl+Z で戻る。
"""
from __future__ import annotations

import argparse
import base64
import pathlib
import struct
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []
PALLET = {"bank": 3, "map": 0}
BE = "block-editor"


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


def be(z: Zigzagu, req: dict, window: str = BE):
    return z.call({**req, "window": window})


def be_state(z: Zigzagu) -> dict:
    return be(z, {"cmd": "state"})


def pointer(z: Zigzagu, id_: str, type_: str, x: int, y: int, button: int = 0, ctrl: bool = False, window: str = BE) -> None:
    be(z, {"cmd": "pointer", "id": id_, "type": type_, "x": x, "y": y, "button": button, "ctrl": ctrl}, window)


def click(z: Zigzagu, id_: str, x: int, y: int, button: int = 0, ctrl: bool = False, window: str = BE) -> None:
    pointer(z, id_, "down", x, y, button, ctrl, window)
    pointer(z, id_, "up", x, y, button, ctrl, window)


def select_in_list(z: Zigzagu, block: int) -> None:
    """ブロック一覧（8 列、1 ブロック 32px）の `block` を押す（スクロールしていない前提で位置を求める）。"""
    click(z, "be.blocks", (block % 8) * 32 + 16, (block // 8) * 32 + 16)


def tile_xy(tile: int) -> tuple[int, int]:
    """タイル一覧（16 列、1 タイル 16px）の `tile` の中心。"""
    return (tile % 16) * 16 + 8, (tile // 16) * 16 + 8


# 8 マス（下層 0〜3・上層 4〜7）の中心（表示上の px。1 タイル 16px）
CELL_XY = {0: (8, 8), 1: (24, 8), 2: (8, 24), 3: (24, 24), 4: (40, 8), 5: (56, 8), 6: (40, 24), 7: (56, 24)}


def ref(tile: int, h: bool = False, v: bool = False, pal: int = 0) -> int:
    return tile | (0x400 if h else 0) | (0x800 if v else 0) | (pal << 12)


def dialogs(z: Zigzagu, window: str | None = BE) -> list:
    req: dict = {"cmd": "dialogs"}
    if window:
        req["window"] = window
    r = z.call(req)
    return r["dialogs"] if isinstance(r, dict) else r


def press_if_open(z: Zigzagu, press: str, window: str | None = BE, tries: int = 20) -> list:
    for _ in range(tries):
        d = dialogs(z, window)
        if d:
            req: dict = {"cmd": "dialog", "press": press}
            if window:
                req["window"] = window
            z.call(req)
            return d
        time.sleep(0.1)
    return []


def open_window(z: Zigzagu, action: str, label: str) -> None:
    z.call({"cmd": "action", "id": action})
    for _ in range(80):
        if any(w["label"] == label and w["ready"] for w in z.call({"cmd": "windows"})):
            return
        time.sleep(0.2)
    raise RuntimeError(f"窓が開きません: {label}")


def check_393(z: Zigzagu, shots: pathlib.Path | None) -> None:
    block = 1
    select_in_list(z, block)
    s = be_state(z)
    check(s["block"] == block, f"393: ブロック {block} を選ぶ")
    before = list(s["tiles"])
    be(z, {"cmd": "setField", "id": "be.palette", "value": 3})

    # タイル一覧で 2×2 をドラッグ（0x04 → 0x15）
    x0, y0 = tile_xy(0x04)
    x1, y1 = tile_xy(0x15)
    pointer(z, "be.tiles", "down", x0, y0)
    pointer(z, "be.tiles", "move", x1, y1)
    pointer(z, "be.tiles", "up", x1, y1)
    s = be_state(z)
    check(s["selection"] == {"width": 2, "height": 2, "picked": False}, f"393: 2×2 を選べる（{s['selection']}）")
    frame = be(z, {"cmd": "getField", "id": "be.tilesFrame"})
    check(frame.get("visible", True) is not False, f"393: 選んだ矩形に枠が出る（{frame}）")
    check("2×2" in be(z, {"cmd": "getField", "id": "be.status"})["value"], "393: 窓の下に選んだ大きさが出る")

    # 8 マスの下層の左上に 1 回で置く
    click(z, "be.block", *CELL_XY[0])
    s = be_state(z)
    want = [ref(0x04, pal=3), ref(0x05, pal=3), ref(0x14, pal=3), ref(0x15, pal=3)]
    check(s["tiles"][0:4] == want, f"393: 2×2 を 1 回で置ける（{[hex(v) for v in s['tiles'][0:4]]}）")
    check(s["tiles"][4:8] == before[4:8], "393: 上層は変わらない")

    # 左右反転にして上層へ置く（並びも各タイルも反転）
    be(z, {"cmd": "setField", "id": "be.xflip", "value": True})
    click(z, "be.block", *CELL_XY[4])
    s = be_state(z)
    want_h = [ref(0x05, True, pal=3), ref(0x04, True, pal=3), ref(0x15, True, pal=3), ref(0x14, True, pal=3)]
    check(s["tiles"][4:8] == want_h, f"393: 左右反転の矩形は並びとタイルが反転する（{[hex(v) for v in s['tiles'][4:8]]}）")
    be(z, {"cmd": "setField", "id": "be.xflip", "value": False})
    save_shot(z, shots, "block_rect_place.png", BE)

    # はみ出た分は置かない（下層の右下から: 下層の右下と上層の左下だけ）
    pre = list(s["tiles"])
    click(z, "be.block", *CELL_XY[3])
    s = be_state(z)
    changed = [i for i in range(8) if s["tiles"][i] != pre[i]]
    check(set(changed) <= {3, 6} and s["tiles"][3] == ref(0x04, pal=3) and s["tiles"][6] == ref(0x05, pal=3), f"393: はみ出た分は置かない（変わったマス {changed}）")

    # Ctrl＋左クリックでパレットだけ
    # 1 枚の選択に戻す（タイル一覧を 1 回押す）
    click(z, "be.tiles", *tile_xy(0x30))
    be(z, {"cmd": "setField", "id": "be.palette", "value": 5})
    s = be_state(z)
    pre = list(s["tiles"])
    click(z, "be.block", *CELL_XY[1], ctrl=True)
    s = be_state(z)
    check(s["tiles"][1] == ((pre[1] & 0x0FFF) | (5 << 12)), f"393: Ctrl＋左クリックでパレットだけ変わる（{pre[1]:#x} → {s['tiles'][1]:#x}）")

    # 右ドラッグで下層の 2×2 を拾い、上層へ置く
    pointer(z, "be.block", "down", *CELL_XY[0], button=2)
    pointer(z, "be.block", "up", *CELL_XY[3], button=2)
    s = be_state(z)
    check(s["selection"] == {"width": 2, "height": 2, "picked": True}, f"393: 右ドラッグで 2×2 を拾う（{s['selection']}）")
    lower = list(s["tiles"][0:4])
    click(z, "be.block", *CELL_XY[4])
    s = be_state(z)
    check(s["tiles"][4:8] == lower, "393: 拾った矩形を反転とパレットごと置ける")

    # 1 マスの右クリックは今までどおり（タイル・反転・パレットの欄が拾った値になる）
    click(z, "be.block", *CELL_XY[1], button=2)
    s = be_state(z)
    check(s["selection"] == {"width": 1, "height": 1, "picked": False} and s["tile"] == (lower[1] & 0x3FF) and s["palette"] == 5,
          f"393: 1 マスの右クリックは今までどおり（タイル {s['tile']}、パレット {s['palette']}）")

    # ホバー
    pointer(z, "be.block", "move", *CELL_XY[5])
    text = be(z, {"cmd": "getField", "id": "be.status"})["value"]
    check("上層 右上" in text and "タイル" in text and "パレット" in text and "反転" in text, f"393: 8 マスのホバーで情報が出る（{text}）")
    pointer(z, "be.tiles", "move", *tile_xy(0x123))
    text = be(z, {"cmd": "getField", "id": "be.status"})["value"]
    check("123" in text, f"393: タイル一覧のホバーでタイル番号が出る（{text}）")
    save_shot(z, shots, "block_rect_hover.png", BE)

    # 変更 → メインの履歴 1 回で戻る
    final = be_state(z)["tiles"]
    be(z, {"cmd": "click", "id": "be.save"})
    press_if_open(z, "yes", tries=3)
    time.sleep(0.3)
    snap = be(z, {"cmd": "snapshot"})["snapshot"]
    check(blocks_of(snap, block) == final, "393: 「変更」で確定する")
    be(z, {"cmd": "undo"})
    time.sleep(0.3)
    snap = be(z, {"cmd": "snapshot"})["snapshot"]
    check(blocks_of(snap, block) == before, "393: Ctrl+Z 1 回で戻る")


def blocks_of(snap: dict, block: int) -> list[int]:
    """写しからブロック `block`（通し番号）のタイル指定 8 個。"""
    side = "secondary" if block >= 640 else "primary"
    raw = base64.b64decode(snap[side]["blocks"])
    o = (block - 640 if block >= 640 else block) * 16
    return [raw[o + i * 2] | (raw[o + i * 2 + 1] << 8) for i in range(8)]


def attr_of(snap: dict, block: int) -> int:
    side = "secondary" if block >= 640 else "primary"
    return snap[side]["attributes"][block - 640 if block >= 640 else block]


def key(z: Zigzagu, k: str, ctrl: bool = False) -> None:
    be(z, {"cmd": "key", "key": k, "ctrl": ctrl})


def snap(z: Zigzagu) -> dict:
    return be(z, {"cmd": "snapshot"})["snapshot"]


def map_cell_block(z: Zigzagu, x: int, y: int) -> int:
    z.call({"cmd": "mouse", "target": "map", "cell": [x, y], "action": "rightClick"})
    return z.call({"cmd": "selection"})["block"]["blocks"][0]


def check_394(z: Zigzagu, shots: pathlib.Path | None, work: pathlib.Path) -> None:
    # コピーと貼り付け（主の 1 → 2）
    select_in_list(z, 1)
    s1 = snap(z)
    src = blocks_of(s1, 1)
    dst_before = blocks_of(s1, 2)
    key(z, "c", ctrl=True)
    st = be_state(z)
    check(st["edit"]["clipboard"] is not None and st["edit"]["clipboard"]["tiles"] == src, "394: Ctrl+C で選んでいるブロックをコピーする")
    select_in_list(z, 2)
    key(z, "v", ctrl=True)
    time.sleep(0.3)
    s2 = snap(z)
    check(blocks_of(s2, 2) == src and attr_of(s2, 2) == attr_of(s1, 1), "394: Ctrl+V で貼り付ける（タイルと属性）")
    be(z, {"cmd": "undo"})
    time.sleep(0.3)
    check(blocks_of(snap(z), 2) == dst_before, "394: 貼り付けは 1 回の Ctrl+Z で戻る")

    # 切り取り（主の 3）
    select_in_list(z, 3)
    before3 = blocks_of(snap(z), 3)
    be(z, {"cmd": "action", "id": "edit.cut"})
    time.sleep(0.3)
    s3 = snap(z)
    check(blocks_of(s3, 3) == [0] * 8 and attr_of(s3, 3) == 0, "394: 切り取りで空のブロックになる")
    check(be_state(z)["edit"]["clipboard"]["tiles"] == before3, "394: 切り取った中身を貼り付けられる")
    be(z, {"cmd": "undo"})
    time.sleep(0.3)
    check(blocks_of(snap(z), 3) == before3, "394: 切り取りは 1 回の Ctrl+Z で戻る")

    # 入れ替え: 3.0 で使っている副のブロック a と、使っていない副のブロック b
    a = None
    for y in range(0, 20):
        for x in range(0, 24):
            v = map_cell_block(z, x, y)
            if v >= 640:
                a = v
                break
        if a is not None:
            break
    check(a is not None, f"394: 3.0 で副のブロックを見つける（{a}）")
    if a is None:
        return
    # b はこのマップで使っていない副のブロック
    b = next(v for v in range(640 + 0x50, 640 + 0x100) if z.call({"cmd": "blockUsage", "block": v})["here"] == 0)
    map_before = z.call({"cmd": "canvasPng", "target": "map"})["png"]
    sb = snap(z)
    ta, tb = blocks_of(sb, a), blocks_of(sb, b)
    key(z, "x")
    check(be_state(z)["edit"]["swap"]["active"], "394: X で入れ替えがオンになる")
    select_in_list(z, a)
    check(be_state(z)["edit"]["swap"]["first"] == a, "394: 1 つ目を押す")
    select_in_list(z, b)
    d = []
    for _ in range(50):
        d = dialogs(z)
        if d:
            break
        time.sleep(0.1)
    save_shot(z, shots, "block_swap_confirm.png", BE)
    be(z, {"cmd": "dialog", "press": "yes"})
    text = d[0].get("text", "") if d else ""
    check("マップは" in text and "枚" in text, f"394: 入れ替えの前に、使うマップの数を出して聞く（{text[:80]}）")
    time.sleep(1.0)
    sa = snap(z)
    check(blocks_of(sa, a) == tb and blocks_of(sa, b) == ta, "394: 2 つのブロックが入れ替わる")
    map_after = z.call({"cmd": "canvasPng", "target": "map"})["png"]
    check(map_after == map_before, "394: 番号も付け替えるとマップの見た目は同じ")
    check(be_state(z)["status"].find("入れ替えました") >= 0, "394: 窓の下に結果が出る")
    be(z, {"cmd": "undo"})
    time.sleep(0.5)
    su = snap(z)
    check(blocks_of(su, a) == ta and blocks_of(su, b) == tb, "394: 入れ替えは 1 回の Ctrl+Z でタイルセットが戻る")
    check(z.call({"cmd": "canvasPng", "target": "map"})["png"] == map_before, "394: 取り消してもマップの見た目は同じ")
    # 付け替えない入れ替え
    select_in_list(z, a)
    select_in_list(z, b)
    press_if_open(z, "no", tries=50)
    time.sleep(1.0)
    check(z.call({"cmd": "canvasPng", "target": "map"})["png"] != map_before, "394: 付け替えないとマップの見た目が変わる")
    be(z, {"cmd": "undo"})
    time.sleep(0.5)
    # 付け替えて出力すると、3.0 の配置の番号が b になっている
    select_in_list(z, a)
    select_in_list(z, b)
    press_if_open(z, "yes", tries=50)
    time.sleep(1.0)
    key(z, "x")
    check(not be_state(z)["edit"]["swap"]["active"], "394: もう一度 X で入れ替えが終わる")
    res = z.call({"cmd": "export", "dir": str(work)})
    written = res.get("written", []) if isinstance(res, dict) else []
    check(len(written) > 1, f"394: 付け替えたマップが出力される（{len(written)} 件）")
    p30 = work / "maps" / "03" / "00.json"
    if p30.exists():
        import json as _json
        layout = base64.b64decode(_json.loads(p30.read_text(encoding="utf-8"))["Layout"])
        ids = {(layout[i] | (layout[i + 1] << 8)) & 0x3FF for i in range(0, len(layout), 2)}
        check(b in ids and a not in ids, f"394: 出力した 3.0 の配置で {a:#x} が {b:#x} に付け替わっている")
    else:
        check(False, f"394: 3.0 の JSON が出力される（{p30}）")


def wait_stats(z: Zigzagu, what: str, cond=lambda st: True) -> dict:
    """ブロックエディタの使用回数を数え終えるまで待つ（`stats.counted` と `cond`）。"""
    st: dict = {}
    for _ in range(100):
        st = be_state(z)["stats"]
        if st["counted"] and cond(st):
            return st
        time.sleep(0.1)
    check(False, f"395: {what}（数え終わらない: {st.get('counted')}）")
    return st


def unused_secondary_tiles(snap_: dict) -> list[int]:
    """写しの主と副のブロックから数えた、副のタイル（0x280〜）の未使用。"""
    used = set()
    for side in ("primary", "secondary"):
        raw = base64.b64decode(snap_[side]["blocks"])
        for i in range(0, len(raw) - 1, 2):
            used.add((raw[i] | (raw[i + 1] << 8)) & 0x3FF)
    count = len(base64.b64decode(snap_["secondary"]["tiles"])) // 32
    return [t for t in range(0x280, 0x280 + min(count, 0x180)) if t not in used]


def check_395(z: Zigzagu, shots: pathlib.Path | None, work: pathlib.Path) -> None:
    # 使用回数
    be(z, {"cmd": "action", "id": "view.usage"})
    st = wait_stats(z, "使用回数を数える")
    counts = st.get("counts") or []
    check(st["flags"]["usage"] and len(counts) > 640, f"395: 表示 > 使用回数で数える（{len(counts)} 個）")
    # 3.0 に置いてあるブロックも比べる
    samples = sorted({0, 1, 2, 3, 0x10, 640, 641, 642, 650, map_cell_block(z, 5, 5), map_cell_block(z, 10, 8)})
    bad = []
    for b in samples:
        if b >= len(counts) or counts[b] < 0:
            continue
        main = z.call({"cmd": "blockUsage", "block": b})["count"]
        if main != counts[b]:
            bad.append((b, counts[b], main))
    check(not bad, f"395: 使用回数がマップタブの使用回数と同じ（違い {bad}）")
    save_shot(z, shots, "block_usage.png", BE)

    # 未使用のブロック
    be(z, {"cmd": "action", "id": "view.unusedBlocks"})
    st = wait_stats(z, "未使用のブロック", lambda s: s["unusedBlocks"] is not None)
    zero = [i for i, n in enumerate(st["counts"]) if n == 0]
    check(st["unusedBlocks"] == zero and len(zero) > 0, f"395: 未使用のブロックの印が使用回数 0 と合う（{len(zero)} 個）")
    if zero:
        check(z.call({"cmd": "blockUsage", "block": zero[-1]})["count"] == 0, f"395: 印の付いたブロック {zero[-1]:#x} はマップタブでも 0 回")

    # 未使用のタイル（副のタイルは主と副のブロックだけで決まるので、写しから数えた値と比べる）
    be(z, {"cmd": "action", "id": "view.unusedTiles"})
    st = wait_stats(z, "未使用のタイル", lambda s: s["unusedTiles"] is not None)
    s0 = snap(z)
    expect = unused_secondary_tiles(s0)
    got = [t for t in st["unusedTiles"] if t >= 0x280]
    check(got == expect, f"395: 副の未使用のタイルがブロックから数えた値と合う（{len(got)} / {len(expect)} 枚）")
    save_shot(z, shots, "block_unused.png", BE)
    # 副のブロックを 1 つ切り取ると数え直す
    # 副のタイルを 1 つだけのブロックが使っているもの（切り取ると未使用のタイルが増える）
    users: dict[int, set[int]] = {}
    for side, base in (("primary", 0), ("secondary", 640)):
        n = len(base64.b64decode(s0[side]["blocks"])) // 16
        for blk in range(base, base + n):
            for r in blocks_of(s0, blk):
                users.setdefault(r & 0x3FF, set()).add(blk)
    target = next((next(iter(u)) for t, u in sorted(users.items()) if t >= 0x280 and len(u) == 1 and next(iter(u)) >= 641), None)
    if target is not None:
        select_in_list(z, target)
        be(z, {"cmd": "action", "id": "edit.cut"})
        time.sleep(0.3)
        s1 = snap(z)
        expect1 = unused_secondary_tiles(s1)
        st = wait_stats(z, "切り取りの後に数え直す", lambda s: [t for t in (s["unusedTiles"] or []) if t >= 0x280] == expect1)
        got1 = [t for t in (st["unusedTiles"] or []) if t >= 0x280]
        check(got1 == expect1 and len(got1) > len(got), f"395: ブロック {target:#x} を切り取ると未使用のタイルを数え直す（{len(got)} → {len(got1)} 枚）")
        be(z, {"cmd": "undo"})
        time.sleep(0.3)
    for id_ in ("view.usage", "view.unusedBlocks", "view.unusedTiles"):
        be(z, {"cmd": "action", "id": id_})
    st = be_state(z)["stats"]
    check(not any(st["flags"].values()) and not st["counted"] and st["counts"] is None, "395: 3 つともオフにすると結果を捨てる")

    # ブロック一覧の画像の書き出し（副の 0x000〜0x00F を幅 4 で）
    be(z, {"cmd": "action", "id": "tiles.exportBlocks"})
    time.sleep(0.3)
    be(z, {"cmd": "setField", "id": "be.exp.tileset", "value": 1})
    be(z, {"cmd": "setField", "id": "be.exp.from", "value": "000"})
    be(z, {"cmd": "setField", "id": "be.exp.to", "value": "00F"})
    be(z, {"cmd": "setField", "id": "be.exp.columns", "value": "4"})
    be(z, {"cmd": "setField", "id": "be.exp.upper", "value": False})
    be(z, {"cmd": "setField", "id": "be.exp.background", "value": 1})
    info = be(z, {"cmd": "getField", "id": "be.exp.info"})["value"]
    check("16 個" in info and "64×64" in info, f"395: プレビューの大きさが範囲と幅に合う（{info}）")
    save_shot(z, shots, "block_export.png", BE)
    work.mkdir(parents=True, exist_ok=True)
    out = work / "blocks395.png"
    if out.exists():
        out.unlink()
    be(z, {"cmd": "queuePath", "path": str(out)})
    be(z, {"cmd": "dialog", "press": "save"})
    for _ in range(50):
        if out.exists() and out.stat().st_size > 0:
            break
        time.sleep(0.1)
    ok = out.exists() and out.read_bytes()[:4] == b"\x89PNG"
    w, h = struct.unpack(">II", out.read_bytes()[16:24]) if ok else (0, 0)
    check(ok and (w, h) == (64, 64), f"395: PNG に書き出す（{w}×{h}）")
    check("書き出しました" in be_state(z)["status"], "395: 窓の下に書き出した場所が出る")


PE = "palette-editor"


def color_usage(snap_: dict, palette: int) -> list[list[int]]:
    """写しから、色ごとにその色を使うブロック（core の colorUsage と同じ数え方）。"""
    tiles = {False: base64.b64decode(snap_["primary"]["tiles"]), True: base64.b64decode(snap_["secondary"]["tiles"])}
    out: list[list[int]] = [[] for _ in range(16)]
    for side, base in (("primary", 0), ("secondary", 640)):
        raw = base64.b64decode(snap_[side]["blocks"])
        for b in range(len(raw) // 16):
            mask = 0
            for k in range(8):
                ref = raw[b * 16 + k * 2] | (raw[b * 16 + k * 2 + 1] << 8)
                if (ref >> 12) & 0xF != palette:
                    continue
                tile = ref & 0x3FF
                data = tiles[tile >= 0x280]
                o = (tile - 0x280 if tile >= 0x280 else tile) * 32
                for v in data[o:o + 32] if o + 32 <= len(data) else b"":
                    mask |= (1 << (v & 0xF)) | (1 << (v >> 4))
            for c in range(16):
                if mask & (1 << c):
                    out[c].append(base + b)
    return out


def pe(z: Zigzagu, req: dict):
    return z.call({**req, "window": PE})


def check_396(z: Zigzagu, shots: pathlib.Path | None, work: pathlib.Path) -> None:
    be(z, {"cmd": "action", "id": "palette.editor"})
    for _ in range(80):
        if any(w["label"] == PE and w["ready"] for w in z.call({"cmd": "windows"})):
            break
        time.sleep(0.2)
    st = pe(z, {"cmd": "state"})
    palette = st["palette"]

    # 16 進の RGB の欄: 入れると 15 ビットに丸めて、スライダーと値も動く
    pe(z, {"cmd": "click", "id": "pal.color.3"})
    pe(z, {"cmd": "setField", "id": "pal.rgbHex", "value": "#FF8347"})
    pe(z, {"cmd": "click", "id": "pal.rgbApply"})
    st = pe(z, {"cmd": "state"})
    check(st["color"]["red"] == 31 and st["color"]["green"] == 16 and st["color"]["blue"] == 8, f"396: #FF8347 を 15 ビットに丸める（{st['color']}）")
    check(pe(z, {"cmd": "getField", "id": "pal.redValue"})["value"] == "248" and st["rgb"] == "#F88040", f"396: スライダーの値と 16 進の欄が動く（{st['rgb']}）")
    pe(z, {"cmd": "setField", "id": "pal.rgbHex", "value": "#12"})
    pe(z, {"cmd": "click", "id": "pal.rgbApply"})
    d = press_if_open(z, "ok", window=PE)
    check(bool(d) and "#RRGGBB" in d[0].get("text", ""), "396: #RRGGBB でなければエラー")

    # 未使用の色（写しのタイルとブロックから数えた値と比べる）
    s0 = snap(z)
    usage = color_usage(s0, palette)
    pe(z, {"cmd": "action", "id": "view.unusedColors"})
    st = pe(z, {"cmd": "state"})
    expect = [c for c in range(16) if not usage[c]]
    check(st["showUnused"] and st["unusedColors"] == expect, f"396: 表示 > 未使用の色（{st['unusedColors']} / {expect}）")
    save_shot(z, shots, "palette_unused.png", PE)
    pe(z, {"cmd": "action", "id": "view.unusedColors"})

    # 色の使用箇所: 使われている色を選び、一覧の行を押すとブロックエディタで選ぶ
    used = next((c for c in range(1, 16) if usage[c]), None)
    check(used is not None, "396: 使われている色がある")
    if used is not None:
        pe(z, {"cmd": "click", "id": f"pal.color.{used}"})
        pe(z, {"cmd": "action", "id": "tools.colorUsage"})
        time.sleep(0.2)
        info = pe(z, {"cmd": "getField", "id": "pal.usage.info"})["value"]
        check(f"{len(usage[used])} 個" in info, f"396: 色 {used} を使うブロックの数（{info}）")
        save_shot(z, shots, "palette_usage.png", PE)
        target = usage[used][-1]
        pe(z, {"cmd": "click", "id": f"pal.usage.{target}"})
        ok = False
        for _ in range(30):
            if be_state(z)["block"] == target:
                ok = True
                break
            time.sleep(0.1)
        check(ok, f"396: 一覧の行を押すとブロックエディタでブロック {target:#x} を選ぶ（{be_state(z)['block']}）")
        pe(z, {"cmd": "dialog", "press": "close"})

    # パレットの読み込み: JASC-PAL・GIMP・Adobe の .act
    work.mkdir(parents=True, exist_ok=True)
    def colors_of(n: int) -> list[tuple[int, int, int]]:
        return [(i * 16, 255 - i * 16, (i * 40 + n * 8) % 256) for i in range(16)]

    files = {
        "jasc.pal": lambda rgb: ("JASC-PAL\r\n0100\r\n16\r\n" + "".join(f"{r} {g} {b}\r\n" for r, g, b in rgb)).encode(),
        "gimp.gpl": lambda rgb: ("GIMP Palette\nName: t\nColumns: 4\n#\n" + "".join(f"{r:3d} {g:3d} {b:3d}\tc{i}\n" for i, (r, g, b) in enumerate(rgb))).encode(),
        "adobe.act": lambda rgb: bytes(v for c in rgb for v in c) + bytes(768 - 48) + bytes([0, 16, 0xFF, 0xFF]),
    }
    rgb = colors_of(0)
    for n, (name, make) in enumerate(files.items()):
        rgb = colors_of(n)
        data = make(rgb)
        expect_hex = [f"{((r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10)):04X}" for r, g, b in rgb]
        path = work / name
        path.write_bytes(data)
        z.call({"cmd": "queuePath", "path": str(path)})
        be(z, {"cmd": "action", "id": "palette.open"})
        got = []
        for _ in range(30):
            got = pe(z, {"cmd": "state"})["colors"]
            if got == expect_hex:
                break
            time.sleep(0.1)
        check(got == expect_hex, f"396: {name} を読み込む（{got[:3]}…）")
        press_if_open(z, "ok", window=BE, tries=3)
    bad = work / "short.gpl"
    bad.write_bytes(("GIMP Palette\n" + "".join(f"{r} {g} {b}\n" for r, g, b in rgb[:4])).encode())
    z.call({"cmd": "queuePath", "path": str(bad)})
    be(z, {"cmd": "action", "id": "palette.open"})
    d = press_if_open(z, "ok", window=BE)
    check(bool(d) and "16 ではありません" in d[0].get("text", ""), f"396: 16 色でないとエラー（{d[0].get('text', '') if d else ''}）")

    # 色の変更は今どおり 1 回で戻せる（読み込んだ色を反映して Ctrl+Z）
    colors_before = snap(z)["primary"]["palettes"][palette * 16:palette * 16 + 16] if palette < 7 else None
    be(z, {"cmd": "action", "id": "palette.commit"})
    press_if_open(z, "yes", window=BE, tries=5)
    time.sleep(0.5)
    if colors_before is not None:
        after = snap(z)["primary"]["palettes"][palette * 16:palette * 16 + 16]
        check(after != colors_before, "396: 読み込んだ色を反映する")
        be(z, {"cmd": "undo"})
        time.sleep(0.5)
        check(snap(z)["primary"]["palettes"][palette * 16:palette * 16 + 16] == colors_before, "396: 1 回の Ctrl+Z で戻る")
    pe(z, {"cmd": "close"})


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--rom", required=True)
    p.add_argument("--exe")
    p.add_argument("--shots")
    p.add_argument("--only", nargs="*")
    p.add_argument("--work", help="出力の作業フォルダ（省略で一時フォルダ）")
    a = p.parse_args()
    shots = pathlib.Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    profile = pathlib.Path(tempfile.mkdtemp(prefix="zzm-profile-"))
    only = set(a.only or [])

    def want(n: str) -> bool:
        return not only or n in only

    with Zigzagu(a.exe, profile=profile) as z:
        z.call({"cmd": "open", "rom": a.rom})
        z.call({"cmd": "selectMap", **PALLET})
        open_window(z, "tools.blockEditor", BE)
        if want("393"):
            check_393(z, shots)
        if want("394"):
            work = pathlib.Path(a.work) if a.work else pathlib.Path(tempfile.mkdtemp(prefix="zzm-swap-"))
            check_394(z, shots, work)
        if want("395"):
            work = pathlib.Path(a.work) if a.work else pathlib.Path(tempfile.mkdtemp(prefix="zzm-stats-"))
            check_395(z, shots, work)
        if want("396"):
            work = pathlib.Path(a.work) if a.work else pathlib.Path(tempfile.mkdtemp(prefix="zzm-pal-"))
            check_396(z, shots, work)

    print()
    print("失敗なし" if not failures else f"失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
