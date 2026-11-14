"""スクリプトエディタ（別ウィンドウ）の土台を確かめる（#190）。

  python tests/automation/script_editor_check.py --rom <素の BPRJ> --project <CFRU-JP のフォルダ（読むだけ）> --work <作業フォルダ>
      [--exe <zigzagumap.exe>] [--shots <スクリーンショットのフォルダ>]

- `--project` のフォルダには書き込まない。必要な分（assembly/・strings/・xse_*.s・asm_defines.s・eventscripts・maps/・
  charmap.tbl・zigzagumap.json）だけを `--work` の下の `project/` に写し、写しを開いて編集する。`--work` が `--project` の中なら止める。
- 写しの eventscripts に `npc 3 0 0 <ラベル>` を 1 行足し、イベント（3.0 の人 0）からラベルの行が開けることを確かめる。
- 開く・入力・Ctrl+S で保存（改行の形と BOM を保つ）・外部の変更の読み直し（未保存が無ければ黙って、あれば聞く）・
  開けないパスの拒否・未保存のタブとウィンドウを閉じるときの確認・Ctrl+S でメインの出力が動かないこと、を見る。
"""
from __future__ import annotations

import argparse
import base64
import os
import pathlib
import re
import shutil
import sys
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import AppError, Zigzagu  # noqa: E402

W = {"window": "script-editor"}
COPY_DIRS = ["assembly", "strings", "maps"]
COPY_FILES = ["xse_commands.s", "xse_defines.s", "asm_defines.s", "eventscripts", "charmap.tbl", "zigzagumap.json"]
failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def prepare(src: pathlib.Path, work: pathlib.Path) -> pathlib.Path:
    src = src.resolve()
    work = work.resolve()
    if work == src or src in work.parents:
        raise SystemExit(f"作業フォルダが元のフォルダの中です: {work}")
    dst = work / "project"
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    for d in COPY_DIRS:
        if (src / d).is_dir():
            shutil.copytree(src / d, dst / d)
    for f in COPY_FILES:
        if (src / f).is_file():
            shutil.copy2(src / f, dst / f)
    return dst


def first_label(path: pathlib.Path) -> tuple[str, int]:
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):", line)
        if m:
            return m.group(1), i
    raise SystemExit(f"ラベルがありません: {path}")


def wait_ready(z: Zigzagu, label: str = "script-editor", timeout: float = 20) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if any(w["label"] == label and w.get("ready") for w in z.call({"cmd": "windows"})):
            return True
        time.sleep(0.2)
    return False


def wait_closed(z: Zigzagu, label: str = "script-editor", timeout: float = 10) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if not any(w["label"] == label for w in z.call({"cmd": "windows"})):
            return True
        time.sleep(0.2)
    return False


def ed(z: Zigzagu, cmd: str, **kw):
    return z.call({"cmd": cmd, **W, **kw})


