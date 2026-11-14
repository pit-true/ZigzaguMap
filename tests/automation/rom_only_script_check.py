"""プロジェクトフォルダを開かず、素の ROM だけを開いたときのスクリプトの表示（#206）と取り込み（#207）を確かめる。

  python tests/automation/rom_only_script_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>]

- 起動は --automation・--profile（一時フォルダ）・--mute-audio・画面外。ROM には書き込まない。
- 確かめること:
  1. イベントタブで人のスクリプトを開くと、エディタの読み取り専用のタブ（ROM:08XXXXXX）に xse_commands.s の書き方の文が出る
  2. プロジェクトが無くても、同梱の命令表で命令の色付け（semantic の command）とホバーが出る
  3. 読み取り専用で、打っても本文が変わらない
  4. 「.s に取り込む」は使えず（プロジェクトが要る）、押しても何も書かない
  5. スクリプトのラベルの欄は出ず、オフセットの欄が出る
失敗があれば終了コード 1。
"""
from __future__ import annotations

import argparse
import pathlib
import shutil
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import AppError, Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> bool:
    print(("OK   " if cond else "NG   ") + what, flush=True)
    if not cond:
        failures.append(what)
    return cond


def wait_editor(z: Zigzagu, timeout: float = 30) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if any(w["label"] == "script-editor" and w.get("ready") for w in z.call({"cmd": "windows"})):
            return True
        time.sleep(0.1)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    args = ap.parse_args()
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    profile = pathlib.Path(tempfile.mkdtemp(prefix="zzm-romonly-"))
    try:
        with Zigzagu(args.exe, profile=profile, extra=["--mute-audio"]) as z:
            st = z.call({"cmd": "open", "rom": args.rom})
            check(st.get("project") in (None, ""), f"プロジェクトなしで開いた（{st.get('project')}）")
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            z.call({"cmd": "tab", "name": "event"})
            z.call({"cmd": "event.select", "kind": "person", "index": 0})
            label = z.call({"cmd": "getField", "id": "event.person.label"})
            script = z.call({"cmd": "getField", "id": "event.person.script"})
            check(not label.get("visible") and script.get("visible"), "ラベルの欄は出ず、オフセットの欄が出る")

            rom = z.call({"cmd": "script.rom", "bank": 3, "map": 0, "kind": "person", "index": 0})
            check(bool(rom.get("opened")) and str(rom.get("tab", "")).startswith("ROM:08"), f"読み取り専用のタブで開く（{rom.get('tab')}）")
            text = rom.get("text") or ""
            check(("msgbox" in text or "loadpointer" in text) and "end" in text, "xse_commands.s の書き方の文が出る")
            check(rom.get("importable") is False, "プロジェクトが無いので取り込めない")
            check(wait_editor(z), "エディタのウィンドウが開く")
            ed = {"window": "script-editor"}
            proj = z.call({"cmd": "editor.project", **ed})
            check(proj["commands"] > 200, f"同梱の命令表を読む（{proj['commands']} 個）")
            lines = text.split("\n")
            n = next((i + 1 for i, l in enumerate(lines) if l.strip().startswith(("lock", "loadpointer", "msgbox", "faceplayer"))), None)
            check(n is not None, "命令の行がある")
            if n is not None:
                toks = z.call({"cmd": "editor.tokens", "line": n, **ed})["lines"][0]
                check(any(t["kind"] == "command" for t in toks.get("semantic", [])), f"命令に色が付く（{lines[n - 1].strip()}）")
                col = len(lines[n - 1]) - len(lines[n - 1].lstrip()) + 1
                hover = z.call({"cmd": "editor.hover", "line": n, "column": col, **ed})
                check(bool(hover) and hover.get("type") == "command", f"命令のホバーが出る（{hover and hover.get('type')}）")
            before = z.call({"cmd": "editor.text", **ed})["text"]
            z.call({"cmd": "editor.key", "key": "Enter", **ed})
            z.call({"cmd": "editor.key", "key": "Delete", **ed})
            check(z.call({"cmd": "editor.text", **ed})["text"] == before, "読み取り専用で、キーを押しても本文は変わらない")
            button = z.call({"cmd": "getField", "id": "se.romImport", **ed})
            check(button.get("enabled") is False, f"「.s に取り込む」は押せない（{button.get('enabled')}）")
            r = z.call({"cmd": "editor.import", "rename": {}, **ed})
            check(r.get("result") is None, f"取り込みは断る（{r.get('message')}）")
            z.call({"cmd": "close", "window": "script-editor"})
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    print(f"\n失敗 {len(failures)} 件")
    for f in failures:
        print("  " + f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
