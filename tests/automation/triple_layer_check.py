"""トリプルレイヤー（#299・#302）を、素の ROM だけで確かめる。

  python tests/automation/triple_layer_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--work <出力の作業フォルダ>]

- 299: `blockInfo` が素のブロックを 2 層（重ね方 0）と答える。
- 302: ブロックエディタで、マサラタウンで使っているブロック N の 4 バイト目を 30 にすると 3 層目の 4 マスが出る。
  3 層目にタイルを置いて「変更」を押すと（N+1 に消える値があれば確かめの窓に「はい」）、メインのマップとパレットの N の絵が変わり、
  `blockInfo` で N が 3 層、N+1 が 3 層の次の番号になる。一覧で N+1 を押すと N が選ばれる。
  Ctrl+Z 1 回で N と N+1 の両方が戻る。やり直して出力すると、tileset.json の Behaviors（N の 4 バイト目 0x30、N+1 は 0）と
  Blocks（N+1 の下層に 3 層目、上層は 0）が規則どおり。主の 639 番は 3 層にできない（文を出して値を戻す）。
  4 バイト目を 50 にすると「実機ではこのマスは描かれません」が出る。
"""
from __future__ import annotations

import argparse
import base64
import json
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


def be(z: Zigzagu, req: dict):
    return z.call({**req, "window": BE})


def be_state(z: Zigzagu) -> dict:
    return be(z, {"cmd": "state"})


