"""表示 > 人物の移動範囲と視界（#472）。範囲・視界の計算、人物を動かしたときの追従、選択の強調、終了後の不変。"""
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
    p.add_argument("--non-trainer", choices=["on", "off"], default="off", help="NON_TRAINER_SPOTTING の期待値")
    p.add_argument("--shots")
    args = p.parse_args()
    rom = pathlib.Path(args.rom)
    rom_hash = hashlib.sha256(rom.read_bytes()).digest()

    def project_json():
        folder = pathlib.Path(args.project) / "maps" if args.project else None
        return {str(path.relative_to(folder)): hashlib.sha256(path.read_bytes()).digest() for path in folder.rglob("*.json")} if folder and folder.exists() else {}

    original_json = project_json()
    with tempfile.TemporaryDirectory(prefix="zzm-ranges-", ignore_cleanup_errors=True) as work:
        with Zigzagu(args.exe, profile=pathlib.Path(work) / "profile", extra=["--mute-audio"]) as z:
            z.call(dict(cmd="open", rom=args.rom, **({"project": args.project} if args.project else {})))
            z.call(dict(cmd="selectMap", bank=3, map=0))
            z.call(dict(cmd="tab", name="event"))
            before = z.call(dict(cmd="state"))
            original = z.call(dict(cmd="canvasPng", target="event"))["png"]
            z.call(dict(cmd="menu.run", id="view.npcRanges"))
            state = z.call(dict(cmd="npc.ranges"))
            assert state["enabled"], state
            assert state["rules"]["nonTrainerSpotting"] == (args.non_trainer == "on"), state["rules"]
            assert state["rules"]["cfru"] == bool(args.project)
            print("OK 設定の読み取り", state["rules"])
            # 視界を持つ人物の居るマップを探す（道路の番号の順）。
            found = None
            for number in range(19, 45):
                try:
                    z.call(dict(cmd="selectMap", bank=3, map=number))
                except Exception:
                    continue
                persons = z.call(dict(cmd="npc.ranges"))["persons"]
                spotters = [x for x in persons if x["spotter"]]
                if any(x["spotter"]["kind"] == "trainer" and not x["spotter"]["allDirections"] for x in spotters):
                    found = number
                    break
            assert found is not None, "トレーナーの居るマップが見つからない"
            persons = z.call(dict(cmd="npc.ranges"))["persons"]
            trainer = next(x for x in persons if x["spotter"] and x["spotter"]["kind"] == "trainer" and not x["spotter"]["allDirections"])
            assert len(trainer["rays"]) == 1
            ray = trainer["rays"][0]
            assert len(ray["tiles"]) <= trainer["spotter"]["range"]
            assert len(ray["tiles"]) == trainer["spotter"]["range"] or ray["blocked"] is not None, trainer
            with_range = [x for x in persons if x["range"]]
            print(f"OK 3.{found}: 視界 {len(spotters)} 人（例 {trainer['localId']} の {ray['direction']} 向き {len(ray['tiles'])} マス、遮り {ray['blocked']}）、移動範囲 {len(with_range)} 人")
            shown = pixels(base64.b64decode(z.call(dict(cmd="canvasPng", id="npc.ranges"))["png"]))
            assert shown[0] > 0
            # 人物を動かすと、見回すトレーナーの視界が今の向きに付いてくる。
            z.call(dict(cmd="npc.motion", enabled=True, seed=3))
            z.call(dict(cmd="npc.hold", owner="test", on=True))
            directions = set()
            for _ in range(30):
                z.call(dict(cmd="npc.advance", frames=40))
                motion = {a["localId"]: a for a in z.call(dict(cmd="npc.state"))["actors"]}
                for x in z.call(dict(cmd="npc.ranges"))["persons"]:
                    if x["spotter"] and not x["spotter"]["allDirections"]:
                        assert x["rays"][0]["direction"] == motion[x["localId"]]["facing"], (x, motion[x["localId"]])
                        directions.add((x["localId"], x["rays"][0]["direction"]))
            z.call(dict(cmd="npc.motion", enabled=False))
            print("OK 人物を動かすと視界が今の向きに付いてくる", sorted(directions)[:6])
            # 選んだ人物は強く描く（画像が変わる）。
            index = next(i for i, x in enumerate(persons) if x["localId"] == trainer["localId"])
            z.call(dict(cmd="tab", name="event"))
            if len(persons) > 1:
                z.call(dict(cmd="event.select", kind="person", index=(index + 1) % len(persons)))
            other = z.call(dict(cmd="canvasPng", id="npc.ranges"))["png"]
            z.call(dict(cmd="event.select", kind="person", index=index))
            selected = z.call(dict(cmd="canvasPng", id="npc.ranges"))["png"]
            assert selected != other or len(persons) == 1
            print("OK 選んだ人物の範囲と視界を強く描く")
            if args.shots:
                folder = pathlib.Path(args.shots); folder.mkdir(parents=True, exist_ok=True)
                shot = z.call(dict(cmd="screenshot"))
                (folder / "npc_ranges.png").write_bytes(base64.b64decode(shot if isinstance(shot, str) else shot["png"]))
            z.call(dict(cmd="menu.run", id="view.npcRanges"))
            assert not z.call(dict(cmd="npc.ranges"))["enabled"]
            z.call(dict(cmd="selectMap", bank=3, map=0))
            assert z.call(dict(cmd="canvasPng", target="event"))["png"] == original
            after = z.call(dict(cmd="state"))
            assert after["dirty"] == before["dirty"] and after["history"] == before["history"]
            print("OK 終えると表示・未出力・履歴は前と同じ")
        assert hashlib.sha256(rom.read_bytes()).digest() == rom_hash
        assert project_json() == original_json
        print("OK ROM と maps の JSON は変わらない")


if __name__ == "__main__":
    main()
