"""天候のプレビュー（#498）。既定はオフ。天候ごとの絵、雷の光、時間帯との重なり、再生の命令、PNG の保存、止めた後の後始末。
ROM と maps の JSON は変えない。`--shots` に天候ごとの画面写真（fb498_*.png）を置く。"""
from __future__ import annotations

import argparse
import base64
import hashlib
import pathlib
import tempfile
import time

from phase4_view_check import pixels
from zz import Zigzagu

NAMES = ["none", "clouds", "sunny", "rain", "snow", "thunder", "fog", "ash", "sandstorm", "fog2", "underwater", "shade", "drought", "heavyrain", "bubbles"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--rom", required=True)
    p.add_argument("--exe", required=True)
    p.add_argument("--project")
    p.add_argument("--shots")
    p.add_argument("--name", default="vanilla")
    p.add_argument("--map", default="3.0", help="バンク.マップ（既定はマサラ）")
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
    bank, number = (int(v) for v in args.map.split("."))
    with tempfile.TemporaryDirectory(prefix="zzm-weather-", ignore_cleanup_errors=True) as work:
        with Zigzagu(args.exe, profile=pathlib.Path(work) / "profile", extra=["--mute-audio"]) as z:
            z.call(dict(cmd="open", rom=args.rom, **({"project": args.project} if args.project else {})))
            z.call(dict(cmd="selectMap", bank=bank, map=number))
            z.call(dict(cmd="tab", name="event"))
            before = z.call(dict(cmd="state"))
            original_map = z.call(dict(cmd="canvasPng", target="event"))["png"]

            state = z.call(dict(cmd="weather.state"))
            assert not state["entry"]["enabled"] and state["entry"]["choice"] == "map", state
            assert not any(s["name"] == "weather" for s in state["clock"]["subscriptions"]), state
            print("OK 既定はオフ（時計の購読も無い）")

            z.call(dict(cmd="menu.run", id="view.previewPlayer"))
            px, py = min(10, before["map"]["width"] - 1), min(10, before["map"]["height"] - 1)
            z.call(dict(cmd="preview.player", player=dict(x=px, y=py)))

            def frame():
                return pixels(base64.b64decode(z.call(dict(cmd="canvasPng", id="preview.event.frame"))["png"]))

            def shot(name):
                if shots:
                    (shots / f"fb498_{args.name}_{name}.png").write_bytes(base64.b64decode(z.call(dict(cmd="canvasPng", id="preview.event.frame"))["png"]))

            plain = frame()
            assert plain[:2] == (240, 160)

            # 天候ごと: マップに入ったときの形から 180 フレーム進めた絵。
            results = {}
            first = z.call(dict(cmd="weather.set", weather=0, on=True, seed=1))
            assert first["entry"]["enabled"] and first["subscribed"], first
            for w in range(15):
                info = z.call(dict(cmd="weather.set", weather=w))
                info = z.call(dict(cmd="weather.tick", frames=180))
                image = frame()
                results[w] = (info, image)
                shot(f"{w:02d}_{NAMES[w]}")
                print(f"INFO {w:2d} {NAMES[w]:10s} 中={info['status']} 段={info['screen'] and info['screen']['evy']} 合成={info['screen'] and (info['screen']['eva'], info['screen']['evb'])} 絵={info['objects']} 問題={info['problem']}")
            for w in (1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14):
                assert results[w][1] != plain, f"{w} の絵が変わらない"
            for w in (0, 2):
                assert results[w][0]["problem"] is None and results[w][0]["objects"] == 0
            assert results[12][0]["problem"], "日照りは「プレビューできません」"
            for w in (3, 4, 5, 11, 13):
                assert results[w][0]["screen"]["evy"] == 3 or w == 4, (w, results[w][0]["screen"])
            assert (results[6][0]["screen"]["eva"], results[6][0]["screen"]["evb"]) == (12, 8)
            assert (results[10][0]["screen"]["eva"], results[10][0]["screen"]["evb"]) == (4, 16)
            assert (results[8][0]["screen"]["eva"], results[8][0]["screen"]["evb"]) == (16, 0)
            assert results[3][0]["objects"] <= 10 and results[13][0]["objects"] > results[3][0]["objects"]
            if args.project:
                assert results[7][0]["ashIsSandstorm"] and results[7][0]["objects"] == 25, results[7][0]
            print("OK 天候ごとの絵・段・合成（雨 10 粒・大雨はもっと多い・霧 12/8・薄い霧 4/16・砂嵐 16/0・日照りはプレビューできない）")

            # 雷: 段 19 まで光る。
            z.call(dict(cmd="weather.set", weather=5))
            seen = set()
            for _ in range(300):
                info = z.call(dict(cmd="weather.tick", frames=1))
                seen.add(info["screen"]["evy"])
                if info["screen"]["evy"] == 19:
                    shot("05_thunder_flash")
                    break
            assert 19 in seen, seen
            print("OK 雷で段 19 まで光る")

            # 時計で動く（雨）。
            z.call(dict(cmd="weather.set", weather=3))
            a = frame(); time.sleep(0.4); b = frame()
            assert a != b, "時計で雨が動かない"
            clock = z.call(dict(cmd="weather.state"))["clock"]
            assert any(s["name"] == "weather" for s in clock["subscriptions"]) and clock["running"], clock

            # PNG の保存に天候が入る。
            z.call(dict(cmd="weather.set", weather=6))
            z.call(dict(cmd="weather.tick", frames=10))
            z.call(dict(cmd="preview.player", enabled=False))
            held = z.call(dict(cmd="weather.state"))
            assert held["holders"] == ["hidden"], held
            z.call(dict(cmd="preview.player", enabled=True))
            z.call(dict(cmd="preview.player", player=dict(x=px, y=py)))
            path = pathlib.Path(work) / "weather.png"
            z.call(dict(cmd="weather.set", weather=11))
            z.call(dict(cmd="weather.tick", frames=1))
            expected = frame()
            z.call(dict(cmd="queuePath", path=str(path)))
            z.call(dict(cmd="action", id="preview.save"))
            assert pixels(path.read_bytes()) == expected and expected != plain
            print("OK 時計で動き、画面が無い間は止まる。保存した PNG に天候が入る")

            # 時間帯との重なり（プロジェクトがあり、屋外のマップのとき）。
            if args.project:
                night = z.call(dict(cmd="view.timeOfDay", time="night", wait=True))
                if night["ok"] and night["mapTinted"]:
                    z.call(dict(cmd="weather.set", weather=3))
                    z.call(dict(cmd="weather.tick", frames=30))
                    rain_night = frame()
                    shot("03_rain_night")
                    z.call(dict(cmd="weather.set", weather=0))
                    z.call(dict(cmd="weather.tick", frames=1))
                    only_night = frame()
                    assert rain_night != only_night and only_night != plain
                    print("OK 時間帯（夜）と雨の段が重なる")
                z.call(dict(cmd="view.timeOfDay", time="day", wait=True))

            # 再生の命令（プロジェクトのスクリプトの本文に足して、エディタの未保存の本文だけで試す）。
            if args.project:
                check_playback(z, args.project, shot)

            # 止める: 時計の購読をやめ、元の絵に戻る。
            off = z.call(dict(cmd="weather.set", on=False))
            assert not off["entry"]["enabled"] and not off["subscribed"] and off["graphicsBytes"] == 0, off
            clock = z.call(dict(cmd="weather.state"))["clock"]
            assert not any(s["name"] == "weather" for s in clock["subscriptions"]), clock
            z.call(dict(cmd="preview.player", player=dict(x=px, y=py)))
            assert frame() == plain
            print("OK 止めると時計の購読をやめ、絵を捨てて元の絵に戻る")
            z.call(dict(cmd="menu.run", id="view.previewPlayer"))
            assert z.call(dict(cmd="canvasPng", target="event"))["png"] == original_map
            after = z.call(dict(cmd="state"))
            assert after["dirty"] == before["dirty"] and after["history"] == before["history"]
        assert hashlib.sha256(rom.read_bytes()).digest() == rom_hash
        assert project_json() == original_json
        print("OK 履歴・ROM・プロジェクトの JSON ファイルが操作前後で同じ")


def check_playback(z, project, shot):
    """setweather 3・doweather で雨へ徐々に切り替わり、resetweather・doweather でマップの天候へ戻る。戻しても同じ。"""
    folder = pathlib.Path(project) / "assembly" / "overworld_scripts"
    path = sorted(p.relative_to(project).as_posix() for p in folder.glob("*.s"))[0]
    assert z.call(dict(cmd="script.open", path=path))["opened"], path
    for _ in range(60):
        try:
            z.call(dict(cmd="editor.activate", path=path, window="script-editor"))
            break
        except Exception:
            time.sleep(0.5)
    text = z.call(dict(cmd="editor.text", path=path, window="script-editor"))["text"]
    added = "".join(line + "\n" for line in ["", "ZzmWeatherPlayback:", "\tsetweather 3", "\tdoweather", "\twait 300", "\tresetweather", "\tdoweather", "\twait 300", "\tend"])
    z.call(dict(cmd="editor.setText", text=text + added, window="script-editor"))
    z.call(dict(cmd="weather.set", weather="map"))
    try:
        z.call(dict(cmd="playback.start", label="ZzmWeatherPlayback"))
        timeline = z.call(dict(cmd="playback.timeline"))
        marks = [m for m in timeline["markers"] if m["kind"] == "weather"]
        assert [m["detail"].split()[0] for m in marks] == ["setweather", "doweather", "resetweather", "doweather"], marks
        start = marks[1]["frame"]
        states = {}
        for f in (start, start + 200, start + 301, start + 600):
            z.call(dict(cmd="playback.seek", frame=f))
            states[f] = z.call(dict(cmd="weather.state"))
        assert states[start + 200]["status"] == 3 and states[start + 200]["screen"]["evy"] == 3, states[start + 200]
        assert states[start + 600]["status"] != 3, states[start + 600]
        shot("playback_rain")
        z.call(dict(cmd="playback.seek", frame=start + 200))
        again = z.call(dict(cmd="weather.state"))
        assert again["status"] == 3 and again["frame"] == states[start + 200]["frame"], again
        z.call(dict(cmd="playback.stop"))
        assert z.call(dict(cmd="weather.state"))["playback"] is None
    finally:
        z.call(dict(cmd="editor.setText", text=text, window="script-editor"))
    print("OK 再生: setweather・doweather で雨へ、resetweather・doweather でマップの天候へ。戻しても同じ")


if __name__ == "__main__":
    main()
