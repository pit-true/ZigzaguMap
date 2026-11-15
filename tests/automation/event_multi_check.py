"""イベントの複数選択・まとめての移動・削除・複製（Phase5 #399）を、素の ROM だけで確かめる。

  python tests/automation/event_multi_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--work <出力の作業フォルダ>]

- 見ること: Shift＋クリックで人・ワープ・看板を混ぜて選べる。まとめてドラッグすると全部が同じだけ動き、マップの外へは出ず、
  1 回の元に戻すで戻る。Ctrl+D で写しを末尾に足し（欄は同じ、人の番号は足した位置）、1 回で消える。Shift＋ドラッグの矩形で選べる。
  Delete の確認は 1 回で、キャンセルなら何も変わらず、消すと 1 回で戻る。空いた所を押すと複数の選択をやめ、1 つだけのときの
  クリックとドラッグは今までと同じ。複製と移動を出力して読み直すと同じになる（--work の写しに出力する。ROM には書かない）。
"""
from __future__ import annotations

import argparse
import base64
import os
import pathlib
import shutil
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

failures: list[str] = []
BANK, MAP = 3, 0


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if not shots:
        return
    png = z.call({"cmd": "screenshot"})
    (shots / name).write_bytes(base64.b64decode(png if isinstance(png, str) else png["png"]))


def lists(st: dict) -> dict:
    ev = st["events"]
    return {"person": ev["persons"], "warp": ev["warps"], "sign": ev["signs"], "trap": ev["traps"]}


def pos(st: dict, kind: str, index: int) -> tuple[int, int]:
    e = lists(st)[kind][index]
    return e["x"], e["y"]


