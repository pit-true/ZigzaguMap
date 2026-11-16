"""夜だけの種族の検索、時間帯での絞り込み、結果からの移動（#437）。出力はしない。"""
from __future__ import annotations

import argparse
import pathlib
import tempfile
import time

from zz import Zigzagu


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--rom", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--exe", required=True)
    args = p.parse_args()
    with tempfile.TemporaryDirectory(prefix="zzm-wildtime-", ignore_cleanup_errors=True) as profile:
        with Zigzagu(pathlib.Path(args.exe), profile=profile, extra=["--mute-audio"]) as z:
            z.call({"cmd": "open", "rom": args.rom, "project": args.project})
            z.call({"cmd": "selectMap", "bank": 3, "map": 19})
            z.call({"cmd": "command", "name": "setWildTable", "args": {"bank": 3, "map": 19, "time": 3, "from": 1, "remove": False}})
            z.call({"cmd": "command", "name": "setWildSlot", "args": {"bank": 3, "map": 19, "time": 3, "area": 0, "slot": 0, "species": 25, "minLevel": 5, "maxLevel": 7}})
            z.call({"cmd": "action", "id": "tools.wildSearch"})
            z.call({"cmd": "setField", "id": "wild.search.species", "value": 25})
            z.call({"cmd": "setField", "id": "wild.search.time", "value": 4})
            def results() -> str:
                for _ in range(100):
                    info = z.call({"cmd": "getField", "id": "wild.search.info"})["value"]
                    if "検索しています" not in info and "枠" in info:
                        return z.call({"cmd": "getField", "id": "wild.search.table"})["value"]
                    time.sleep(.1)
                raise AssertionError("検索が終わりません")
            text = results()
            assert "3.19" in text and "夜" in text and "5" in text and "7" in text, text
            print("OK 夜の表だけに置いた種族が検索結果に出る")
            z.call({"cmd": "mouse", "id": "wild.search.row.0", "action": "dblclick", "px": [4, 4]})
            state = z.call({"cmd": "state"})
            assert state["map"]["bank"] == 3 and state["map"]["map"] == 19 and state["tab"] == "wild", state
            assert z.call({"cmd": "getField", "id": "wild.min.1"})["value"] == "5"
            print("OK 結果からマップと夜のタブへ移る")
            z.call({"cmd": "setField", "id": "wild.search.time", "value": 2})
            for _ in range(100):
                info = z.call({"cmd": "getField", "id": "wild.search.info"})["value"]
                if "検索しています" not in info:
                    break
                time.sleep(.1)
            text = z.call({"cmd": "getField", "id": "wild.search.table"})["value"]
            assert "3.19" not in text, text
            print("OK 昼に絞ると夜だけの結果が消える")


if __name__ == "__main__":
    main()
