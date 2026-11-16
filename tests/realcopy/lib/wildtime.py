r"""時間帯の野生の写しでの確認（--wildtime。Phase6 #436）。

写しの ROM とプロジェクトを開き、1 番道路（3.19）の野生ポケモンタブの時間帯のタブで
- 朝: 「昼の表を写して作る」、夕: 写してから枠 1 の種族を変える、夜: 「空の表を作る…」で草むらだけの表を作り出現率を変える
- 夕の表を消して Ctrl+Z で戻す（1 回で戻る）
を行い、出力した maps\03\19.json の Wild[].Time が 0〜3 になり、中身が画面で作ったとおりであること、
写しのビルドが通り、生成された map_wild_time.inc に朝・夕・夜の表（gWildMon{Morning,Evening,Night}Headers）の 3.19 が入ること、
ZigzaguMap で開き直すと同じ表が読めることを確かめる。写しのテキストファイル（maps など）は、最後に元へ戻す。
"""
from __future__ import annotations

import json
import pathlib
import re
import time

from .app import Zigzagu
from .builder import build_fixture
from .fixtures import Fixture
from .link import TextSnapshot

ROUTE1 = (3, 19)
PIKACHU = 25


def _field(z: Zigzagu, id_: str) -> dict:
    return z.call({"cmd": "getField", "id": id_})


def _wild_json(fx: Fixture) -> list[dict]:
    path = fx.project_path / "maps" / f"{ROUTE1[0]:02d}" / f"{ROUTE1[1]:02d}.json"
    return json.loads(path.read_text(encoding="utf-8")).get("Wild", [])


def wildtime_one(fx: Fixture, z: Zigzagu, check, log, timeout: int | None, log_dir: pathlib.Path) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    try:
        z.open_fixture(fx)
        z.call({"cmd": "selectMap", "bank": ROUTE1[0], "map": ROUTE1[1]})
        z.call({"cmd": "tab", "name": "wild"})
        check(_field(z, "wild.time.1")["visible"], "時間帯のタブが出る（プロジェクトを開いているとき）")
        # 朝: 昼の表を写す
        z.call({"cmd": "click", "id": "wild.time.0"})
        info = _field(z, "wild.timeInfo")
        check(info["visible"] and "昼の表を使います" in info["value"], f"表の無い朝のタブに、実機で昼の表を使うことが出る（{info['value']}）")
        z.call({"cmd": "click", "id": "wild.timeCopy"})
        check(_field(z, "wild.rate")["visible"] and not _field(z, "wild.timeInfo")["visible"], "朝の表ができて、編集の欄が出る")
        # 夕: 写してから枠 1 の種族を変える
        z.call({"cmd": "click", "id": "wild.time.2"})
        z.call({"cmd": "click", "id": "wild.timeCopy"})
        z.call({"cmd": "setField", "id": "wild.type", "value": 0})
        z.call({"cmd": "setField", "id": "wild.species.1", "value": PIKACHU})
        z.call({"cmd": "click", "id": "wild.save"})
        # 夜: 空の表を作る（草むらだけ）
        z.call({"cmd": "click", "id": "wild.time.3"})
        z.call({"cmd": "click", "id": "wild.timeCreate"})
        time.sleep(0.3)
        for i, on in enumerate([True, False, False, False]):
            z.call({"cmd": "setField", "id": f"wildAdd.{i}", "value": on})
        z.call({"cmd": "click", "id": "wildAdd.ok"})
        time.sleep(0.3)
        z.call({"cmd": "setField", "id": "wild.rate", "value": "7"})
        z.call({"cmd": "click", "id": "wild.save"})
        # 夕の表を消して戻す
        z.call({"cmd": "click", "id": "wild.time.2"})
        z.call({"cmd": "click", "id": "wild.timeRemove"})
        check(_field(z, "wild.timeInfo")["visible"], "夕の表を消すと、表の無い案内に変わる")
        z.call({"cmd": "undo"})
        check(_field(z, "wild.rate")["visible"], "1 回の Ctrl+Z で夕の表が戻る")

        res = z.export()
        written = res.get("written", []) if isinstance(res, dict) else []
        log(f"出力: 書いた {len(written)} 件")
        wild = {w["Time"]: w for w in _wild_json(fx)}
        check(sorted(wild) == [0, 1, 2, 3], f"maps\\03\\19.json の Wild[].Time が 0〜3（{sorted(wild)}）")
        if sorted(wild) == [0, 1, 2, 3]:
            check(wild[0]["Areas"] == wild[1]["Areas"], "朝の表は昼の表の写し")
            check(wild[2]["Areas"] != wild[1]["Areas"], "夕の表は枠 1 の種族を変えたもの")
            night = wild[3]["Areas"]
            check(night[0]["Rate"] == 7 and all(not a.get("Slots") for a in night[1:]), "夜の表は草むらだけで出現率 7")

        r = build_fixture(fx, log_dir, timeout or 3600)
        log(r.summary())
        check(r.ok, "写しのビルドが通る")
        if not r.ok:
            return
        inc = fx.project_path / "build" / "map_wild_time.inc"
        text = inc.read_text(encoding="utf-8", errors="replace") if inc.exists() else ""
        for name in ("Morning", "Evening", "Night"):
            check(f"gWildMon{name}Headers" in text, f"map_wild_time.inc に gWildMon{name}Headers がある")
        for name in ("Morning", "Evening", "Night"):
            section = text.split(f"gWildMon{name}Headers[] = {{", 1)[-1].split("};", 1)[0]
            check(bool(re.search(r"\.mapGroup\s*=\s*3\s*,\s*\.mapNum\s*=\s*19\b", section)), f"{name} の表に 3.19 の行がある")

        rom_path = fx.path(f"{fx.build.cwd}/{fx.build.output}")
        z.open(rom_path, fx.project_path)
        z.call({"cmd": "selectMap", "bank": ROUTE1[0], "map": ROUTE1[1]})
        z.call({"cmd": "tab", "name": "wild"})
        z.call({"cmd": "click", "id": "wild.time.3"})
        check(_field(z, "wild.rate")["value"] == "7", "開き直すと夜の表が読める（出現率 7）")
    finally:
        changed = snap.restore()
        log(f"写しのテキストファイルを元に戻した（{changed} 件）")
