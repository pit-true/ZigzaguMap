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
    p.add_argument("--project")
    p.add_argument("--label")
    p.add_argument("--rom-only", action="store_true", help="素の ROM の 3.0 の人物と踏むスクリプトを再生する（#459）。--project を付けると、そのプロジェクトでまだ取り込んでいないイベントとして")
    p.add_argument("--camera", action="store_true")
    p.add_argument("--shots")
    p.add_argument("--editor", action="store_true")
    p.add_argument("--message-label")
    p.add_argument("--message-time")
    p.add_argument("--emotes", action="store_true")
    p.add_argument("--choice-label", help="customchoice か yesno のあるラベル。答えを替えて計算し直す")
    p.add_argument("--start-state", action="store_true", help="男女・向き・居ない人物、マップとセッションの切り替え、タイムラインの位置・拡大・ドラッグ")
    p.add_argument("--unsaved", action="store_true", help="エディタの未保存の本文を再生に使い、保存しない（--editor と一緒に）")
    args = p.parse_args()
    if args.rom_only:
        check_rom_only(args.exe, args.rom, args.shots, args.project)
        return
    if not args.project or not args.label:
        p.error("--project と --label が要ります（--rom-only のときは要りません）")
    project = pathlib.Path(args.project)

    def digest():
        files = [pathlib.Path(args.rom), *project.joinpath("maps").rglob("*.json"), *project.joinpath("assembly").rglob("*.s")]
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
            answered = []
            if args.camera:
                branches = [m["branch"] for m in timeline["markers"] if m["kind"] == "branch" and not m["branch"]["known"]]
                first = [b for b in branches if b["key"].endswith("#1")]
                assert len(first) > 2
                answered.append(first[2]["key"])
                z.call(dict(cmd="playback.answer", key=first[2]["key"], taken=True))
                timeline = z.call(dict(cmd="playback.timeline"))
                second = [m["branch"] for m in timeline["markers"] if m["kind"] == "branch" and not m["branch"]["known"] and m["branch"]["key"].endswith("#2")]
                answered.append(second[0]["key"])
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
            answered_timeline = timeline
            if args.start_state:
                check_layout(z, timeline)
                check_start_state(z, args.label, positions[0])
                z.call(dict(cmd="playback.start", label=args.label))
                for key in answered:
                    z.call(dict(cmd="playback.answer", key=key, taken=True))
                timeline = z.call(dict(cmd="playback.timeline"))
                last = timeline["lastFrame"]
            if args.editor and args.start_state:
                check_two_rows(z, answered_timeline, positions[0])
            if args.editor and args.unsaved:
                check_unsaved(z, args.label, answered_timeline, answered)
                z.call(dict(cmd="playback.start", label=args.label))
                for key in answered:
                    z.call(dict(cmd="playback.answer", key=key, taken=True))
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
            if args.choice_label:
                check_choice(z, args.choice_label, args.shots)
            if args.start_state:
                check_switch(z, args.label, before, args.rom, args.project)
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


def play_to_end(z, timeout=30):
    """4 倍で最後まで再生する（文で止まったら続きを読む）。"""
    z.call(dict(cmd="playback.seek", frame=0))
    z.call(dict(cmd="playback.speed", value=4))
    deadline = time.monotonic() + timeout
    while True:
        state = z.call(dict(cmd="playback.state"))
        if not state["playing"]:
            if state["frame"] >= state["lastFrame"]:
                return state
            z.call(dict(cmd="playback.play"))
        assert time.monotonic() < deadline, state
        time.sleep(0.05)


