"""ツールバーのドット絵のアイコン（#541）を確かめる。

  python tests/automation/toolbar_icon_check.py --rom <素の BPRJ の写し> [--project <プロジェクトフォルダの写し>] [--exe <zigzagumap.exe>]
      [--shots <フォルダ>]

- ROM を開く前: ワールドマップエディタのアイコンは自作の絵（`toolbar.icons` の `worldMap` が `fallback`）。
- ROM を開いたあと: ROM のタウンマップから切り出した絵に変わる（`rom`）。新規マップの作成・挿入の絵は変わらない。ROM は 1 バイトも変わらない。
- `--project` があれば、プロジェクトのフォルダを開いたときも切り出した絵になることを見る。
- `--shots` があれば、ツールバーを撮る（`toolbar_norom.png`・`toolbar_rom.png`、ダークテーマは `_dark`、4 倍の拡大は `_x4`）。
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if not shots:
        return
    data = z.call({"cmd": "ui.shot", "id": "toolbar"})
    png = base64.b64decode(data if isinstance(data, str) else data.get("png") or data.get("data"))
    (shots / f"{name}.png").write_bytes(png)
    try:
        from PIL import Image
    except ImportError:
        return
    img = Image.open(io.BytesIO(png))
    img.resize((img.width * 4, img.height * 4), Image.NEAREST).save(shots / f"{name}_x4.png")


def both_themes(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    shot(z, shots, name)
    z.call({"cmd": "setting", "key": "theme", "value": "dark"})
    shot(z, shots, f"{name}_dark")
    z.call({"cmd": "setting", "key": "theme", "value": "light"})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--project")
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    a = ap.parse_args()
    shots = pathlib.Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    rom = pathlib.Path(a.rom)
    before = hashlib.sha256(rom.read_bytes()).digest()

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile:
        with Zigzagu(pathlib.Path(a.exe) if a.exe else None, profile=profile) as z:
            st = z.call({"cmd": "toolbar.icons", "wait": True})
            check(st["worldMap"] == "fallback", f"ROM を開く前のワールドマップの絵は自作の絵: {st['worldMap']}")
            check(all(st["sizes"].get(k, 0) > 0 for k in ("newMap", "insertMap", "worldMap")), "3 つのボタンに絵がある")
            norom = st["sizes"]
            both_themes(z, shots, "toolbar_norom")

            z.call({"cmd": "open", "rom": str(rom)})
            st = z.call({"cmd": "toolbar.icons", "wait": True})
            check(st["worldMap"] == "rom", f"ROM を開くと ROM のタウンマップから切り出した絵: {st['worldMap']}")
            check(st["sizes"]["worldMap"] != norom["worldMap"], "ワールドマップの絵が変わる")
            check(st["sizes"]["newMap"] == norom["newMap"] and st["sizes"]["insertMap"] == norom["insertMap"], "新規マップの作成・挿入の絵は変わらない")
            both_themes(z, shots, "toolbar_rom")

            if a.project:
                z.call({"cmd": "open", "rom": str(rom), "project": a.project})
                st = z.call({"cmd": "toolbar.icons", "wait": True})
                check(st["worldMap"] == "rom", f"プロジェクトのフォルダを開いても切り出した絵: {st['worldMap']}")

    check(hashlib.sha256(rom.read_bytes()).digest() == before, "ROM は変わらない")
    print("失敗なし" if not failures else f"失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
