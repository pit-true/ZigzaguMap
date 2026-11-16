"""Phase6 の時間帯ビューア（#434）を確かめる。

  python tests/automation/time_of_day_check.py --rom <素の BPRJ> --nd <ND の CFRU の写し> [--chronos <Chronos の cfru の写し>]
      [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- 起動は --automation・--profile（一時フォルダ）・画面外。ROM と写しには書き込まない（出力しない）。
- 見ること
  - 起動したときは昼。昼のマップの絵は、時間帯を切り替えて昼に戻したあとも 1 画素も変わらない。
  - 夜にするとマサラタウン（3.0。町）の色が変わり、ほとんどの画素が実機の式（dns.c）で昼の色から計算した色になる
    （残りは夜だけ光る窓とドア）。描き直しの時間を出す。
  - 屋内（4.1）は夜でも色が変わらず、ステータスバーにそう出る。
  - メニュー（表示 > 時間帯）とツール欄のコンボが今の時間帯を指す。
  - Chronos の写しでは `settimeofday` の値で切り替わる（1 朝 = 青を半分、4 深夜 = 夜）。
  - ROM だけで開いたときは切り替わらず、理由を返す。
"""
from __future__ import annotations

import argparse
import base64
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402
from phase4_view_check import pixels  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def map_png(z: Zigzagu) -> bytes:
    return base64.b64decode(z.call({"cmd": "canvasPng", "target": "map"})["png"])


def tint5(c: int, b: int, k: int, halve: bool) -> int:
    if halve:
        return c if b else c >> 1
    return c + (((b - c) * k) >> 4)


def expected_ratio(day: bytes, night: bytes, fade: dict) -> float:
    """昼の絵の画素から実機の式で計算した色と、夜の絵の画素が合う割合（黒と透明は数えない）。"""
    w, h, a = pixels(day)
    w2, h2, b = pixels(night)
    if (w, h) != (w2, h2):
        return 0.0
    color = fade["color"]
    blend = (color & 31, (color >> 5) & 31, (color >> 10) & 31)
    k = fade["amount"]
    same = total = 0
    for i in range(0, len(a), 4):
        if a[i + 3] == 0:
            continue
        rgb = (a[i] >> 3, a[i + 1] >> 3, a[i + 2] >> 3)
        if rgb == (0, 0, 0):
            continue
        total += 1
        want = [tint5(rgb[j], blend[j], k, fade["halve"]) for j in range(3)]
        got = (b[i] >> 3, b[i + 1] >> 3, b[i + 2] >> 3)
        if list(got) == want:
            same += 1
    return same / total if total else 0.0


def checked_time(z: Zigzagu) -> list[str]:
    return [i["id"] for i in z.call({"cmd": "menu.list"}) if str(i.get("id", "")).startswith("time.") and i.get("checked")]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--nd", required=True)
    ap.add_argument("--chronos")
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    exe = pathlib.Path(args.exe) if args.exe else None
    with tempfile.TemporaryDirectory(prefix="zzm-time-", ignore_cleanup_errors=True) as profile:
        with Zigzagu(exe, profile=profile) as z:
            z.call({"cmd": "open", "rom": args.rom, "project": args.nd}, timeout=120)
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            st = z.call({"cmd": "view.timeOfDay"})
            check(st["time"] == "day" and st["fade"] is None, "起動したときは昼")
            check(st["combo"] == {"value": "day", "disabled": False}, "ツール欄のコンボは昼")
            check(checked_time(z) == ["time.day"], "表示 > 時間帯 は昼にチェック")
            day = map_png(z)

            st = z.call({"cmd": "view.timeOfDay", "time": "night", "wait": True})
            print("  夜:", {k: st[k] for k in ("sections", "clock", "fade", "switchMs", "status")})
            check(st["ok"] and st["time"] == "night" and st["mapTinted"], "夜に切り替わり、町のマップは色が変わる")
            check(st["clock"] == "rtc" and [s["hour"] for s in st["sections"]] == [6, 12, 18, 21], "ND は実機の時計、代表の時刻は 6・12・18・21 時")
            check(st["fade"] == {"color": 5 | (21 << 10), "amount": 4, "halve": False}, "夜は 21 時の色（RGB(5,0,21) を 4/16）")
            night = map_png(z)
            if shots:
                (shots / "pallet_day.png").write_bytes(day)
                (shots / "pallet_night.png").write_bytes(night)
            ratio = expected_ratio(day, night, st["fade"])
            print(f"  実機の式と合う画素: {ratio * 100:.2f}%")
            check(night != day and ratio > 0.97, "夜の絵は、昼の色から実機の式で計算した色になる（光る窓とドアを除く）")
            check(checked_time(z) == ["time.night"] and st["combo"]["value"] == "night", "メニューとコンボが夜を指す")
            times = []
            for t in ("morning", "evening", "night", "morning"):
                times.append(z.call({"cmd": "view.timeOfDay", "time": t})["switchMs"])
            print("  切り替えの描き直し（ミリ秒）:", times)
            check(max(times) < 100, "切り替えの描き直しは 100ms 以内")
            z.call({"cmd": "menu.run", "id": "time.evening"})
            check(z.call({"cmd": "view.timeOfDay"})["time"] == "evening", "メニューの 夕 で切り替わる")

            z.call({"cmd": "view.timeOfDay", "time": "day", "wait": True})
            check(map_png(z) == day, "昼に戻すと、元の絵と 1 画素も変わらない")

            # 屋内（4.1）: 夜でも色が変わらない
            z.call({"cmd": "selectMap", "bank": 4, "map": 1})
            indoor_day = map_png(z)
            st = z.call({"cmd": "view.timeOfDay", "time": "night"})
            check(st["ok"] and not st["mapTinted"], "屋内のマップは時間帯で色が変わらない")
            check("変わりません" in st["status"], "ステータスバーにそう出る")
            check(map_png(z) == indoor_day, "屋内の絵は夜でも同じ")
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            check(z.call({"cmd": "view.timeOfDay"})["mapTinted"] and map_png(z) == night, "町へ戻ると夜の色で描く")

            if args.chronos:
                z.call({"cmd": "open", "rom": args.rom, "project": args.chronos}, timeout=120)
                z.call({"cmd": "selectMap", "bank": 3, "map": 0})
                st = z.call({"cmd": "view.timeOfDay"})
                check(st["time"] == "day", "開き直すと昼に戻る")
                st = z.call({"cmd": "view.timeOfDay", "settimeofday": 1})
                check(st["time"] == "morning" and st["clock"] == "chronos" and st["fade"]["halve"], "Chronos の settimeofday 1 は朝（青を半分）")
                morning = map_png(z)
                z.call({"cmd": "view.timeOfDay", "time": "day"})
                ratio = expected_ratio(map_png(z), morning, st["fade"])
                check(ratio > 0.999, f"朝の絵は昼の色の青を半分にした色（{ratio * 100:.2f}%）")
                st = z.call({"cmd": "view.timeOfDay", "settimeofday": 4})
                check(st["time"] == "night", "settimeofday 4（深夜）は夜")
                z.call({"cmd": "view.timeOfDay", "time": "day"})

            z.call({"cmd": "open", "rom": args.rom}, timeout=120)
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            st = z.call({"cmd": "view.timeOfDay", "time": "night"})
            check(not st["ok"] and st["time"] == "day" and st["error"], "ROM だけのときは切り替わらず、理由を返す")
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