def check_rom_only(exe, rom, shots, project=None):
    """素の ROM（プロジェクト無し）で、マサラタウンの人物と踏むスクリプトを最後まで再生する。箱は編集できず、読み取り専用の表示を強調する。"""
    digest = hashlib.sha256(pathlib.Path(rom).read_bytes()).digest()
    with tempfile.TemporaryDirectory(prefix="zzm-playback-rom-", ignore_cleanup_errors=True) as work:
        with Zigzagu(exe, profile=pathlib.Path(work) / "profile", extra=["--mute-audio"]) as z:
            # project を渡すと、プロジェクトでまだ取り込んでいない（ROM のアドレスのままの）イベントを、プロジェクトの命令表で再生する
            z.call(dict(cmd="open", rom=rom, project=project) if project else dict(cmd="open", rom=rom))
            z.call(dict(cmd="selectMap", bank=3, map=0))
            z.call(dict(cmd="tab", name="event"))
            before = z.call(dict(cmd="canvasPng", target="event"))["png"]
            played = {"person": 0, "trap": 0}
            moved = 0
            for kind in ("person", "trap"):
                for index in range(16):
                    try:
                        started = z.call(dict(cmd="playback.start", kind=kind, index=index))
                    except AppError as e:
                        if "見つかりません" in str(e) or "プロジェクト" in str(e):
                            continue
                        raise
                    if not started.get("active"):
                        break
                    assert started["entry"].startswith("ROM_"), started["entry"]
                    timeline = z.call(dict(cmd="playback.timeline"))
                    assert not any(m["kind"] == "limit" for m in timeline["markers"]), (kind, index)
                    end = play_to_end(z)
                    assert end["frame"] == timeline["lastFrame"]
                    locks = z.call(dict(cmd="playback.locks"))
                    assert all(lock and ".s に取り込む" in lock for lock in locks), locks
                    if kind == "trap" and len({s["actor"] for s in timeline["segments"]}) > 1:
                        moved += 1
                        # 読み取り専用の表示（逆アセンブルの行）を開いて、今の命令と移動データの値を強調する
                        z.call(dict(cmd="script.rom", bank=3, map=0, kind="trap", index=index))
                        wait_editor(z)
                        segment = timeline["segments"][0]
                        z.call(dict(cmd="playback.seek", frame=segment["start"]))
                        ranges = z.call(dict(cmd="editor.playbackHighlights", window="script-editor"))
                        rom_ranges = [entry for entry in ranges if entry["path"].startswith("ROM:") and entry["ranges"]]
                        assert rom_ranges, ranges
                        text = z.call(dict(cmd="editor.text", path=rom_ranges[0]["path"], window="script-editor"))["text"]
                        marked = [text[r["from"]:r["to"]] for r in rom_ranges[0]["ranges"]]
                        assert any("applymovement" in m for m in marked), marked
                        if shots:
                            folder = pathlib.Path(shots)
                            folder.mkdir(parents=True, exist_ok=True)
                            (folder / "playback_rom.png").write_bytes(base64.b64decode(z.call(dict(cmd="ui.shot", id="playback.bar"))["png"]))
                    played[kind] += 1
                    z.call(dict(cmd="playback.stop"))
            assert played["person"] > 0 and played["trap"] > 0 and moved > 0, (played, moved)
            assert z.call(dict(cmd="canvasPng", target="event"))["png"] == before
            print(f"OK 素の ROM のマサラタウン: 人物 {played['person']} 件、踏むスクリプト {played['trap']} 件を最後まで再生（オーキドの所 {moved} 件）。箱は編集できない印、読み取り専用の表示を強調")
    assert hashlib.sha256(pathlib.Path(rom).read_bytes()).digest() == digest
    print("OK ROM が操作前後で同じ")


def wait_editor(z, timeout=30):
    deadline = time.monotonic() + timeout
    while True:
        try:
            z.call(dict(cmd="editor.state", window="script-editor"))
            return
        except AppError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.2)


def actor_of(state, actor_id):
    return next(a for a in state["actors"] if a["id"] == actor_id)


