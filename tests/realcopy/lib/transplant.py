r"""別の ROM からのタイルセットの移植の写しでの確認（--transplant。Phase4 #314）。

写しの ROM とプロジェクトを開き、素の BPRJ（--source-rom）の 3.1 のタイルセット（両方）を、配置も写して 3.0 へ取り込む。
出力して写しをビルドし、できた ROM の 3.0 が、元の ROM の 3.1 と同じ配置・ボーダー、同じ中身のタイルセット
（画像・パレット・ブロック・属性。New のヘッダーはビルドが空きへ置き直す）を指していることを確かめる。
写しのテキストファイル（maps など）は、最後に元へ戻す（足した maps\tilesets のフォルダも消える）。
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
SOURCE = (3, 1)
TP = "transplant"


def _wait_window(z: Zigzagu, label: str, timeout: float = 30) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if any(w["label"] == label and w["ready"] for w in z.call({"cmd": "windows"})):
            return True
        time.sleep(0.2)
    return False


def _select(z: Zigzagu, bank: int, map_: int) -> dict:
    return z.call({"cmd": "transplant.select", "bank": bank, "map": map_, "window": TP})


def transplant_one(fx: Fixture, z: Zigzagu, check, log, timeout: int | None, log_dir: pathlib.Path, source_rom: pathlib.Path) -> None:
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    try:
        z.open_fixture(fx)
        z.call({"cmd": "selectMap", "bank": TARGET[0], "map": TARGET[1]})
        z.call({"cmd": "action", "id": "tools.transplant"})
        check(_wait_window(z, TP), "移植の窓が開く")
        z.call({"cmd": "queuePath", "path": str(source_rom), "window": TP})
        z.call({"cmd": "click", "id": "tp.pickRom", "window": TP})
        for _ in range(100):
            if z.call({"cmd": "state", "window": TP})["mapCount"] > 0:
                break
            time.sleep(0.2)
        s = _select(z, *SOURCE)
        z.call({"cmd": "setField", "id": "tp.parts", "value": 0, "window": TP})
        z.call({"cmd": "setField", "id": "tp.copyLayout", "value": True, "window": TP})
        log("変わること: " + " / ".join(z.call({"cmd": "state", "window": TP})["report"]))
        z.call({"cmd": "click", "id": "tp.import", "window": TP})
        time.sleep(1.0)
        m = z.call({"cmd": "state"})["map"]
        check(m["primaryTileset"] >= 0x09F00000 and m["secondaryTileset"] >= 0x09F00000, f"{TARGET[0]}.{TARGET[1]} の組が新しいタイルセットになる（{m['primaryTileset']:#x}, {m['secondaryTileset']:#x}）")
        check([m["width"], m["height"]] == s["selectedSize"], f"配置も写して大きさが {s['selectedSize']} になる")
        z.call({"cmd": "close", "window": TP})
        res = z.export()
        written = [w for w in res.get("written", []) if "tilesets" in w.replace("\\", "/")]
        log(f"出力: 書いた {len(res.get('written', []))} 件（タイルセット {written}）")
        r = build_fixture(fx, log_dir, timeout or 3600)
        log(r.summary())
        check(r.ok, "写しのビルドが通る")
        if not r.ok:
            return
        built = BuiltRom(fx.path(f"{fx.build.cwd}/{fx.build.output}"))
        orig = BuiltRom(source_rom)
        a = built.layout(*TARGET)
        b = orig.layout(*SOURCE)
        check((a["width"], a["height"], a["cells"], a["border"]) == (b["width"], b["height"], b["cells"], b["border"]),
              f"ビルドした ROM の {TARGET[0]}.{TARGET[1]} の配置とボーダーが元の {SOURCE[0]}.{SOURCE[1]} と同じ")
        for side, count in (("primary", 640), ("secondary", s["conversion"]["secondary"]["blocks"])):
            ta = built.tileset(a[side], count)
            tb = orig.tileset(b[side], count)
            same = all(ta[k] == tb[k] for k in ("palettes", "blocks", "attributes", "compressed", "secondary", "callback"))
            # 画像は 16 枚の倍数に切り上げて書くので、短いほうの長さで比べる
            tiles_same = ta["tiles"] is None or tb["tiles"] is None or ta["tiles"][: len(tb["tiles"])] == tb["tiles"][: len(ta["tiles"])]
            check(same and tiles_same,
                  f"ビルドした ROM の{('主' if side == 'primary' else '副')}タイルセット（{a[side]:#x}）が元（{b[side]:#x}）と同じ中身")
    finally:
        changed = snap.restore()
        log(f"写しのテキストファイルを元に戻した（{changed} 件）")
