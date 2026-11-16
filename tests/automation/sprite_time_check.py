"""人物の時間帯の色と、表示を変えないPNGの時間帯指定（#435）。"""
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
    p.add_argument("--project", required=True)
    p.add_argument("--exe", required=True)
    p.add_argument("--shots")
    a = p.parse_args()
    with tempfile.TemporaryDirectory(prefix="zzm-sprite-time-", ignore_cleanup_errors=True) as work:
        with Zigzagu(a.exe, profile=pathlib.Path(work) / "profile", extra=["--mute-audio"]) as z:
            z.call({"cmd": "open", "rom": a.rom, "project": a.project})
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            z.call({"cmd": "setting", "key": "showObjects", "value": True})
            def image(time, persons=False):
                return base64.b64decode(z.call({"cmd": "image.composite", "whole": False, "events": "persons" if persons else "none", "time": time, "png": True})["png"])
            day, day_obj = image("day"), image("day", True)
            night, night_obj = image("night"), image("night", True)
            assert z.call({"cmd": "view.timeOfDay"})["time"] == "day"
            print("OK 書き出しの時間帯を指定しても表示は昼のまま")
            _, _, d = pixels(day_obj)
            _, _, bg = pixels(day)
            _, _, n = pixels(night_obj)
            tested = same = 0
            for i in range(0, len(d), 4):
                rgb = tuple(d[i+j] >> 3 for j in range(3))
                if d[i:i+4] == bg[i:i+4] or rgb == (0, 0, 0):
                    continue
                tested += 1
                expected = tuple(c + (((b-c)*4) >> 4) for c, b in zip(rgb, (5, 0, 21)))
                if tuple(n[i+j] >> 3 for j in range(3)) == expected:
                    same += 1
            assert tested > 0 and same == tested, (same, tested)
            print(f"OK 人物の {tested} 画素が実機のOBJの式と一致")
            z.call({"cmd": "tab", "name": "event"})
            before = z.call({"cmd": "canvasPng", "target": "event"})["png"]
            z.call({"cmd": "view.timeOfDay", "time": "night"})
            assert z.call({"cmd": "canvasPng", "target": "event"})["png"] != before
            z.call({"cmd": "view.timeOfDay", "time": "day"})
            assert z.call({"cmd": "canvasPng", "target": "event"})["png"] == before
            print("OK 夜で人物の表示が変わり、昼に戻すと元の画像と同じ")
            z.call({"cmd": "selectMap", "bank": 4, "map": 1})
            assert pixels(image("day", True)) == pixels(image("night", True))
            print("OK 屋内は人物も背景も時間帯で変わらない")
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            z.call({"cmd": "view.timeOfDay", "time": "night"})
            z.call({"cmd": "action", "id": "image.export"})
            assert z.call({"cmd": "mapExport.state"})["choice"]["time"] == "night"
            if a.shots:
                folder = pathlib.Path(a.shots)
                folder.mkdir(parents=True, exist_ok=True)
                shot = z.call({"cmd": "screenshot"})
                (folder / "time_export.png").write_bytes(base64.b64decode(shot if isinstance(shot, str) else shot["png"]))
            for key in ("persons", "warps", "traps", "signs"):
                z.call({"cmd": "setField", "id": f"mapExport.{key}", "value": False})
            for index, name, expected in ((1, "day", day), (3, "night", night)):
                z.call({"cmd": "setField", "id": "mapExport.time", "value": index})
                z.call({"cmd": "mapExport.state"})
                file = pathlib.Path(work) / f"{name}.png"
                z.call({"cmd": "queuePath", "path": str(file)})
                z.call({"cmd": "mapExport.run", "action": "save"})
                assert pixels(file.read_bytes()) == pixels(expected)
                assert z.call({"cmd": "view.timeOfDay"})["time"] == "night"
                print(f"OK 窓で選んだ {name} の色でPNGを書き、表示中の夜は変わらない")


if __name__ == "__main__":
    main()