def check_layout(z, timeline):
    """箱の位置と幅がフレーム数どおり、拡大で並び直す、目盛りのドラッグで飛ぶ。"""
    def verify(layout):
        scale, labels = layout["scale"], layout["labels"]
        assert len(layout["segments"]) == len(timeline["segments"]), layout
        for box in layout["segments"]:
            assert abs(box["left"] - (labels + box["start"] * scale)) < 0.01, box
            assert abs(box["width"] - max(2, (box["end"] - box["start"] + 1) * scale)) < 0.01, box
        rows = {}
        for box in layout["segments"]:
            rows.setdefault(box["actor"], set()).add(box["top"])
        assert all(len(tops) == 1 for tops in rows.values()), rows
        assert len({next(iter(t)) for t in rows.values()}) == len(rows), rows
        for marker in layout["markers"]:
            assert abs(marker["left"] - (labels + marker["frame"] * scale)) < 0.01, marker
        assert len({m["top"] for m in layout["markers"]}) <= 3
        for b in layout["markers"]:
            if b["top"] >= 46:
                continue  # 3 段目はあふれた印を重ねる
            same_lane = [m for m in layout["markers"] if m["top"] == b["top"] and m["left"] <= b["left"] and m is not b]
            assert not same_lane or max(m["left"] + m["width"] for m in same_lane) <= b["left"] + 1, (same_lane[-1], b)
        return layout
    z.call(dict(cmd="playback.seek", frame=0))
    first = verify(z.call(dict(cmd="playback.layout")))
    zoomed = verify(z.call(dict(cmd="playback.wheel", delta=-100, x=300)))
    assert abs(zoomed["scale"] - first["scale"] * 1.25) < 1e-6, (first["scale"], zoomed["scale"])
    out = verify(z.call(dict(cmd="playback.wheel", delta=100, x=300)))
    assert abs(out["scale"] - first["scale"]) < 1e-6
    target = min(40, timeline["lastFrame"])
    scale, labels = out["scale"], out["labels"]
    x0 = labels + 4 * scale - out["scrollLeft"]
    x1 = labels + target * scale - out["scrollLeft"]
    z.call(dict(cmd="mouse", id="playback.axis", action="drag", px=[x0, 6], toPx=[x1, 6], steps=4))
    state = z.call(dict(cmd="playback.state"))
    assert state["frame"] == target and not state["playing"], state
    layout = z.call(dict(cmd="playback.layout"))
    assert abs(layout["cursor"] - (labels + target * scale)) < 0.01
    active = [b for b in layout["segments"] if b["active"]]
    assert all(b["start"] <= target <= b["end"] for b in active)
    assert len(active) == sum(1 for seg in timeline["segments"] if seg["start"] <= target <= seg["end"])
    print(f"OK タイムラインの箱 {len(first['segments'])} 個（{len({b['actor'] for b in first['segments']})} 行）の位置と幅、拡大縮小、目盛りのドラッグで {target} フレームへ")


def check_two_rows(z, timeline, initial):
    """2 人が同時に動くラベルをエディタの未保存の本文に足し、2 行の箱の位置と幅を確かめる。ファイルは書かない。"""
    path = timeline["segments"][0]["command"]["path"]
    person = next(a["id"] for a in initial["actors"] if a["id"] not in (0xFF, 0x7F))
    z.call(dict(cmd="script.open", path=path))
    z.call(dict(cmd="editor.activate", path=path, window="script-editor"))
    text = z.call(dict(cmd="editor.text", path=path, window="script-editor"))["text"]
    added = "".join(line + "\n" for line in [
        "", "ZzmPlaybackTwoRows:",
        "\tapplymovement 0xFF ZzmPlaybackTwoRows_Player",
        f"\tapplymovement {person} ZzmPlaybackTwoRows_Person",
        "\twaitmovement 0", "\tend",
        "ZzmPlaybackTwoRows_Player:", "\t.byte walk_up, walk_up, walk_left, end_m",
        "ZzmPlaybackTwoRows_Person:", "\t.byte walk_down, walk_right, end_m",
    ])
    z.call(dict(cmd="editor.setText", text=text + added, window="script-editor"))
    z.call(dict(cmd="playback.start", label="ZzmPlaybackTwoRows"))
    two = z.call(dict(cmd="playback.timeline"))
    actors = sorted({seg["actor"] for seg in two["segments"]})
    assert actors == sorted([person, 0xFF]), actors
    assert [seg["start"] for seg in two["segments"] if seg["actor"] == person] == [seg["start"] for seg in two["segments"] if seg["actor"] == 0xFF][:2]
    check_layout(z, two)
    z.call(dict(cmd="playback.stop"))
    z.call(dict(cmd="editor.setText", text=text, window="script-editor"))
    print(f"OK 2 人（主人公と人物 {person}）が同時に動く行の箱が、同じフレームの位置に並ぶ")


