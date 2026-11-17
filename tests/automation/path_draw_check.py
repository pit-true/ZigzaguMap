"""道をなぞって移動の列を作る窓（#517）を確かめる。

人物から窓を開き、矢印キー・Ctrl＋矢印・Backspace・Shift＋→・待ち・マップのドラッグで命令の列を作る。
通れないマスの知らせ、閉じたときの後始末、マップのデータと履歴が変わらないことを確かめる。

    python tests/automation/path_draw_check.py --exe <zigzagumap.exe> --rom <BPRJ.gba> [--shots <フォルダ>]
"""
from __future__ import annotations

import argparse
import base64
import pathlib
import tempfile

from zz import Zigzagu


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", required=True)
    ap.add_argument("--rom", required=True)
    ap.add_argument("--project")
    ap.add_argument("--shots")
    a = ap.parse_args()
    with tempfile.TemporaryDirectory(prefix="zzm-path-", ignore_cleanup_errors=True) as tmp:
        with Zigzagu(a.exe, profile=pathlib.Path(tmp) / "profile", extra=["--mute-audio"]) as z:
            z.call(dict(cmd="open", rom=a.rom, **({"project": a.project} if a.project else {})))
            z.call(dict(cmd="selectMap", bank=3, map=0))
            z.call(dict(cmd="tab", name="event"))
            before = z.call(dict(cmd="state"))
            persons = z.call(dict(cmd="event.state"))["events"]["persons"]
            p = persons[0]
            key = lambda k, **m: z.call(dict(cmd="key", key=k, **m))  # noqa: E731
            state = lambda: z.call(dict(cmd="pathDraw.state"))  # noqa: E731

            # 1. 人物から開くと、その人物の位置から始まる
            s = z.call(dict(cmd="pathDraw.open", actor=p["localId"]))
            assert s["open"] and s["actor"] == p["localId"] and (s["start"]["x"], s["start"]["y"]) == (p["x"], p["y"]), s
            assert s["rows"] == [] and s["values"] == []
            print("OK 人物から開くと、人物の位置から始まり、命令は空")

            # 2. 矢印キーで 3 歩 → 一覧が 3 つ
            for _ in range(3):
                key("ArrowUp")
            s = state()
            assert s["values"] == [0x11] * 3 and len(s["rows"]) == 3 and s["rows"][0] == "walk_up", s
            assert (s["end"]["x"], s["end"]["y"]) == (p["x"], p["y"] - 3)
            print("OK 矢印キーで 3 歩、一覧が 3 つ")

            # 3. Backspace で 1 つ戻す、Shift＋→ でやり直す、Ctrl＋矢印で向きだけ
            key("Backspace")
            assert state()["values"] == [0x11] * 2
            key("ArrowRight", shift=True)
            assert state()["values"] == [0x11] * 3
            key("ArrowLeft", ctrl=True)
            s = state()
            assert s["values"] == [0x11] * 3 + [0x02] and s["rows"][-1] == "look_left" and s["end"]["facing"] == "left", s
            assert (s["end"]["x"], s["end"]["y"]) == (p["x"], p["y"] - 3)
            print("OK Backspace で戻す、Shift＋→ でやり直す、Ctrl＋矢印は向きだけ")

            # 4. 待ちと速さ
            s = z.call(dict(cmd="pathDraw.edit", action="wait", frames=20))
            assert s["values"][-2:] == [0x1C, 0x1A] and s["rows"][-1].startswith("待ち 20 フレーム"), s
            z.call(dict(cmd="pathDraw.edit", action="speed", value=0x1D))
            key("ArrowDown")
            s = state()
            assert s["values"][-1] == 0x1D, s
            z.call(dict(cmd="pathDraw.edit", action="speed", value=0x10))
            print("OK 待ちを 16・4 フレームに分け、速さを変えた歩きを足す")

            # 5. マップの左ドラッグ: 通ったマスごとに 1 歩（横を先に）
            end = state()["end"]
            n = len(state()["values"])
            r = z.call(dict(cmd="mouse", target="event", action="drag", cell=[end["x"], end["y"]], to=[end["x"] + 2, end["y"] + 1], steps=6))
            s = state()
            assert (s["end"]["x"], s["end"]["y"]) == (end["x"] + 2, end["y"] + 1), s
            assert sorted(s["values"][n:]) == sorted([0x13, 0x13, 0x10]), s["values"][n:]
            after_drag = z.call(dict(cmd="event.state"))
            assert after_drag["events"]["persons"] == persons, "ドラッグでイベントが動いた"
            print("OK マップの左ドラッグで通ったマスごとに歩きを足し、イベントは動かない")

            if a.shots:
                folder = pathlib.Path(a.shots); folder.mkdir(parents=True, exist_ok=True)
                shot = z.call(dict(cmd="screenshot"))
                (folder / "path_draw.png").write_bytes(base64.b64decode(shot if isinstance(shot, str) else shot["png"]))

            # 6. 通れないマス（マップの外）を知らせる。作るのは止めない
            z.call(dict(cmd="pathDraw.edit", action="clear"))
            s = z.call(dict(cmd="pathDraw.open", start=dict(x=0, y=0, facing="down")))
            assert s["actor"] == 255
            z.call(dict(cmd="pathDraw.step", direction="left"))
            s = state()
            assert s["values"] == [0x12] and s["problems"] == [dict(index=0, reason="outside", x=-1, y=0)], s
            warning = z.call(dict(cmd="getField", id="pathDraw.warning"))
            assert "通れないマス" in str(warning), warning
            print("OK 通れないマスを知らせ、命令は作る")

            # 7. 全部消す・やり直す・閉じる。マップのデータと履歴は変わらない
            z.call(dict(cmd="pathDraw.edit", action="clear"))
            assert state()["values"] == []
            z.call(dict(cmd="pathDraw.edit", action="redo"))
            assert state()["values"] == [0x12]
            z.call(dict(cmd="pathDraw.close"))
            assert state() == dict(open=False)
            after = z.call(dict(cmd="state"))
            assert after["dirty"] == before["dirty"] and after["history"] == before["history"], (before, after)
            z.call(dict(cmd="pathDraw.open"))
            z.call(dict(cmd="selectMap", bank=3, map=1))
            assert state() == dict(open=False)
            print("OK 閉じる・マップの切り替えで窓を閉じ、マップのデータと履歴は変わらない")
    print("OK 終了")


if __name__ == "__main__":
    main()
