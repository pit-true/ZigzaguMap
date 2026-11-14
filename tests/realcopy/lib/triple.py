r"""トリプルレイヤーの写しでの確認（--triple。Phase4 #317）。

写しの ROM とプロジェクトを開き、3.0 で使っているブロック N をブロックエディタで 3 層にして（3 層目に反転したタイルを置く）、
N をマップに置いて出力し、写しをビルドする（ビルド側の変更は要らない）。できた ROM で、
- 3.0 のタイルセットの N の属性の 4 バイト目が 0x30、N+1 の属性が 0、N+1 の下層が 3 層目、上層が 0
- 3.0 の配置に N がある
- ZigzaguMap でできた ROM を開き直すと、N が 3 層、N+1 が 3 層の次の番号になる（往復）
を確かめる。写しのテキストファイル（maps など）は、最後に元へ戻す。
"""
from __future__ import annotations

import pathlib
import time

from .app import Zigzagu
from .builder import build_fixture
from .fixtures import Fixture
from .link import TextSnapshot
from .romread import BuiltRom

TARGET = (3, 0)
CELL = (5, 5)
BE = "block-editor"


def _be(z: Zigzagu, req: dict):
    return z.call({**req, "window": BE})


def _press(z: Zigzagu, id_: str, x: int, y: int, button: int) -> None:
    for t in ("down", "up"):
        _be(z, {"cmd": "pointer", "id": id_, "type": t, "x": x, "y": y, "button": button})


def triple_one(fx: Fixture, z: Zigzagu, check, log, timeout: int | None, log_dir: pathlib.Path) -> None:
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    try:
        z.open_fixture(fx)
        z.call({"cmd": "selectMap", "bank": TARGET[0], "map": TARGET[1]})
        z.call({"cmd": "mouse", "target": "map", "cell": list(CELL), "action": "rightClick"})
        n = z.call({"cmd": "selection"})["block"]["blocks"][0]
        info = z.call({"cmd": "blockInfo", "block": n})
        if info["unresolved"] or z.call({"cmd": "blockInfo", "block": n + 1})["triple"]:
            n -= 1
        log(f"3 層にするブロック: {n:#x}")
        z.call({"cmd": "action", "id": "tools.blockEditor"})
        for _ in range(100):
            if any(w["label"] == BE and w["ready"] for w in z.call({"cmd": "windows"})):
                break
            time.sleep(0.2)
        _press(z, "be.blocks", (n % 8) * 32 + 16, (n // 8) * 32 + 16, 0)
        _be(z, {"cmd": "setField", "id": "be.background", "value": 0x30})
        _press(z, "be.block", 8, 8, 2)
        _be(z, {"cmd": "setField", "id": "be.xflip", "value": True})
        _be(z, {"cmd": "setField", "id": "be.yflip", "value": True})
        for x, y in ((8, 8), (24, 8), (8, 24), (24, 24)):
            _press(z, "be.third", x, y, 0)
        third = _be(z, {"cmd": "state"})["third"]
        _be(z, {"cmd": "click", "id": "be.save"})
        for _ in range(20):
            d = _be(z, {"cmd": "dialogs"})["dialogs"]
            if d:
                _be(z, {"cmd": "dialog", "press": "yes"})
                break
            time.sleep(0.1)
        time.sleep(0.5)
        check(z.call({"cmd": "blockInfo", "block": n})["triple"], f"ブロック {n:#x} が 3 層になる（3 層目 {third}）")
        z.call({"cmd": "close", "window": BE})
        # N をマップの (1,1) に置く（移動許可はそのまま）
        z.call({"cmd": "command", "name": "paintBlocks", "args": {"bank": TARGET[0], "map": TARGET[1], "cells": [{"x": 1, "y": 1, "block": n}]}})
        res = z.export()
        log(f"出力: 書いた {len(res.get('written', []))} 件 {[w for w in res.get('written', []) if 'tilesets' in w.replace(chr(92), '/')]}")
        r = build_fixture(fx, log_dir, timeout or 3600)
        log(r.summary())
        check(r.ok, "写しのビルドが通る")
        if not r.ok:
            return
        rom_path = fx.path(f"{fx.build.cwd}/{fx.build.output}")
        built = BuiltRom(rom_path)
        lay = built.layout(*TARGET)
        secondary = n >= 640
        local = n - 640 if secondary else n
        ts = built.tileset(lay["secondary" if secondary else "primary"], local + 2)
        check((ts["attributes"][local] >> 24) & 0x70 == 0x30, f"ビルドした ROM の N の属性の 4 バイト目が 0x30（{ts['attributes'][local]:#010x}）")
        check(ts["attributes"][local + 1] == 0, f"N+1 の属性が 0（{ts['attributes'][local + 1]:#x}）")
        lower = ts["blocks"][(local + 1) * 8:(local + 1) * 8 + 4]
        upper = ts["blocks"][(local + 1) * 8 + 4:(local + 2) * 8]
        check(lower == third and upper == [0, 0, 0, 0], f"N+1 の下層が 3 層目（{lower}）、上層が 0（{upper}）")
        check(lay["cells"][1 * lay["width"] + 1] & 0x3FF == n, "ビルドした ROM の 3.0 の (1,1) が N")
        # 往復: できた ROM を開き直すと 3 層のまま
        z.open(rom_path, None)
        z.call({"cmd": "selectMap", "bank": TARGET[0], "map": TARGET[1]})
        a = z.call({"cmd": "blockInfo", "block": n})
        b = z.call({"cmd": "blockInfo", "block": n + 1})
        check(a["triple"] and b["tripleChild"], f"できた ROM を開き直すと N が 3 層、N+1 が 3 層の次の番号（{a['layerMode']}, {b['tripleChild']}）")
    finally:
        changed = snap.restore()
        log(f"写しのテキストファイルを元に戻した（{changed} 件）")
