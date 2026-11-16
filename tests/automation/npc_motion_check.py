"""表示 > 人物を動かす（#471）。移動タイプの再生、止める口、終了後の不変、マップ切り替え。"""
from __future__ import annotations

import argparse
import base64
import hashlib
import pathlib
import tempfile
import time

from phase4_view_check import pixels
from zz import Zigzagu


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--rom", required=True)
    p.add_argument("--exe", required=True)
    p.add_argument("--project")
    p.add_argument("--bank", type=int, default=3)
    p.add_argument("--map", type=int, default=0)
    p.add_argument("--shots")
    args = p.parse_args()
    rom = pathlib.Path(args.rom)
    rom_hash = hashlib.sha256(rom.read_bytes()).digest()

    def project_json():
        folder = pathlib.Path(args.project) / "maps" if args.project else None
        return {str(path.relative_to(folder)): hashlib.sha256(path.read_bytes()).digest() for path in folder.rglob("*.json")} if folder and folder.exists() else {}

    original_json = project_json()
    with tempfile.TemporaryDirectory(prefix="zzm-npc-", ignore_cleanup_errors=True) as work:
        with Zigzagu(args.exe, profile=pathlib.Path(work) / "profile", extra=["--mute-audio"]) as z:
            z.call(dict(cmd="open", rom=args.rom, **({"project": args.project} if args.project else {})))
            z.call(dict(cmd="selectMap", bank=args.bank, map=args.map))
            z.call(dict(cmd="tab", name="event"))
            before = z.call(dict(cmd="state"))
            original = z.call(dict(cmd="canvasPng", target="event"))["png"]
            original_map = z.call(dict(cmd="canvasPng", target="map"))["png"]
            state = z.call(dict(cmd="npc.state"))
            assert not state["enabled"] and not state["clock"]["running"], state
            print("OK 既定はオフで、時計を動かしていない")

            z.call(dict(cmd="menu.run", id="view.npcMotion"))
            state = z.call(dict(cmd="npc.state"))
            assert state["enabled"] and state["clock"]["running"], state
            z.call(dict(cmd="npc.motion", enabled=False))
            start = z.call(dict(cmd="npc.motion", enabled=True, seed=1))
            actors = start["actors"]
            assert actors, "人物の居るマップを選んでください"
            origin = {a["localId"]: (a["x"], a["y"]) for a in actors}
            # 自分で進めるため、時計は止めておく（止める口の確認も兼ねる）。
            held = z.call(dict(cmd="npc.hold", owner="test", on=True))
            assert held["holders"] == ["test"] and not held["clock"]["running"], held
            time.sleep(0.5)
            assert z.call(dict(cmd="npc.state"))["frame"] == held["frame"]
            print("OK 止める口で時計を止め、止めている間は進まない")

            overlay0 = pixels(base64.b64decode(z.call(dict(cmd="npc.image"))["png"]))
            a = z.call(dict(cmd="npc.advance", frames=1200))
            assert a["frame"] == held["frame"] + 1200
            moving = [x for x in a["actors"] if x["reason"] is None]
            moved = [x for x in moving if (x["x"], x["y"]) != origin[x["localId"]]]
            print("動く人物", len(moving), "動いた人物", len(moved), "止めて見せる", [(x["localId"], x["reason"]) for x in a["actors"] if x["reason"]])
            assert pixels(base64.b64decode(z.call(dict(cmd="npc.image"))["png"])) != overlay0 or not moved
            # 同じ種で始め直すと同じ動き。
            z.call(dict(cmd="npc.motion", enabled=True, seed=1))
            z.call(dict(cmd="npc.hold", owner="test", on=False))
            z.call(dict(cmd="npc.hold", owner="test", on=True))
            b = z.call(dict(cmd="npc.advance", frames=1200))
            assert [(x["x"], x["y"], x["facing"]) for x in b["actors"]] == [(x["x"], x["y"], x["facing"]) for x in a["actors"]]
            print("OK 同じ種なら同じ動き、人物の画像を重ね描きに描く")
            if args.shots:
                folder = pathlib.Path(args.shots); folder.mkdir(parents=True, exist_ok=True)
                shot = z.call(dict(cmd="screenshot"))
                (folder / "npc_motion_event.png").write_bytes(base64.b64decode(shot if isinstance(shot, str) else shot["png"]))
            for tab in ("map", "movement", "event"):
                z.call(dict(cmd="tab", name=tab))
                assert pixels(base64.b64decode(z.call(dict(cmd="npc.image"))["png"]))[:2] == (before["map"]["width"] * 16, before["map"]["height"] * 16)
            z.call(dict(cmd="tab", name="header"))
            hidden = z.call(dict(cmd="npc.state"))
            assert "hiddenTab" in hidden["holders"], hidden
            z.call(dict(cmd="tab", name="event"))
            assert "hiddenTab" not in z.call(dict(cmd="npc.state"))["holders"]
            print("OK マップのタブを渡り歩き、マップの見えないタブでは時計を止める")
            # 仮の主人公と一緒に使う（主人公は人物の通れないマス）。
            z.call(dict(cmd="preview.player", enabled=True))
            z.call(dict(cmd="npc.advance", frames=60))
            frame = pixels(base64.b64decode(z.call(dict(cmd="canvasPng", id="preview.event.frame"))["png"]))
            assert frame[:2] == (240, 160)
            z.call(dict(cmd="preview.player", enabled=False))
            print("OK 仮の主人公の枠にも動く人物を描く")
            z.call(dict(cmd="npc.hold", owner="test", on=False))
            running = z.call(dict(cmd="npc.state"))
            assert running["clock"]["running"] and running["holders"] == []
            time.sleep(1.0)
            later = z.call(dict(cmd="npc.state"))
            assert later["frame"] > running["frame"] + 30, (running["frame"], later["frame"])
            print("OK 時計で進む（1秒で", later["frame"] - running["frame"], "フレーム）")
            z.call(dict(cmd="menu.run", id="view.npcMotion"))
            stopped = z.call(dict(cmd="npc.state"))
            assert not stopped["enabled"] and not stopped["clock"]["running"] and stopped["clock"]["subscriptions"] == [], stopped
            assert z.call(dict(cmd="canvasPng", target="event"))["png"] == original
            z.call(dict(cmd="tab", name="map"))
            assert z.call(dict(cmd="canvasPng", target="map"))["png"] == original_map
            after = z.call(dict(cmd="state"))
            assert after["dirty"] == before["dirty"] and after["history"] == before["history"]
            print("OK 止めると時計の予約・購読が無くなり、表示・未出力・履歴は前と同じ")
            z.call(dict(cmd="npc.motion", enabled=True))
            z.call(dict(cmd="selectMap", bank=args.bank, map=args.map + 1))
            stopped = z.call(dict(cmd="npc.state"))
            assert not stopped["enabled"] and not stopped["clock"]["running"]
            print("OK マップを切り替えると止めて捨てる")
        assert hashlib.sha256(rom.read_bytes()).digest() == rom_hash
        assert project_json() == original_json
        print("OK ROM と maps の JSON は変わらない")


if __name__ == "__main__":
    main()
