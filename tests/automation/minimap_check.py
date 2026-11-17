"""ミニマップの小窓（Phase7 #511）を、素の ROM だけで確かめる（出力しない）。

  python tests/automation/minimap_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- 既定は閉じていて、縮小図も作らない。表示 > ミニマップ で開くと、長い辺が 200 画素までの縮小図が出る。
- 8 倍にして縮小図を押すと、押した位置が表示の真ん中に来る（見えている範囲の枠の真ん中が押した位置）。
- 描くと、少し後に縮小図が作り直されて画素が変わる。イベントの点は 表示 > イベントの種類ごとの表示 に従う。
- 野生のタブでは縮小図を出さない。閉じると個人設定に残り、次に起動して ROM を開くと前の位置に出る。
- 小窓の「タウンマップも出す」で、タウンマップの現在地のまわりの拡大を出す・隠す（個人設定に残す）。
- 大きいマップを含む 10 枚を開き、切り替えの時間と縮小図を作る時間を出す（目安として表示するだけ）。
"""
from __future__ import annotations

import argparse
import base64
import os
import pathlib
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu, shot  # noqa: E402

failures: list[str] = []
SWITCH_MAPS = [(3, 1), (3, 3), (3, 19), (4, 1), (1, 1), (3, 37), (3, 45), (3, 50), (5, 0), (3, 0)]


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def mm(z: Zigzagu, **kw) -> dict:
    return z.call({"cmd": "minimap.state", **kw})


