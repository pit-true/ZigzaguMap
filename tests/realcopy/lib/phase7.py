r"""Phase7 の全体の往復テスト（--phase7。#534）。

写しの ROM とプロジェクトを開き、Phase7 の編集をまとめて行ってから、MCP サーバーから 1 回だけ出力する。
- 大きいブラシ（5×5 の円）で 3.0 に描く（#515）
- 範囲を選んで動かす道具で、3.0 の 3×3 を右へ 2 マス動かす（#516）
- 道をなぞる窓で、確かめ用の .s の移動データを 3 歩の道に置き換える（#517・#518）
- 3.0 の人 0（スクリプトを確かめ用のラベルにする）をコピーして、3.1 へ貼る（#519）
- 設定 > MCP の窓口を開き、MCP サーバー（tools/mcp/dist/zigzagumap-mcp.mjs）に stdio でつないで、3.3 の 2×1 を書き換え、
  `project_export` で出力する（#521）
出力のあと、
- 写しの ROM とプロジェクトを開き直すと、3.0・3.3 の配置、3.1 に貼った人とそのラベル、.s の移動データが同じ（往復）
- 写しでビルドが通り、できた ROM の 3.0・3.3 の配置、3.1 に貼った人のスクリプトの番地、なぞった移動データのバイト列が同じ
を確かめる。写しのテキストファイル（maps・assembly\overworld_scripts など）は、最後に元へ戻す。
"""
from __future__ import annotations

import pathlib
import sys
import time

from .app import Zigzagu
from .builder import build_fixture
from .fixtures import Fixture
from .link import TextSnapshot, read_symbols

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "automation"))
from mcp_client import MJS, McpClient  # noqa: E402

BANK, MAP = 3, 0
PASTE_TO = (3, 1)
MCP_MAP = (3, 3)
SCRIPT = "assembly/overworld_scripts/zz_phase7_test.s"
SOURCE = """.text
.thumb
.align 2

.include "../xse_commands.s"
.include "../xse_defines.s"
.include "../asm_defines.s"

.global ZzP7Main
ZzP7Main:
\tapplymovement 0xFF ZzP7_Walk
\twaitmovement 0
\tend

.global ZzP7_Walk
ZzP7_Walk: .byte walk_down, end_m
"""
WALK_LINE = "ZzP7_Walk: .byte walk_up, walk_up, walk_left, end_m"
# walk_up・walk_up・walk_left・end_m
WALK_BYTES = bytes([0x11, 0x11, 0x12, 0xFE])


def _cells(z: Zigzagu, bank: int, map: int) -> dict:
    z.call({"cmd": "selectMap", "bank": bank, "map": map})
    z.call({"cmd": "tab", "name": "map"})
    return z.call({"cmd": "cells"})


def _person_label(z: Zigzagu, bank: int, map: int, index: int) -> str | None:
    labels = z.call({"cmd": "script.labels", "bank": bank, "map": map})["person"]
    return next((l["label"] for l in labels if l["index"] == index), None)


def _free_cell(events: dict | None, w: int, h: int) -> tuple[int, int]:
    events = events or {}
    used = {(e["x"], e["y"]) for kind in ("persons", "warps", "traps", "signs") for e in events.get(kind, [])}
    for y in range(2, h - 2):
        for x in range(2, w - 2):
            if (x, y) not in used:
                return x, y
    raise AssertionError("空いたマスが無い")


def _map_edits(z: Zigzagu, check, log) -> list[int]:
    """3.0 に大きいブラシで描き、範囲を選んで動かす。描いた後の配置を返す。"""
    base = _cells(z, BANK, MAP)
    w, h, cells = base["width"], base["height"], base["cells"]
    z.call({"cmd": "setting", "key": "autoMovement", "value": False})
    # 大きいブラシ（5×5 の円）
    z.call({"cmd": "tool.set", "tool": "pencil", "brushSize": 5, "brushShape": "circle"})
    z.call({"cmd": "selectBlock", "block": 0x0D})
    cx, cy = max(3, w // 4), max(3, h // 4)
    z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": [cx, cy]})
    after = z.call({"cmd": "cells"})["cells"]
    painted = [(x, y) for y in range(h) for x in range(w) if after[y * w + x] != cells[y * w + x]]
    check(0 < len(painted) <= 21 and all(abs(x - cx) <= 2 and abs(y - cy) <= 2 for x, y in painted) and all(after[y * w + x] & 0x3FF == 0x0D for x, y in painted),
          f"5×5 の円のブラシで ({cx},{cy}) のまわりに描く（{len(painted)} マス）")
    z.call({"cmd": "tool.set", "brushSize": 1, "brushShape": "square"})
    # 範囲を選んで右へ 2 マス動かす
    sx, sy = max(1, w // 2), max(1, h // 2 - 1)
    before_move = after
    z.call({"cmd": "tool.set", "tool": "select"})
    z.call({"cmd": "selectBlock", "block": 0x0D})
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [sx, sy], "to": [sx + 2, sy + 2], "steps": 2})
    check(z.call({"cmd": "select.state"})["rect"] == [sx, sy, 3, 3], f"({sx},{sy}) から 3×3 を選ぶ")
    z.call({"cmd": "mouse", "target": "map", "action": "drag", "cell": [sx + 1, sy + 1], "to": [sx + 3, sy + 1], "steps": 2})
    moved = z.call({"cmd": "cells"})["cells"]
    ok = all(moved[(sy + dy) * w + sx + 2 + dx] == before_move[(sy + dy) * w + sx + dx] for dy in range(3) for dx in range(3))
    ok &= all(moved[(sy + dy) * w + sx + dx] & 0x3FF == 0x0D for dy in range(3) for dx in range(2))
    check(ok, "選んだ 3×3 が右へ 2 マス動き、跡は選んでいるブロックで埋まる")
    z.call({"cmd": "key", "key": "Escape"})
    z.call({"cmd": "tool.set", "tool": "pencil"})
    log(f"3.0 を書き換えた（{w}×{h}）")
    return moved


