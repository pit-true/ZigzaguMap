"""マップの画像の書き出しの窓とタイムラプス（Phase5 #403）を、素の ROM だけで確かめる（出力しない）。

  python tests/automation/map_export_check.py --rom <素の BPRJ> --work <書き出し先のフォルダ> [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- ファイル > マップの画像を書き出す... で窓が開き、プレビューの大きさが選択に合う（このマップ・周りの境界・全マップ）。
- PNG と BMP をファイルに書け、画像の大きさが合う。つなぎ合わせ（全マップ）もファイルに書ける。
- 3.0 を 100×75（幅 100 での最大）に広げて 12 回描き、タイムラプスの GIF を書く。GIF のコマの数と大きさが合い、作る前と後の JavaScript のヒープを出す。
"""
from __future__ import annotations

import argparse
import base64
import os
import pathlib
import struct
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if not shots:
        return
    png = z.call({"cmd": "screenshot"})
    (shots / name).write_bytes(base64.b64decode(png if isinstance(png, str) else png["png"]))


def gif_info(data: bytes) -> tuple[int, int, int]:
    """GIF の幅・高さ・コマの数（画像の記述子の数）。"""
    w, h = struct.unpack("<HH", data[6:10])
    p = 13
    if data[10] & 0x80:
        p += 3 * (1 << ((data[10] & 7) + 1))
    frames = 0
    while p < len(data):
        b = data[p]
        if b == 0x3B:
            break
        if b == 0x21:
            p += 2
            while data[p]:
                p += data[p] + 1
            p += 1
        elif b == 0x2C:
            frames += 1
            flags = data[p + 9]
            p += 10
            if flags & 0x80:
                p += 3 * (1 << ((flags & 7) + 1))
            p += 1
            while data[p]:
                p += data[p] + 1
            p += 1
        else:
            raise ValueError(f"知らないブロック {b:#x}")
    return w, h, frames


def run(z: Zigzagu, action: str, path: pathlib.Path | None):
    if path:
        z.call({"cmd": "queuePath", "path": str(path)})
    return z.call({"cmd": "mapExport.run", "action": action}, timeout=600)


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    args = ap.parse_args()
    work = pathlib.Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="zzm-export-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": args.rom})
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})
        m = z.call({"cmd": "state"})["map"]
        w, h = m["width"], m["height"]
        z.call({"cmd": "action", "id": "image.export"})
        st = z.call({"cmd": "mapExport.state"})
        check(st["open"] and st["choice"]["format"] == "png", "窓が開き、形式の初めは PNG")
        check(st["last"]["width"] == w * 16 and st["last"]["height"] == h * 16, f"このマップのプレビューの大きさ（{st['last']}）")
        shot(z, shots, "export_map.png")

        z.call({"cmd": "setField", "id": "mapExport.border", "value": True})
        st = z.call({"cmd": "mapExport.state"})
        check(st["last"]["width"] == (w + 14) * 16 and st["last"]["height"] == (h + 10) * 16, f"周りの境界ブロックで広がる（{st['last']}）")
        z.call({"cmd": "setField", "id": "mapExport.neighbors", "value": True})
        z.call({"cmd": "setField", "id": "mapExport.movement", "value": True})
        st = z.call({"cmd": "mapExport.state"})
        check(st["last"]["maps"] > 1, f"隣のマップの帯も描く（マップ {st['last']['maps']} 枚）")
        shot(z, shots, "export_border.png")
        p = run(z, "save", work / "map30.png")
        data = (work / "map30.png").read_bytes() if p else b""
        check(data[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", data[16:24]) == ((w + 14) * 16, (h + 10) * 16), "PNG に書け、大きさが合う")

        z.call({"cmd": "setField", "id": "mapExport.bmp", "value": True})
        p = run(z, "save", work / "map30.bmp")
        data = (work / "map30.bmp").read_bytes() if p else b""
        check(data[:2] == b"BM" and struct.unpack("<ii", data[18:26])[0] == (w + 14) * 16, "BMP に書け、幅が合う")

        z.call({"cmd": "setField", "id": "mapExport.rangeWhole", "value": True})
        z.call({"cmd": "setField", "id": "mapExport.png", "value": True})
        z.call({"cmd": "setField", "id": "mapExport.border", "value": False})
        st = z.call({"cmd": "mapExport.state"})
        check(st["last"]["maps"] > 3, f"つなぎ合わせのプレビュー（マップ {st['last']['maps']} 枚、{st['last']['width']}×{st['last']['height']}）")
        p = run(z, "save", work / "whole.png")
        data = (work / "whole.png").read_bytes() if p else b""
        check(data[:4] == b"\x89PNG" and struct.unpack(">II", data[16:24]) == (st["last"]["width"], st["last"]["height"]), "つなぎ合わせもファイルに書ける")
        shot(z, shots, "export_whole.png")

        # タイムラプス: 変更が無いときは作らない
        z.call({"cmd": "setField", "id": "mapExport.rangeMap", "value": True})
        z.call({"cmd": "setField", "id": "mapExport.neighbors", "value": False})
        z.call({"cmd": "setField", "id": "mapExport.movement", "value": False})
        check(run(z, "timelapse", None) is None, "変更が無ければタイムラプスは作らない")
        z.call({"cmd": "dialog", "press": "close"})

        # 100×75 に広げて 12 回描く（FR の大きさの上限で、幅 100 なら高さは 75 まで）
        z.call({"cmd": "command", "name": "resizeMapEdge", "args": {"bank": 3, "map": 0, "side": "right", "amount": 100 - w, "targets": [{"bank": 3, "map": 0}]}})
        z.call({"cmd": "command", "name": "resizeMapEdge", "args": {"bank": 3, "map": 0, "side": "down", "amount": 75 - h, "targets": [{"bank": 3, "map": 0}]}})
        m = z.call({"cmd": "state"})["map"]
        check((m["width"], m["height"]) == (100, 75), f"100×75 に広げた（{m['width']}×{m['height']}）")
        for i in range(12):
            z.call({"cmd": "command", "name": "paintBlocks", "args": {"bank": 3, "map": 0, "cells": [{"x": 30 + i * 5 + dx, "y": 30 + dy, "block": 0x10 + i} for dx in range(4) for dy in range(20)]}})
        position = z.call({"cmd": "editHistory.state"})["position"]
        z.call({"cmd": "action", "id": "image.export"})
        z.call({"cmd": "mapExport.state"})
        before = z.call({"cmd": "state"})["jsHeap"]
        r = run(z, "timelapse", work / "timelapse.gif")
        after = z.call({"cmd": "state"})["jsHeap"]
        check(bool(r) and r["frames"] == 15, f"タイムラプスのコマの数（{r and r['frames']}。最初・広げた 2 回・描いた 12 回）")
        data = (work / "timelapse.gif").read_bytes() if r else b""
        check(data[:6] == b"GIF89a" and gif_info(data) == (1600, 1200, 15), f"GIF に書け、大きさとコマの数が合う（{gif_info(data) if data else None}、{len(data)} バイト）")
        check(z.call({"cmd": "editHistory.state"})["position"] == position, "作ったあとは履歴が元の位置に戻る")
        print(f"     JavaScript のヒープ: 作る前 {before} MB、作った後 {after} MB")
        z.call({"cmd": "setField", "id": "mapExport.skip", "value": 4})
        r = run(z, "timelapse", work / "timelapse_skip.gif")
        check(bool(r) and r["frames"] == 4, f"4 コマとばし（{r and r['frames']}。最初・5・10・最後）")
        z.call({"cmd": "dialog", "press": "close"})
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
