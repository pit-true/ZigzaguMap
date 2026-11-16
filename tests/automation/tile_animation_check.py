"""タイルアニメとドアの開け閉め（#473・#474）。既定はオフで、止めると元の絵に戻る。ROM と maps の JSON は変えない。"""
from __future__ import annotations

import argparse
import base64
import hashlib
import pathlib
import tempfile

from phase4_view_check import pixels
from zz import Zigzagu

# 素の BPRJ で、副タイルセットにアニメを持つマップの候補（噴水 2 種・火山の煙・クチバジム・タマムシジム）。
# 同じタイルセットでも動くタイルを置いていないマップがあるので、候補のどれかで絵が変われば合格。
SECONDARY_MAPS = (
    ((3, 6), (3, 25), (3, 34)),
    tuple((1, n) for n in range(42, 59)),
    tuple((1, n) for n in (96, 98, 99, 100, 102, 103, 104, 105, 106, 107, 108)),
    ((9, 6),),
    ((10, 16),),
)


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
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="zzm-tileanim-", ignore_cleanup_errors=True) as work:
        with Zigzagu(args.exe, profile=pathlib.Path(work) / "profile", extra=["--mute-audio"]) as z:
            z.call(dict(cmd="open", rom=args.rom, **({"project": args.project} if args.project else {})))
            z.call(dict(cmd="selectMap", bank=3, map=0))
            z.call(dict(cmd="tab", name="event"))
            before = z.call(dict(cmd="state"))
            original_map = z.call(dict(cmd="canvasPng", target="event"))["png"]
            width, height = before["map"]["width"] * 16, before["map"]["height"] * 16

            def scene(frame=None, x=0, y=0, w=width, h=height):
                req = dict(cmd="tileAnim.scene", x=x, y=y, width=w, height=h)
                if frame is not None:
                    req["frame"] = frame
                result = z.call(req)
                assert result["unknownBlocks"] == [], result["unknownBlocks"]
                return pixels(base64.b64decode(result["png"])), result

            info = z.call(dict(cmd="tileAnim.info"))
            assert not info["enabled"] and info["frame"] is None
            names = [t["name"] for t in info["primary"]["tracks"]]
            assert info["primary"]["reason"] is None and info["primary"]["counterMax"] == 640, info
            assert names == ["bg_sea2_anime", "bg_sea_anime", "bg_hana_anime"], names
            still, _ = scene()
            assert z.call(dict(cmd="tileAnim.info"))["frame"] is None
            print("OK マサラタウンの主タイルセットの海・荒海・花を ROM から読み、既定はオフ")

            frame0, result = scene(0)
            assert frame0 == still and all(s["frame"] is None for s in result["shown"]), result["shown"]
            sea1, result = scene(17)
            shown = {s["name"]: s["frame"] for s in result["shown"]}
            assert shown == {"bg_sea2_anime": 2, "bg_sea_anime": 1, "bg_hana_anime": 0}, shown
            assert sea1 != still
            sea2, _ = scene(33)
            assert sea2 != sea1
            again, _ = scene(17)
            assert again == sea1
            print("OK フレームを渡すと海と花が変わり、同じフレームは同じ絵")

            z.call(dict(cmd="menu.run", id="view.previewPlayer"))
            z.call(dict(cmd="preview.player", player=dict(x=10, y=14)))

            def frame():
                return pixels(base64.b64decode(z.call(dict(cmd="canvasPng", id="preview.event.frame"))["png"]))

            z.call(dict(cmd="tileAnim.frame", frame=None))
            preview_still = frame()
            z.call(dict(cmd="tileAnim.frame", frame=17))
            preview_anim = frame()
            assert preview_anim != preview_still
            if shots:
                (shots / "tile_anim_preview.png").write_bytes(base64.b64decode(z.call(dict(cmd="canvasPng", id="preview.event.frame"))["png"]))
            assert z.call(dict(cmd="canvasPng", target="event"))["png"] == original_map
            print("OK 仮の主人公の 240×160 の絵にも同じフレームを当て、ふつうのマップ表示は変えない")

            if args.project:
                z.call(dict(cmd="view.timeOfDay", time="night"))
                night_anim = frame()
                assert night_anim != preview_anim
                z.call(dict(cmd="tileAnim.frame", frame=None))
                night_still = frame()
                assert night_still != night_anim
                z.call(dict(cmd="view.timeOfDay", time="day"))
                z.call(dict(cmd="tileAnim.frame", frame=17))
                assert frame() == preview_anim
                print("OK 夜の色でもアニメの絵が変わり、昼に戻すと同じ絵")

            z.call(dict(cmd="tileAnim.frame", frame=None))
            assert frame() == preview_still
            assert not z.call(dict(cmd="tileAnim.info"))["enabled"]
            print("OK 止めると元の絵に戻る")

            # ドア。マサラタウンの 1 マスのドアを開けて閉める。
            doors = z.call(dict(cmd="door.list"))["doors"]
            assert doors and not any(d["tall"] for d in doors), doors
            door = doors[0]
            x, y = door["x"], door["y"]
            info_door = z.call(dict(cmd="door.info", x=x, y=y))
            assert info_door["reason"] is None and info_door["tall"] is False
            assert z.call(dict(cmd="door.info", x=0, y=0))["reason"] == "behavior"
            cell = dict(x=x * 16, y=y * 16, w=16, h=16)
            closed_cell, _ = scene(99, **cell)
            run = z.call(dict(cmd="door.run", kind="open", x=x, y=y, frame=100))
            assert run == dict(ok=True, reason=None, lastFrame=119), run
            cells = []
            for f in (100, 104, 105, 110, 115, 119, 125):
                cells.append(scene(f, **cell)[0])
            assert cells[0] == closed_cell and cells[1] == closed_cell
            assert cells[2] != closed_cell and cells[3] != cells[2] and cells[4] != cells[3]
            assert cells[5] == cells[4] and cells[6] == cells[4]
            assert z.call(dict(cmd="door.state", frame=118))["task"]["lastFrame"] == 119
            assert z.call(dict(cmd="door.state", frame=119))["task"] is None
            assert z.call(dict(cmd="door.wait", frame=100))["resume"] == 120
            busy = z.call(dict(cmd="door.run", kind="close", x=x, y=y, frame=110))
            assert busy["ok"] is False and busy["reason"] == "busy", busy
            z.call(dict(cmd="door.clear"))
            z.call(dict(cmd="door.run", kind="open", x=x, y=y, frame=100))
            closing = z.call(dict(cmd="door.run", kind="close", x=x, y=y, frame=120))
            assert closing == dict(ok=True, reason=None, lastFrame=139), closing
            assert scene(120, **cell)[0] == cells[4]
            assert scene(125, **cell)[0] == cells[3]
            assert scene(139, **cell)[0] == closed_cell
            if shots:
                result = z.call(dict(cmd="tileAnim.scene", frame=112, x=x * 16 - 112, y=y * 16 - 72, width=240, height=160))
                (shots / "door_open.png").write_bytes(base64.b64decode(result["png"]))
            print("OK 1 マスのドアは元の絵・3 コマを 5 フレームずつ、20 フレームで閉じる。動いている間の命令は受け付けない")
            z.call(dict(cmd="tileAnim.frame", frame=None))
            assert z.call(dict(cmd="door.state"))["cells"] == []
            assert frame() == preview_still
            check_clock(z, frame, preview_still)
            if args.project:
                check_playback_doors(z, x, y, scene, shots, args.project)

            z.call(dict(cmd="click", id="preview.stop"))
            assert z.call(dict(cmd="canvasPng", target="event"))["png"] == original_map

            for candidates in SECONDARY_MAPS:
                moved = None
                for bank, number in candidates:
                    z.call(dict(cmd="selectMap", bank=bank, map=number))
                    info = z.call(dict(cmd="tileAnim.info"))
                    assert info["secondary"]["reason"] is None and len(info["secondary"]["tracks"]) == 1, (bank, number, info)
                    track = info["secondary"]["tracks"][0]
                    m = z.call(dict(cmd="state"))["map"]
                    w, h = m["width"] * 16, m["height"] * 16
                    a, _ = scene(track["period"] + track["phase"], w=w, h=h)
                    b, _ = scene(track["period"] * 2 + track["phase"], w=w, h=h)
                    z.call(dict(cmd="tileAnim.frame", frame=None))
                    if a != b:
                        moved = (bank, number, track, w, h)
                        break
                assert moved, candidates
                bank, number, track, w, h = moved
                if shots:
                    result = z.call(dict(cmd="tileAnim.scene", frame=track["period"] + track["phase"], width=min(w, 480), height=min(h, 320)))
                    (shots / f"tile_anim_{bank}_{number}.png").write_bytes(base64.b64decode(result["png"]))
                    z.call(dict(cmd="tileAnim.frame", frame=None))
                print(f"OK {bank}.{number} の副タイルセットの {track['name']}（{track['period']} フレームごと・{track['frames']} コマ）")

            # 縦 2 マスのドア（シルフカンパニーなど）。
            tall = None
            for number in range(42, 59):
                z.call(dict(cmd="selectMap", bank=1, map=number))
                found = [d for d in z.call(dict(cmd="door.list"))["doors"] if d["tall"]]
                if found:
                    tall = (number, found[0])
                    break
            assert tall, "縦 2 マスのドアが見つからない"
            number, door = tall
            x, y = door["x"], door["y"]
            area = dict(x=x * 16, y=y * 16 - 16, w=16, h=32)
            closed, _ = scene(0, **area)
            z.call(dict(cmd="door.run", kind="open", x=x, y=y, frame=0))
            opened, _ = scene(19, **area)
            assert opened != closed
            state = z.call(dict(cmd="door.state", frame=19))
            assert sorted(c["at"] for c in state["cells"]) == sorted([f"{x},{y - 1}", f"{x},{y}"]), state
            z.call(dict(cmd="door.run", kind="close", x=x, y=y, frame=20))
            assert scene(39, **area)[0] == closed
            print(f"OK 1.{number} の縦 2 マスのドア（ブロック {door['blockId']}）は上のマスも描き替え、閉めると元に戻る")
            heap = z.call(dict(cmd="state"))["jsHeap"]
            info = z.call(dict(cmd="tileAnim.info"))
            print(f"INFO 絵 {info['bytes']['frames']} バイト・写し {info['bytes']['copies']} バイト・JS ヒープ {heap}")
            z.call(dict(cmd="tileAnim.frame", frame=None))
            after = z.call(dict(cmd="state"))
            assert after["dirty"] == before["dirty"] and after["history"] == before["history"]
        assert hashlib.sha256(rom.read_bytes()).digest() == rom_hash
        assert project_json() == original_json
        print("OK 履歴・ROM・プロジェクトの JSON ファイルが操作前後で同じ")


