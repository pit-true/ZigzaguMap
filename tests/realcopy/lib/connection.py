r"""接続の編集の写しでの確認（--connection。Phase3 #229〜#231）。

写しの ROM とプロジェクトを開き、次を順に確かめる（ND と Chronos のどちらでも）。
1. マップ 3.0 の上の接続の角のつまみを 3 マス動かす（#229）。両方のマップのずれが +3 と -3 になる。
2. 右の辺のメニューから新しいマップを作ってつなぐ（#230）。
3. 左の辺のつまみで左へ 2 広げる（#231）。上下の接続のずれ（相手も）とイベントがずれ、直していない `.s` の座標の一覧を記録する。
4. 出力して写しをビルドし、できた ROM を ZigzaguMap で開き直すと、両方の接続のずれが ROM に入っている（境界がずれていない）。
   新しいマップが ROM にあり、両側の接続（右と左）も入っている。
写しのテキストファイル（eventscripts、maps、assembly\overworld_scripts、strings、zigzagumap.json）は、最後に元へ戻す。
"""
from __future__ import annotations

import pathlib
import time

from .app import Zigzagu
from .builder import build_fixture
from .fixtures import Fixture
from .link import TextSnapshot

BANK, MAP = 3, 0
SHIFT = 3


def _neighbors(z: Zigzagu, bank: int, map_: int) -> list[dict]:
    z.call({"cmd": "selectMap", "bank": bank, "map": map_})
    return z.call({"cmd": "neighbors.state", "wait": True})["neighbors"]


def _offset(z: Zigzagu, bank: int, map_: int, to: tuple[int, int]) -> int | None:
    return next((n["offset"] for n in _neighbors(z, bank, map_) if (n["bank"], n["map"]) == to), None)


def _wait_dialog(z: Zigzagu, title: str, timeout: float = 10) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if any(d.get("title") == title for d in z.call({"cmd": "dialogs"})["dialogs"]):
            return
        time.sleep(0.1)
    raise RuntimeError(f"ダイアログが出ません: {title}")


def connection_one(fx: Fixture, z: Zigzagu, check, log, timeout: int | None, log_dir: pathlib.Path) -> None:
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    try:
        z.open_fixture(fx)
        z.call({"cmd": "tab", "name": "map"})
        first = _neighbors(z, BANK, MAP)
        right_before = [n for n in first if n["side"] == "right"]
        up = next((n for n in first if n["side"] == "up"), None)
        check(up is not None, f"{BANK}.{MAP} に上の接続がある")
        if up is None:
            return
        other = (up["bank"], up["map"])
        before = up["offset"]
        back = _offset(z, *other, (BANK, MAP))
        log(f"{BANK}.{MAP} → {other[0]}.{other[1]} のずれ {before}、逆の接続 {back}")
        z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
        z.call({"cmd": "neighbors.state", "wait": True})
        z.call({"cmd": "mouse", "target": "connectionHandle", "handle": f"corner:{up['index']}:start", "action": "drag", "cell": [0, 0], "to": [SHIFT, 0]})
        now = _offset(z, BANK, MAP, other)
        now_back = _offset(z, *other, (BANK, MAP))
        check(now == before + SHIFT and now_back == -(before + SHIFT), f"角のつまみで両方のずれが {before + SHIFT} と {-(before + SHIFT)} になる（{now}、{now_back}）")
        # 新しいマップを作ってつなぐ（右の辺。#230）
        z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
        z.call({"cmd": "neighbors.state", "wait": True})
        z.call({"cmd": "connection.menu", "side": "right"})
        z.call({"cmd": "contextMenu.press", "id": "newMap"})
        _wait_dialog(z, "新しいマップのバンク")
        z.call({"cmd": "dialog", "press": "ok"})
        new = next((n for n in _neighbors(z, BANK, MAP) if n["side"] == "right" and n["map"] not in [c["map"] for c in right_before]), None)
        check(new is not None, f"右の辺から新しいマップを作ってつなぐ {new and (new['bank'], new['map'], new['offset'])}")
        # 左へ 2 広げる（#231）
        z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
        z.call({"cmd": "neighbors.state", "wait": True})
        width = z.call({"cmd": "state"})["map"]["width"]
        z.call({"cmd": "mouse", "target": "connectionHandle", "handle": "edge:left", "action": "drag", "cell": [0, 0], "to": [-2, 0]})
        time.sleep(0.5)
        for d in z.call({"cmd": "dialogs"})["dialogs"]:
            log(f"知らせ: {d.get('title')}: {str(d.get('text'))[:200]}")
            z.call({"cmd": "dialog", "press": "ok"})
        refs = z.call({"cmd": "resize.refs"})
        log(f"直していない .s の座標: {len(refs)} 行 {[(r['path'], r['line']) for r in refs[:5]]}")
        resized = z.call({"cmd": "state"})["map"]["width"]
        check(resized == width + 2, f"左の辺のつまみで左へ 2 広がる（{width} → {resized}）")
        after_up = _offset(z, BANK, MAP, other)
        after_back = _offset(z, *other, (BANK, MAP))
        check(after_up == before + SHIFT + 2 and after_back == -(before + SHIFT + 2), f"上の接続のずれが +2、相手が -2（{after_up}、{after_back}）")
        res = z.export()
        log(f"出力: 書いた {len(res.get('written', []))} 件")
        r = build_fixture(fx, log_dir, timeout or 3600)
        log(r.summary())
        check(r.ok, "写しのビルドが通る")
        if not r.ok:
            return
        z.open(fx.path(f"{fx.build.cwd}/{fx.build.output}"), None)
        built = _offset(z, BANK, MAP, other)
        built_back = _offset(z, *other, (BANK, MAP))
        check(built == after_up and built_back == after_back, f"ビルドした ROM の両方の接続のずれが {after_up} と {after_back}（{built}、{built_back}）")
        z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
        check(z.call({"cmd": "state"})["map"]["width"] == width + 2, "ビルドした ROM のマップの幅が 2 増えている")
        if new is not None:
            right = _offset(z, BANK, MAP, (new["bank"], new["map"]))
            left = _offset(z, new["bank"], new["map"], (BANK, MAP))
            check(right == new["offset"] and left == -new["offset"], f"ビルドした ROM に新しいマップ {new['bank']}.{new['map']} と両側の接続がある（{right}、{left}）")
    finally:
        changed = snap.restore()
        log(f"写しのテキストファイルを元に戻した（{changed} 件）")
