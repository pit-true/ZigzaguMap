"""Phase3 の表示・ホバー・スタンプの機能（#228 ほか）を、素の ROM だけで確かめる（プロジェクトフォルダは写しだけを使う）。

  python tests/automation/phase3_view_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--only <名前> ...]

- 起動は --automation・--profile（一時フォルダ）・--mute-audio・画面外。ROM には書き込まない。
- 見ること（`--only` で選べる。名前は下の CHECKS の鍵）:
  - layoutShared: 場所の設定タブの「配置の共有」。素の BPRJ の 5.4 は 17 枚で共有していて、一覧のマップを押すと開く。
    共有していないマップ（3.0）では隠れる。かんたん表示とくわしく表示の両方。
"""
from __future__ import annotations

import argparse
import base64
import os
import pathlib
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def save_png(data, path: pathlib.Path) -> None:
    png = data if isinstance(data, str) else data.get("png") or data.get("data")
    path.write_bytes(base64.b64decode(png))


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str, part: str | None = None) -> None:
    if not shots:
        return
    data = z.call({"cmd": "ui.shot", "id": part}) if part else z.call({"cmd": "screenshot"})
    save_png(data, shots / name)


def check_layout_shared(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    # 場所の設定タブの下の方まで見えるように、窓を縦に大きくする（画面外なので見た目は変わらない）。
    z.call({"cmd": "resize", "width": 1280, "height": 1500})
    z.call({"cmd": "selectMap", "bank": 5, "map": 4})
    z.call({"cmd": "tab", "name": "header"})
    z.call({"cmd": "click", "id": "header.mode.simple"})
    f = z.call({"cmd": "getField", "id": "easy.layoutShared"})
    check(f["visible"] and "17 枚" in f["value"], f"かんたん表示: 5.4 で「17 枚」が出る（{f['value']!r}）")
    items = z.call({"cmd": "ui.list", "root": "easy.layoutShared.list"})
    buttons = [i for i in items if str(i.get("id", "")).startswith("easy.layoutShared.map:")]
    check(len(buttons) == 16, f"かんたん表示: 自分以外の 16 枚が押せる（{len(buttons)} 個）")
    shot(z, shots, "p3_layout_shared_simple.png", "easy.layoutShared.list")
    shot(z, shots, "p3_layout_shared_simple_window.png")
    if buttons:
        target = buttons[0]["id"].split(":", 1)[1]
        z.call({"cmd": "click", "id": buttons[0]["id"]})
        time.sleep(0.5)
        st = z.call({"cmd": "state"})
        opened = st.get("map") or {}
        check(f"{opened.get('bank')}.{opened.get('map')}" == target, f"一覧の {target} を押すと開く（開いたのは {opened.get('bank')}.{opened.get('map')}）")
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "header"})
    f = z.call({"cmd": "getField", "id": "easy.layoutShared"})
    check(not f["visible"], "かんたん表示: 共有していない 3.0 では隠れる")

    z.call({"cmd": "click", "id": "header.mode.classic"})
    z.call({"cmd": "selectMap", "bank": 5, "map": 4})
    z.call({"cmd": "tab", "name": "header"})
    f = z.call({"cmd": "getField", "id": "header.layoutShared"})
    check(f["visible"] and "17 枚" in f["value"], f"くわしく表示: 5.4 で「17 枚」が出る（{f['value']!r}）")
    shot(z, shots, "p3_layout_shared_classic_window.png")
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    f = z.call({"cmd": "getField", "id": "header.layoutShared"})
    check(not f["visible"], "くわしく表示: 共有していない 3.0 では隠れる")
    z.call({"cmd": "click", "id": "header.mode.simple"})


CHECKS = {
    "layoutShared": check_layout_shared,
}


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    names = args.only or list(CHECKS)
    with tempfile.TemporaryDirectory(prefix="zzm-p3view-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": args.rom})
        ctx: dict = {"rom": args.rom}
        for name in names:
            print(f"== {name}")
            try:
                CHECKS[name](z, shots, ctx)
            except Exception as e:  # noqa: BLE001
                check(False, f"{name}: 例外 {e}")
    print(f"失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
