"""イベントの削除と複数行の文字列の写しでの確認（--delete。#220・#221）。

写しの ROM とプロジェクトを開き、次を順に確かめる（ND と Chronos の両方）。
0. 写しのビルド側を新しい版にする。ND は build-support のパッチ（string.py の複数行、map_project.py の rom_erase）を当て、
   Chronos は実フォルダ（読むだけ）の cfru/scripts/string.py・map_project.py と tools/check_text_width.py を写す。
1. マップ 3.0 に人を 1 人置き（ラベルとひな形）、エディタの「本文を編集」で文字列を複数行（`\\n` と `\\p` のあとで改行）にして保存する。
   `.string` に複数行で書かれ、Chronos は幅検査が通る。
2. 素の ROM のスクリプトのイベント（埋める範囲が 1 つ以上あるもの。人・看板・スクリプトタイル）を探し、確認のダイアログを出して消す。maps\\rom_erase.json に範囲が
   記録され（出力のとき）、元に戻すと記録も消え、やり直すと戻る。
3. 出力してビルドする。できた ROM で、記録した範囲がすべて 0xFF になり、複数行で書いた文字列のバイト列が 1 行で書いたときと同じ。
4. 1 で置いた人を、右クリックの「イベントを削除」で消す。.s の記述と .string の文字列（ND は _k も）が消え、Chronos は幅検査の
   登録からも消える。元に戻すと全部戻り、やり直すとまた消える。
写しのテキストファイル（eventscripts、maps、assembly\\overworld_scripts、strings、zigzagumap.json）は、最後に元へ戻す。
"""
from __future__ import annotations

import base64
import contextlib
import importlib.util
import os
import io
import json
import pathlib
import re
import shutil
import subprocess
import sys
import time

from .app import Zigzagu
from .fixtures import Fixture
from .guard import require_inside
from .link import TextSnapshot, read_symbols

BANK, MAP = 3, 0
SCRIPT = "assembly/overworld_scripts/zz_delete_test.s"
STRINGS = "strings/overworld_strings_zz_delete_test.string"
REPO = pathlib.Path(__file__).resolve().parents[3]
PATCHES = REPO / "build-support" / "patches"
ED = {"window": "script-editor"}
LONG = "こんにちは！\\nきょうは いいてんきだね\\pまたね\\nげんきでね"
# 新しい画面のスクリーンショットを置くフォルダ（環境変数 ZZM_RC_SHOTS。無ければ撮らない）
SHOTS = pathlib.Path(os.environ["ZZM_RC_SHOTS"]) if os.environ.get("ZZM_RC_SHOTS") else None


def _shot(z: Zigzagu, name: str, window: str | None = None) -> None:
    if not SHOTS:
        return
    SHOTS.mkdir(parents=True, exist_ok=True)
    png = z.call({"cmd": "screenshot", **({"window": window} if window else {})})
    (SHOTS / name).write_bytes(base64.b64decode(png if isinstance(png, str) else png["png"]))


LONG_WRAPPED = "こんにちは！\\n\nきょうは いいてんきだね\\p\nまたね\\n\nげんきでね"


def _apply_patch(cwd: pathlib.Path, patch: pathlib.Path, log) -> bool:
    """パッチを当てる（もう当ててあれば何もしない）。"""
    git = ["git", "-c", "core.autocrlf=false", "apply"]
    if subprocess.run(git + ["--check", "-R", str(patch)], cwd=cwd, capture_output=True).returncode == 0:
        log(f"当て済み: {patch.name}")
        return True
    r = subprocess.run(git + [str(patch)], cwd=cwd, capture_output=True, text=True)
    log(f"当てた: {patch.name}（{r.returncode}）{r.stderr.strip()}")
    return r.returncode == 0


