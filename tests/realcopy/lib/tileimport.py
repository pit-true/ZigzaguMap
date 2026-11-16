r"""画像からタイルとブロックを作る（--tileimport。Phase6 #443）の写しでの確認。

写しの ROM とプロジェクトを開き、自動操作の `tileset.importImage` で見本の PNG（この中で作る小さな絵）を取り込む。
- 3.0 は今の副タイルセットへ、3.1 は新しい副タイルセットへ取り込み、できたブロックを画像の並びのまま左上に塗る
- 出力して写しをビルドし（`TileCount` は 16 の倍数、`tiles.png` は 16 色）、できた ROM を開き直すと、2 つのマップの絵が
  出力の前と同じ（往復）
を確かめる。写しのテキストファイル（maps など）は、最後に元へ戻す。
"""
from __future__ import annotations

import json
import pathlib
import struct
import time
import zlib

from .app import Zigzagu
from .builder import build_fixture
from .delete import PATCHES, _apply_patch
from .fixtures import Fixture
from .link import TextSnapshot

TARGETS = (((3, 0), "secondary"), ((3, 1), "newSecondary"))


def sample_png(path: pathlib.Path, width: int = 48, height: int = 32) -> None:
    """見本の絵（左上は透明色のマゼンタ。縞・市松・単色のマス、透明のマスを混ぜる。色は 12 色）。"""
    colors = [(248, 0, 248), (248, 248, 248), (200, 40, 40), (40, 160, 40), (40, 40, 200), (240, 200, 0), (0, 0, 0), (120, 72, 24), (0, 200, 200), (168, 168, 168), (248, 128, 160), (80, 80, 80)]
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            cx, cy = x // 16, y // 16
            if (cx, cy) == (2, 1) or (x, y) == (0, 0):
                c = 0  # 透明のマスと、透明色に使う左上の画素
            elif cx == 0:
                c = 1 + (x + y) % 4  # 斜めの縞
            elif cx == 1:
                c = 5 + ((x // 4 + y // 4) % 2) * 2  # 市松
            else:
                c = 8 + (y // 4) % 4 if x % 16 >= 2 else 0
            row += bytes(colors[c]) + b"\xff"
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def tileimport_one(fx: Fixture, z: Zigzagu, check, log, timeout: int | None, log_dir: pathlib.Path) -> None:
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    log_dir.mkdir(parents=True, exist_ok=True)
    png = log_dir / "sample.png"
    sample_png(png)
    try:
        z.open_fixture(fx)
        expected: dict[tuple[int, int], str] = {}
        for (bank, map_), target in TARGETS:
            z.call({"cmd": "selectMap", "bank": bank, "map": map_})
            r = z.call({"cmd": "tileset.importImage", "paths": [str(png)], "target": target, "stamp": f"取り込みの確認 {bank}.{map_}"})
            plan = r["plan"]
            log(f"{bank}.{map_}（{target}）: 新しいタイル {plan['tiles']['created']}、ブロック {plan['blocks']['needed']}、本 {plan['palettes']['opened']}、{r['ms']}ms、問題 {[p['code'] for p in plan['problems']]}")
            check(r["done"], f"{bank}.{map_} に取り込める（{target}）")
            if not r["done"]:
                continue
            cells = [{"x": i % plan["cellsWide"], "y": i // plan["cellsWide"], "block": b} for i, b in enumerate(plan["cells"]) if b >= 0]
            z.call({"cmd": "command", "name": "paintBlocks", "args": {"bank": bank, "map": map_, "cells": cells}})
            expected[(bank, map_)] = z.call({"cmd": "canvasPng", "target": "map"})["png"]
        patch = PATCHES / f"map_project-pillow-{fx.name}.patch"
        check(_apply_patch(fx.project_path, patch, log, ("scripts/map_project.py", "_import_pil_image")), f"写しの map_project.py に {patch.name} を当てる")
        res = z.export()
        written = [w.replace("\\", "/") for w in (res.get("written", []) if isinstance(res, dict) else [])]
        tilesets = [w for w in written if w.endswith("tileset.json")]
        log(f"出力: 書いた {len(written)} 件（タイルセット {tilesets}）")
        for w in tilesets:
            p = pathlib.Path(w) if pathlib.Path(w).is_absolute() else fx.project_path / w
            data = json.loads(p.read_text(encoding="utf-8"))
            check(data["TileCount"] % 16 == 0, f"{p.parent.name} の TileCount（{data['TileCount']}）が 16 の倍数")
            tiles_png = p.parent / "tiles.png"
            raw = tiles_png.read_bytes()
            plte = raw.index(b"PLTE")
            n = struct.unpack(">I", raw[plte - 4 : plte])[0] // 3
            check(n == 16, f"{p.parent.name} の tiles.png が 16 色（{n}）")
        check(any("secondary_" in w for w in tilesets), "取り込んだ副タイルセットが maps/tilesets に出力される")
        r = build_fixture(fx, log_dir, timeout or 3600)
        log(r.summary())
        check(r.ok, "写しのビルドが通る")
        if not r.ok:
            return
        rom_path = fx.path(f"{fx.build.cwd}/{fx.build.output}")
        z.open(rom_path, None)
        for (bank, map_), png_b64 in expected.items():
            z.call({"cmd": "selectMap", "bank": bank, "map": map_})
            time.sleep(0.2)
            check(z.call({"cmd": "canvasPng", "target": "map"})["png"] == png_b64, f"できた ROM を開き直した {bank}.{map_} の絵が出力の前と同じ")
    finally:
        changed = snap.restore()
        log(f"写しのテキストファイルを元に戻した（{changed} 件）")
