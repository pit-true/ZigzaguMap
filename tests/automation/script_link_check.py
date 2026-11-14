"""スクリプト連携の画面（#198・#200・#202・#203・#206・#207・#208）を、写しで画面の部品から確かめる。

  python tests/automation/script_link_check.py [--only nd|chronos] [--exe <zigzagumap.exe>] [--config <tests/realcopy の設定>]
      [--shots <フォルダ>] [--no-build]

- 写しは tests/realcopy と同じもの（local.config.json の copyRoot の下。無ければ作る）を使い、写しのテキストファイルは最後に元へ戻す。
  ユーザーの実フォルダは読むだけ。起動は --profile（写し先の下）・--mute-audio・画面外。
- 確かめること:
  1. イベントを置くとラベルとひな形が付き、イベントタブのスクリプトのラベルの欄に出る（オフセットの欄は隠れる）
  2. 欄に入力すると .s のラベルの一覧が出て、Enter で決まる（元に戻せる）
  3. 「スクリプトを開く」でエディタのそのラベルの行が開く
  4. 素の ROM のスクリプトの読み取り専用のタブと「.s に取り込む」の一覧（ダイアログ）
  5. マップスクリプトのパネル（場所の設定タブのかんたん表示）。縦にスクロールする枠の中のパネルを ui.shot で撮っても落ちず（#216）、
     見えていない部品はエラーになる
  6. F2 のラベル名の変更がイベントのラベルにも反映される
  7. ビルドの欄でビルドし、わざと入れた誤りがエラーの一覧に出て、押すとその行へ移る（--no-build で飛ばす）
- --shots を付けると、新しい画面のスクリーンショットを書く。
失敗があれば終了コード 1。
"""
from __future__ import annotations

import argparse
import base64
import os
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "realcopy"))
from lib import config, fixtures  # noqa: E402
from lib.app import AppError, Zigzagu  # noqa: E402
from lib.link import SCRIPT, TextSnapshot  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> bool:
    print(("OK   " if cond else "NG   ") + what, flush=True)
    if not cond:
        failures.append(what)
    return cond


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str, window: str | None = None) -> None:
    if shots is None:
        return
    req = {"cmd": "screenshot"}
    if window:
        req["window"] = window
    data = z.call(req)
    b64 = data["png"] if isinstance(data, dict) else data
    path = shots / name
    path.write_bytes(base64.b64decode(b64))
    print(f"     -> {path}")


def wait_editor(z: Zigzagu, timeout: float = 20) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        w = z.call({"cmd": "windows"})
        if any(x["label"] == "script-editor" and x.get("ready") for x in w):
            time.sleep(0.5)
            return
        time.sleep(0.2)
    raise RuntimeError("スクリプトエディタが開きません")


