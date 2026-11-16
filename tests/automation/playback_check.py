"""写しのプロジェクトで再生・巻き戻し・終了後の復元を確認する。"""
from __future__ import annotations

import argparse
import base64
import hashlib
import pathlib
import tempfile
import time

from zz import AppError, Zigzagu


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--exe", required=True)
    p.add_argument("--rom", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--camera", action="store_true")
    p.add_argument("--shots")
    p.add_argument("--editor", action="store_true")
    p.add_argument("--message-label")
    p.add_argument("--message-time")
    p.add_argument("--emotes", action="store_true")
    args = p.parse_args()
    project = pathlib.Path(args.project)

    def digest():
        files = [pathlib.Path(args.rom), *project.joinpath("maps").rglob("*.json")]
        return {str(path): hashlib.sha256(path.read_bytes()).digest() for path in files}

    before_files = digest()
    with tempfile.TemporaryDirectory(prefix="zzm-playback-", ignore_cleanup_errors=True) as work:
        with Zigzagu(args.exe, profile=pathlib.Path(work) / "profile", extra=["--mute-audio"]) as z:
            z.call(dict(cmd="open", rom=args.rom, project=args.project))
            z.call(dict(cmd="selectMap", bank=3, map=0))
            z.call(dict(cmd="tab", name="event"))
            before = z.call(dict(cmd="canvasPng", target="event"))["png"]
            settings = z.call(dict(cmd="view.aids"))
            started = z.call(dict(cmd="playback.start", label=args.label))
            assert started["active"] and started["frame"] == 0
            timeline = z.call(dict(cmd="playback.timeline"))
            if args.camera:
                branches = [m["branch"] for m in timeline["markers"] if m["kind"] == "branch" and not m["branch"]["known"]]
                first = [b for b in branches if b["key"].endswith("#1")]
                assert len(first) > 2
                z.call(dict(cmd="playback.answer", key=first[2]["key"], taken=True))
                timeline = z.call(dict(cmd="playback.timeline"))
                second = [m["branch"] for m in timeline["markers"] if m["kind"] == "branch" and not m["branch"]["known"] and m["branch"]["key"].endswith("#2")]
                z.call(dict(cmd="playback.answer", key=second[0]["key"], taken=True))
                timeline = z.call(dict(cmd="playback.timeline"))
                camera = [s for s in timeline["segments"] if s["actor"] == 0x7f]
                assert len(camera) == 2 and camera[0]["toY"] == camera[0]["fromY"] - 1
                assert camera[1]["toY"] == camera[0]["fromY"]
                print("OK NDのカメラが1マス動いて戻る")
            assert timeline["segments"] and timeline["lastFrame"] > 0
            last = timeline["lastFrame"]
            positions = {}
            for frame in sorted(set([0, last // 2, last])):
                positions[frame] = z.call(dict(cmd="playback.seek", frame=frame))
            for frame in reversed(positions):
                assert z.call(dict(cmd="playback.seek", frame=frame)) == positions[frame]
            print("OK コマと人物の状態は逆順に参照しても同じ")
            z.call(dict(cmd="playback.seek", frame=0))
            next_state = z.call(dict(cmd="playback.step", direction="next"))
            assert next_state["frame"] == next(f for f in timeline["keyFrames"] if f > 0)
            back = z.call(dict(cmd="playback.step", direction="previous"))
            assert back["frame"] == 0
            one = z.call(dict(cmd="playback.step", direction="next", singleFrame=True))
            assert one["frame"] == 1
            for speed in [0.25, 4]:
                z.call(dict(cmd="playback.speed", value=speed))
                end = z.call(dict(cmd="playback.seek", frame=last))
                assert end["actors"] == positions[last]["actors"]
                z.call(dict(cmd="playback.seek", frame=0))
                z.call(dict(cmd="playback.play"))
                deadline = time.monotonic() + 10
                while True:
                    end = z.call(dict(cmd="playback.state"))
                    if not end["playing"]:
                        break
                    assert time.monotonic() < deadline, end
                    time.sleep(0.03)
                assert end["frame"] == last and end["actors"] == positions[last]["actors"]
            z.call(dict(cmd="playback.seek", frame=0))
            z.call(dict(cmd="key", id="playback.bar", key="ArrowRight"))
            assert z.call(dict(cmd="playback.state"))["frame"] == next(f for f in timeline["keyFrames"] if f > 0)
            z.call(dict(cmd="key", id="playback.bar", key="Home"))
            z.call(dict(cmd="key", id="playback.bar", key="ArrowRight", shift=True))
            assert z.call(dict(cmd="playback.state"))["frame"] == 1
            z.call(dict(cmd="playback.seek", frame=last))
            print("OK コマ送り・戻し・1フレーム送り・速度変更")
            if args.editor:
                segment = timeline["segments"][0]
                paths = set([segment["command"]["path"], segment["movementPath"]]) - {None}
                for path in paths:
                    z.call(dict(cmd="script.open", path=path))
                deadline = time.monotonic() + 20
                while True:
                    try:
                        z.call(dict(cmd="editor.state", window="script-editor"))
                        break
                    except AppError:
                        if time.monotonic() >= deadline:
                            raise
                        time.sleep(0.1)
                z.call(dict(cmd="playback.seek", frame=last))
                z.call(dict(cmd="playback.seek", frame=segment["start"]))
                ranges = z.call(dict(cmd="editor.playbackHighlights", window="script-editor"))
                marked = []
                for entry in ranges:
                    text = z.call(dict(cmd="editor.text", path=entry["path"], window="script-editor"))["text"]
                    # 対象のスクリプトはASCIIの命令・ラベル。UTF-16位置で切り出す。
                    raw = text.encode("utf-16-le")
                    marked.extend(raw[r["from"] * 2:r["to"] * 2].decode("utf-16-le") for r in entry["ranges"])
                assert any("applymovement" in value for value in marked), marked
                assert segment["step"]["text"] in marked, marked
                print("OK エディタのapplymovement行と移動データの値を強調")
            if args.shots:
                folder = pathlib.Path(args.shots)
                folder.mkdir(parents=True, exist_ok=True)
                shot = z.call(dict(cmd="ui.shot", id="playback.bar"))
                (folder / "playback_bar.png").write_bytes(base64.b64decode(shot["png"]))
            z.call(dict(cmd="playback.stop"))
            assert z.call(dict(cmd="playback.state")) == {"active": False}
            assert z.call(dict(cmd="view.aids")) == settings
            assert z.call(dict(cmd="canvasPng", target="event"))["png"] == before
            if args.editor:
                assert all(not entry["ranges"] for entry in z.call(dict(cmd="editor.playbackHighlights", window="script-editor")))
            print("OK 終了後のイベントの絵と表示設定を復元")
            if args.message_label:
                original_time = z.call(dict(cmd="view.timeOfDay"))["time"]
                message = z.call(dict(cmd="playback.start", label=args.message_label))
                assert message["active"] and not message["playing"]
                field = z.call(dict(cmd="getField", id="playback.message"))
                assert field["visible"] and field["value"] and "\\n" not in field["value"]
                # 枠を読み込めたときは、ROMから描いたCanvasも取得できる。
                assert z.call(dict(cmd="canvasPng", id="playback.message"))["png"]
                if args.message_time:
                    assert z.call(dict(cmd="view.timeOfDay"))["time"] == args.message_time
                if args.shots:
                    shot = z.call(dict(cmd="ui.shot", id="playback.message"))
                    (pathlib.Path(args.shots) / "playback_message.png").write_bytes(base64.b64decode(shot["png"]))
                z.call(dict(cmd="playback.stop"))
                assert z.call(dict(cmd="view.timeOfDay"))["time"] == original_time
                assert z.call(dict(cmd="canvasPng", target="event"))["png"] == before
                print("OK メッセージ本文、改行、ROMの枠と色を表示")
            if args.emotes:
                actor = next(actor for actor in positions[0]["actors"] if actor["id"] == 0xff).copy()
                actor.update(tileX=10, tileY=10, pixelX=160, pixelY=160, graphicsId=0, height=0, present=True, visible=True, mark=None)
                def scene(mark=None):
                    return z.call(dict(cmd="actors.scene", x=80, y=80, actors=[dict(actor, mark=mark)]))
                plain = scene()
                assert not plain["missing"]
                names = ["exclaim", "question", "cross", "doubleExclaim", "smile"]
                names += ["emote_" + name for name in ["exclaim", "question", "ellipsis", "double_exclaim", "music", "mon_exclaim", "mon_question", "mon_ellipsis", "mon_music", "mon_heart", "mon_poison", "mon_happy", "mon_very_happy", "mon_sad", "mon_upset", "mon_angry"]]
                for name in names:
                    marked = scene(dict(mark=name, frame=8))
                    assert not marked["missing"], (name, marked["missing"])
                    assert marked["png"] != plain["png"], name
                original_time = z.call(dict(cmd="view.timeOfDay"))["time"]
                z.call(dict(cmd="view.timeOfDay", time="night"))
                assert not scene(dict(mark="emote_mon_heart", frame=24))["missing"]
                z.call(dict(cmd="view.timeOfDay", time=original_time))
                print("OK 通常の印5種と追加の感情アイコン16種、夜の描画")
    assert digest() == before_files
    print("OK ROMとプロジェクトのJSONが操作前後で同じ")


if __name__ == "__main__":
    main()