def check_start_state(z, label, initial):
    """男女・1コマ目の向き・居ない人物を帯で変えると計算し直す。男女は個人設定に残る。"""
    player = actor_of(initial, 0xFF)
    z.call(dict(cmd="playback.seek", frame=0))
    z.call(dict(cmd="setField", id="playback.gender", value="女の子"))
    female = actor_of(z.call(dict(cmd="playback.state")), 0xFF)
    assert female["graphicsId"] == 7 and player["graphicsId"] == 0, (player, female)
    facing = "left" if player["facing"] != "left" else "right"
    z.call(dict(cmd="setField", id="playback.facing", value=["down", "up", "left", "right"].index(facing)))
    turned = z.call(dict(cmd="playback.state"))
    assert z.call(dict(cmd="getField", id="playback.facing"))["value"] in ("左", "右")
    moving = any(seg["actor"] == 0xFF and seg["start"] == 0 for seg in z.call(dict(cmd="playback.timeline"))["segments"])
    # 1 コマ目から主人公が動くラベルでは、向きは移動の命令で決まる。
    assert moving or actor_of(turned, 0xFF)["facing"] == facing, actor_of(turned, 0xFF)
    people = [a["id"] for a in initial["actors"] if a["id"] not in (0xFF, 0x7F)]
    if people:
        z.call(dict(cmd="setField", id=f"playback.absent.{people[0]}", value=True))
        absent = actor_of(z.call(dict(cmd="playback.state")), people[0])
        assert not absent["present"] and not absent["visible"], absent
    z.call(dict(cmd="playback.stop"))
    again = z.call(dict(cmd="playback.start", label=label))
    assert actor_of(again, 0xFF)["graphicsId"] == 7
    assert z.call(dict(cmd="getField", id="playback.gender"))["value"] == "女の子"
    z.call(dict(cmd="setField", id="playback.gender", value="男の子"))
    assert actor_of(z.call(dict(cmd="playback.state")), 0xFF)["graphicsId"] == 0
    z.call(dict(cmd="playback.stop"))
    print(f"OK 男女（個人設定に残る）・主人公の向き・居ない人物 {people[:1]} で計算し直す")


def check_unsaved(z, label, timeline, answered):
    """エディタの未保存の本文を使い、ファイルは書かない。"""
    walks = {"walk_up": "walk_down", "walk_down": "walk_up", "walk_left": "walk_right", "walk_right": "walk_left"}
    edited = [s for s in timeline["segments"] if s["step"] and s["movementPath"]]
    segment = next((s for s in edited if s["step"]["text"] in walks), edited[0])
    path, step = segment["movementPath"], segment["step"]
    swap = walks.get(step["text"], "walk_down")
    z.call(dict(cmd="script.open", path=path))
    z.call(dict(cmd="editor.activate", path=path, window="script-editor"))
    text = z.call(dict(cmd="editor.text", path=path, window="script-editor"))["text"]
    lines = text.split("\n")
    line = lines[step["line"]]
    assert line[step["start"]:step["end"]] == step["text"], (line, step)
    lines[step["line"]] = line[:step["start"]] + swap + line[step["end"]:]
    z.call(dict(cmd="editor.setText", text="\n".join(lines), window="script-editor"))
    z.call(dict(cmd="playback.start", label=label))
    for key in answered:
        z.call(dict(cmd="playback.answer", key=key, taken=True))
    changed = z.call(dict(cmd="playback.timeline"))
    same = next(s for s in changed["segments"] if s["actor"] == segment["actor"] and s["start"] == segment["start"])
    assert same["step"]["text"] == swap, same
    if step["text"] in walks:
        moved = (segment["toX"] - segment["fromX"], segment["toY"] - segment["fromY"])
        assert (same["toX"] - same["fromX"], same["toY"] - same["fromY"]) == (-moved[0], -moved[1]), (segment, same)
    z.call(dict(cmd="playback.stop"))
    z.call(dict(cmd="editor.setText", text=text, window="script-editor"))
    print(f"OK エディタの未保存の本文（{step['text']} → {swap}）で再生し、ファイルは書かない")


