"""ミニマップ（Phase7 #511、#542 から別ウィンドウ）を、素の ROM だけで確かめる（出力しない）。

  python tests/automation/minimap_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- 既定は閉じていて、縮小図も作らない。表示 > ミニマップ で別ウィンドウ（ラベル minimap）が開き、長い辺が 200 画素までの縮小図が出る。
- 縮小図にはイベントの点を出さない（イベントの種類を隠しても、ウィンドウの絵は変わらない）。
- 8 倍にしてウィンドウの縮小図を押すと、押した位置が表示の真ん中に来る（見えている範囲の枠の真ん中が押した位置）。
- 描くと、少し後に縮小図が作り直されてウィンドウの画素が変わる。戻すと元の絵に戻る。
- 野生のタブでは縮小図を出さない。表示 > ミニマップ をもう一度押すか、ウィンドウの × で閉じる（× でも個人設定に残る）。
- ウィンドウの「タウンマップも出す」で、タウンマップの現在地のまわりの広い範囲を 2 倍で出す・隠す（個人設定に残す。#570）。
  ワールドマップエディターで地名の位置を変えると、出力しなくても拡大の枠と絵がすぐ変わり、取り消すと戻る。
- 次に起動して ROM を開くと、前回のとおりウィンドウが開き、タウンマップの拡大も出る。
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
from zz import Zigzagu, shot, wait_window  # noqa: E402

failures: list[str] = []
SWITCH_MAPS = [(3, 1), (3, 3), (3, 19), (4, 1), (1, 1), (3, 37), (3, 45), (3, 50), (5, 0), (3, 0)]
W = "minimap"


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def mm(z: Zigzagu, **kw) -> dict:
    return z.call({"cmd": "minimap.state", **kw})


def win(z: Zigzagu) -> dict:
    """ウィンドウの中の状態（メインから届いたものを描き終えてから）。"""
    time.sleep(0.15)
    return z.call({"cmd": "state", "window": W})


def png(z: Zigzagu, id_: str = "minimap.canvas") -> str:
    time.sleep(0.15)
    return z.call({"cmd": "canvasPng", "window": W, "id": id_})["png"]


def center(frame: dict) -> tuple[float, float]:
    return frame["x"] + frame["width"] / 2, frame["y"] + frame["height"] / 2


def win_shot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if not shots:
        return
    r = z.call({"cmd": "screenshot", "window": W})
    (shots / name).write_bytes(base64.b64decode(r if isinstance(r, str) else r["png"]))


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
            labels = [w["label"] for w in z.call({"cmd": "windows"})]
            check(not s["open"] and s["builds"] == 0 and s["width"] == 0 and W not in labels, "既定は閉じていて、ウィンドウも縮小図も作らない")

            z.call({"cmd": "action", "id": "view.minimap"})
            check(wait_window(z, W), "表示 > ミニマップ で別ウィンドウが開く")
            s = mm(z)
            st = z.call({"cmd": "state"})["map"]
            w, h = st["width"], st["height"]
            check(s["open"] and s["ready"] and s["setting"]["show"], "ウィンドウの準備ができ、個人設定に残す")
            long_side = max(w, h) * 16
            exp_w = round(w * 16 * min(1, 200 / long_side))
            check(max(s["width"], s["height"]) <= 200 and abs(s["width"] - exp_w) <= 1, f"縮小図は長い辺が 200 画素まで（{s['width']}×{s['height']}、マップ {w}×{h}）")
            check(0 < s["sentBytes"] <= 200 * 200 * 4 * 4 // 3 + 4, f"送る縮小図は 200×200 の RGBA 以下（{s['sentBytes']} 文字）")
            ws = win(z)
            check(ws["shown"] and ws["thumb"] == {"width": s["width"], "height": s["height"]} and ws["frame"] == s["frame"], f"ウィンドウに縮小図と枠が出る（{ws['thumb']}、表示の倍率 {ws['displayScale']}）")
            check("ミニマップ" in ws["title"], f"ウィンドウの題名（{ws['title']}）")
            win_shot(z, shots, "minimap_window.png")
            shot(z, shots, "minimap_main.png")

            # イベントの点は出さない（人を隠しても絵が変わらない）
            p0 = png(z)
            z.call({"cmd": "action", "id": "view.eventKind.person"})
            p1 = png(z)
            z.call({"cmd": "action", "id": "view.eventKind.person"})
            check(p0 == p1, "イベントの点を出さない（人を隠しても縮小図の絵は同じ）")

            # タウンマップの拡大（ウィンドウのチェック）
            z.call({"cmd": "setField", "window": W, "id": "minimap.town", "value": True})
            time.sleep(0.8)
            s = mm(z)
            tz = s["town"]
            check(tz is not None and tz["loaded"] and tz["area"] is not None, f"タウンマップの拡大を出す（{tz and tz['text']}）")
            ar0 = tz["area"] if tz else None
            check(ar0 is not None and ar0["scale"] == 2 and ar0["width"] >= 11 and ar0["height"] >= 8, f"現在地のまわりの広い範囲（面の 3 分の 1 以上）を 2 倍（{ar0}）")
            check(s["setting"].get("town") is True, "チェックを個人設定に残す")
            ws = win(z)
            check(ws["town"] is not None and ws["town"]["width"] == tz["area"]["width"] * 8 * 2 and ws["town"]["text"] == tz["text"], f"ウィンドウに拡大と地名が出る（{ws['town']}）")
            ta = ws["town"]["area"] if ws["town"] else {"width": 0, "height": 0}
            check(ar0 is not None and ar0["width"] == min(22, ta["width"] // 16) and ar0["height"] == min(15, ta["height"] // 16), f"ウィンドウの大きさ（{ta}）に入るだけのマスを出す")
            fr = tz["frame"]["rect"] if tz else None
            ar = tz["area"] if tz else None
            check(bool(fr and ar and ar["x"] <= fr["x"] and ar["y"] <= fr["y"] and fr["x"] + fr["width"] <= ar["x"] + ar["width"]), "地名の枠が拡大の範囲に入る")
            check(ws["stage"]["height"] >= 100, f"拡大を足してもウィンドウが伸び、縮小図の場所が残る（{ws['stage']}）")
            win_shot(z, shots, "minimap_window_town.png")

            # ワールドマップエディターで地名の位置を変えると、出力しなくても拡大がすぐ変わる（#570）。取り消すと戻る
            z.call({"cmd": "action", "id": "tools.worldMap"})
            check(wait_window(z, "world-map"), "ワールドマップエディターを開く")
            for _ in range(100):
                try:
                    if z.call({"cmd": "state", "window": "world-map"}).get("loaded"):
                        break
                except Exception:  # noqa: BLE001  準備の途中
                    pass
                time.sleep(0.2)
            town_png0 = png(z, "minimap.townCanvas")
            rect0 = mm(z)["town"]["frame"]["rect"]
            hist0 = z.call({"cmd": "state"})["history"]
            wm = {"window": "world-map"}
            z.call({"cmd": "setField", **wm, "id": "Cbo_Anzahl", "value": 0})
            z.call({"cmd": "setField", **wm, "id": "Cbo_Wert_NamenListe", "value": 0})
            z.call({"cmd": "setField", **wm, "id": "Txt_PosX", "value": str(rect0["x"] + 2)})
            z.call({"cmd": "setField", **wm, "id": "Txt_PosY", "value": str(rect0["y"] - 1)})
            z.call({"cmd": "click", **wm, "id": "Cmd_NameSpeichern"})
            time.sleep(0.6)
            rect1 = mm(z)["town"]["frame"]["rect"]
            check(rect1["x"] == rect0["x"] + 2 and rect1["y"] == rect0["y"] - 1, f"ワールドマップエディターで位置を変えると、出力しなくても枠が動く（{rect0} → {rect1}）")
            check(png(z, "minimap.townCanvas") != town_png0, "ミニマップのタウンマップの絵の画素が変わる")
            win_shot(z, shots, "minimap_window_town_moved.png")
            if shots:
                r = z.call({"cmd": "screenshot", "window": "world-map"})
                (shots / "minimap_world_map.png").write_bytes(base64.b64decode(r if isinstance(r, str) else r["png"]))
            z.call({"cmd": "key", "key": "z", "ctrl": True})
            time.sleep(0.6)
            check(z.call({"cmd": "state"})["history"] == hist0 and mm(z)["town"]["frame"]["rect"] == rect0, "取り消すと枠も戻る")
            check(png(z, "minimap.townCanvas") == town_png0, "取り消すと絵も元に戻る")
            z.call({"cmd": "close", "window": "world-map"})
            wait_window(z, "world-map", present=False)
            texts = {}
            for bank, m in [(4, 1), (1, 0), (3, 19)]:
                z.call({"cmd": "selectMap", "bank": bank, "map": m})
                time.sleep(0.2)
                t = mm(z)["town"]
                texts[f"{bank}.{m}"] = (t["text"], t["area"] is not None, win(z)["town"]["text"])
            print("情報 タウンマップの拡大:", texts)
            check(all(isinstance(v[0], str) and v[0] and v[0] == v[2] for v in texts.values()), "ほかのマップでも地名か「場所がありません」を出し、ウィンドウにも届く")
            check(all(v[1] or v[0] == "タウンマップに場所がありません" for v in texts.values()), "場所が無いマップは「タウンマップに場所がありません」")
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            z.call({"cmd": "setField", "window": W, "id": "minimap.town", "value": False})
            time.sleep(0.5)
            s = mm(z)
            check(s["town"] is None and s["setting"].get("town") is False and win(z)["town"] is None, "チェックを外すと拡大を捨てる")
            s = z.call({"cmd": "minimap.town", "on": True})
            time.sleep(0.3)
            check(z.call({"cmd": "getField", "window": W, "id": "minimap.town"})["checked"] is True, "自動操作の minimap.town でもウィンドウの印が合う")

            # 8 倍にしてウィンドウの縮小図を押す
            for _ in range(8):
                r = z.call({"cmd": "zoom.wheel", "cell": [w // 2, h // 2], "delta": -1})
                if r["zoom"] >= 8:
                    break
            check(r["zoom"] == 8, "8 倍にした")
            before = mm(z)
            ws = win(z)
            check(ws["frame"] == before["frame"], "拡大するとウィンドウの枠も小さくなる")
            ds = ws["displayScale"]
            px, py = round(s["width"] * 0.6), round(s["height"] * 0.55)
            for kind in ("down", "up"):
                z.call({"cmd": "pointer", "window": W, "id": "minimap.canvas", "type": kind, "x": px * ds, "y": py * ds})
            time.sleep(0.3)
            after = mm(z)
            cx, cy = center(after["frame"])
            check(after["scroll"] != before["scroll"], f"ウィンドウで押すとメインのスクロールが動く（{before['scroll']} → {after['scroll']}）")
            check(abs(cx - px) <= 2 and abs(cy - py) <= 2, f"押した位置が枠の真ん中になる（押した ({px}, {py})、枠の真ん中 ({cx:.1f}, {cy:.1f})）")
            check(win(z)["frame"] == after["frame"], "ウィンドウの枠も動く")
            # ドラッグ
            z.call({"cmd": "pointer", "window": W, "id": "minimap.canvas", "type": "down", "x": px * ds, "y": py * ds})
            z.call({"cmd": "pointer", "window": W, "id": "minimap.canvas", "type": "move", "x": (px - 20) * ds, "y": (py - 10) * ds})
            z.call({"cmd": "pointer", "window": W, "id": "minimap.canvas", "type": "up", "x": (px - 20) * ds, "y": (py - 10) * ds})
            time.sleep(0.3)
            cx2, cy2 = center(mm(z)["frame"])
            check(abs(cx2 - (px - 20)) <= 2 and abs(cy2 - (py - 10)) <= 2, f"ドラッグでも付いてくる（枠の真ん中 ({cx2:.1f}, {cy2:.1f})）")
            win_shot(z, shots, "minimap_window_zoom8.png")
            z.call({"cmd": "minimap.click", "x": px, "y": py})

            # 描くと縮小図が変わる（押した位置のマスに描く）
            scale = after["scale"]
            cell = [int(px / (16 * scale)), int(py / (16 * scale))]
            png0 = png(z)
            builds0 = mm(z)["builds"]
            z.call({"cmd": "selectBlock", "block": 0x0E})
            z.call({"cmd": "mouse", "target": "map", "action": "click", "cell": cell})
            time.sleep(0.6)
            s = mm(z)
            check(s["builds"] > builds0, f"描いたあと縮小図を作り直して送る（{builds0} → {s['builds']} 回）")
            check(png(z) != png0, "描くとウィンドウの縮小図の画素が変わる")
            z.call({"cmd": "key", "key": "z", "ctrl": True})
            time.sleep(0.6)
            check(png(z) == png0, "戻すとウィンドウの縮小図も元に戻る")

            # 送るのは変わったときだけ（スクロールだけなら縮小図を作り直さない）
            b = mm(z)["builds"]
            z.call({"cmd": "minimap.click", "x": px - 30, "y": py - 30})
            time.sleep(0.3)
            check(mm(z)["builds"] == b, "スクロールだけでは縮小図を作り直さない（枠だけ送る）")

            # タブ
            z.call({"cmd": "tab", "name": "movement"})
            check(mm(z)["frame"] is not None and win(z)["shown"], "移動エリアのタブでも枠を出す")
            z.call({"cmd": "tab", "name": "event"})
            check(mm(z)["frame"] is not None and win(z)["shown"], "イベントのタブでも枠を出す")
            z.call({"cmd": "tab", "name": "wild"})
            ws = win(z)
            check(mm(z)["frame"] is None and not ws["shown"] and ws["note"], f"野生のタブでは出さない（{ws['note']}）")
            z.call({"cmd": "tab", "name": "map"})

            # 切り替えの時間と縮小図を作る時間（目安）
            rows = []
            builds = mm(z)["builds"]
            for bank, m in SWITCH_MAPS:
                sw = z.call({"cmd": "selectMap", "bank": bank, "map": m})["switchMs"]
                time.sleep(0.15)  # 縮小図はメインの絵を出したあとに作る
                s = mm(z)
                rows.append((bank, m, sw, s["buildMs"], s["width"], s["height"], s["sentBytes"]))
            check(s["builds"] == builds + len(SWITCH_MAPS), f"切り替えごとに 1 回だけ作る（{s['builds'] - builds} 回）")
            for bank, m, sw, b, ww, hh, sb in rows:
                print(f"情報 {bank}.{m}: 切り替え {sw}ms、縮小図 {ww}×{hh} を {b}ms（送る {sb} 文字）")
            check(all(r[4] > 0 for r in rows), "どのマップでも縮小図を作る")
            check(win(z)["thumb"] == {"width": s["width"], "height": s["height"]}, "最後のマップの縮小図がウィンドウに届く")

            # 閉じる（メニュー）
            z.call({"cmd": "action", "id": "view.minimap"})
            check(wait_window(z, W, present=False), "もう一度押すとウィンドウが閉じる")
            s = mm(z)
            check(not s["open"] and s["width"] == 0 and not s["setting"]["show"], "閉じると縮小図を捨て、個人設定に残す")
            # 閉じる（ウィンドウの ×）
            z.call({"cmd": "action", "id": "view.minimap"})
            check(wait_window(z, W), "開き直す")
            z.call({"cmd": "close", "window": W})
            check(wait_window(z, W, present=False), "ウィンドウの × で閉じる")
            time.sleep(0.3)
            s = mm(z)
            check(not s["open"] and not s["setting"]["show"], "× で閉じても個人設定に残す")
            z.call({"cmd": "action", "id": "view.minimap"})
            check(wait_window(z, W), "もう一度開く")
            time.sleep(1.0)  # 個人設定の書き込み（300ms 後）を待つ
        with Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
            z.call({"cmd": "open", "rom": args.rom})
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            check(wait_window(z, W), "次に起動して ROM を開くと、前回のとおりウィンドウが開く")
            time.sleep(0.8)
            s = mm(z)
            check(s["open"] and s["width"] > 0, "縮小図も出る")
            check(s["town"] is not None and win(z)["town"] is not None, "タウンマップの拡大も前回のとおり出る")
            win_shot(z, shots, "minimap_restart.png")
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