def check_clock(z, frame, still):
    """表示 > タイルアニメを動かす: 共通の時計で進み、画面が無い間と止めた後は時計を使わない。"""
    import time
    on = z.call(dict(cmd="tileAnim.clock", on=True))
    assert on["on"] and on["subscribed"] and on["holders"] == [], on
    time.sleep(0.6)
    moving = z.call(dict(cmd="tileAnim.clock"))
    assert moving["clockFrame"] >= 10 and moving["frame"] == moving["clockFrame"] and moving["clock"]["running"], moving
    assert any(s["name"] == "tileAnim" for s in moving["clock"]["subscriptions"])
    shots = set()
    for _ in range(6):
        shots.add(hashlib.sha256(repr(frame()).encode()).hexdigest())
        time.sleep(0.15)
    assert len(shots) > 1, "時計で絵が変わらない"
    z.call(dict(cmd="action", id="view.tileAnimation"))
    off = z.call(dict(cmd="tileAnim.clock"))
    assert not off["on"] and not off["subscribed"] and off["frame"] is None, off
    assert not any(s["name"] == "tileAnim" for s in off["clock"]["subscriptions"]), off
    assert not off["clock"]["running"], off
    assert frame() == still
    # 仮の主人公の画面が無い間は購読を止める（hidden）。
    z.call(dict(cmd="preview.player", enabled=False))
    hidden = z.call(dict(cmd="tileAnim.clock", on=True))
    assert hidden["holders"] == ["hidden"] and not hidden["clock"]["running"], hidden
    z.call(dict(cmd="preview.player", enabled=True))
    assert z.call(dict(cmd="tileAnim.clock"))["holders"] == []
    z.call(dict(cmd="tileAnim.clock", on=False))
    z.call(dict(cmd="preview.player", player=dict(x=10, y=14)))
    print("OK 表示 > タイルアニメを動かす は共通の時計で進み、画面が無い間と止めた後は時計を予約しない")


