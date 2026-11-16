"""仮の主人公の連れ歩き（#476・#477）。DPE の絵、付いてくる動き、前景との重なり、無効なプロジェクト、終了後の不変。"""
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
    p.add_argument("--project", required=True)
    p.add_argument("--expect", choices=["enabled", "disabled", "noSheets", "noSource", "noDpe"], default="enabled")
    p.add_argument("--shots")
    args = p.parse_args()
    rom = pathlib.Path(args.rom)
    rom_hash = hashlib.sha256(rom.read_bytes()).digest()

    def project_json():
        folder = pathlib.Path(args.project) / "maps"
        return {str(path.relative_to(folder)): hashlib.sha256(path.read_bytes()).digest() for path in folder.rglob("*.json")} if folder.exists() else {}

    original_json = project_json()
    with tempfile.TemporaryDirectory(prefix="zzm-follower-", ignore_cleanup_errors=True) as work:
        with Zigzagu(args.exe, profile=pathlib.Path(work) / "profile", extra=["--mute-audio"]) as z:
            z.call(dict(cmd="open", rom=args.rom, project=args.project))
            z.call(dict(cmd="selectMap", bank=3, map=0))
            z.call(dict(cmd="tab", name="event"))
            before = z.call(dict(cmd="state"))
            z.call(dict(cmd="preview.player", enabled=True, player=dict(x=10, y=10, facing="down")))
            state = z.call(dict(cmd="follower.state"))
            if args.expect != "enabled":
                assert not state["status"]["enabled"] and state["status"]["reason"] == args.expect, state
                assert state["speciesCount"] == 0 or args.expect == "disabled"
                note = z.call(dict(cmd="getField", id="follower.note"))
                print("OK 連れ歩きを出せない理由:", state["status"]["reason"], note)
                z.call(dict(cmd="follower.set", enabled=True))
                assert not z.call(dict(cmd="follower.state"))["enabled"]
                print("OK 無効なプロジェクトでは出さない")
            else:
                assert state["status"]["enabled"] and state["speciesCount"] > 700, state
                assert not state["enabled"]
                def frame():
                    return pixels(base64.b64decode(z.call(dict(cmd="canvasPng", id="preview.event.frame"))["png"]))
                without = frame()
                s = z.call(dict(cmd="follower.set", enabled=True))
                assert s["enabled"] and s["position"] == dict(x=10, y=9, facing="down"), s
                shown = frame()
                assert shown != without
                print("OK 既定の種族", s["species"], s["sheet"], "を主人公の後ろに描く")
                # 直線・曲がり角・戻る動き
                z.call(dict(cmd="key", id="preview.event.player", key="ArrowDown"))
                time.sleep(0.5)  # 主人公が 1 マス歩き終えるまで（歩いている間の矢印キーは無視される）
                mid = z.call(dict(cmd="follower.state"))
                assert mid["busy"]
                s = z.call(dict(cmd="follower.advance", frames=20))
                assert s["position"] == dict(x=10, y=10, facing="down"), s
                z.call(dict(cmd="key", id="preview.event.player", key="ArrowRight"))
                time.sleep(0.5)  # 主人公が 1 マス歩き終えるまで（歩いている間の矢印キーは無視される）
                s = z.call(dict(cmd="follower.advance", frames=20))
                assert s["position"] == dict(x=10, y=11, facing="down"), s
                z.call(dict(cmd="key", id="preview.event.player", key="ArrowLeft"))
                time.sleep(0.5)  # 主人公が 1 マス歩き終えるまで（歩いている間の矢印キーは無視される）
                s = z.call(dict(cmd="follower.advance", frames=20))
                assert s["position"] == dict(x=11, y=11, facing="right"), s
                print("OK 直線・曲がり角・戻る動きで、主人公が居たマスに入る")
                # 素早いドラッグ（何マスも先へ）と、遠くへの置き直し
                z.call(dict(cmd="preview.player", player=dict(x=14, y=13)))
                s = z.call(dict(cmd="follower.advance", frames=60))
                assert s["position"]["x"] == 14 and s["position"]["y"] == 12, s
                z.call(dict(cmd="preview.player", player=dict(x=0, y=0)))
                s = z.call(dict(cmd="follower.state"))
                assert not s["busy"] and abs(s["position"]["x"]) + abs(s["position"]["y"]) == 1, s
                print("OK 素早いドラッグは通った道を追い、遠くへ置き直すと後ろへ移る")
                # 32 と 64、色違い・メス
                z.call(dict(cmd="preview.player", player=dict(x=10, y=10, facing="down")))
                base = frame()
                z.call(dict(cmd="follower.set", shiny=True))
                shiny = z.call(dict(cmd="follower.state"))
                assert frame() != base or shiny["sheet"]["path"].startswith("ow/32/owm0001")
                z.call(dict(cmd="follower.set", shiny=False))
                options = z.call(dict(cmd="getField", id="follower.species"))
                print("種族の欄", str(options)[:80])
                for species in range(1, 1600):
                    s = z.call(dict(cmd="follower.set", species=species))
                    if s["sheet"] and s["sheet"]["big"]:
                        break
                assert s["sheet"]["big"], s
                big = frame()
                assert big != base
                print("OK 64×64 の種族", species, s["sheet"]["path"], "も描く")
                if args.shots:
                    folder = pathlib.Path(args.shots); folder.mkdir(parents=True, exist_ok=True)
                    shot = z.call(dict(cmd="screenshot"))
                    (folder / "follower.png").write_bytes(base64.b64decode(shot if isinstance(shot, str) else shot["png"]))
                    (folder / "follower_frame.png").write_bytes(base64.b64decode(z.call(dict(cmd="canvasPng", id="preview.event.frame"))["png"]))
                z.call(dict(cmd="follower.set", enabled=False))
                assert frame() == pixels(base64.b64decode(z.call(dict(cmd="canvasPng", id="preview.event.frame"))["png"]))
            z.call(dict(cmd="preview.player", enabled=False))
            assert not z.call(dict(cmd="follower.state"))["enabled"]
            after = z.call(dict(cmd="state"))
            assert after["dirty"] == before["dirty"] and after["history"] == before["history"]
            print("OK 終えると連れ歩きを捨て、未出力・履歴は前と同じ")
        assert hashlib.sha256(rom.read_bytes()).digest() == rom_hash
        assert project_json() == original_json
        print("OK ROM と maps の JSON は変わらない")


if __name__ == "__main__":
    main()
