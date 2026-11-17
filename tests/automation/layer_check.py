"""レイヤーごとの表示（Phase7 #513）を、素の ROM だけで確かめる（出力しない）。

  python tests/automation/layer_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- 既定は全部オンで、ステータスバーに何も出さない。
- 上を外すと、マップの絵が変わり（木などの上のレイヤーが消える）、ステータスバーに「レイヤー: 上を隠しています」。
  上のレイヤーが透明なマスの画素は変わらない（下のレイヤーだけの絵）。
- 全部外すと、マップ全体が背景色 1 色になる。ブロックパレットの絵は変わらない。移動エリアのタブと画像の書き出しも同じ。
- 全部オンに戻すと、マップの絵が元と画素まで同じ。メニューの項目でも切り替えられる。
"""
from __future__ import annotations

import argparse
import base64
import io
import os
import pathlib
import sys
import tempfile

from PIL import Image

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
    png = z.call({"cmd": "screenshot"})
    (shots / name).write_bytes(base64.b64decode(png if isinstance(png, str) else png["png"]))


def png(z: Zigzagu, target: str = "map") -> str:
    return z.call({"cmd": "canvasPng", "target": target})["png"]


def image(data: str) -> Image.Image:
    if "," in data[:40]:
        data = data.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")


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
    with tempfile.TemporaryDirectory(prefix="zzm-layer-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": args.rom})
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})
        z.call({"cmd": "tab", "name": "map"})
        s = z.call({"cmd": "view.layers"})
        check(s["bottom"] and s["top"] and s["third"] and s["status"] is None, "既定は全部オンで、ステータスバーに何も出さない")
        all_png = png(z)
        palette0 = png(z, "palette")
        comp0 = z.call({"cmd": "image.composite", "whole": False, "png": True})["png"]
        move0 = png(z, "movement")

        s = z.call({"cmd": "view.layers", "top": False})
        check(s["status"] == "レイヤー: 上を隠しています", f"上を外すとステータスバーに出す（{s['status']}）")
        bottom_png = png(z)
        a, b = image(all_png), image(bottom_png)
        ab, bb = a.tobytes(), b.tobytes()
        diff = sum(1 for i in range(0, len(ab), 3) if ab[i:i + 3] != bb[i:i + 3])
        same = a.size[0] * a.size[1] - diff
        check(diff > 0 and same > diff, f"上を外すと上のレイヤーの画素だけ変わる（変わった {diff}、同じ {same}）")
        shot(z, shots, "layer_top_hidden.png")

        s = z.call({"cmd": "view.layers", "bottom": False, "third": False})
        check(s["status"] == "レイヤー: 下・上・3 枚目を隠しています", f"全部外したときの文（{s['status']}）")
        none = image(png(z))
        colors = none.getcolors(16)
        check(colors is not None and len(colors) == 1, f"全部外すとマップは背景色 1 色（{colors}）")
        check(png(z, "palette") == palette0, "ブロックパレットの絵は変わらない")
        mv = image(png(z, "movement"))
        check(png(z, "movement") != move0, "移動エリアのタブにも適用する")
        comp = z.call({"cmd": "image.composite", "whole": False, "png": True})["png"]
        check(comp != comp0, "画像の書き出しも今見えているとおりにする")
        del mv

        s = z.call({"cmd": "view.layers", "bottom": True, "top": True, "third": True})
        check(s["status"] is None, "全部オンに戻すとステータスバーの文を消す")
        check(png(z) == all_png, "全部オンに戻すとマップの絵が元と画素まで同じ")
        check(z.call({"cmd": "image.composite", "whole": False, "png": True})["png"] == comp0, "画像の書き出しも元に戻る")

        z.call({"cmd": "action", "id": "view.layer.top"})
        check(z.call({"cmd": "view.layers"})["top"] is False and png(z) == bottom_png, "メニューの「上のレイヤー」でも外せる")
        z.call({"cmd": "selectMap", "bank": 3, "map": 1})
        check(png(z) != all_png and z.call({"cmd": "view.layers"})["top"] is False, "別のマップを開いても外したまま")
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})
        check(png(z) == bottom_png, "戻っても上を外した絵")
        z.call({"cmd": "action", "id": "view.layer.top"})
        check(png(z) == all_png, "もう一度押すと元の絵")
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
