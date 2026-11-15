r"""マップ一覧の右クリックの「このマップを複製」の写しでの確認（--maplist。Phase5 #401）。

写しの ROM とプロジェクトを開き、一覧の 3.0 を右クリックして「このマップを複製」を押す。同じバンクの最後の番号に
写したマップができて開き、一覧の印が「未出力」になる。出力して写しをビルドし、できた ROM を開き直すと、
写したマップがあり、配置（ブロック）と大きさが 3.0 と同じになる。写しのテキストファイル（maps など）は、最後に元へ戻す。
"""
from __future__ import annotations

import pathlib

from .app import Zigzagu
from .builder import build_fixture
from .fixtures import Fixture
from .link import TextSnapshot

SOURCE = (3, 0)


def _item(z: Zigzagu, bank: int, map_: int) -> dict | None:
    return next((i for i in z.call({"cmd": "tree.list"}) if i["mapId"] == {"bank": bank, "map": map_}), None)


def maplist_one(fx: Fixture, z: Zigzagu, check, log, timeout: int | None, log_dir: pathlib.Path) -> None:
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    try:
        z.open_fixture(fx)
        source = z.call({"cmd": "cells", "bank": SOURCE[0], "map": SOURCE[1]})
        z.call({"cmd": "tree.rightClick", "bank": SOURCE[0], "map": SOURCE[1]})
        ids = [i["id"] for i in (z.call({"cmd": "contextMenu.state"}) or {}).get("items", [])]
        check(ids == ["tree.open", "tree.copyName", "tree.copyId", "tree.duplicate"], f"一覧の右クリックのメニュー（{ids}）")
        z.call({"cmd": "contextMenu.press", "id": "tree.duplicate"})
        m = z.call({"cmd": "state"})["map"]
        target = (m["bank"], m["map"])
        check(target[0] == SOURCE[0] and target != SOURCE, f"同じバンクの最後に写して開く（{target}）")
        item = _item(z, *target)
        check(bool(item) and item["mark"] == "dirty", f"写したマップの印は未出力（{item and item['mark']}）")
        res = z.export()
        log(f"出力: 書いた {len(res.get('written', []))} 件")
        r = build_fixture(fx, log_dir, timeout or 3600)
        log(r.summary())
        check(r.ok, "写しのビルドが通る")
        if not r.ok:
            return
        z.open(fx.path(f"{fx.build.cwd}/{fx.build.output}"), None)
        built = z.call({"cmd": "cells", "bank": target[0], "map": target[1]})
        check(
            built["width"] == source["width"] and built["height"] == source["height"] and built["cells"] == source["cells"],
            f"ビルドした ROM に {target[0]}.{target[1]} があり、配置と大きさが {SOURCE[0]}.{SOURCE[1]} と同じ",
        )
    finally:
        changed = snap.restore()
        log(f"写しのテキストファイルを元に戻した（{changed} 件）")
