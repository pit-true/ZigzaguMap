r"""道をなぞって .s に書く（--pathdraw。#518）。

写しに確かめ用の .s を足し、3.0 の人 0 のスクリプトにする。
- エディタの applymovement の行から道をなぞる窓を開き、移動データを 3 歩の道に置き換える
- 人 0 の右クリックから道をなぞる窓を開き、新しいラベルの移動データを足す
出力して写しでビルドし、できた ROM の移動データのバイト列が、なぞった道と同じことを確かめる。
写しのテキストファイル（maps・assembly\overworld_scripts など）は、最後に元へ戻す。
"""
from __future__ import annotations

import pathlib

from .app import Zigzagu
from .builder import build_fixture
from .fixtures import Fixture
from .link import TextSnapshot, read_symbols

BANK, MAP = 3, 0
SCRIPT = "assembly/overworld_scripts/zz_pathdraw_test.s"
SOURCE = """.text
.thumb
.align 2

.include "../xse_commands.s"
.include "../xse_defines.s"
.include "../asm_defines.s"

.global ZzPathMain
ZzPathMain:
\tapplymovement 0xFF ZzPath_Walk
\twaitmovement 0
\tend

.global ZzPath_Walk
ZzPath_Walk: .byte walk_down, end_m
"""
# なぞった道: 上・上・左（walk_up, walk_up, walk_left, end_m）
WALK_BYTES = bytes([0x11, 0x11, 0x12, 0xFE])


def pathdraw_one(fx: Fixture, z: Zigzagu, check, log, timeout: int | None, log_dir: pathlib.Path) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    try:
        (fx.project_path / SCRIPT).write_bytes(SOURCE.encode("utf-8"))
        z.open_fixture(fx)
        z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
        z.call({"cmd": "tab", "name": "event"})
        z.call({"cmd": "script.setLabel", "target": "person", "index": 0, "label": "ZzPathMain"})

        # 1. applymovement の行から: 置き換える
        line = SOURCE.splitlines().index("\tapplymovement 0xFF ZzPath_Walk")
        s = z.call({"cmd": "pathDraw.open", "from": "line", "path": SCRIPT, "line": line})
        check(s["target"]["label"] == "ZzPath_Walk" and s["mode"] == "replace", "applymovement の行から開くと、その移動データが置き換える先になる")
        for d in ("up", "up", "left"):
            z.call({"cmd": "pathDraw.step", "direction": d})
        r = z.call({"cmd": "pathDraw.apply"})
        log(f"置き換え: {r['result']}")
        text = (fx.project_path / SCRIPT).read_text(encoding="utf-8")
        check("ZzPath_Walk: .byte walk_up, walk_up, walk_left, end_m" in text, "移動データをなぞった道に置き換える")

        # 2. 人 0 から: 新しいラベルで足す
        s = z.call({"cmd": "pathDraw.open", "from": "person", "index": 0})
        for d in ("down", "down", "right"):
            z.call({"cmd": "pathDraw.step", "direction": d})
        r = z.call({"cmd": "pathDraw.apply"})["result"]
        log(f"新しいラベル: {r}")
        added = fx.project_path / r["changed"][0]
        check(f"{r['label']}: .byte walk_down, walk_down, walk_right, end_m" in added.read_text(encoding="utf-8"), f"新しいラベル {r['label']} を {r['changed'][0]} に足す")
        z.call({"cmd": "pathDraw.close"})
        z.export()

        r = build_fixture(fx, log_dir, timeout or 3600)
        log(r.summary())
        check(r.ok, "なぞった道を書いた写しのビルドが通る")
        if not r.ok:
            return
        rom_path = fx.path(f"{fx.build.cwd}/{fx.build.output}")
        symbols = read_symbols(fx.project_path / "offsets.ini")
        walk = symbols.get("ZzPath_Walk")
        check(walk is not None, f"offsets.ini に ZzPath_Walk がある（{walk and hex(walk)}）")
        if walk is not None:
            got = rom_path.read_bytes()[walk - 0x08000000 : walk - 0x08000000 + 4]
            check(got == WALK_BYTES, f"できた ROM の ZzPath_Walk がなぞった道（{got.hex()}）")
    finally:
        changed = snap.restore()
        log(f"写しのテキストファイルを元に戻した（{changed} 件）")
