r"""Phase5 の全体の往復テスト（--phase5。#406）。

写しの ROM とプロジェクトを開き、3.0 で Phase5 の操作をまとめて行ってから出力する。
- 塗りつぶし（道具の帯の「塗り」で 1 回）、マップシフト（道具の「シフト」で右下へ 1 マス）
- 対話式リサイズの窓（右に 2・下に 1 広げ、端の写しで埋める）
- ブロックの入れ替え（ブロックエディタの 編集 > ブロックの入れ替え。3.0 で使っている副のブロックと使っていない副のブロック。マップの番号も付け替える）
- イベントの複数の操作（人と看板かワープを選んで複製し、写しをまとめて動かし、写しの 1 つを消す）
- 新しいタイルセット（ブロックエディタの 画像 > 新しいタイルセット…。副・今のタイルセットの写し）
出力のあと、
- 写しの ROM とプロジェクトを開き直すと、3.0 の配置・境界ブロック・大きさ・イベント・絵が出力の前と同じ（往復）
- 写しでビルドが通り、できた ROM の 3.0 の大きさと配置が同じで、ZigzaguMap でできた ROM を開くと絵も同じ
を確かめる。写しのテキストファイル（maps など）は、最後に元へ戻す。
"""
from __future__ import annotations

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


def _open_block_editor(z: Zigzagu) -> None:
    z.call({"cmd": "action", "id": "tools.blockEditor"})
    for _ in range(100):
        if any(w["label"] == BE and w["ready"] for w in z.call({"cmd": "windows"})):
            return
        time.sleep(0.2)
    raise RuntimeError("ブロックエディタが開きません")