def select_in_list(z: Zigzagu, block: int) -> None:
    """ブロック一覧（8 列、1 ブロック 32px）の `block` を押す。"""
    cell_pointer(z, "be.blocks", (block % 8) * 32 + 16, (block // 8) * 32 + 16, "left")


def cell_pointer(z: Zigzagu, id_: str, x: int, y: int, button: str) -> None:
    b = 2 if button == "right" else 0
    be(z, {"cmd": "pointer", "id": id_, "type": "down", "x": x, "y": y, "button": b})
    be(z, {"cmd": "pointer", "id": id_, "type": "up", "x": x, "y": y, "button": b})


def background_index(z: Zigzagu, value: int) -> None:
    be(z, {"cmd": "setField", "id": "be.background", "value": value})


def dialogs(z: Zigzagu, window: str | None = BE) -> list:
    req: dict = {"cmd": "dialogs"}
    if window:
        req["window"] = window
    r = z.call(req)
    # 別ウィンドウは {"dialogs": [...]}、メインは一覧そのものを返す
    return r["dialogs"] if isinstance(r, dict) else r


def press_if_open(z: Zigzagu, press: str, window: str | None = BE) -> list:
    for _ in range(20):
        d = dialogs(z, window)
        if d:
            req: dict = {"cmd": "dialog", "press": press}
            if window:
                req["window"] = window
            z.call(req)
            return d
        time.sleep(0.1)
    return []


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--rom", required=True)
    p.add_argument("--exe")
    p.add_argument("--shots")
    p.add_argument("--work")
    a = p.parse_args()
    shots = pathlib.Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    work = pathlib.Path(a.work) if a.work else pathlib.Path(tempfile.mkdtemp(prefix="zzm-triple-"))
    work.mkdir(parents=True, exist_ok=True)
    profile = pathlib.Path(tempfile.mkdtemp(prefix="zzm-profile-"))

    with Zigzagu(a.exe, profile=profile) as z:
        z.call({"cmd": "open", "rom": a.rom})
        z.call({"cmd": "selectMap", **PALLET})
        z.call({"cmd": "setting", "key": "autoMovement", "value": False})

        # 299: 素のブロックは 2 層
        z.call({"cmd": "mouse", "target": "map", "cell": [5, 5], "action": "rightClick"})
        n = z.call({"cmd": "selection"})["block"]["blocks"][0]
        block_n = n
        info = z.call({"cmd": "blockInfo", "block": n})
        check(info["layerMode"] == 0 and not info["triple"] and not info["tripleChild"], f"299: 素のブロック {n:#x} は 2 層（{info}）")

        palette_before = z.call({"cmd": "canvasPng", "target": "palette"})
        map_before = z.call({"cmd": "canvasPng", "target": "map"})

        # 302: ブロックエディタ
        z.call({"cmd": "action", "id": "tools.blockEditor"})
        for _ in range(50):
            if any(w["label"] == BE and w["ready"] for w in z.call({"cmd": "windows"})):
                break
            time.sleep(0.2)
        select_in_list(z, n)
        s = be_state(z)
        check(s["block"] == n and not s["thirdVisible"], f"302: 一覧でブロック {n:#x} を選ぶと 3 層目は出ていない")
        attr_before = s["attribute"]
        background_index(z, 0x30)
        s = be_state(z)
        check(s["triple"] and s["thirdVisible"], "302: 4 バイト目を 30 にすると 3 層目の 4 マスが出る")
        check("3枚目のレイヤー" in be(z, {"cmd": "getField", "id": "be.thirdLabel"})["value"], "302: 3 層目の見出し")
        # 8 マスの左上（下層）を拾い、反転を付けて 3 層目の 4 マスに置く
        cell_pointer(z, "be.block", 8, 8, "right")
        be(z, {"cmd": "setField", "id": "be.xflip", "value": True})
        be(z, {"cmd": "setField", "id": "be.yflip", "value": True})
        for x, y in ((8, 8), (24, 8), (8, 24), (24, 24)):
            cell_pointer(z, "be.third", x, y, "left")
        s = be_state(z)
        third = s["third"]
        check(third is not None and all(v & 0x0C00 == 0x0C00 for v in third), f"302: 3 層目の 4 マスに置ける（{third}）")
        save_shot(z, shots, "tile_block_editor_triple.png", BE)
        be(z, {"cmd": "click", "id": "be.save"})
        asked = press_if_open(z, "yes")
        if asked:
            check(any("3枚目のレイヤーに使われます" in d.get("text", "") for d in asked), "302: N+1 に消える値があるときは確かめる")
        time.sleep(0.5)
        info = z.call({"cmd": "blockInfo", "block": n})
        child = z.call({"cmd": "blockInfo", "block": n + 1})
        check(info["triple"] and info["third"] == n + 1, f"302: 保存すると N が 3 層（{info}）")
        check(child["tripleChild"] and child["parent"] == n and child["attribute"] == 0, f"302: N+1 は 3 層の次の番号で属性 0（{child}）")
        check(z.call({"cmd": "canvasPng", "target": "palette"}) != palette_before, "302: パレットがすぐ 3 層で描き直される")
        check(z.call({"cmd": "canvasPng", "target": "map"}) != map_before, "302: メインのマップがすぐ 3 層で描き直される")
        save_shot(z, shots, "tile_main_after_triple.png")

        # 一覧で N+1 を押すと N を選ぶ
        select_in_list(z, n + 1)
        check(be_state(z)["block"] == n, "302: 一覧で N+1 を押すと N が選ばれる")

        # 1 回の取り消しで N と N+1 の両方が戻る
        z.call({"cmd": "undo"})
        time.sleep(0.3)
        info = z.call({"cmd": "blockInfo", "block": n})
        child = z.call({"cmd": "blockInfo", "block": n + 1})
        check(not info["triple"] and not child["tripleChild"], "302: Ctrl+Z 1 回で N が戻る")
        check(z.call({"cmd": "canvasPng", "target": "palette"}) == palette_before, "302: Ctrl+Z 1 回で N+1 も戻り、パレットが元の絵になる")
        check(be_state(z)["attribute"] == attr_before, "302: 取り消すとブロックエディタも元の属性を読み直す")

        # やり直して出力し、tileset.json を確かめる
        z.call({"cmd": "redo"})
        time.sleep(0.3)
        result = z.call({"cmd": "export", "dir": str(work)})
        side = "secondary" if n >= 640 else "primary"
        jsons = [pathlib.Path(x) for x in result["written"] if x.replace("\\", "/").endswith("tileset.json") and side in x.replace("\\", "/")]
        check(len(jsons) == 1, f"302: 出力で N のタイルセット（{side}）の tileset.json を書く（{result['written']}）")
        if jsons:
            n = n - 640 if n >= 640 else n
            src = json.loads((work / jsons[0]).read_text(encoding="utf-8"))
            beh = base64.b64decode(src["Behaviors"])
            blk = base64.b64decode(src["Blocks"])
            check(beh[n * 4 + 3] & 0xF0 == 0x30, "302: tileset.json の Behaviors で N の 4 バイト目が 0x30")
            check(beh[(n + 1) * 4:(n + 2) * 4] == bytes(4), "302: N+1 の属性が 0")
            lower = [blk[(n + 1) * 16 + i * 2] | (blk[(n + 1) * 16 + i * 2 + 1] << 8) for i in range(4)]
            check(lower == third, f"302: N+1 の下層が 3 層目（{lower}）")
            check(blk[(n + 1) * 16 + 8:(n + 2) * 16] == bytes(8), "302: N+1 の上層が 0")

        # 主の 639 番は 3 層にできない
        select_in_list(z, 639)
        before = be_state(z)["attribute"]
        background_index(z, 0x30)
        msgs = press_if_open(z, "ok")
        check(any("トリプルレイヤーに設定できません" in d.get("text", "") for d in msgs), "302: 主の 639 番を 30 にすると文が出る")
        s = be_state(z)
        check(s["attribute"] == before and not s["thirdVisible"], "302: 主の 639 番は値が戻り、3 層目は出ない")

        # 5〜7 の注意
        select_in_list(z, block_n + 3)
        background_index(z, 0x50)
        check(be(z, {"cmd": "getField", "id": "be.layerWarning"})["visible"], "302: 4 バイト目 50 で「実機ではこのマスは描かれません」")
        save_shot(z, shots, "tile_block_editor_undrawn.png", BE)
        background_index(z, 0x00)
        check(not be(z, {"cmd": "getField", "id": "be.layerWarning"})["visible"], "302: 00 に戻すと注意が消える")
        z.call({"cmd": "close", "window": BE})

    print()
    print("失敗:", len(failures))
    for f in failures:
        print("  -", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
