"""マップ一覧の状態の印と右クリック（Phase5 #401）を、素の ROM だけで確かめる（出力しない）。

  python tests/automation/map_tree_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- 印: 開いているマップは "open"、未出力の変更があるマップは "dirty"、読み込めなかったマップは "error"。
  読み込めなかったマップは、ROM の写しの 3.1 のヘッダーの配置のポインタを、ROM の末尾の 0xFF の所へ向けて作る（写しは一時フォルダに置き、元の ROM は読むだけ）。
- 右クリックのメニュー: 開く・名前をコピー・番号をコピー・このマップを複製。複製は同じバンクの最後の番号に写して開き、
  1 回の「元に戻す」で消える。ビルドまでの確認は tests/realcopy/run.py --maplist。
"""
from __future__ import annotations

import argparse
import base64
import os
import pathlib
import re
import shutil
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import AppError, Zigzagu, shot  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def item(z: Zigzagu, bank: int, map_: int) -> dict | None:
    return next((i for i in z.call({"cmd": "tree.list"}) if i["mapId"] == {"bank": bank, "map": map_}), None)


def mark(z: Zigzagu, bank: int, map_: int) -> str | None:
    i = item(z, bank, map_)
    return i["mark"] if i else "（項目なし）"


def menu(z: Zigzagu, bank: int, map_: int) -> list[str]:
    z.call({"cmd": "tree.rightClick", "bank": bank, "map": map_})
    return [i["id"] for i in (z.call({"cmd": "contextMenu.state"}) or {}).get("items", [])]


def status(z: Zigzagu) -> str:
    s = z.call({"cmd": "state"})["status"]
    return s["left"] if isinstance(s, dict) else str(s)


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="zzm-tree-", ignore_cleanup_errors=True) as work:
        profile = pathlib.Path(work) / "profile"
        rom = pathlib.Path(work) / "broken.gba"
        shutil.copyfile(args.rom, rom)
        with Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
            z.call({"cmd": "open", "rom": args.rom})
            z.call({"cmd": "selectMap", "bank": 3, "map": 1})
            # 3.1 のヘッダーの場所（場所の設定タブの、くわしく表示の高度な表示の欄）。写しの ROM のこのヘッダーの配置のポインタを壊す
            z.call({"cmd": "tab", "name": "header"})
            z.call({"cmd": "click", "id": "header.mode.classic"})
            z.call({"cmd": "setField", "id": "header.advanced", "value": True})
            offset = int(re.sub(r"[^0-9A-Fa-f]", "", z.call({"cmd": "getField", "id": "pro.headerOffset"})["value"]), 16) & 0x1FFFFFF
            data = bytearray(rom.read_bytes())
            # 一覧に残るよう ROM の中を指すポインタにし、指す先は 0xFF（大きさが読めない配置）にする
            check(data[-0x100:] == b"\xff" * 0x100, "ROM の末尾が 0xFF で埋まっている（壊したマップを作る前提）")
            data[offset : offset + 4] = (0x08000000 + len(data) - 0x100).to_bytes(4, "little")
            rom.write_bytes(bytes(data))
            z.call({"cmd": "click", "id": "header.mode.simple"})
            z.call({"cmd": "tab", "name": "map"})

            z.call({"cmd": "open", "rom": str(rom)})
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            check(mark(z, 3, 0) == "open", f"開いているマップの印（{mark(z, 3, 0)}）")
            check(mark(z, 3, 2) is None, f"開いていないマップは印なし（{mark(z, 3, 2)}）")
            text = item(z, 3, 0)["text"]

            # 右クリックのメニュー
            ids = menu(z, 3, 0)
            check(ids == ["tree.open", "tree.copyName", "tree.copyId", "tree.duplicate"], f"右クリックのメニュー（{ids}）")
            shot(z, shots, "tree_menu.png")
            z.call({"cmd": "contextMenu.press", "id": "tree.copyId"})
            check(z.call({"cmd": "clipboard.last"}) == "3.0", "番号をコピー")
            menu(z, 3, 0)
            z.call({"cmd": "contextMenu.press", "id": "tree.copyName"})
            name = z.call({"cmd": "clipboard.last"})
            check(bool(name) and text.startswith(name) and "(3.0)" not in name, f"名前をコピー（{name}）")
            check(name in status(z), f"コピーした文字をステータスバーに出す（{status(z)}）")

            menu(z, 3, 2)
            z.call({"cmd": "contextMenu.press", "id": "tree.open"})
            m = z.call({"cmd": "state"})["map"]
            check((m["bank"], m["map"]) == (3, 2), "「開く」でそのマップを開く")
            check(mark(z, 3, 2) == "open" and mark(z, 3, 0) is None, "開いているマップの印が移る")

            # 読み込めなかったマップ
            try:
                z.call({"cmd": "tree.open", "bank": 3, "map": 1})
            except AppError:
                pass
            check(mark(z, 3, 1) == "error", f"読み込めなかったマップの印（{mark(z, 3, 1)}）")
            m = z.call({"cmd": "state"})["map"]
            check((m["bank"], m["map"]) == (3, 2) and mark(z, 3, 2) == "open", "読み込めなかったときは今のマップのまま")
            shot(z, shots, "tree_error.png")

            # 複製
            before = len([i for i in z.call({"cmd": "tree.list"}) if i["mapId"] and i["mapId"]["bank"] == 3])
            menu(z, 3, 0)
            z.call({"cmd": "contextMenu.press", "id": "tree.duplicate"})
            m = z.call({"cmd": "state"})["map"]
            target = (m["bank"], m["map"])
            check(target == (3, before), f"同じバンクの最後に写して開く（{target}）")
            check(mark(z, *target) == "dirty", f"写したマップの印は未出力（{mark(z, *target)}）")
            check("複製しました" in status(z), f"複製をステータスバーに出す（{status(z)}）")
            shot(z, shots, "tree_duplicate.png")
            z.call({"cmd": "undo"})
            # 一覧の作り直しは取り消しの後に非同期で行うので、少し待つ
            for _ in range(30):
                if item(z, *target) is None:
                    break
                time.sleep(0.1)
            check(item(z, *target) is None, "1 回の「元に戻す」で写したマップが消える")
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
