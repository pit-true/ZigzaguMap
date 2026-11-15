r"""新しいタイルセットの写しでの確認（--newtileset。Phase5 #397）。

写しの ROM とプロジェクトを開き、3.0 でブロックエディタの 画像 > 新しいタイルセット… を
「タイルセット2・今のタイルセットの写し」で作る（3.0 の組が新しい副タイルセットに付け替わる）。
- 作った直後の 3.0 の見た目が、作る前と同じ（写しなので）
- 出力して写しをビルドし、できた ROM の 3.0 の副タイルセットが元と別の位置にあり、ブロックの中身が元と同じ
- ZigzaguMap でできた ROM を開き直すと、3.0 の絵が作る前と同じ（往復。実機で見える絵と同じ描き方）
を確かめる。写しのテキストファイル（maps など）は、最後に元へ戻す。
"""
from __future__ import annotations

import base64
import pathlib
import time

from .app import Zigzagu
from .builder import build_fixture
from .delete import PATCHES, _apply_patch
from .fixtures import Fixture
from .link import TextSnapshot
from .romread import BuiltRom

TARGET = (3, 0)
BE = "block-editor"


def _be(z: Zigzagu, req: dict):
    return z.call({**req, "window": BE})


def newtileset_one(fx: Fixture, z: Zigzagu, check, log, timeout: int | None, log_dir: pathlib.Path) -> None:
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    try:
        z.open_fixture(fx)
        z.call({"cmd": "selectMap", "bank": TARGET[0], "map": TARGET[1]})
        before_png = z.call({"cmd": "canvasPng", "target": "map"})["png"]
        z.call({"cmd": "action", "id": "tools.blockEditor"})
        for _ in range(100):
            if any(w["label"] == BE and w["ready"] for w in z.call({"cmd": "windows"})):
                break
            time.sleep(0.2)
        s0 = _be(z, {"cmd": "snapshot"})["snapshot"]
        old_pointer = s0["secondary"]["pointer"]
        old_blocks = base64.b64decode(s0["secondary"]["blocks"])
        _be(z, {"cmd": "action", "id": "tiles.newTileset"})
        time.sleep(0.3)
        _be(z, {"cmd": "setField", "id": "be.nt.kind", "value": 1})
        _be(z, {"cmd": "setField", "id": "be.nt.content", "value": 1})
        _be(z, {"cmd": "dialog", "press": "create"})
        new_pointer = old_pointer
        for _ in range(100):
            new_pointer = _be(z, {"cmd": "snapshot"})["snapshot"]["secondary"]["pointer"]
            if new_pointer != old_pointer:
                break
            time.sleep(0.1)
        log(f"新しい副タイルセット: {new_pointer:#x}（元 {old_pointer:#x}）。{_be(z, {'cmd': 'state'})['status']}")
        check(new_pointer != old_pointer, "3.0 の組が新しい副タイルセットに付け替わる")
        check(z.call({"cmd": "canvasPng", "target": "map"})["png"] == before_png, "写しで作った直後の 3.0 の見た目は前と同じ")
        z.call({"cmd": "close", "window": BE})
        patch = PATCHES / f"map_project-pillow-{fx.name}.patch"
        check(_apply_patch(fx.project_path, patch, log, ("scripts/map_project.py", "_import_pil_image")), f"写しの map_project.py に {patch.name} を当てる")
        res = z.export()
        written = res.get("written", []) if isinstance(res, dict) else []
        log(f"出力: 書いた {len(written)} 件（{[w for w in written if 'tilesets' in w][:3]}）")
        check(any("tilesets" in w and "secondary_" in w for w in written), "新しい副タイルセットが maps\\tilesets に出力される")
        r = build_fixture(fx, log_dir, timeout or 3600)
        log(r.summary())
        check(r.ok, "写しのビルドが通る")
        if not r.ok:
            return
        rom_path = fx.path(f"{fx.build.cwd}/{fx.build.output}")
        built = BuiltRom(rom_path)
        lay = built.layout(*TARGET)
        count = len(old_blocks) // 16
        ts = built.tileset(lay["secondary"], count)
        old = [old_blocks[i] | (old_blocks[i + 1] << 8) for i in range(0, len(old_blocks), 2)]
        log(f"ビルドした ROM の 3.0 の副タイルセット: {lay['secondary']:#x}")
        check((lay["secondary"] | 0x08000000) != (old_pointer | 0x08000000), "ビルドした ROM の 3.0 は元と別の副タイルセットを指す")
        check(list(ts["blocks"][: count * 8]) == old, "ビルドした ROM の新しい副タイルセットのブロックが元と同じ")
        z.open(rom_path, None)
        z.call({"cmd": "selectMap", "bank": TARGET[0], "map": TARGET[1]})
        check(z.call({"cmd": "canvasPng", "target": "map"})["png"] == before_png, "できた ROM を開き直した 3.0 の見た目が作る前と同じ")
    finally:
        changed = snap.restore()
        log(f"写しのテキストファイルを元に戻した（{changed} 件）")
