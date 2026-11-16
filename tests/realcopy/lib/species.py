"""DPE の追加種族の表示・JSON 出力・再読込（#439）。写しだけを変更して戻す。"""
from __future__ import annotations

import base64
import json
import time

from .link import TextSnapshot


def species_one(fx, z, check, log, timeout, log_dir):
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    count = 970 if fx.name == "nd" else 1573
    last = count - 1
    def field(id_):
        return z.call({"cmd": "getField", "id": id_})
    try:
        z.open_fixture(fx)
        z.call({"cmd": "selectMap", "bank": 3, "map": 19})
        z.call({"cmd": "tab", "name": "wild"})
        for _ in range(100):
            f = field("wild.species.1")
            if f.get("options") == count:
                break
            time.sleep(.1)
        check(f.get("options") == count, f"DPE の種族が {count} 件並ぶ（{f.get('options')}）")
        if f.get("options") != count:
            return
        z.call({"cmd": "setField", "id": "wild.species.1", "value": last})
        label = field("wild.species.1")["value"]
        check(bool(label) and not label.startswith("No."), f"最後の種族 {last} の名前が出る（{label}）")
        z.call({"cmd": "click", "id": "wild.save"})
        z.export()
        data = json.loads((fx.project_path / "maps/03/19.json").read_text(encoding="utf-8"))
        day = next(w for w in data["Wild"] if w["Time"] == 1)
        raw = base64.b64decode(day["Areas"][0]["Slots"])
        check((raw[2] | raw[3] << 8) == last, "追加種族の番号が JSON に書かれる")
        z.open_fixture(fx)
        z.call({"cmd": "selectMap", "bank": 3, "map": 19})
        z.call({"cmd": "tab", "name": "wild"})
        for _ in range(100):
            f = field("wild.species.1")
            if f.get("options") == count:
                break
            time.sleep(.1)
        check(f.get("index") == last and f.get("value") == label, "開き直しても追加種族の番号と名前が同じ")
        z.call({"cmd": "trainer.edit", "id": 1})
        for _ in range(100):
            try:
                z.call({"cmd": "setField", "id": "trainerEdit.party", "value": f"{last} 5"})
                break
            except Exception:
                time.sleep(.1)
        check(label in field("trainerEdit.partyNames")["value"], "トレーナーの手持ちにも同じ種族名が出る")
        z.call({"cmd": "dialog", "press": "cancel"})
    finally:
        log(f"写しのテキストを復元（{snap.restore()} 件）")