def _path_edit(fx: Fixture, z: Zigzagu, check, log) -> None:
    """道をなぞる窓で ZzP7_Walk を 3 歩の道に置き換える。"""
    z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
    z.call({"cmd": "tab", "name": "event"})
    line = SOURCE.splitlines().index("\tapplymovement 0xFF ZzP7_Walk")
    s = z.call({"cmd": "pathDraw.open", "from": "line", "path": SCRIPT, "line": line})
    check(s["target"]["label"] == "ZzP7_Walk" and s["mode"] == "replace", "applymovement の行から道をなぞる窓を開く")
    for d in ("up", "up", "left"):
        z.call({"cmd": "pathDraw.step", "direction": d})
    r = z.call({"cmd": "pathDraw.apply"})
    log(f"道をなぞった: {r['result']}")
    z.call({"cmd": "pathDraw.close"})
    check(WALK_LINE in (fx.project_path / SCRIPT).read_text(encoding="utf-8"), "移動データをなぞった道に置き換える")


def _paste_edit(z: Zigzagu, check, log) -> dict:
    """3.0 の人 0 を ZzP7Main にしてコピーし、3.1 の空いたマスへ貼る。貼った人を返す。"""
    z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "script.setLabel", "target": "person", "index": 0, "label": "ZzP7Main"})
    check(_person_label(z, BANK, MAP, 0) == "ZzP7Main", "3.0 の人 0 のスクリプトを ZzP7Main にする")
    z.call({"cmd": "event.select", "kind": "person", "index": 0})
    r = z.call({"cmd": "event.copy"})
    check(r["count"] == 1, f"3.0 の人 0 をコピーする（{r['status']}）")
    z.call({"cmd": "selectMap", "bank": PASTE_TO[0], "map": PASTE_TO[1]})
    st = z.call({"cmd": "event.state"})
    m = z.call({"cmd": "state"})["map"]
    x, y = _free_cell(st["events"], m["width"], m["height"])
    count = len((st["events"] or {}).get("persons", []))  # ND の 3.1 はイベントが無い（#536 の貼り付け先にもなる）
    r = z.call({"cmd": "event.paste", "x": x, "y": y})
    persons = z.call({"cmd": "event.state"})["events"]["persons"]
    check(r["ok"] is True and len(persons) == count + 1, f"3.1 の ({x},{y}) へ貼る（{r['status']}）")
    pasted = persons[-1]
    check(_person_label(z, *PASTE_TO, count) == "ZzP7Main", "貼った人のスクリプトも ZzP7Main")
    return {"index": count, "x": pasted["x"], "y": pasted["y"]}


