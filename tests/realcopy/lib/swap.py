r"""ブロックの入れ替えの写しでの確認（--swap。Phase5 #394）。

写しの ROM とプロジェクトを開き、3.0 で使っている副のブロック a と、3.0 で使っていない副のブロック b を
ブロックエディタの 編集 > ブロックの入れ替え で入れ替え、マップの番号も付け替える（確かめの窓で「はい」）。
- 付け替えたマップ（その副タイルセットを使う全部）の見た目が入れ替えの前と同じ
- 出力して写しをビルドし、できた ROM の副タイルセットで a と b の中身が入れ替わり、3.0 の配置で a が b になっている
- ZigzaguMap でできた ROM を開き直すと、3.0 の絵が入れ替えの前と同じ（往復）
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


def _press(z: Zigzagu, id_: str, x: int, y: int, button: int = 0) -> None:
    for t in ("down", "up"):
        _be(z, {"cmd": "pointer", "id": id_, "type": t, "x": x, "y": y, "button": button})


def _select(z: Zigzagu, block: int) -> None:
    _press(z, "be.blocks", (block % 8) * 32 + 16, (block // 8) * 32 + 16)


def _blocks(snap: dict, block: int) -> list[int]:
    raw = base64.b64decode(snap["secondary"]["blocks"])
    o = (block - 640) * 16
    return [raw[o + i * 2] | (raw[o + i * 2 + 1] << 8) for i in range(8)]


def swap_one(fx: Fixture, z: Zigzagu, check, log, timeout: int | None, log_dir: pathlib.Path) -> None:
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    try:
        z.open_fixture(fx)
        z.call({"cmd": "selectMap", "bank": TARGET[0], "map": TARGET[1]})
        a = None
        for y in range(0, 20):
            for x in range(0, 20):
                z.call({"cmd": "mouse", "target": "map", "cell": [x, y], "action": "rightClick"})
                v = z.call({"cmd": "selection"})["block"]["blocks"][0]
                if v >= 640:
                    a = v
                    break
            if a is not None:
                break
        check(a is not None, f"3.0 で副のブロックを見つける（{a}）")
        if a is None:
            return
        b = next(v for v in range(640 + 0x40, 640 + 0x100) if v != a and z.call({"cmd": "blockUsage", "block": v})["here"] == 0
                 and not z.call({"cmd": "blockInfo", "block": v})["triple"] and not z.call({"cmd": "blockInfo", "block": v})["tripleChild"])
        log(f"入れ替える副のブロック: {a:#x} と {b:#x}")
        before_png = z.call({"cmd": "canvasPng", "target": "map"})["png"]
        z.call({"cmd": "action", "id": "tools.blockEditor"})
        for _ in range(100):
            if any(w["label"] == BE and w["ready"] for w in z.call({"cmd": "windows"})):
                break
            time.sleep(0.2)
        s0 = _be(z, {"cmd": "snapshot"})["snapshot"]
        ta, tb = _blocks(s0, a), _blocks(s0, b)
        _be(z, {"cmd": "key", "key": "x"})
        _select(z, a)
        _select(z, b)
        t0 = time.perf_counter()
        dialog = []
        for _ in range(300):
            dialog = _be(z, {"cmd": "dialogs"})["dialogs"]
            if dialog:
                break
            time.sleep(0.1)
        log(f"確かめの窓まで {time.perf_counter() - t0:.1f} 秒: {dialog[0].get('text', '')[:120] if dialog else 'なし'}")
        _be(z, {"cmd": "dialog", "press": "yes"})
        for _ in range(300):
            if "入れ替えました" in _be(z, {"cmd": "state"})["status"]:
                break
            time.sleep(0.1)
        status = _be(z, {"cmd": "state"})["status"]
        log(f"入れ替え: {time.perf_counter() - t0:.1f} 秒、{status}")
        s1 = _be(z, {"cmd": "snapshot"})["snapshot"]
        check(_blocks(s1, a) == tb and _blocks(s1, b) == ta, "副の 2 つのブロックが入れ替わる")
        check(z.call({"cmd": "canvasPng", "target": "map"})["png"] == before_png, "番号を付け替えた 3.0 の見た目は入れ替えの前と同じ")
        z.call({"cmd": "close", "window": BE})
        patch = PATCHES / f"map_project-pillow-{fx.name}.patch"
        check(_apply_patch(fx.project_path, patch, log, ("scripts/map_project.py", "_import_pil_image")), f"写しの map_project.py に {patch.name} を当てる")
        res = z.export()
        written = res.get("written", []) if isinstance(res, dict) else []
        log(f"出力: 書いた {len(written)} 件")
        r = build_fixture(fx, log_dir, timeout or 3600)
        log(r.summary())
        check(r.ok, "写しのビルドが通る")
        if not r.ok:
            return
        rom_path = fx.path(f"{fx.build.cwd}/{fx.build.output}")
        built = BuiltRom(rom_path)
        lay = built.layout(*TARGET)
        ts = built.tileset(lay["secondary"], max(a, b) - 640 + 1)
        got_a = ts["blocks"][(a - 640) * 8:(a - 640 + 1) * 8]
        got_b = ts["blocks"][(b - 640) * 8:(b - 640 + 1) * 8]
        check(got_a == tb and got_b == ta, "ビルドした ROM の副タイルセットで 2 つのブロックが入れ替わっている")
        ids = {c & 0x3FF for c in lay["cells"]}
        check(b in ids and a not in ids, f"ビルドした ROM の 3.0 の配置で {a:#x} が {b:#x} に付け替わっている")
        # 往復: できた ROM を開き直すと、3.0 の絵は入れ替えの前と同じ
        z.open(rom_path, None)
        z.call({"cmd": "selectMap", "bank": TARGET[0], "map": TARGET[1]})
        check(z.call({"cmd": "canvasPng", "target": "map"})["png"] == before_png, "できた ROM を開き直した 3.0 の見た目が入れ替えの前と同じ")
    finally:
        changed = snap.restore()
        log(f"写しのテキストファイルを元に戻した（{changed} 件）")