def center(frame: dict) -> tuple[float, float]:
    return frame["x"] + frame["width"] / 2, frame["y"] + frame["height"] / 2


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="zzm-minimap-", ignore_cleanup_errors=True) as profile:
        with Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
            z.call({"cmd": "open", "rom": args.rom})
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            z.call({"cmd": "tab", "name": "map"})
            s = mm(z)
            check(not s["open"] and s["builds"] == 0 and s["width"] == 0, "既定は閉じていて、縮小図を作らない")

            z.call({"cmd": "action", "id": "view.minimap"})
            s = mm(z)
            st = z.call({"cmd": "state"})["map"]
            w, h = st["width"], st["height"]
            check(s["open"] and s["setting"]["show"], "表示 > ミニマップ で開き、個人設定に残す")
            long_side = max(w, h) * 16
            exp_w = round(w * 16 * min(1, 200 / long_side))
            check(max(s["width"], s["height"]) <= 200 and abs(s["width"] - exp_w) <= 1, f"縮小図は長い辺が 200 画素まで（{s['width']}×{s['height']}、マップ {w}×{h}）")
            check(s["events"] > 0, f"イベントの点を出す（{s['events']} 個）")

            shot(z, shots, "minimap_only.png")

            # タウンマップの拡大
            s = z.call({"cmd": "minimap.town", "on": True})
            tz = s["town"]
            check(tz is not None and tz["loaded"] and tz["area"] is not None, f"タウンマップの拡大を出す（{tz and tz['text']}）")
            check(tz is not None and tz["area"]["scale"] == 4 and tz["area"]["width"] >= 7, f"現在地のまわり 7×5 マス以上を 4 倍（{tz and tz['area']}）")
            check(s["setting"].get("town") is True, "チェックを個人設定に残す")
            fr = tz["frame"]["rect"] if tz else None
            ar = tz["area"] if tz else None
            check(bool(fr and ar and ar["x"] <= fr["x"] and ar["y"] <= fr["y"] and fr["x"] + fr["width"] <= ar["x"] + ar["width"]), "地名の枠が拡大の範囲に入る")
            shot(z, shots, "minimap_town.png")
            texts = {}
            for bank, m in [(4, 1), (1, 0), (3, 19)]:
                z.call({"cmd": "selectMap", "bank": bank, "map": m})
                t = mm(z)["town"]
                texts[f"{bank}.{m}"] = (t["text"], t["area"] is not None)
            print("情報 タウンマップの拡大:", texts)
            check(all(isinstance(v[0], str) and v[0] for v in texts.values()), "ほかのマップでも地名か「場所がありません」を出す")
            check(all(v[1] or v[0] == "タウンマップに場所がありません" for v in texts.values()), "場所が無いマップは「タウンマップに場所がありません」")
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            s = z.call({"cmd": "minimap.town", "on": False})
            check(s["town"] is None and s["setting"].get("town") is False, "チェックを外すと拡大を捨てる")
            s = z.call({"cmd": "minimap.town", "on": True})

            # 8 倍にして押す
            for _ in range(8):
                r = z.call({"cmd": "zoom.wheel", "cell": [w // 2, h // 2], "delta": -1})
                if r["zoom"] >= 8:
                    break
            check(r["zoom"] == 8, "8 倍にした")
            before = mm(z)
            px, py = round(s["width"] * 0.6), round(s["height"] * 0.55)
            after = z.call({"cmd": "minimap.click", "x": px, "y": py})
            cx, cy = center(after["frame"])
            check(after["scroll"] != before["scroll"], f"押すとスクロールが動く（{before['scroll']} → {after['scroll']}）")
            check(abs(cx - px) <= 2 and abs(cy - py) <= 2, f"押した位置が枠の真ん中になる（押した ({px}, {py})、枠の真ん中 ({cx:.1f}, {cy:.1f})）")
            shot(z, shots, "minimap_zoom8.png")

            # 描くと縮小図が変わる（押した位置のマスに描く）
            scale = after["scale"]
            cell = [int(px / (16 * scale)), int(py / (16 * scale))]
            png0 = mm(z, png=True)["png"]
            builds0 = after["builds"]
            z.call({"cmd": "selectBlock", "block": 0x0E})
            z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": cell})
            time.sleep(0.5)
            s = mm(z, png=True)
            check(s["builds"] > builds0, f"描いたあと縮小図を作り直す（{builds0} → {s['builds']} 回）")
            check(s["png"] != png0, "描くと縮小図の画素が変わる")
            z.call({"cmd": "key", "key": "z", "ctrl": True})
            time.sleep(0.5)
            check(mm(z, png=True)["png"] == png0, "戻すと縮小図も元に戻る")

            # イベントの種類の表示
            n0 = mm(z)["events"]
            z.call({"cmd": "action", "id": "view.eventKind.person"})
            n1 = mm(z)["events"]
            z.call({"cmd": "action", "id": "view.eventKind.person"})
            check(n1 < n0 and mm(z)["events"] == n0, f"人を隠すと人の点が消え、戻すと出る（{n0} → {n1}）")

            # タブ
            z.call({"cmd": "tab", "name": "movement"})
            check(mm(z)["frame"] is not None, "移動エリアのタブでも枠を出す")
            z.call({"cmd": "tab", "name": "event"})
            check(mm(z)["frame"] is not None, "イベントのタブでも枠を出す")
            z.call({"cmd": "tab", "name": "wild"})
            check(mm(z)["frame"] is None, "野生のタブでは出さない")
            z.call({"cmd": "tab", "name": "map"})

            # 切り替えの時間と縮小図を作る時間（目安）
            rows = []
            builds = mm(z)["builds"]
            for bank, m in SWITCH_MAPS:
                sw = z.call({"cmd": "selectMap", "bank": bank, "map": m})["switchMs"]
                time.sleep(0.15)  # 縮小図はメインの絵を出したあとに作る
                s = mm(z)
                rows.append((bank, m, sw, s["buildMs"], s["width"], s["height"]))
            check(s["builds"] == builds + len(SWITCH_MAPS), f"切り替えごとに 1 回だけ作る（{s['builds'] - builds} 回）")
            for bank, m, sw, b, ww, hh in rows:
                print(f"情報 {bank}.{m}: 切り替え {sw}ms、縮小図 {ww}×{hh} を {b}ms")
            check(all(r[4] > 0 for r in rows), "どのマップでも縮小図を作る")

            z.call({"cmd": "action", "id": "view.minimap"})
            s = mm(z)
            check(not s["open"] and s["width"] == 0 and not s["setting"]["show"], "もう一度で閉じ、縮小図を捨てる")
            z.call({"cmd": "action", "id": "view.minimap"})
            time.sleep(1.0)  # 個人設定の書き込み（300ms 後）を待つ
        with Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
            z.call({"cmd": "open", "rom": args.rom})
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            s = mm(z)
            check(s["open"] and s["width"] > 0, "次に起動して ROM を開くと、前回のとおり出る")
            time.sleep(0.5)
            check(mm(z)["town"] is not None, "タウンマップの拡大も前回のとおり出る")
            shot(z, shots, "minimap_restart.png")
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
