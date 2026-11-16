"""仮の主人公を動かし、踏む・話しかけるスクリプトの再生を確かめる（#457）。

プロジェクトの写しを作業フォルダに作り（元のフォルダには書かない）、3.0 にひな形で人物・看板・踏むスクリプトを置いてから、
仮の主人公を置く・歩く・踏む・話しかける。出力したマップのファイルが、仮の主人公を置く前と同じことも確かめる。

    python tests/automation/playback_player_check.py --exe <zigzagumap.exe> --rom <BPRJ.gba> --project <ND の写し> --work <作業フォルダ>
"""
from __future__ import annotations

import argparse
import hashlib
import pathlib
import shutil
import tempfile

from zz import Zigzagu

COPY_DIRS = ["assembly", "strings", "maps"]
COPY_FILES = ["xse_commands.s", "xse_defines.s", "asm_defines.s", "eventscripts", "charmap.tbl", "zigzagumap.json", "BPRJ.ld"]
SCRIPT = "assembly/overworld_scripts/zz_player.s"


def prepare(src: pathlib.Path, work: pathlib.Path) -> pathlib.Path:
    src, work = src.resolve(), work.resolve()
    if work == src or src in work.parents:
        raise SystemExit(f"作業フォルダが元のフォルダの中です: {work}")
    dst = work / "project"
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    for d in COPY_DIRS:
        if (src / d).is_dir():
            shutil.copytree(src / d, dst / d)
    for f in COPY_FILES:
        if (src / f).is_file():
            shutil.copy2(src / f, dst / f)
    for f in (dst / "assembly/overworld_scripts").glob("zz_*.s"):
        f.unlink()
    return dst


def digest(project: pathlib.Path) -> dict[str, bytes]:
    return {str(p.relative_to(project)): hashlib.sha256(p.read_bytes()).digest() for p in sorted(project.joinpath("maps").rglob("*")) if p.is_file()}


