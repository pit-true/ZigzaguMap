r"""Phase6 の全体の往復テスト（--phase6。#493）。

写しの ROM とプロジェクトを開き、Phase6 の編集をまとめて行ってから 1 回だけ出力する。
- 時間帯別の野生（1 番道路 3.19 の朝・夕・夜の表。lib/wildtime.py と同じ操作）
- 画像からのタイルセットの取り込み（3.0 は今の副タイルセットへ追加、3.1 は新しい副タイルセット。lib/tileimport.py と同じ操作）
- タイムラインの編集による .s の書き戻し（確かめ用の .s を写しに足し、3.0 の人 0 のスクリプトにして再生し、
  移動データの 1 歩目の向きを箱の編集で変える）
出力のあと、
- 写しの ROM とプロジェクトを開き直すと、野生の夜の表・取り込んだ 2 つのマップの絵・人 0 のラベル・再生の移動データが同じ（往復）
- 写しでビルドが通り、できた ROM に時間帯の表が入り、取り込んだマップの絵が同じで、人 0 のスクリプトと書き戻した
  移動データのバイト列がラベルの位置にある
を確かめる。写しのテキストファイル（maps・assembly\overworld_scripts など）は、最後に元へ戻す。
"""
from __future__ import annotations

import pathlib

from .app import Zigzagu
from .builder import build_fixture
from .delete import PATCHES, _apply_patch
from .fixtures import Fixture
from .link import TextSnapshot, read_symbols
from .tileimport import sample_png, tileimport_check_export, tileimport_check_maps, tileimport_edit
from .wildtime import wildtime_check_build, wildtime_check_json, wildtime_check_reopened, wildtime_edit

BANK, MAP = 3, 0
SCRIPT = "assembly/overworld_scripts/zz_phase6_test.s"
SOURCE = """.text
.thumb
.align 2

.include "../xse_commands.s"
.include "../xse_defines.s"
.include "../asm_defines.s"

.global ZzP6Main
ZzP6Main:
\tapplymovement 0xFF ZzP6_Walk
\twaitmovement 0
\tend

.global ZzP6_Walk
ZzP6_Walk: .byte walk_up, walk_up, walk_left, end_m
"""
EDITED_LINE = "ZzP6_Walk: .byte walk_right, walk_up, walk_left, end_m"
# walk_right・walk_up・walk_left・end_m
EDITED_BYTES = bytes([0x13, 0x11, 0x12, 0xFE])


def _walk_segment(timeline: dict) -> int:
    return next(i for i, s in enumerate(timeline["segments"]) if s["movementLabel"] == "ZzP6_Walk" and s["stepIndex"] == 0)


def _first_move(z: Zigzagu) -> int:
    """3.0 で ZzP6Main を再生し、移動データの 1 歩目の値を返す（再生は終える）。"""
    z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "playback.start", "label": "ZzP6Main"})
    timeline = z.call({"cmd": "playback.timeline"})
    value = timeline["segments"][_walk_segment(timeline)]["movementId"]
    z.call({"cmd": "playback.stop"})
    return value


def _person_label(z: Zigzagu) -> str | None:
    labels = z.call({"cmd": "script.labels"})["person"]
    return labels[0]["label"] if labels else None


def timeline_edit(fx: Fixture, z: Zigzagu, check, log) -> None:
    """人 0 のスクリプトを ZzP6Main にし、再生のタイムラインで 1 歩目を右向きに変えて .s へ書き戻す。"""
    z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "script.setLabel", "target": "person", "index": 0, "label": "ZzP6Main"})
    check(_person_label(z) == "ZzP6Main", "3.0 の人 0 のスクリプトを ZzP6Main にする")
    z.call({"cmd": "playback.start", "kind": "person", "index": 0})
    timeline = z.call({"cmd": "playback.timeline"})
    segment = _walk_segment(timeline)
    check(timeline["segments"][segment]["movementId"] == 0x11, "再生のタイムラインに ZzP6_Walk の 1 歩目（walk_up）がある")
    done = z.call({"cmd": "playback.edit", "segment": segment, "edit": {"type": "direction", "index": 0, "direction": "right"}})
    log(f"箱の編集: {done['result']}")
    text = (fx.project_path / SCRIPT).read_text(encoding="utf-8")
    check(EDITED_LINE in text, "箱の編集が .s の移動データへ書き戻される（walk_right）")
    after = z.call({"cmd": "playback.timeline"})
    check(after["segments"][_walk_segment(after)]["movementId"] == 0x13, "書き戻した後のタイムラインの 1 歩目が walk_right")
    z.call({"cmd": "playback.stop"})


def phase6_one(fx: Fixture, z: Zigzagu, check, log, timeout: int | None, log_dir: pathlib.Path) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    png = log_dir / "sample.png"
    sample_png(png)
    try:
        (fx.project_path / SCRIPT).write_bytes(SOURCE.encode("utf-8"))
        z.open_fixture(fx)
        z.call({"cmd": "setting", "key": "showClones", "value": False})

        wildtime_edit(fx, z, check, log)
        expected = tileimport_edit(z, check, log, png)
        timeline_edit(fx, z, check, log)

        patch = PATCHES / f"map_project-pillow-{fx.name}.patch"
        check(_apply_patch(fx.project_path, patch, log, ("scripts/map_project.py", "_import_pil_image")), f"写しの map_project.py に {patch.name} を当てる")
        res = z.export()
        wildtime_check_json(fx, check)
        tileimport_check_export(fx, res, check, log)

        # 往復: 写しの ROM とプロジェクトを開き直す
        z.open_fixture(fx)
        wildtime_check_reopened(z, check)
        tileimport_check_maps(z, expected, check, "開き直した")
        z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
        z.call({"cmd": "tab", "name": "event"})
        check(_person_label(z) == "ZzP6Main", "開き直しても 3.0 の人 0 のスクリプトは ZzP6Main")
        check(_first_move(z) == 0x13, "開き直して再生すると 1 歩目が walk_right")

        # ビルド
        r = build_fixture(fx, log_dir, timeout or 3600)
        log(r.summary())
        check(r.ok, "写しのビルドが通る")
        if not r.ok:
            return
        wildtime_check_build(fx, check)
        rom_path = fx.path(f"{fx.build.cwd}/{fx.build.output}")
        symbols = read_symbols(fx.project_path / "offsets.ini")
        walk, main = symbols.get("ZzP6_Walk"), symbols.get("ZzP6Main")
        check(walk is not None and main is not None, f"offsets.ini に ZzP6Main・ZzP6_Walk がある（{main and hex(main)}・{walk and hex(walk)}）")
        if walk is not None:
            got = rom_path.read_bytes()[walk - 0x08000000 : walk - 0x08000000 + 4]
            check(got == EDITED_BYTES, f"できた ROM の ZzP6_Walk が書き戻した移動データ（{got.hex()}）")
        z.open(rom_path, None)
        tileimport_check_maps(z, expected, check, "できた ROM を開き直した")
        z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
        person = z.call({"cmd": "event.state"})["events"]["persons"][0]
        check(main is not None and person["script"] == main, f"できた ROM の 3.0 の人 0 のスクリプトが ZzP6Main（{hex(person['script'] or 0)}）")
    finally:
        changed = snap.restore()
        log(f"写しのテキストファイルを元に戻した（{changed} 件）")
