"""ブロックエディタ・パレットエディタの Phase5 の操作（#393〜#397）を、素の ROM だけで確かめる。

  python tests/automation/block_tools_check.py --rom <素の BPRJ の写し> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--only 393 394 ...]

- 393: タイル一覧のドラッグで 2×2 を選び、8 マスに 1 回で置ける。左右反転で並びと各タイルが反転する。
  Ctrl＋左クリックでパレットだけ変わる。右ドラッグで反転とパレットごと拾って置ける。ホバーで窓の下に情報が出る。
  「変更」で 1 回の Ctrl+Z で戻る。
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
    """写しから主のブロック `block` のタイル指定 8 個。"""
    raw = base64.b64decode(snap["primary"]["blocks"])
    o = block * 16
    return [raw[o + i * 2] | (raw[o + i * 2 + 1] << 8) for i in range(8)]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--rom", required=True)
    p.add_argument("--exe")
    p.add_argument("--shots")
    p.add_argument("--only", nargs="*")
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

    print()
    print("失敗なし" if not failures else f"失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
