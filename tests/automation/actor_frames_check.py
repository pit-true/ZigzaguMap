"""共通の人物描画（#468）。実ROMの向き・コマ、途中の座標・高さ・非表示。"""
from __future__ import annotations

import argparse
import base64
import pathlib
import tempfile

from phase4_view_check import pixels
from zz import Zigzagu


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--rom", required=True)
    p.add_argument("--exe", required=True)
    args = p.parse_args()
    with tempfile.TemporaryDirectory(prefix="zzm-actors-", ignore_cleanup_errors=True) as work:
        with Zigzagu(args.exe, profile=pathlib.Path(work) / "profile", extra=["--mute-audio"]) as z:
            z.call({"cmd": "open", "rom": args.rom})
            state = z.call({"cmd": "state"})
            actor = dict(id=255, graphicsId=0, tileX=6, tileY=6, pixelX=96, pixelY=96,
                         height=0, facing="down", sprite="stand", actionFrame=0, movementId=None,
                         visible=True, present=True, shadow=False, mark=None, elevation=3,
                         fixedPriority=False, animHold=False)

            def render(**changes):
                result = z.call({"cmd": "actors.render", "actors": [dict(actor, **changes)]})
                _, _, rgba = pixels(base64.b64decode(result["png"]))
                opaque = {(i // 4 % 240, i // 4 // 240): tuple(rgba[i:i+4])
                          for i in range(0, len(rgba), 4) if rgba[i+3]}
                return opaque, result["frames"][0]

            for graphics in (0, 1, 7):
                images = [render(graphicsId=graphics, facing=d)[0] for d in ("down", "up", "left", "right")]
                assert all(images)
                assert images[0] != images[1] and images[0] != images[2]
                assert {(207-x, y): color for (x, y), color in images[2].items()} == images[3]
                walk = [render(graphicsId=graphics, sprite="walk", movementId=12, actionFrame=t)[0] for t in range(32)]
                assert any(image != walk[0] for image in walk)
            print("OK 男女の主人公と人物の四方向・左右反転・歩きのコマ")
            ground, _ = render()
            shifted, _ = render(pixelX=99, pixelY=98, height=-8)
            assert {(x+3, y-6): color for (x, y), color in ground.items()} == shifted
            assert render(visible=False)[0] == {}
            assert render(present=False)[0] == {}
            assert render(graphicsId=-1)[0] == {}
            print("OK 移動途中の画素位置、ジャンプの高さ、非表示とカメラ")
            missing, reason = render(graphicsId=1023)
            assert not missing and reason["reason"] == "graphics"
            after = z.call({"cmd": "state"})
            assert after["dirty"] == state["dirty"] and after["history"] == state["history"]
            print("OK 未対応の理由を返し、ROM・マップ・履歴を変更しない")


if __name__ == "__main__":
    main()