def check_playback_doors(z, x, y, scene, shots, project):
    """再生の opendoor・waitdoor（0xAE）・closedoor: 20 フレームの待ちとタイムラインの帯、再生のフレームのドアの絵。"""
    # 本文を足すのはプロジェクトのスクリプトのファイル（エディタの未保存の本文だけを変え、ファイルには書かない）。
    folder = pathlib.Path(project) / "assembly" / "overworld_scripts"
    path = sorted(p.relative_to(project).as_posix() for p in folder.glob("*.s"))[0]
    assert z.call(dict(cmd="script.open", path=path))["opened"], path
    import time
    for _ in range(60):
        try:
            z.call(dict(cmd="editor.activate", path=path, window="script-editor"))
            break
        except Exception:
            time.sleep(0.5)
    text = z.call(dict(cmd="editor.text", path=path, window="script-editor"))["text"]
    added = "".join(line + "\n" for line in [
        "", "ZzmDoorPlayback:", f"\topendoor {x} {y}", "\twaitdoor", "\tfaceplayer", f"\tclosedoor {x} {y}", "\twaitdoor", "\tend",
    ])
    z.call(dict(cmd="editor.setText", text=text + added, window="script-editor"))
    try:
        z.call(dict(cmd="playback.start", label="ZzmDoorPlayback"))
        timeline = z.call(dict(cmd="playback.timeline"))
        doors = [m for m in timeline["markers"] if m["kind"] == "door"]
        opened = next(m for m in doors if m.get("door") and m["door"]["kind"] == "open")
        start = opened["frame"]
        waits = [m for m in doors if not m.get("door")]
        assert [w["until"] for w in waits] == [start + 20, start + 40], doors
        closed = next(m for m in doors if m.get("door") and m["door"]["kind"] == "close")
        assert closed["frame"] == start + 20, closed
        assert timeline["lastFrame"] >= start + 40, timeline["lastFrame"]
        layout = z.call(dict(cmd="playback.layout"))
        assert [(w["start"], w["until"]) for w in layout["waits"]] == [(start, start + 20), (start + 20, start + 40)], layout["waits"]
        assert all(w["width"] > 0 for w in layout["waits"])
        cell = dict(x=x * 16, y=y * 16, w=16, h=16)
        images = []
        for f in (start, start + 10, start + 19, start + 30, start + 40):
            z.call(dict(cmd="playback.seek", frame=f))
            state = z.call(dict(cmd="door.state", frame=f))
            images.append((f, scene(None, **cell)[0], state["cells"]))
        assert images[0][2] == [] and images[1][2] and images[2][2] and images[4][2] == [], [(f, c) for f, _, c in images]
        assert images[1][1] != images[0][1] and images[4][1] == images[0][1]
        # 戻っても同じ絵（命令から計算し直す）。
        z.call(dict(cmd="playback.seek", frame=start + 10))
        assert scene(None, **cell)[0] == images[1][1]
        if shots:
            (shots / "door_playback.png").write_bytes(__import__("base64").b64decode(z.call(dict(cmd="canvasPng", id="preview.event.frame"))["png"]))
        z.call(dict(cmd="playback.stop"))
        assert z.call(dict(cmd="tileAnim.info"))["frame"] is None
    finally:
        z.call(dict(cmd="editor.setText", text=text, window="script-editor"))
    print(f"OK 再生のドア: waitdoor（0xAE）が 20 フレーム待ち、タイムラインに帯、シークした所のドアの絵（{x},{y}）")


if __name__ == "__main__":
    main()