def player_actor(state):
    return next(a for a in state["actors"] if a["id"] == 0xFF)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", required=True)
    ap.add_argument("--rom", required=True)
    ap.add_argument("--project", required=True)
    ap.add_argument("--work", required=True)
    a = ap.parse_args()
    project = prepare(pathlib.Path(a.project), pathlib.Path(a.work))
    rom_before = hashlib.sha256(pathlib.Path(a.rom).read_bytes()).digest()
    with tempfile.TemporaryDirectory(prefix="zzm-player-", ignore_cleanup_errors=True) as tmp:
        with Zigzagu(a.exe, profile=pathlib.Path(tmp) / "profile", extra=["--mute-audio"]) as z:
            z.call(dict(cmd="open", rom=a.rom, project=str(project)))
            z.call(dict(cmd="selectMap", bank=3, map=0))
            z.call(dict(cmd="tab", name="event"))
            z.call(dict(cmd="scripts.table", action="add", entry=dict(bank=3, map=0, name="zz", script=SCRIPT), create=True))
            person = z.call(dict(cmd="template.place", kind="person", x=12, y=12), timeout=60)
            sign = z.call(dict(cmd="template.place", kind="sign", x=14, y=12), timeout=60)
            trap = z.call(dict(cmd="template.place", kind="tile", x=10, y=14), timeout=60)
            z.call(dict(cmd="script.settle"))
            assert person["label"] and sign["label"] and trap["label"], (person, sign, trap)
            z.call(dict(cmd="export"), timeout=300)
            exported = digest(project)

            # イベントタブの右クリック「ここに仮の主人公を置く」（イベントの無いマスと、イベントの上）
            z.call(dict(cmd="mouse", target="event", cell=[3, 3], action="rightClick"))
            z.call(dict(cmd="contextMenu.press", id="placePlayer"))
            menu = z.call(dict(cmd="preview.player"))
            assert menu["enabled"] and (menu["player"]["x"], menu["player"]["y"]) == (3, 3), menu
            z.call(dict(cmd="mouse", target="event", cell=[12, 12], action="rightClick"))
            z.call(dict(cmd="contextMenu.press", id="placePlayer"))
            assert (z.call(dict(cmd="preview.player"))["player"]["x"], z.call(dict(cmd="preview.player"))["player"]["y"]) == (12, 12)
            print("OK 右クリックの「ここに仮の主人公を置く」")

            # 置くだけ（ドラッグ・置き直し）では踏むスクリプトを始めない
            placed = z.call(dict(cmd="playback.player.place", x=10, y=14, facing="down", gender="female"))
            assert placed["player"] == {"x": 10, "y": 14, "facing": "down", "gender": "female"}, placed
            assert z.call(dict(cmd="playback.state")) == {"active": False}
            print("OK 置いただけでは踏むスクリプトを始めない")

            # 歩いて踏む: 自動で再生し、終えると踏んだマスと向きに戻る
            z.call(dict(cmd="playback.player.place", x=9, y=14, facing="down"))
            moved = z.call(dict(cmd="playback.player.move", direction="right"))
            play = moved["playback"]
            assert play["active"] and play["trigger"] == {"kind": "trap", "index": trap["event"]["index"]}, play
            assert play["entry"] == trap["label"], (play["entry"], trap["label"])
            assert play["playing"] or play["frame"] == 0, play
            start = z.call(dict(cmd="playback.seek", frame=0))
            assert (player_actor(start)["tileX"], player_actor(start)["tileY"], player_actor(start)["facing"]) == (10, 14, "right"), player_actor(start)
            assert player_actor(start)["graphicsId"] == 7
            condition = z.call(dict(cmd="getField", id="playback.condition"))
            assert condition["visible"] and "0x" in condition["value"], condition
            z.call(dict(cmd="playback.stop"))
            back = z.call(dict(cmd="preview.player"))
            assert back["enabled"] and back["player"] == {"x": 10, "y": 14, "facing": "right", "gender": "female"}, back
            print("OK 歩いて踏むと再生が始まり（条件を帯に出す）、終えると踏んだ位置と向きに戻る")

            # 話しかける: 人物（下から上を向いて）
            z.call(dict(cmd="playback.player.place", x=12, y=13, facing="up"))
            talked = z.call(dict(cmd="playback.player.talk"))["playback"]
            assert talked["active"] and talked["trigger"]["kind"] == "person" and talked["entry"] == person["label"], talked
            first = z.call(dict(cmd="playback.seek", frame=0))
            assert (player_actor(first)["tileX"], player_actor(first)["tileY"], player_actor(first)["facing"]) == (12, 13, "up")
            z.call(dict(cmd="playback.stop"))
            # 看板（左から右を向いて）
            z.call(dict(cmd="playback.player.place", x=13, y=12, facing="right"))
            read = z.call(dict(cmd="playback.player.talk"))["playback"]
            assert read["active"] and read["trigger"] == {"kind": "sign", "index": sign["event"]["index"]} and read["entry"] == sign["label"], read
            z.call(dict(cmd="playback.stop"))
            assert z.call(dict(cmd="preview.player"))["player"]["x"] == 13
            # 向いた先に何も無い
            z.call(dict(cmd="playback.player.place", x=1, y=1, facing="up"))
            none = z.call(dict(cmd="playback.player.talk"))
            assert not none["playback"]["active"] and "ありません" in none["status"]["left"], none
            print("OK 人物・看板に話しかけて、今の位置と向きから再生。何も無ければ知らせる")

            # 歩きの途中の絵（16 フレームで 1 マス）。移動の途中で保存しないことも合わせて確かめる
            z.call(dict(cmd="playback.player.place", x=5, y=5, facing="down"))
            walked = z.call(dict(cmd="playback.player.move", direction="down"))
            assert walked["player"] == {"x": 5, "y": 6, "facing": "down", "gender": "female"} and not walked["playback"]["active"], walked
            z.call(dict(cmd="export"), timeout=300)
            assert digest(project) == exported
            z.call(dict(cmd="preview.player", enabled=False))
            print("OK 仮の主人公を置いて歩かせたまま出力しても、maps のファイルは変わらない")
    assert hashlib.sha256(pathlib.Path(a.rom).read_bytes()).digest() == rom_before
    print("OK ROM は変わらない")


if __name__ == "__main__":
    main()
