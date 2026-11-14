"""Phase3 の接続と描画（列 A・B）を、素の ROM だけで確かめる。

  python tests/automation/connection_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--only 222,223]

- 222: 2 枚のマップへの paintBlocks を group で実行すると、両方に未出力の印が付き、出力で両方の JSON が書かれる。
  1 回の取り消しで両方が戻って印が消え、もう一度出力するとファイルが消える（ベース ROM と同じに戻ったため）。
- ほかの番号は、その issue を足すときに関数を足す（`CHECKS` の表）。
"""
from __future__ import annotations

import argparse
import base64
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []

PALLET = {"bank": 3, "map": 0}
ROUTE1 = {"bank": 3, "map": 19}


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if not shots:
        return
    png = z.call({"cmd": "screenshot"})
    (shots / name).write_bytes(base64.b64decode(png if isinstance(png, str) else png["png"]))


def map_json(bank: int, map_: int) -> str:
    return f"maps/{bank:02d}/{map_:02d}.json"


def written(result: dict, bank: int, map_: int, key: str = "written") -> bool:
    want = map_json(bank, map_).replace("/", "\\")
    return any(p.replace("/", "\\").lower().endswith(want.lower()) for p in result[key])


def check_222(z: Zigzagu, work: pathlib.Path, shots: pathlib.Path | None) -> None:
    out = work / "out222"
    out.mkdir(parents=True, exist_ok=True)
    z.call({"cmd": "selectMap", **PALLET})
    group = {
        "name": "group",
        "args": {
            "commands": [
                {"name": "paintBlocks", "args": {**PALLET, "cells": [{"x": 1, "y": 1, "block": 5}]}},
                {"name": "paintBlocks", "args": {**ROUTE1, "cells": [{"x": 2, "y": 2, "block": 6}]}},
            ]
        },
    }
    z.call({"cmd": "command", **group})
    st = z.call({"cmd": "state"})
    check("3.0" in st["dirty"] and "3.19" in st["dirty"], "2 枚のマップへの group で両方に未出力の印が付く")
    cells = z.call({"cmd": "cells"})
    check(cells["cells"][1 * cells["width"] + 1] & 0x3FF == 5, "表示中のマップが描き直される（配置が変わる）")
    z.call({"cmd": "undo"})
    st = z.call({"cmd": "state"})
    check("3.0" not in st["dirty"] and "3.19" not in st["dirty"], "1 回の取り消しで両方が戻り、印が消える（ベース ROM と同じに戻るため）")
    cells = z.call({"cmd": "cells"})
    check(cells["cells"][1 * cells["width"] + 1] & 0x3FF != 5, "取り消しで表示中のマップも描き直される")
    z.call({"cmd": "redo"})
    st = z.call({"cmd": "state"})
    check("3.0" in st["dirty"] and "3.19" in st["dirty"], "やり直しで両方にまた印が付く")
    r = z.call({"cmd": "export", "dir": str(out)})
    check(written(r, 3, 0) and written(r, 3, 19), "出力で両方のマップの JSON が書かれる")
    z.call({"cmd": "undo"})
    r = z.call({"cmd": "export", "dir": str(out)})
    check(written(r, 3, 0, "removed") and written(r, 3, 19, "removed"), "取り消して出力すると両方のファイルが消える（ベース ROM と同じ）")

CHECKS = {"222": check_222}


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    ap.add_argument("--only", help="確かめる issue の番号（カンマ区切り）")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    only = args.only.split(",") if args.only else list(CHECKS)
    with tempfile.TemporaryDirectory(prefix="zzm-conn-", ignore_cleanup_errors=True) as tmp:
        work = pathlib.Path(tmp)
        for number in only:
            print(f"== #{number}")
            # issue ごとに起動し直す（前の確認の状態を持ち越さない）
            with Zigzagu(args.exe, profile=work / f"profile{number}", extra=["--mute-audio"]) as z:
                z.call({"cmd": "open", "rom": args.rom})
                CHECKS[number](z, work, shots)
    print(f"\n失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