def wait_state(z: Zigzagu, pred, timeout: float = 6):
    t0 = time.time()
    st = ed(z, "editor.state")
    while time.time() - t0 < timeout:
        st = ed(z, "editor.state")
        if pred(st):
            return st
        time.sleep(0.25)
    return st


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if not shots:
        return
    shots.mkdir(parents=True, exist_ok=True)
    r = z.call({"cmd": "screenshot", **W})
    png = r["png"] if isinstance(r, dict) else r
    (shots / name).write_bytes(base64.b64decode(png))
    print("撮影:", shots / name)


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--project", required=True, help="写す元の CFRU-JP のフォルダ（書き込まない）")
    ap.add_argument("--work", required=True, help="写しとプロファイルを置くフォルダ")
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    a = ap.parse_args()
    work = pathlib.Path(a.work)
    shots = pathlib.Path(a.shots) if a.shots else None
    proj = prepare(pathlib.Path(a.project), work)
    rel = "assembly/overworld_scripts/" + sorted(p.name for p in (proj / "assembly/overworld_scripts").glob("*.s"))[0]
    s_file = proj / rel
    label, label_line = first_label(s_file)
    with open(proj / "eventscripts", "a", encoding="utf-8", newline="") as f:
        f.write(f"\nnpc 3 0 0 {label}\n")
    # CRLF と BOM の .string（保存で形が残るか）
    crlf = proj / "strings/zz_crlf_check.string"
    crlf.write_bytes("﻿#org @gText_ZzCheck\r\nテスト\r\n".encode("utf-8"))
    maps_before = {p: p.stat().st_mtime for p in (proj / "maps").rglob("*") if p.is_file()}
    profile = work / "profile"
    shutil.rmtree(profile, ignore_errors=True)

    with Zigzagu(a.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": a.rom, "project": str(proj)})
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})

        # ---- イベントからラベルを解決して開く ----
        loc = z.call({"cmd": "script.resolve", "bank": 3, "map": 0, "kind": "person", "index": 0})
        check(loc is not None and loc["path"] == rel and loc["line"] == label_line, f"3.0 の人 0 → {rel}:{label_line}（{loc}）")
        r = z.call({"cmd": "script.open", "bank": 3, "map": 0, "kind": "person", "index": 0})
        check(r["opened"], "script.open でイベントのスクリプトを開く")
        check(wait_ready(z), "エディタのウィンドウの準備ができる")
        st = wait_state(z, lambda s: s["active"] == rel)
        check(st["active"] == rel and st["cursor"]["line"] == label_line, f"ラベルの行にカーソルがある（{st['cursor']}）")
        check(not st["dirty"], "開いた直後は未保存でない")

        # ---- 入力と保存 ----
        original = s_file.read_bytes()
        st = ed(z, "editor.type", text="@ zz-check\n", line=1, column=1)
        check(st["dirty"] and st["tabs"][0]["dirty"], "入力すると未保存の印が付く")
        check(st["title"].startswith("●"), f"題名に未保存の印（{st['title']}）")
        shot(z, shots, "190-editor.png")
        main_status = z.call({"cmd": "status"})
        st = ed(z, "editor.key", key="s", ctrl=True)
        st = wait_state(z, lambda s: not s["dirty"])
        check(not st["dirty"], "Ctrl+S で保存して未保存の印が消える")
        saved = s_file.read_bytes()
        nl = b"\r\n" if b"\r\n" in original else b"\n"
        check(saved == b"@ zz-check" + nl + original, "ディスクの中身が入力どおり（改行の形も同じ）")
        main_after = z.call({"cmd": "status"})
        check(main_after.get("left") == main_status.get("left"), "エディタの Ctrl+S でメインの出力が動かない（ステータスが変わらない）")
        maps_after = {p: p.stat().st_mtime for p in (proj / "maps").rglob("*") if p.is_file()}
        check(maps_after == maps_before, "maps\\ は書き換わらない")

        # ---- 外部の変更（未保存なし → 黙って読み直し、カーソルは残る） ----
        ed(z, "editor.select", line=3, column=2)
        time.sleep(1.2)  # 更新日時の分解能のため
        s_file.write_bytes(saved + b"@ external" + nl)
        st = wait_state(z, lambda s: "@ external" in ed(z, "editor.text")["text"], timeout=8)
        text = ed(z, "editor.text")["text"]
        check("@ external" in text and not st["dirty"], "外部の変更を黙って読み直す（1 秒ごとの見張り）")
        check(st["cursor"]["line"] == 3 and st["cursor"]["column"] == 2, f"読み直してもカーソルが残る（{st['cursor']}）")
        check(not st["dialogs"], "未保存が無いときは聞かない")

        # ---- 外部の変更（未保存あり → 聞く。「いいえ」で残す） ----
        ed(z, "editor.type", text="@ mine\n", line=1, column=1)
        time.sleep(1.2)
        s_file.write_bytes(saved + b"@ external2" + nl)
        st = wait_state(z, lambda s: len(s["dialogs"]) > 0, timeout=8)
        check(len(st["dialogs"]) == 1 and "外部で変更" in st["dialogs"][0]["text"], "未保存があるときは「読み直しますか？」と聞く")
        if st["dialogs"]:
            ed(z, "dialog", press="no")
        text = ed(z, "editor.text")["text"]
        st = ed(z, "editor.state")
        check(text.startswith("@ mine") and "@ external2" not in text and st["dirty"], "「いいえ」で編集中の内容を残す")
        time.sleep(2.2)
        check(not ed(z, "editor.state")["dialogs"], "同じ変更で何度も聞かない")
        # もう一度外で変えて「はい」
        time.sleep(1.2)
        s_file.write_bytes(saved + b"@ external3" + nl)
        st = wait_state(z, lambda s: len(s["dialogs"]) > 0, timeout=8)
        if st["dialogs"]:
            ed(z, "dialog", press="yes")
        st = wait_state(z, lambda s: not s["dirty"])
        text = ed(z, "editor.text")["text"]
        check("@ external3" in text and not text.startswith("@ mine") and not st["dirty"], "「はい」でディスクの内容に読み直す")

        # ---- CRLF と BOM ----
        crlf_rel = "strings/zz_crlf_check.string"
        st = ed(z, "editor.open", path=crlf_rel, line=2)
        check(st["opened"] and st["active"] == crlf_rel and len(st["tabs"]) == 2, "2 つ目のタブで .string を開く")
        tab = next(t for t in st["tabs"] if t["path"] == crlf_rel)
        check(tab["lineEnding"] == "\r\n" and tab["bom"] and tab["kind"] == "string", "CRLF と BOM を覚える")
        ed(z, "editor.type", text="追加\n", line=2, column=1)
        ed(z, "editor.save")
        check(crlf.read_bytes() == "﻿#org @gText_ZzCheck\r\n追加\r\nテスト\r\n".encode("utf-8"), "保存しても CRLF と BOM が残る")
        st = ed(z, "editor.activate", path=rel)
        check(st["active"] == rel, "タブを切り替える")

        # ---- 開けないパス ----
        st = ed(z, "editor.open", path="eventscripts")
        check(not st["opened"] and st["dialogs"] and "開けません" in st["dialogs"][0]["text"], "assembly/overworld_scripts と strings の外は開かない")
        if st["dialogs"]:
            ed(z, "dialog", press="ok")
        r = z.call({"cmd": "script.open", "path": "xse_commands.s"})
        check(not r["opened"], "メインからも外のファイルは開かない（ステータスバーに出す）")

        # ---- 未保存のタブを閉じる ----
        ed(z, "editor.activate", path=crlf_rel)
        ed(z, "editor.type", text="x", line=1, column=1)
        st = ed(z, "editor.closeTab", path=crlf_rel)
        check(len(st["dialogs"]) == 1 and "保存しますか" in st["dialogs"][0]["text"], "未保存のタブを閉じるときに聞く")
        ed(z, "dialog", press="cancel")
        st = ed(z, "editor.state")
        check(len(st["tabs"]) == 2, "キャンセルなら閉じない")
        ed(z, "editor.closeTab", path=crlf_rel)
        ed(z, "dialog", press="no")
        st = ed(z, "editor.state")
        check(len(st["tabs"]) == 1 and crlf.read_bytes().startswith("﻿#org".encode("utf-8")), "「いいえ」で保存せずに閉じる")

        # ---- 未保存のままウィンドウを閉じる ----
        ed(z, "editor.type", text="@ unsaved\n", line=1, column=1)
        r = ed(z, "close")
        check(not r["closing"] and r["dialogs"], "未保存があるとウィンドウを閉じるときに聞く")
        shot(z, shots, "190-dirty-dialog.png")
        ed(z, "dialog", press="cancel")
        check(wait_ready(z, timeout=2), "キャンセルならウィンドウは残る")
        before_disk = s_file.read_bytes()
        ed(z, "close")
        try:
            ed(z, "dialog", press="yes")
        except (AppError, OSError):
            pass
        check(wait_closed(z), "「はい」で保存して閉じる")
        check(s_file.read_bytes().startswith(b"@ unsaved"), "閉じる前に保存した")
        check(before_disk != s_file.read_bytes(), "保存で中身が変わった")

        # ---- 開き直し ----
        r = z.call({"cmd": "script.open", "path": rel, "line": 2})
        check(r["opened"] and wait_ready(z), "閉じたあとも開き直せる")
        st = wait_state(z, lambda s: s["active"] == rel)
        check(st["cursor"]["line"] == 2, "行を指定して開く")

        # ---- 別のプロジェクトへ移るときは、メインの画面内のダイアログで聞き、エディタを閉じる ----
        ed(z, "editor.type", text="@ discard\n", line=1, column=1)
        disk = s_file.read_bytes()
        opener = threading.Thread(target=lambda: z.call({"cmd": "open", "rom": a.rom}, timeout=60), daemon=True)
        opener.start()
        t0 = time.time()
        dialogs = []
        while time.time() - t0 < 10 and not dialogs:
            dialogs = z.call({"cmd": "dialogs"})["dialogs"]
            time.sleep(0.2)
        check(bool(dialogs) and "スクリプトエディタ" in dialogs[-1]["text"], "メインで別のプロジェクトを開くとき、エディタの未保存を聞く")
        if dialogs:
            z.call({"cmd": "dialog", "press": "no"})
        opener.join(30)
        check(wait_closed(z), "プロジェクトが変わるとエディタを閉じる")
        check(s_file.read_bytes() == disk, "「いいえ」なら保存しない")

    print()
    print("合格" if not failures else f"失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