def _select_be_block(z: Zigzagu, block: int) -> None:
    for t in ("down", "up"):
        _be(z, {"cmd": "pointer", "id": "be.blocks", "type": t, "x": (block % 8) * 32 + 16, "y": (block // 8) * 32 + 16, "button": 0})


def _wait_status(z: Zigzagu, text: str, window: str | None = None) -> str:
    st = ""
    for _ in range(300):
        st = (_be(z, {"cmd": "state"}) if window else z.call({"cmd": "state"}))["status"]
        if text in st:
            break
        time.sleep(0.1)
    return st


def _snapshot(z: Zigzagu) -> dict:
    """3.0 の比べる中身（配置・境界ブロック・大きさ・イベント・絵）。"""
    z.call({"cmd": "selectMap", "bank": TARGET[0], "map": TARGET[1]})
    z.call({"cmd": "tab", "name": "map"})
    cells = z.call({"cmd": "cells"})
    events = z.call({"cmd": "event.state"})["events"]
    png = z.call({"cmd": "canvasPng", "target": "map"})["png"]
    return {"cells": cells, "events": events, "png": png}


def _describe_diff(a: dict, b: dict) -> str:
    out = []
    for k in ("width", "height"):
        if a["cells"][k] != b["cells"][k]:
            out.append(f"{k} {a['cells'][k]}→{b['cells'][k]}")
    if a["cells"]["cells"] != b["cells"]["cells"]:
        n = sum(1 for x, y in zip(a["cells"]["cells"], b["cells"]["cells"]) if x != y)
        out.append(f"配置の違い {n} マス")
    if a["cells"]["border"] != b["cells"]["border"]:
        out.append("境界ブロック")
    for kind in ("persons", "signs", "warps", "traps"):
        ea, eb = (a["events"] or {}).get(kind), (b["events"] or {}).get(kind)
        if ea != eb:
            out.append(f"イベント {kind}（{len(ea or [])}→{len(eb or [])}）")
    if a["png"] != b["png"]:
        out.append("絵")
    return "、".join(out) or "同じ"


def phase5_one(fx: Fixture, z: Zigzagu, check, log, timeout: int | None, log_dir: pathlib.Path) -> None:
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    try:
        z.open_fixture(fx)
        z.call({"cmd": "setting", "key": "showClones", "value": False})
        z.call({"cmd": "selectMap", "bank": TARGET[0], "map": TARGET[1]})
        z.call({"cmd": "tab", "name": "map"})
        m0 = z.call({"cmd": "state"})["map"]
        h0 = z.call({"cmd": "editHistory.state"})["position"]
        log(f"3.0: {m0['width']}×{m0['height']}")

        # 塗りつぶし（拾ったブロックとは別のブロックで、押したマスとつながった所を塗る）
        z.call({"cmd": "mouse", "target": "map", "cell": [2, 2], "action": "rightClick"})
        here = z.call({"cmd": "selection"})["block"]["blocks"][0]
        other = 0x001 if here != 0x001 else 0x002
        z.call({"cmd": "selectBlock", "block": other})
        z.call({"cmd": "tool.set", "tool": "fill"})
        st = z.call({"cmd": "mouse", "target": "map", "cell": [2, 2]})
        log(f"塗りつぶし: {st.get('status', '')}")
        check(z.call({"cmd": "editHistory.state"})["position"] == h0 + 1, "塗りつぶしが 1 回の操作になる")
        # マップシフト（右下へ 1 マス）
        z.call({"cmd": "tool.set", "tool": "shift"})
        z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [5, 5], "to": [6, 6], "steps": 2})
        z.call({"cmd": "tool.set", "tool": "pencil"})
        check(z.call({"cmd": "editHistory.state"})["position"] == h0 + 2, "マップシフトが 1 回の操作になる")

        # 対話式リサイズの窓（右に 2・下に 1）
        z.call({"cmd": "tool.resizeDialog"})
        z.call({"cmd": "setField", "id": "resize.width", "value": str(m0["width"] + 2)})
        z.call({"cmd": "setField", "id": "resize.height", "value": str(m0["height"] + 1)})
        z.call({"cmd": "dialog", "press": "ok"})
        m1 = z.call({"cmd": "state"})["map"]
        check((m1["width"], m1["height"]) == (m0["width"] + 2, m0["height"] + 1), f"リサイズの窓で大きさが変わる（{m1['width']}×{m1['height']}）")

        # イベントの複数の操作
        z.call({"cmd": "tab", "name": "event"})
        es = z.call({"cmd": "event.state"})
        counts0 = es["counts"]
        second = "sign" if counts0.get("signs", 0) > 0 else "warp"
        plural = {"person": "persons", "sign": "signs", "warp": "warps"}
        items = [{"kind": "person", "index": 0}, {"kind": second, "index": 0}]
        z.call({"cmd": "event.selectMany", "items": items})
        z.call({"cmd": "event.duplicate"})
        es = z.call({"cmd": "event.state"})
        check(es["counts"]["persons"] == counts0["persons"] + 1 and es["counts"][plural[second]] == counts0[plural[second]] + 1, f"人と{second}を複製する（{es['counts']}）")
        copies = es["selected"]
        log(f"複製した写し: {copies}")
        # 写しをまとめて右へ 1 マス動かす（写しの人のマスをドラッグ）
        person = es["events"]["persons"][counts0["persons"]]
        z.call({"cmd": "mouse", "target": "event", "action": "drag", "cell": [person["x"], person["y"]], "to": [person["x"] + 1, person["y"]], "steps": 2})
        es = z.call({"cmd": "event.state"})
        moved = es["events"]["persons"][counts0["persons"]]
        check((moved["x"], moved["y"]) == (person["x"] + 1, person["y"]), f"写しをまとめて動かす（{person['x']},{person['y']} → {moved['x']},{moved['y']}）")
        # 写しの看板（かワープ）を消す
        z.call({"cmd": "event.selectMany", "items": [{"kind": second, "index": counts0[plural[second]]}]})
        z.call({"cmd": "event.deleteSelected", "confirm": False})
        es = z.call({"cmd": "event.state"})
        check(es["counts"][plural[second]] == counts0[plural[second]] and es["counts"]["persons"] == counts0["persons"] + 1, f"写しの{second}を消す（{es['counts']}）")
        z.call({"cmd": "tab", "name": "map"})

        # ブロックの入れ替え（3.0 で使っている副のブロック a と、使っていない副のブロック b）
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
        before_swap = z.call({"cmd": "canvasPng", "target": "map"})["png"]
        _open_block_editor(z)
        _be(z, {"cmd": "key", "key": "x"})
        _select_be_block(z, a)
        _select_be_block(z, b)
        for _ in range(300):
            if _be(z, {"cmd": "dialogs"})["dialogs"]:
                break
            time.sleep(0.1)
        _be(z, {"cmd": "dialog", "press": "yes"})
        log(f"入れ替え: {_wait_status(z, '入れ替えました', BE)}")
        check(z.call({"cmd": "canvasPng", "target": "map"})["png"] == before_swap, "入れ替えて番号を付け替えた 3.0 の見た目は前と同じ")

        # 新しいタイルセット（副・今のタイルセットの写し）
        old_pointer = _be(z, {"cmd": "snapshot"})["snapshot"]["secondary"]["pointer"]
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
        check(new_pointer != old_pointer, f"3.0 の組が新しい副タイルセットに付け替わる（{old_pointer:#x} → {new_pointer:#x}）")
        z.call({"cmd": "close", "window": BE})
        check(z.call({"cmd": "canvasPng", "target": "map"})["png"] == before_swap, "新しいタイルセットを作った直後の 3.0 の見た目は前と同じ")

        before = _snapshot(z)
        patch = PATCHES / f"map_project-pillow-{fx.name}.patch"
        check(_apply_patch(fx.project_path, patch, log, ("scripts/map_project.py", "_import_pil_image")), f"写しの map_project.py に {patch.name} を当てる")
        res = z.export()
        written = res.get("written", []) if isinstance(res, dict) else []
        log(f"出力: 書いた {len(written)} 件（タイルセット {sum(1 for w in written if 'tilesets' in w)} 件）")
        check(any("tilesets" in w and "secondary_" in w for w in written), "新しい副タイルセットが maps\\tilesets に出力される")

        # 往復: 写しの ROM とプロジェクトを開き直す
        z.open_fixture(fx)
        again = _snapshot(z)
        diff = _describe_diff(before, again)
        check(diff == "同じ", f"開き直すと 3.0 が出力の前と同じ（{diff}）")

        # ビルド
        r = build_fixture(fx, log_dir, timeout or 3600)
        log(r.summary())
        check(r.ok, "写しのビルドが通る")
        if not r.ok:
            return
        rom_path = fx.path(f"{fx.build.cwd}/{fx.build.output}")
        lay = BuiltRom(rom_path).layout(*TARGET)
        check((lay["width"], lay["height"]) == (before["cells"]["width"], before["cells"]["height"]), f"ビルドした ROM の 3.0 の大きさ（{lay['width']}×{lay['height']}）")
        check(list(lay["cells"]) == list(before["cells"]["cells"]), "ビルドした ROM の 3.0 の配置が出力の前と同じ")
        z.open(rom_path, None)
        z.call({"cmd": "selectMap", "bank": TARGET[0], "map": TARGET[1]})
        check(z.call({"cmd": "canvasPng", "target": "map"})["png"] == before["png"], "できた ROM を開き直した 3.0 の見た目が出力の前と同じ")
    finally:
        changed = snap.restore()
        log(f"写しのテキストファイルを元に戻した（{changed} 件）")