def click(z: Zigzagu, cell: tuple[int, int], **kw) -> dict:
    return z.call({"cmd": "mouse", "target": "event", "action": "click", "cell": list(cell), **kw})


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    ap.add_argument("--work")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    work = pathlib.Path(args.work) if args.work else pathlib.Path(tempfile.mkdtemp(prefix="zzm-multi-"))
    if work.exists():
        shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="zzm-multi-prof-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": args.rom})
        z.call({"cmd": "setting", "key": "showClones", "value": False})
        z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
        z.call({"cmd": "tab", "name": "event"})
        st = z.call({"cmd": "event.state"})
        w, h = z.call({"cmd": "state"})["map"]["width"], z.call({"cmd": "state"})["map"]["height"]
        start = st
        p0, w0, s0 = pos(st, "person", 0), pos(st, "warp", 0), pos(st, "sign", 0)
        counts0 = st["counts"]

        # 1. 1 つだけのクリックは今までと同じ
        click(z, p0)
        st = z.call({"cmd": "event.state"})
        check(st["kind"] == "person" and st["index"] == 0 and st["selected"] == [{"kind": "person", "index": 0}], "クリックで人 0 を 1 つだけ選ぶ")

        # 2. Shift＋クリックで足す
        click(z, w0, shift=True)
        click(z, s0, shift=True)
        st = z.call({"cmd": "event.state"})
        kinds = sorted(s["kind"] for s in st["selected"])
        check(kinds == ["person", "sign", "warp"], f"Shift＋クリックで人・ワープ・看板を選ぶ（{st['selected']}）")
        check(st["kind"] == "sign", "欄は最後に押した看板")
        shot(z, shots, "event_multi_1_select.png")
        # 外す
        click(z, w0, shift=True)
        check(len(z.call({"cmd": "event.state"})["selected"]) == 2, "もう一度 Shift＋クリックすると外れる")
        click(z, w0, shift=True)

        # 3. まとめてドラッグ（右へ 1、下へ 1。マップの中に収まる向き）
        dx = 1 if max(p0[0], w0[0], s0[0]) + 1 < w else -1
        dy = 1 if max(p0[1], w0[1], s0[1]) + 1 < h else -1
        z.call({"cmd": "mouse", "target": "event", "action": "drag", "cell": list(p0), "to": [p0[0] + dx, p0[1] + dy]})
        st = z.call({"cmd": "event.state"})
        moved = [pos(st, "person", 0), pos(st, "warp", 0), pos(st, "sign", 0)]
        expect = [(p0[0] + dx, p0[1] + dy), (w0[0] + dx, w0[1] + dy), (s0[0] + dx, s0[1] + dy)]
        check(moved == expect, f"まとめてドラッグで 3 つとも同じだけ動く（{moved}）")
        check(len(st["selected"]) == 3, "動かしたあとも 3 つ選んだまま")
        shot(z, shots, "event_multi_2_drag.png")
        z.call({"cmd": "undo"})
        st = z.call({"cmd": "event.state"})
        check([pos(st, "person", 0), pos(st, "warp", 0), pos(st, "sign", 0)] == [p0, w0, s0], "1 回の元に戻すで 3 つとも戻る")

        # 4. マップの外へは出さない（左上の外まで引っぱる）
        z.call({"cmd": "mouse", "target": "event", "action": "drag", "cell": list(p0), "to": [p0[0] - 40, p0[1] - 40]})
        st = z.call({"cmd": "event.state"})
        moved = [pos(st, "person", 0), pos(st, "warp", 0), pos(st, "sign", 0)]
        check(min(x for x, _ in moved) == 0 and min(y for _, y in moved) == 0 and all(0 <= x < w and 0 <= y < h for x, y in moved),
              f"マップの外へは出ず、端で止まる（{moved}）")
        z.call({"cmd": "undo"})

        # 5. Ctrl+D で複製
        z.call({"cmd": "key", "key": "d", "ctrl": True})
        st = z.call({"cmd": "event.state"})
        c = st["counts"]
        check(c["persons"] == counts0["persons"] + 1 and c["warps"] == counts0["warps"] + 1 and c["signs"] == counts0["signs"] + 1,
              f"Ctrl+D で 3 種類とも 1 つずつ増える（{c}）")
        copy_p = lists(st)["person"][-1]
        src_p = lists(start)["person"][0]
        same = {k: v for k, v in copy_p.items() if k not in ("x", "y", "localId")} == {k: v for k, v in src_p.items() if k not in ("x", "y", "localId")}
        check(same and copy_p["localId"] == counts0["persons"] + 1, "人の写しは欄（フラグ・スクリプト）が同じで、番号は足した位置")
        occupied = {(e["x"], e["y"]) for k in lists(start).values() for e in k}
        check((copy_p["x"], copy_p["y"]) not in occupied, f"写しはほかのイベントの無いマスに置く（{copy_p['x']}, {copy_p['y']}）")
        check(sorted((s["kind"], s["index"]) for s in st["selected"]) == sorted([("person", counts0["persons"]), ("warp", counts0["warps"]), ("sign", counts0["signs"])]),
              "写しを選ぶ")
        shot(z, shots, "event_multi_3_duplicate.png")
        z.call({"cmd": "undo"})
        check(z.call({"cmd": "event.state"})["counts"] == counts0, "1 回の元に戻すで写しが全部消える")

        # 6. 空いた所を押すと複数の選択をやめる
        free = next((x, y) for y in range(h) for x in range(w) if (x, y) not in occupied)
        z.call({"cmd": "event.selectMany", "items": [{"kind": "person", "index": 0}, {"kind": "warp", "index": 0}]})
        click(z, free)
        check(len(z.call({"cmd": "event.state"})["selected"]) == 1, "空いた所を押すと 1 つの選択に戻る")

        # 7. Shift＋ドラッグの矩形
        x0, y0 = min(p0[0], w0[0]), min(p0[1], w0[1])
        x1, y1 = max(p0[0], w0[0]), max(p0[1], w0[1])
        corner = next(((x, y) for x, y in [(x0, y0), (x1, y1), (x0, y1), (x1, y0)] if (x, y) not in occupied), None)
        if corner:
            other = (x1 + x0 - corner[0], y1 + y0 - corner[1])
            z.call({"cmd": "mouse", "target": "event", "action": "drag", "cell": list(corner), "to": list(other), "shift": True})
            st = z.call({"cmd": "event.state"})
            inside = sorted((k, i) for k, l in lists(start).items() for i, e in enumerate(l) if x0 <= e["x"] <= x1 and y0 <= e["y"] <= y1)
            got = sorted((s["kind"], s["index"]) for s in st["selected"])
            check(set(inside) <= set(got) and len(got) >= 2, f"Shift＋ドラッグの矩形の中を選ぶ（{got}）")
            check([pos(st, "person", 0), pos(st, "warp", 0)] == [p0, w0], "矩形の選択ではイベントは動かない")
            shot(z, shots, "event_multi_4_rect.png")
        else:
            check(False, "矩形の角に空いたマスが無い")

        # 8. Delete（確認は 1 回。キャンセルなら何も変わらない）
        z.call({"cmd": "event.selectMany", "items": [{"kind": "person", "index": 0}, {"kind": "warp", "index": 0}, {"kind": "sign", "index": 0}]})
        z.call({"cmd": "key", "key": "Delete"})
        t0 = time.time()
        dialog = None
        while time.time() - t0 < 15 and not dialog:
            dialog = next((d for d in z.call({"cmd": "dialogs"})["dialogs"] if d.get("title") == "イベントを削除"), None)
            time.sleep(0.1)
        check(bool(dialog) and "3 個のイベントを削除します" in dialog["text"], "Delete で 3 つまとめた確認が 1 回出る")
        shot(z, shots, "event_multi_5_delete_confirm.png")
        z.call({"cmd": "dialog", "press": "cancel"})
        time.sleep(0.2)
        check(z.call({"cmd": "event.state"})["counts"] == counts0, "キャンセルなら何も変わらない")
        r = z.call({"cmd": "event.deleteSelected", "confirm": False})
        c = r["counts"]
        check(r["ok"] and c["persons"] == counts0["persons"] - 1 and c["warps"] == counts0["warps"] - 1 and c["signs"] == counts0["signs"] - 1, f"3 つまとめて消える（{c}）")
        z.call({"cmd": "undo"})
        st = z.call({"cmd": "event.state"})
        check(st["counts"] == counts0 and st["events"] == start["events"], "1 回の元に戻すで 3 つとも戻る")

        # 9. フライトポジションは選べるが消さない・写さない
        if st["fly"]:
            z.call({"cmd": "event.selectMany", "items": [{"kind": "fly", "index": 0}, {"kind": "person", "index": 0}]})
            r = z.call({"cmd": "event.duplicate"})
            check(r["counts"]["persons"] == counts0["persons"] + 1 and "複製しません" in r["status"], f"フライトポジションは写さない（{r['status']}）")
            z.call({"cmd": "undo"})

        # 10. 写しと移動を出力して読み直すと同じになる
        z.call({"cmd": "event.selectMany", "items": [{"kind": "person", "index": 0}, {"kind": "warp", "index": 0}, {"kind": "sign", "index": 0}]})
        z.call({"cmd": "event.duplicate"})
        z.call({"cmd": "mouse", "target": "event", "action": "drag", "cell": list(p0), "to": [p0[0] + dx, p0[1]]})
        edited = z.call({"cmd": "event.state"})["events"]
        z.call({"cmd": "export", "dir": str(work)})
        z.call({"cmd": "open", "rom": args.rom, "project": str(work)})
        z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
        z.call({"cmd": "tab", "name": "event"})
        check(z.call({"cmd": "event.state"})["events"] == edited, "出力して読み直すと同じイベントになる")
    if not args.work:
        shutil.rmtree(work, ignore_errors=True)
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