def check_choice(z, label, shots):
    """選択肢の既定の答え、帯の欄で選び直す、今のフレームを保つ、タイムラインの印に答え。"""
    z.call(dict(cmd="playback.start", label=label))
    timeline = z.call(dict(cmd="playback.timeline"))
    index, marker = next((i, m) for i, m in enumerate(timeline["markers"]) if m.get("choice"))
    choice = marker["choice"]
    assert choice["defaulted"], choice
    z.call(dict(cmd="playback.seek", frame=marker["frame"]))
    field = z.call(dict(cmd="getField", id=f"playback.choice.{index}"))
    assert field["visible"], field
    layout = z.call(dict(cmd="playback.layout"))
    assert ":" in layout["markers"][index]["text"], layout["markers"][index]
    other = next(o["value"] for o in choice["options"] if o["value"] != choice["value"]) if choice["options"] else choice["value"] + 1
    branches_before = [m["branch"]["taken"] for m in timeline["markers"] if m.get("branch")]
    if choice["options"]:
        z.call(dict(cmd="setField", id=f"playback.choice.{index}", value=[o["value"] for o in choice["options"]].index(other)))
    else:
        z.call(dict(cmd="setField", id=f"playback.choice.{index}", value=str(other)))
    state = z.call(dict(cmd="playback.state"))
    assert state["frame"] == marker["frame"], state
    changed = z.call(dict(cmd="playback.timeline"))
    picked = next(m for m in changed["markers"] if m.get("choice") and m["choice"]["key"] == choice["key"])["choice"]
    assert picked["value"] == other and not picked["defaulted"], picked
    branches_after = [m["branch"]["taken"] for m in changed["markers"] if m.get("branch")]
    assert branches_after != branches_before, (branches_before, branches_after)
    if shots:
        pathlib.Path(shots).mkdir(parents=True, exist_ok=True)
        shot = z.call(dict(cmd="ui.shot", id="playback.bar"))
        (pathlib.Path(shots) / "playback_choice.png").write_bytes(base64.b64decode(shot["png"]))
    back = z.call(dict(cmd="playback.choose", key=choice["key"], value=choice["value"]))
    assert back["frame"] == marker["frame"]
    again = z.call(dict(cmd="playback.timeline"))
    assert [m["branch"]["taken"] for m in again["markers"] if m.get("branch")] == branches_before
    try:
        z.call(dict(cmd="playback.choose", key="choice:none#0", value=0))
        raise AssertionError("無い選択肢を受け付けた")
    except AppError:
        pass
    z.call(dict(cmd="playback.stop"))
    print(f"OK 選択肢（{choice['kind']}）の既定 {choice['value']} → {other} で分岐が変わり、フレームを保つ")


def check_switch(z, label, before, rom, project):
    """再生中のマップ・セッションの切り替えで終了し、元のマップの絵へ戻る。"""
    z.call(dict(cmd="playback.start", label=label))
    z.call(dict(cmd="playback.seek", frame=1))
    z.call(dict(cmd="selectMap", bank=3, map=1))
    assert z.call(dict(cmd="playback.state")) == {"active": False}
    z.call(dict(cmd="selectMap", bank=3, map=0))
    assert z.call(dict(cmd="canvasPng", target="event"))["png"] == before
    z.call(dict(cmd="playback.start", label=label))
    z.call(dict(cmd="open", rom=rom, project=project))
    assert z.call(dict(cmd="playback.state")) == {"active": False}
    z.call(dict(cmd="selectMap", bank=3, map=0))
    z.call(dict(cmd="tab", name="event"))
    assert z.call(dict(cmd="canvasPng", target="event"))["png"] == before
    print("OK 再生中のマップ・セッションの切り替えで終了し、イベントの絵が元に戻る")


if __name__ == "__main__":
    main()