def prepare_build_side(fx: Fixture, real: pathlib.Path | None, check, log) -> None:
    proj = fx.project_path
    if fx.name == "nd":
        check(_apply_patch(proj, PATCHES / "string-multiline.patch", log), "写しの string.py に複数行のパッチを当てる")
        check(_apply_patch(proj, PATCHES / "map_project-rom-erase-nd.patch", log), "写しの map_project.py に rom_erase のパッチを当てる")
    else:
        assert real is not None
        for rel in ["cfru/scripts/string.py", "cfru/scripts/map_project.py", "tools/check_text_width.py"]:
            dst = require_inside(fx.path(f"Chronos/{rel}"), fx.copy_root, "写す先")
            shutil.copy2(real / rel, dst)
        text = fx.path("Chronos/cfru/scripts/map_project.py").read_text(encoding="utf-8", errors="replace")
        check("rom_erase" in text, "写しの Chronos の map_project.py が rom_erase を読む版")


def encode(proj: pathlib.Path, text: str) -> bytes:
    """写しの string.py で 1 行の本文をバイト列にする（終端 0xFF を付ける）。"""
    scripts = str(proj / "scripts")
    sys.path.insert(0, scripts)
    try:
        spec = importlib.util.spec_from_file_location("zz_string_encoder", proj / "scripts" / "string.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.CharMap = str(proj / "charmap.tbl")
        with contextlib.redirect_stdout(io.StringIO()):
            out = module.ProcessString(text, 0)
    finally:
        sys.path.remove(scripts)
    return bytes(int(t, 16) for t in re.findall(r"0x[0-9a-fA-F]+", out)) + b"\xff"


def _wait_editor(z: Zigzagu, timeout: float = 30) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if any(w["label"] == "script-editor" and w.get("ready") for w in z.call({"cmd": "windows"})):
            return True
        time.sleep(0.1)
    return False


def _build(z: Zigzagu, timeout: int, log) -> bool:
    z.call({"cmd": "action", "id": "tools.build"})
    t0 = time.time()
    state = None
    while time.time() - t0 < timeout:
        try:
            state = z.call({"cmd": "build.state", **ED}, timeout=30)
            if state and state.get("result") is not None and not state.get("running"):
                break
        except Exception:  # noqa: BLE001  ウィンドウの準備ができるまで
            pass
        time.sleep(2)
    ok = bool(state and state.get("result") and state["result"]["ok"])
    if not ok and state:
        for line in z.call({"cmd": "build.log", **ED})["lines"][-30:]:
            log("  | " + line["line"])
    return ok


def _find_rom_event(z: Zigzagu, log) -> tuple[int, int, str, int, dict] | None:
    """埋める範囲が 1 つ以上ある、素の ROM のスクリプトのイベント（人・看板・スクリプトタイル）を、マップ一覧の順に探す。"""
    for item in z.call({"cmd": "tree.list"}):
        m = item.get("mapId")
        if not m:
            continue
        z.call({"cmd": "selectMap", "bank": m["bank"], "map": m["map"]})
        counts = z.call({"cmd": "event.state"})["counts"]
        for kind, key in (("person", "persons"), ("sign", "signs"), ("trap", "traps")):
            for i in range(counts[key]):
                plan = z.call({"cmd": "event.deletePlan", "kind": kind, "index": i})
                if plan["rom"] and plan["rom"]["erase"]:
                    log(f"消すイベント: マップ {m['bank']}.{m['map']} の {kind} {i}（{len(plan['rom']['erase'])} 件を埋める、{len(plan['rom']['keep'])} 件は埋めない）")
                    return m["bank"], m["map"], kind, i, plan
    return None


def delete_one(fx: Fixture, z: Zigzagu, check, log, timeout: int, real_chronos: pathlib.Path | None) -> None:
    proj = fx.project_path
    snap = TextSnapshot(proj, fx.copy_root)
    try:
        prepare_build_side(fx, real_chronos, check, log)
        _run(fx, z, proj, check, log, timeout)
    finally:
        log(f"写しのテキストファイルを戻した: {snap.restore()} 件")


def _run(fx: Fixture, z: Zigzagu, proj: pathlib.Path, check, log, timeout: int) -> None:
    nd = fx.name == "nd"
    z.open_fixture(fx)
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
    z.call({"cmd": "scripts.table", "action": "add", "entry": {"bank": BANK, "map": MAP, "name": "ZzDeleteTest", "script": SCRIPT, "strings": None}, "create": True})
    count = z.call({"cmd": "event.state"})["counts"]["persons"]
    z.call({"cmd": "command", "name": "addEvent", "args": {"bank": BANK, "map": MAP, "kind": "person", "x": 3, "y": 3}})
    z.call({"cmd": "script.settle"})
    labels = z.call({"cmd": "script.labels"})
    npc = next((x["label"] for x in labels["person"] if x["index"] == count), None)
    check(npc is not None, f"置いた人にラベルが付く（{npc}）")
    if npc is None:
        return
    text_label = f"gText_{npc}"

    # 1. 文字列を複数行にする（本文を編集）
    r = z.call({"cmd": "script.open", "bank": BANK, "map": MAP, "kind": "person", "index": count})
    check(bool(r.get("opened")) and _wait_editor(z), "エディタで置いた人のスクリプトを開く")
    z.call({"cmd": "editor.project", **ED})
    labels_k = [text_label] + ([f"{text_label}_k"] if nd else [])
    if SHOTS:
        # 「本文を編集」の入力欄（複数行）を出して撮る
        z.call({"cmd": "editor.stringEdit", "label": text_label, "text": LONG_WRAPPED, **ED})
        script_text = z.call({"cmd": "editor.text", "path": SCRIPT, **ED})["text"].split("\n")
        z.call({"cmd": "editor.activate", "path": SCRIPT, **ED})
        line = next(i for i, t in enumerate(script_text) if text_label in t and "msgbox" in t)
        col = script_text[line].index(text_label) + 2
        z.call({"cmd": "editor.stringEdit", "line": line + 1, "column": col, "label": text_label, "open": True, **ED})
        time.sleep(0.5)
        _shot(z, f"string-1-multiline-edit-{fx.name}.png", "script-editor")
        z.call({"cmd": "editor.closeHover", **ED})
    for lab in labels_k:
        z.call({"cmd": "editor.stringEdit", "label": lab, "text": LONG_WRAPPED, **ED})
    z.call({"cmd": "editor.open", "path": STRINGS, **ED})
    z.call({"cmd": "editor.save", **ED})
    _shot(z, f"string-2-file-{fx.name}.png", "script-editor")
    written = (proj / STRINGS).read_text(encoding="utf-8")
    check(LONG_WRAPPED in written.replace("\r\n", "\n"), ".string に制御記号のあとで改行した形で書かれる")
    if not nd:
        wc = z.call({"cmd": "editor.widthCheck", "wait": True, **ED})
        last = (wc or {}).get("last") or {}
        check(last.get("exit") == 0 and not last.get("errors"), f"Chronos の幅検査が複数行の文字列で通る（{last.get('exit')}、{len(last.get('errors') or [])} 件）")
    z.call({"cmd": "close", **ED})

    # 2. 素の ROM のスクリプトの人を消す
    found = _find_rom_event(z, log)
    check(found is not None, "埋める範囲のある素の ROM のイベントが見つかる")
    erase: list[dict] = []
    if found:
        bank, mp, kind, index, plan = found
        key = {"person": "persons", "sign": "signs", "trap": "traps"}[kind]
        z.call({"cmd": "selectMap", "bank": bank, "map": mp})
        before = z.call({"cmd": "event.state"})["counts"][key]
        r = z.call({"cmd": "event.delete", "kind": kind, "index": index})
        titles = [d["title"] for d in r["dialogs"]]
        text = next((d["text"] for d in r["dialogs"] if d["title"] == "イベントを削除"), "")
        check("埋める範囲" in text and "埋めない範囲" in text, "確認のダイアログに埋める範囲と埋めない範囲の数が出る")
        _shot(z, f"delete-2-confirm-rom-{fx.name}.png")
        z.call({"cmd": "dialog", "press": "ok"})
        time.sleep(0.5)
        st = z.call({"cmd": "romErase.state"})
        check(z.call({"cmd": "event.state"})["counts"][key] == before - 1, "イベントが 1 つ減る")
        check(len(st["ranges"]) >= len(plan["rom"]["erase"]) and st["modified"], f"埋める範囲が記録される（{len(st['ranges'])} 件）")
        z.call({"cmd": "undo"})
        check(z.call({"cmd": "romErase.state"})["ranges"] == [] or len(z.call({"cmd": "romErase.state"})["ranges"]) < len(st["ranges"]), "元に戻すと記録も消える")
        check(z.call({"cmd": "event.state"})["counts"][key] == before, "元に戻すとイベントも戻る")
        z.call({"cmd": "redo"})
        erase = z.call({"cmd": "romErase.state"})["ranges"]
        check(len(erase) == len(st["ranges"]), "やり直すと記録が戻る")
        z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})

    # 3. 出力してビルドする
    res = z.export()
    log(f"出力: {len(res.get('written', []))} ファイル")
    if erase:
        data = json.loads((proj / "maps/rom_erase.json").read_text(encoding="utf-8"))
        check(len(data["Ranges"]) == len(erase), "maps\\rom_erase.json に範囲が書かれる")
    ok = _build(z, timeout, log)
    check(ok, "写しでビルドが通る")
    z.call({"cmd": "close", **ED})
    if ok:
        out_rom = fx.path("NeoDark-DPE-main/test.gba") if nd else fx.path("Chronos/build/Chronos.gba")
        data = out_rom.read_bytes()
        bad = [r for r in erase if data[r["address"] - 0x08000000: r["address"] - 0x08000000 + r["length"]] != b"\xff" * r["length"]]
        check(not bad, f"記録した範囲 {len(erase)} 件がすべて 0xFF になる")
        symbols = read_symbols(proj / "offsets.ini")
        expect = encode(proj, LONG)
        for lab in labels_k:
            addr = symbols.get(lab)
            got = data[addr - 0x08000000: addr - 0x08000000 + len(expect)] if addr else b""
            check(got == expect, f"複数行で書いた {lab} のバイト列が 1 行で書いたときと同じ（{len(expect)} バイト）")

    # 4. 置いた人を右クリックで消す
    z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
    ev = z.call({"cmd": "event.state"})["events"]["persons"][count]
    z.call({"cmd": "mouse", "target": "event", "cell": [ev["x"], ev["y"]], "action": "rightClick"})
    menu = z.call({"cmd": "contextMenu.state"})
    check(bool(menu) and any(i["id"] == "delete" and i["enabled"] for i in menu["items"]), "右クリックで「イベントを削除」が出る")
    _shot(z, f"delete-4-context-menu-{fx.name}.png")
    z.call({"cmd": "contextMenu.press", "id": "delete"})
    _shot(z, f"delete-5-confirm-script-{fx.name}.png")
    z.call({"cmd": "dialog", "press": "ok"})
    time.sleep(0.5)
    z.call({"cmd": "script.settle"})
    s = (proj / SCRIPT).read_text(encoding="utf-8")
    st_text = (proj / STRINGS).read_text(encoding="utf-8")
    check(f"{npc}:" not in s, f".s から {npc} の記述が消える")
    check(all(f"#org @{lab}\n" not in st_text.replace("\r\n", "\n") for lab in labels_k), ".string から文字列が消える（ND は _k も）")
    reg = proj / "strings/text_width_registry.json"
    if not nd and reg.is_file():
        check(text_label not in reg.read_text(encoding="utf-8"), "幅検査の登録からも消える")
    z.call({"cmd": "undo"})
    z.call({"cmd": "script.settle"})
    time.sleep(0.5)
    s2 = (proj / SCRIPT).read_text(encoding="utf-8")
    check(f"{npc}:" in s2 and f"#org @{text_label}" in (proj / STRINGS).read_text(encoding="utf-8"), "元に戻すと .s と .string の記述が戻る")
    check(any(x["label"] == npc for x in z.call({"cmd": "script.labels"})["person"]), "元に戻すとイベントのラベルも戻る")
    z.call({"cmd": "redo"})
    z.call({"cmd": "script.settle"})
    time.sleep(0.5)
    check(f"{npc}:" not in (proj / SCRIPT).read_text(encoding="utf-8"), "やり直すとまた消える")