def run(fx, z: Zigzagu, shots: pathlib.Path | None, build: bool) -> None:
    proj = fx.project_path
    nd = fx.name == "nd"
    z.open_fixture(fx)
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "event"})
    before = z.call({"cmd": "event.state"})["events"]
    n = len(before["persons"])
    z.call({"cmd": "scripts.table", "action": "add", "entry": {"bank": 3, "map": 0, "name": "ZzLinkTest", "script": SCRIPT, "strings": None}, "create": True})
    z.call({"cmd": "command", "name": "addEvent", "args": {"bank": 3, "map": 0, "kind": "person", "x": 2, "y": 2}})
    z.call({"cmd": "command", "name": "addEvent", "args": {"bank": 3, "map": 0, "kind": "person", "x": 3, "y": 2}})
    z.call({"cmd": "script.settle"})
    npc, npc2 = f"ZzLinkTest_Npc{n}", f"ZzLinkTest_Npc{n + 1}"

    # 1. ラベルの欄
    z.call({"cmd": "event.select", "kind": "person", "index": n})
    f = z.call({"cmd": "getField", "id": "event.person.label"})
    check(f.get("value") == npc and f.get("visible", True), f"ラベルの欄に {npc} が出る（{f.get('value')}）")
    off = z.call({"cmd": "ui.list", "root": "event.panel"})
    script_row = [x for x in off if x.get("id") == "event.person.script"]
    check(bool(script_row) and not script_row[0].get("visible", True), "ラベルが付いていればオフセットの欄は隠れる")
    shot(z, shots, "p2l_01_label_field.png")

    # 2. 入力と一覧、Enter
    z.call({"cmd": "ui.type", "id": "event.person.label", "text": f"Npc{n + 1}", "blur": False})
    time.sleep(0.3)
    items = [x["id"] for x in z.call({"cmd": "ui.list", "root": "event.person.label.list"}) if str(x.get("id", "")).startswith("event.person.label.option:")]
    check(f"event.person.label.option:{npc2}" in items, f"入力を含む .s のラベルが一覧に出る（{len(items)} 件）")
    shot(z, shots, "p2l_02_label_list.png")
    z.call({"cmd": "key", "id": "event.person.label", "key": "Enter"})
    labels = z.call({"cmd": "script.labels"})
    check(any(x["index"] == n and x["label"] == npc2 for x in labels["person"]), "Enter で一覧のラベルに決まる")
    z.call({"cmd": "undo"})
    labels = z.call({"cmd": "script.labels"})
    check(any(x["index"] == n and x["label"] == npc for x in labels["person"]), "元に戻すと前のラベルに戻る")

    # 3. スクリプトを開く
    z.call({"cmd": "event.select", "kind": "person", "index": n})
    z.call({"cmd": "click", "id": "event.person.openScript"})
    wait_editor(z)
    st = z.call({"cmd": "editor.state", "window": "script-editor"})
    text = z.call({"cmd": "editor.text", "window": "script-editor"})["text"].split("\n")
    line = st["cursor"]["line"] if st.get("cursor") else 0
    check(st.get("active") == SCRIPT and text[line - 1].startswith(f"{npc}:"), f"「スクリプトを開く」でラベルの行が開く（{st.get('active')}:{line}）")
    shot(z, shots, "p2l_03_editor_label.png", "script-editor")

    # 6. F2 のラベル名の変更（エディタの .s とイベントのラベル）
    r = z.call({"cmd": "editor.rename", "window": "script-editor", "from": npc2, "to": f"{npc2}_R"})["result"]
    check(r and r["count"] >= 1 and r["uses"] == 1, f"F2 のラベル名の変更（{r}）")
    labels = z.call({"cmd": "script.labels"})
    check(any(x["label"] == f"{npc2}_R" for x in labels["person"]), "イベントのラベルも新しい名前になる")
    z.call({"cmd": "editor.save", "window": "script-editor"})

    # 4. ROM のスクリプト
    source = before["persons"][0]["script"] if n > 0 and before["persons"][0]["script"] >= 0x08000000 else 0x08800300
    rom = z.call({"cmd": "script.rom", "bank": 3, "map": 0, "kind": "person", "index": 0, "pointer": source})
    time.sleep(0.5)
    st = z.call({"cmd": "editor.state", "window": "script-editor"})
    tab = next((t for t in st["tabs"] if t["path"] == rom["tab"]), None)
    check(tab is not None and tab["rom"] and tab["readOnly"], f"ROM のスクリプトが読み取り専用のタブで開く（{rom['tab']}）")
    shot(z, shots, "p2l_04_rom_tab.png", "script-editor")
    z.call({"cmd": "click", "id": "se.romImport", "window": "script-editor"})
    time.sleep(0.5)
    d = z.call({"cmd": "dialogs", "window": "script-editor"})["dialogs"]
    check(len(d) == 1 and ".s に取り込む" in d[0]["title"], "「.s に取り込む」で名前の一覧が出る")
    shot(z, shots, "p2l_05_rom_import.png", "script-editor")
    z.call({"cmd": "setField", "id": "romImport.label:0", "value": "ZzImported_Hero", "window": "script-editor"})
    z.call({"cmd": "dialog", "press": "取り込む", "window": "script-editor"})
    time.sleep(1.0)
    z.call({"cmd": "script.settle"})
    labels = z.call({"cmd": "script.labels"})
    check(any(x["index"] == 0 and x["label"] == "ZzImported_Hero" for x in labels["person"]), "一覧で変えた名前で取り込む")
    if nd:
        check("ZzImported_Hero:" in z.call({"cmd": "editor.text", "window": "script-editor", "path": SCRIPT})["text"], "開いている .s にはエディタの本文へ書き足す")

    # 5. マップスクリプトのパネル
    z.call({"cmd": "tab", "name": "header"})
    z.call({"cmd": "script.mapScripts", "action": "create"})
    ms = z.call({"cmd": "script.mapScripts", "action": "add", "type": 2})
    table = ms["table"]
    frame = next((i for i in table["items"] if i["type"] == 2), None) if table else None
    check(frame is not None and len(frame["conditions"]) == 1, "条件表の種類を足すと、条件の行とひな形が付く")
    off = z.call({"cmd": "ui.list", "root": "easy.ms"})
    check(not any("Offset" in str(x.get("id", "")) or "offset" in str(x.get("id", "")) for x in off), "パネルにオフセットの欄が無い")
    # 縦にスクロールする枠の中のパネルを撮る（#216。以前は画像の外を読みにいって落ちた）
    for when in ("先頭", "末尾"):
        if when == "末尾":
            z.call({"cmd": "scroll", "id": "easy.ms", "to": "end"})
        try:
            img = z.call({"cmd": "ui.shot", "id": "easy.ms"})
            check(img["width"] > 0 and img["height"] > 0, f"ui.shot easy.ms（{when}までスクロール）で見えている範囲を撮れる（{img['width']}x{img['height']}）")
        except AppError as e:
            # 先頭では、パネルが枠の下に隠れていればエラーになる（落ちないこと）。末尾では一部が見えているので撮れること
            check(when == "先頭" and "見えていません" in str(e), f"ui.shot easy.ms（{when}までスクロール）: {e}")
        except Exception as e:  # noqa: BLE001
            check(False, f"ui.shot easy.ms（{when}までスクロール）: {type(e).__name__}: {e}")
            time.sleep(1)
        check(z.proc is not None and z.proc.poll() is None, f"ui.shot easy.ms（{when}）のあともアプリが動いている")
        if z.proc is None or z.proc.poll() is not None:
            raise RuntimeError("アプリが落ちました")
    try:
        z.call({"cmd": "ui.shot", "id": "event.person.label"})
        check(False, "隠れているタブの部品の ui.shot はエラーになる")
    except AppError as e:
        check("見えていません" in str(e), f"隠れているタブの部品の ui.shot はエラーになる（{e}）")
    check(z.proc is not None and z.proc.poll() is None, "見えていない部品の ui.shot のあともアプリが動いている")
    shot(z, shots, "p2l_06_map_script_panel.png")
    z.call({"cmd": "tab", "name": "event"})

    if not build:
        return
    # 7. ビルドの欄とエラーの行へのジャンプ
    z.call({"cmd": "export"})
    z.call({"cmd": "editor.activate", "window": "script-editor", "path": SCRIPT})
    lines = z.call({"cmd": "editor.text", "window": "script-editor"})["text"].split("\n")
    bad = len(lines)
    z.call({"cmd": "editor.type", "window": "script-editor", "line": bad, "column": 1, "text": "\tzz_no_such_command 1\n"})
    z.call({"cmd": "editor.save", "window": "script-editor"})
    z.call({"cmd": "build.run", "window": "script-editor", "confirm": False})
    t0 = time.time()
    st = None
    while time.time() - t0 < 1800:
        st = z.call({"cmd": "build.state", "window": "script-editor"})
        if st.get("result") is not None and not st.get("running"):
            break
        time.sleep(2)
    probs = [p for p in (st or {}).get("problems", []) if p.get("path") == SCRIPT]
    check(st is not None and st["result"] and not st["result"]["ok"] and len(probs) >= 1, f"わざと入れた誤りがエラーの一覧に出る（{len(probs)} 件）")
    shot(z, shots, "p2l_07_build_error.png", "script-editor")
    if probs:
        i = st["problems"].index(probs[0])
        z.call({"cmd": "click", "id": f"build.problem:{i}", "window": "script-editor"})
        time.sleep(0.3)
        cur = z.call({"cmd": "editor.state", "window": "script-editor"})
        check(cur["active"] == SCRIPT and cur["cursor"]["line"] == probs[0]["line"], f"押すとその行へ移る（{cur['cursor']['line']} 行目）")


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["nd", "chronos"], action="append")
    ap.add_argument("--exe")
    ap.add_argument("--config")
    ap.add_argument("--shots")
    ap.add_argument("--no-build", action="store_true")
    args = ap.parse_args()
    cfg = config.load(args.config, args.exe)
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    for name in args.only or ["nd", "chronos"]:
        print(f"\n== {name}")
        fx = fixtures.get(cfg, name)
        fixtures.make_copy(fx, reuse=True)
        snap = TextSnapshot(fx.project_path, fx.copy_root)
        try:
            with Zigzagu(cfg, f"ui-{name}", cfg.zigzaguExe) as z:
                run(fx, z, shots if name == (args.only or ["nd"])[0] else None, not args.no_build)
        except (AppError, RuntimeError, OSError) as e:
            check(False, f"{type(e).__name__}: {e}")
        finally:
            print(f"写しのテキストファイルを元に戻しました（{snap.restore()} 件）")
    if failures:
        print(f"\n失敗 {len(failures)} 件")
        return 1
    print("\nすべて通りました")
    return 0


if __name__ == "__main__":
    sys.exit(main())