def _mcp_edit(z: Zigzagu, check, log) -> list[int]:
    """MCP の窓口を開いて 3.3 を書き換え、MCP から出力する。書き換えた後の 3.3 の配置を返す。"""
    if not MJS.exists():
        raise SystemExit(f"MCP サーバーがありません（pnpm --filter @zigzagumap/mcp build で作る）: {MJS}")
    for action in ("mcp.bridge", "mcp.allowWrite", "mcp.allowExport", "mcp.allowScripts"):
        z.call({"cmd": "action", "id": action})
    info = z.profile / "mcp.json"
    for _ in range(100):
        if info.exists():
            break
        time.sleep(0.1)
    check(info.exists(), "MCP の窓口を開くと mcp.json ができる")
    mcp = McpClient(MJS, "--profile", str(z.profile))
    try:
        check(mcp.initialize("realcopy-phase7")["serverInfo"]["name"] == "zigzagumap", "MCP サーバーが initialize に答える")
        err, v = mcp.call("map_open", {"bank": MCP_MAP[0], "map": MCP_MAP[1]})
        check(not err, f"MCP で {MCP_MAP[0]}.{MCP_MAP[1]} を開く（{v}）")
        err, before = mcp.call("map_getCells", {"x": 1, "y": 1, "width": 2, "height": 1})
        blocks = [b ^ 1 for b in before["blocks"]] if isinstance(before, dict) else [1, 2]
        err, v = mcp.call("map_setCells", {"x": 1, "y": 1, "width": 2, "height": 1, "blocks": blocks, "movements": [4, 4]})
        check(not err, f"MCP で 2×1 を書き換える（{blocks}）")
        cells = z.call({"cmd": "cells"})
        w = cells["width"]
        check([cells["cells"][w + 1] & 0x3FF, cells["cells"][w + 2] & 0x3FF] == blocks, "MCP の書き換えが画面のマップに出る")
        err, v = mcp.call("project_export")
        check(not err and isinstance(v, dict), f"MCP から出力する（{len(v.get('written', [])) if isinstance(v, dict) else v} ファイル）")
        if isinstance(v, dict):
            log(f"MCP の出力: {v.get('written')}")
        dirty = z.call({"cmd": "state"})["dirty"]
        check(not dirty, f"MCP の出力のあとは未出力のマップが無い（{dirty}）")
        return cells["cells"]
    finally:
        mcp.close()
        z.call({"cmd": "action", "id": "mcp.bridge"})


def _check_state(fx: Fixture, z: Zigzagu, check, where: str, expected_map: list[int], expected_mcp: list[int], pasted: dict, with_labels: bool) -> None:
    check(_cells(z, BANK, MAP)["cells"] == expected_map, f"{where}: 3.0 の配置（ブラシと範囲の移動）が同じ")
    check(_cells(z, *MCP_MAP)["cells"] == expected_mcp, f"{where}: {MCP_MAP[0]}.{MCP_MAP[1]} の配置（MCP の書き換え）が同じ")
    z.call({"cmd": "selectMap", "bank": PASTE_TO[0], "map": PASTE_TO[1]})
    z.call({"cmd": "tab", "name": "event"})
    persons = z.call({"cmd": "event.state"})["events"]["persons"]
    p = persons[pasted["index"]] if len(persons) > pasted["index"] else None
    check(p is not None and (p["x"], p["y"]) == (pasted["x"], pasted["y"]), f"{where}: 3.1 に貼った人が同じ位置にいる")
    if with_labels:
        check(_person_label(z, *PASTE_TO, pasted["index"]) == "ZzP7Main", f"{where}: 3.1 に貼った人のスクリプトが ZzP7Main")
    z.call({"cmd": "tab", "name": "map"})


def phase7_one(fx: Fixture, z: Zigzagu, check, log, timeout: int | None, log_dir: pathlib.Path) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    try:
        (fx.project_path / SCRIPT).write_bytes(SOURCE.encode("utf-8"))
        z.open_fixture(fx)
        z.call({"cmd": "setting", "key": "showClones", "value": False})

        expected_map = _map_edits(z, check, log)
        _path_edit(fx, z, check, log)
        pasted = _paste_edit(z, check, log)
        expected_mcp = _mcp_edit(z, check, log)

        # 往復: 写しの ROM とプロジェクトを開き直す
        z.open_fixture(fx)
        _check_state(fx, z, check, "開き直した", expected_map, expected_mcp, pasted, True)
        check(WALK_LINE in (fx.project_path / SCRIPT).read_text(encoding="utf-8"), "開き直しても .s の移動データはなぞった道")

        # ビルド
        r = build_fixture(fx, log_dir, timeout or 3600)
        log(r.summary())
        check(r.ok, "写しのビルドが通る")
        if not r.ok:
            return
        rom_path = fx.path(f"{fx.build.cwd}/{fx.build.output}")
        symbols = read_symbols(fx.project_path / "offsets.ini")
        walk, main = symbols.get("ZzP7_Walk"), symbols.get("ZzP7Main")
        check(walk is not None and main is not None, f"offsets.ini に ZzP7Main・ZzP7_Walk がある（{main and hex(main)}・{walk and hex(walk)}）")
        if walk is not None:
            got = rom_path.read_bytes()[walk - 0x08000000 : walk - 0x08000000 + 4]
            check(got == WALK_BYTES, f"できた ROM の ZzP7_Walk がなぞった道（{got.hex()}）")
        z.open(rom_path, None)
        _check_state(fx, z, check, "できた ROM", expected_map, expected_mcp, pasted, False)
        z.call({"cmd": "selectMap", "bank": PASTE_TO[0], "map": PASTE_TO[1]})
        person = z.call({"cmd": "event.state"})["events"]["persons"][pasted["index"]]
        check(main is not None and person["script"] == main, f"できた ROM の 3.1 に貼った人のスクリプトが ZzP7Main（{hex(person['script'] or 0)}）")
    finally:
        changed = snap.restore()
        log(f"写しのテキストファイルを元に戻した（{changed} 件）")
