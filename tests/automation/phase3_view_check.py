"""Phase3 の表示・ホバー・スタンプの機能（#228 ほか）を、素の ROM だけで確かめる（プロジェクトフォルダは写しだけを使う）。

  python tests/automation/phase3_view_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>] [--only <名前> ...]

- 起動は --automation・--profile（一時フォルダ）・--mute-audio・画面外。ROM には書き込まない。
- 見ること（`--only` で選べる。名前は下の CHECKS の鍵）:
  - layoutShared: 場所の設定タブの「配置の共有」。素の BPRJ の 5.4 は 17 枚で共有していて、一覧のマップを押すと開く。
    共有していないマップ（3.0）では隠れる。かんたん表示とくわしく表示の両方。
  - hover: イベントのホバーの吹き出し（#226）。店の品物、もらえるアイテム、トレーナー、同じマスの 2 つ、0.4 秒の待ち、押すと消える。
  - hoverAsm（`--chronos` を渡したとき）: .s のラベルを付けたイベントの要約、ラベルが .s に無いときの知らせ。
    ラベルはメモリの上だけで変えて元に戻す（写しにも書かない）。
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
from zz import Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def save_png(data, path: pathlib.Path) -> None:
    png = data if isinstance(data, str) else data.get("png") or data.get("data")
    path.write_bytes(base64.b64decode(png))


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str, part: str | None = None) -> None:
    if not shots:
        return
    data = z.call({"cmd": "ui.shot", "id": part}) if part else z.call({"cmd": "screenshot"})
    save_png(data, shots / name)


def check_layout_shared(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    # 場所の設定タブの下の方まで見えるように、窓を縦に大きくする（画面外なので見た目は変わらない）。
    z.call({"cmd": "resize", "width": 1280, "height": 1500})
    z.call({"cmd": "selectMap", "bank": 5, "map": 4})
    z.call({"cmd": "tab", "name": "header"})
    z.call({"cmd": "click", "id": "header.mode.simple"})
    f = z.call({"cmd": "getField", "id": "easy.layoutShared"})
    check(f["visible"] and "17 枚" in f["value"], f"かんたん表示: 5.4 で「17 枚」が出る（{f['value']!r}）")
    items = z.call({"cmd": "ui.list", "root": "easy.layoutShared.list"})
    buttons = [i for i in items if str(i.get("id", "")).startswith("easy.layoutShared.map:")]
    check(len(buttons) == 16, f"かんたん表示: 自分以外の 16 枚が押せる（{len(buttons)} 個）")
    shot(z, shots, "p3_layout_shared_simple.png", "easy.layoutShared.list")
    shot(z, shots, "p3_layout_shared_simple_window.png")
    if buttons:
        target = buttons[0]["id"].split(":", 1)[1]
        z.call({"cmd": "click", "id": buttons[0]["id"]})
        time.sleep(0.5)
        st = z.call({"cmd": "state"})
        opened = st.get("map") or {}
        check(f"{opened.get('bank')}.{opened.get('map')}" == target, f"一覧の {target} を押すと開く（開いたのは {opened.get('bank')}.{opened.get('map')}）")
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "header"})
    f = z.call({"cmd": "getField", "id": "easy.layoutShared"})
    check(not f["visible"], "かんたん表示: 共有していない 3.0 では隠れる")

    z.call({"cmd": "click", "id": "header.mode.classic"})
    z.call({"cmd": "selectMap", "bank": 5, "map": 4})
    z.call({"cmd": "tab", "name": "header"})
    f = z.call({"cmd": "getField", "id": "header.layoutShared"})
    check(f["visible"] and "17 枚" in f["value"], f"くわしく表示: 5.4 で「17 枚」が出る（{f['value']!r}）")
    shot(z, shots, "p3_layout_shared_classic_window.png")
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    f = z.call({"cmd": "getField", "id": "header.layoutShared"})
    check(not f["visible"], "くわしく表示: 共有していない 3.0 では隠れる")
    z.call({"cmd": "click", "id": "header.mode.simple"})


def hover_text(z: Zigzagu, kind: str, index: int) -> str:
    return z.call({"cmd": "event.hover", "kind": kind, "index": index})["text"]


def check_hover(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    z.call({"cmd": "resize", "width": 1280, "height": 900})
    z.call({"cmd": "selectMap", "bank": 5, "map": 3})
    z.call({"cmd": "tab", "name": "event"})
    t0 = time.time()
    text = hover_text(z, "person", 0)
    check("ショップ: モンスターボール、キズぐすり" in text, f"5.3 の店員: 品物が出る（{time.time() - t0:.2f} 秒）")
    z.call({"cmd": "selectMap", "bank": 3, "map": 19})
    z.call({"cmd": "tab", "name": "event"})
    text = hover_text(z, "person", 0)
    check("アイテム: キズぐすり" in text and "「わたし フレンドリィ ショップの" in text, "1 番道路の店員: もらえるアイテムとセリフが出る")
    z.call({"cmd": "selectMap", "bank": 4, "map": 3})
    z.call({"cmd": "tab", "name": "event"})
    text = hover_text(z, "trap", 0)
    check("トレーナー 0x146" in text, "研究所のスクリプトタイル: ライバルのトレーナーの番号と戦闘前の文が出る")
    check(text.count("スクリプト ") >= 2, "同じマスのスクリプトタイル 2 つを区切って並べる")
    # マウスを止めると 0.4 秒後に出る（自動操作の hover は pointermove を送るだけ）
    z.call({"cmd": "event.hover.hide"})
    st = z.call({"cmd": "event.state"})
    p = st["events"]["persons"][3]
    z.call({"cmd": "mouse", "target": "event", "cell": [p["x"], p["y"]], "action": "hover"})
    early = z.call({"cmd": "event.hover.state"})
    time.sleep(0.9)
    late = z.call({"cmd": "event.hover.state"})
    check(not early["visible"] and late["visible"] and "オーキド" in late["text"], "マウスを止めると 0.4 秒後に吹き出しが出る")
    shot(z, shots, "p3_event_hover.png")
    z.call({"cmd": "mouse", "target": "event", "cell": [p["x"], p["y"]], "action": "down"})
    gone = z.call({"cmd": "event.hover.state"})
    z.call({"cmd": "mouse", "target": "event", "cell": [p["x"], p["y"]], "action": "up"})
    check(not gone["visible"], "ボタンを押すと消える")
    z.call({"cmd": "tab", "name": "map"})
    try:
        hover_text(z, "person", 0)
        check(False, "イベントタブ以外では event.hover がエラーになる")
    except Exception:  # noqa: BLE001
        check(True, "イベントタブ以外では event.hover がエラーになる")


def check_hover_asm(z: Zigzagu, shots: pathlib.Path | None, ctx: dict) -> None:
    """Chronos の写し（読むだけ）で、.s のラベルを付けたイベントの要約。ラベルはメモリの上だけで変え、出力しない。"""
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "script.setLabel", "bank": 3, "map": 0, "target": "person", "index": 0, "label": "EventScript_TestFixture_Famicom", "kind": "npc"})
    z.call({"cmd": "script.setLabel", "bank": 3, "map": 0, "target": "sign", "index": 1, "label": "EventScript_Nope"})
    t0 = time.time()
    text = hover_text(z, "person", 0)
    first = time.time() - t0
    check("ラベル: EventScript_TestFixture_Famicom" in text and "トレーナー 0x19E" in text and "ポケモン: フシギダネ Lv.30" in text,
          f".s のラベル: セリフ・ポケモン・トレーナーが出る（初回 {first:.2f} 秒、索引を作る分を含む）")
    t0 = time.time()
    hover_text(z, "person", 0)
    check(time.time() - t0 < 0.5, f"2 回目は覚えた答え（{time.time() - t0:.3f} 秒）")
    text = hover_text(z, "sign", 1)
    check("EventScript_Nope が .s に見つかりません" in text and "ROM のスクリプトを出します" in text, "ラベルが .s に無ければ知らせて ROM のスクリプトを出す")
    shot(z, shots, "p3_event_hover_asm.png")
    z.call({"cmd": "undo"})
    z.call({"cmd": "undo"})


CHECKS = {
    "layoutShared": check_layout_shared,
    "hover": check_hover,
}


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--chronos", help="Chronos のフォルダの写し（読むだけ。.s のラベルの要約を確かめる）")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    names = [n for n in (args.only or list(CHECKS)) if n in CHECKS]
    with tempfile.TemporaryDirectory(prefix="zzm-p3view-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": args.rom})
        ctx: dict = {"rom": args.rom}
        for name in names:
            print(f"== {name}")
            try:
                CHECKS[name](z, shots, ctx)
            except Exception as e:  # noqa: BLE001
                check(False, f"{name}: 例外 {e}")
    if args.chronos and (not args.only or "hoverAsm" in args.only):
        root = pathlib.Path(args.chronos)
        with tempfile.TemporaryDirectory(prefix="zzm-p3view-", ignore_cleanup_errors=True) as profile, Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
            z.call({"cmd": "open", "rom": str(root / "base" / "BPRJ0.gba"), "project": str(root / "cfru")})
            print("== hoverAsm")
            try:
                check_hover_asm(z, shots, {})
            except Exception as e:  # noqa: BLE001
                check(False, f"hoverAsm: 例外 {e}")
    print(f"失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
