"""仮の主人公、実機の画面枠、前景、同じ画像の保存（#470・#475）。"""
from __future__ import annotations

import argparse
import base64
import hashlib
import pathlib
import tempfile

from phase4_view_check import pixels
from zz import Zigzagu


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--rom", required=True)
    p.add_argument("--exe", required=True)
    p.add_argument("--project")
    p.add_argument("--shots")
    args = p.parse_args()
    rom = pathlib.Path(args.rom)
    rom_hash = hashlib.sha256(rom.read_bytes()).digest()
    def project_json():
        folder = pathlib.Path(args.project) / "maps" if args.project else None
        return {str(path.relative_to(folder)): hashlib.sha256(path.read_bytes()).digest() for path in folder.rglob("*.json")} if folder and folder.exists() else {}
    original_json = project_json()
    with tempfile.TemporaryDirectory(prefix="zzm-preview-", ignore_cleanup_errors=True) as work:
        with Zigzagu(args.exe, profile=pathlib.Path(work) / "profile", extra=["--mute-audio"]) as z:
            z.call(dict(cmd="open", rom=args.rom, **({"project": args.project} if args.project else {})))
            z.call(dict(cmd="selectMap", bank=3, map=0))
            z.call(dict(cmd="tab", name="event"))
            before = z.call(dict(cmd="state"))
            original = z.call(dict(cmd="canvasPng", target="event"))["png"]
            frame_setting = z.call(dict(cmd="view.aids"))["playerView"]
            z.call(dict(cmd="menu.run", id="view.previewPlayer"))
            state = z.call(dict(cmd="preview.player"))
            assert state["enabled"] and state["frame"]["width"] == 240 and state["frame"]["height"] == 160
            assert state["frame"]["x"] == state["player"]["x"] * 16 - 112
            assert state["frame"]["y"] == state["player"]["y"] * 16 - 72
            assert z.call(dict(cmd="view.aids"))["layers"]["event"]["sight"] is None

            def frame(tab="event"):
                return base64.b64decode(z.call(dict(cmd="canvasPng", id=f"preview.{tab}.frame"))["png"])

            z.call(dict(cmd="preview.player", player=dict(x=10, y=10)))
            male = pixels(frame())
            assert male[:2] == (240, 160)
            z.call(dict(cmd="setField", id="preview.gender", value=1))
            female = pixels(frame())
            assert female != male
            z.call(dict(cmd="setField", id="preview.facing", value=1))
            assert pixels(frame()) != female
            z.call(dict(cmd="mouse", id="preview.event.player", action="drag", px=[8, 16], toPx=[40, 32], steps=1))
            moved = z.call(dict(cmd="preview.player"))["player"]
            assert (moved["x"], moved["y"]) == (12, 11), moved
            z.call(dict(cmd="key", id="preview.event.player", key="ArrowUp"))
            assert z.call(dict(cmd="preview.player"))["player"]["y"] == 10
            z.call(dict(cmd="mouse", id="preview.event.player", action="rightClick", px=[8, 16]))
            assert z.call(dict(cmd="preview.player"))["player"]["facing"] != moved["facing"]
            print("OK 男女・向きの選択、ドラッグと右クリック。マウスに追従する仮の枠は出ない")
            for x, y in ((0, 0), (before["map"]["width"]-1, before["map"]["height"]-1)):
                z.call(dict(cmd="preview.player", player=dict(x=x, y=y)))
                assert pixels(frame())[:2] == (240, 160)
            z.call(dict(cmd="action", id="view.playerView"))
            assert not z.call(dict(cmd="view.aids"))["playerView"]
            z.call(dict(cmd="action", id="view.playerView"))
            assert z.call(dict(cmd="view.aids"))["playerView"]
            print("OK マップ端の枠と境界、Vと共通の表示切り替え")
            z.call(dict(cmd="preview.player", player=dict(x=10, y=10)))
            expected = pixels(frame())
            path = pathlib.Path(work) / "frame.png"
            z.call(dict(cmd="queuePath", path=str(path)))
            z.call(dict(cmd="action", id="preview.save"))
            assert pixels(path.read_bytes()) == expected
            print("OK 保存したPNGが、表示した240×160の画素と一致")
            for tab in ("map", "movement", "event"):
                z.call(dict(cmd="tab", name=tab))
                assert pixels(frame(tab)) == expected
            camera = dict(target=255, x=80, y=96, shakeX=3, shakeY=-2)
            result = z.call(dict(cmd="preview.playback", state=dict(frame=1, actors=[], camera=camera)))
            assert result["frame"] == dict(x=-29, y=22, width=240, height=160)
            z.call(dict(cmd="preview.playback", state=None))
            assert pixels(frame()) == expected
            print("OK 再生のカメラと揺れを同じ枠で描き、解除すると仮の配置へ戻る")
            placement = z.call(dict(cmd="preview.player"))["player"]
            jump = dict(id=255, graphicsId=7, tileX=10, tileY=10, pixelX=160, pixelY=160,
                        height=-8, facing=placement["facing"], sprite="jump", actionFrame=4,
                        movementId=79, visible=True, present=True, shadow=True, mark=None,
                        elevation=3, fixedPriority=False, animHold=False)
            camera = dict(target=255, x=160, y=160, shakeX=0, shakeY=0)
            z.call(dict(cmd="preview.playback", state=dict(frame=4, actors=[jump], camera=camera)))
            scene = z.call(dict(cmd="actors.scene", actors=[jump], x=48, y=88))
            assert scene["missing"] == [] and scene["unknownBlocks"] == [], scene
            assert pixels(base64.b64decode(scene["png"])) == pixels(frame())
            z.call(dict(cmd="preview.playback", state=None))
            assert pixels(frame()) == expected
            print("OK 実ROMのジャンプの影を読み、画面と共通合成の画素が一致")
            if args.project:
                z.call(dict(cmd="view.timeOfDay", time="night"))
                assert pixels(frame()) != expected
                z.call(dict(cmd="view.timeOfDay", time="day"))
                assert pixels(frame()) == expected
                print("OK 時間帯の色を背景と人物に反映し、昼で同じ画像に戻る")
            if args.shots:
                folder = pathlib.Path(args.shots); folder.mkdir(parents=True, exist_ok=True)
                shot = z.call(dict(cmd="screenshot"))
                (folder / "preview_player.png").write_bytes(base64.b64decode(shot if isinstance(shot, str) else shot["png"]))
            z.call(dict(cmd="click", id="preview.stop"))
            assert z.call(dict(cmd="preview.player")) == dict(enabled=False, player=None, frame=None)
            assert z.call(dict(cmd="view.aids"))["playerView"] == frame_setting
            assert z.call(dict(cmd="canvasPng", target="event"))["png"] == original
            after = z.call(dict(cmd="state"))
            assert after["dirty"] == before["dirty"] and after["history"] == before["history"]
            print("OK タブ間で同じ描画、終了後の表示と設定・ROM・履歴の不変")
            z.call(dict(cmd="preview.player", enabled=True))
            z.call(dict(cmd="selectMap", bank=3, map=1))
            assert not z.call(dict(cmd="preview.player"))["enabled"]
            print("OK マップ切り替えで仮の配置を捨てる")
        assert hashlib.sha256(rom.read_bytes()).digest() == rom_hash
        assert project_json() == original_json
        print("OK ROMとプロジェクトのJSONファイルが操作前後で同じ")


if __name__ == "__main__":
    main()
