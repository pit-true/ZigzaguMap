"""`.s`・`.string` の書き込みの順番（#293・#294）を、プロジェクトの写しで確かめる。

  python tests/automation/script_write_order_check.py --rom <ベース ROM> --project <CFRU-JP のフォルダ（読むだけ）> --work <作業フォルダ>
      [--exe <zigzagumap.exe>]

- `--project` のフォルダには書き込まない。必要な分を `--work` の下の `project/` に写し、写しを開く（script_editor_check.py と同じ）。
  写しの maps\\scripts.json には 3.0 の行を足し（`zz_order.s`）、3.1 の行は足さない。
- 293: エディタで開いている `.s` にひな形を置くと、エディタの本文に入り、未保存の変更が無ければそのまま保存される（ディスクにも入る）。
  エディタを閉じた直後（待たずに）ひな形を置いても、`.s` にスクリプトが書かれる（閉じかけのエディタへ渡して消えない）。
  タブを閉じた直後に置いても書かれる。
- cancel: 未保存の変更があるエディタを × で閉じ、確認で「キャンセル」を押す。確認が出ている間に置いたひな形は待たされ
  （.s に書かない）、キャンセルすると窓が残り、未保存の変更を失わずにエディタの本文へ入る。保存すると両方がディスクに入る。
- 294: 「.s を新しく作る」の入力が出ている間に `template.place` を送ると、すぐにエラーが返り、アプリは落ちない。入力に答えれば置ける。
"""
from __future__ import annotations

import argparse
import os
import pathlib
import shutil
import sys
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import AppError, Zigzagu  # noqa: E402

W = {"window": "script-editor"}
COPY_DIRS = ["assembly", "strings", "maps"]
COPY_FILES = ["xse_commands.s", "xse_defines.s", "asm_defines.s", "eventscripts", "charmap.tbl", "zigzagumap.json", "BPRJ.ld"]
SCRIPT = "assembly/overworld_scripts/zz_order.s"
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
    for f in (dst / "assembly/overworld_scripts").glob("zz_*.s"):
        f.unlink()
    for f in (dst / "strings").glob("*zz_*.string"):
        f.unlink()
    return dst


def windows(z: Zigzagu) -> list[dict]:
    return z.call({"cmd": "windows"})


def wait_editor(z: Zigzagu, ready: bool = True, timeout: float = 20) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        present = any(w["label"] == "script-editor" and (w.get("ready") or not ready) for w in windows(z))
        if present == ready:
            return True
        time.sleep(0.1)
    return False


def disk(proj: pathlib.Path) -> str:
    p = proj / SCRIPT
    return p.read_text(encoding="utf-8") if p.exists() else ""


def place(z: Zigzagu, kind: str, x: int, y: int, timeout: float = 60) -> dict:
    return z.call({"cmd": "template.place", "kind": kind, "x": x, "y": y}, timeout=timeout)


def check_293(z: Zigzagu, proj: pathlib.Path) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "scripts.table", "action": "add", "entry": {"bank": 3, "map": 0, "name": "zz", "script": SCRIPT}, "create": True})
    first = place(z, "person", 12, 12)
    z.call({"cmd": "script.settle"})
    label1 = first["label"]
    check(bool(label1) and f"{label1}:" in disk(proj), f"エディタを開く前のひな形は .s に書かれる（{label1}）")
    # エディタで開いたまま置く: 本文に入り、未保存の変更が無ければ保存される
    z.call({"cmd": "script.open", "bank": 3, "map": 0, "kind": "person", "index": first["event"]["index"]})
    check(wait_editor(z), "エディタが開く")
    time.sleep(1)
    second = place(z, "sign", 14, 12)
    z.call({"cmd": "script.settle"})
    st = z.call({"cmd": "editor.state", **W})
    text = z.call({"cmd": "editor.text", "path": SCRIPT, **W})["text"]
    label2 = second["label"]
    check(f"{label2}:" in text and f"{label2}:" in disk(proj) and not st["dirty"],
          f"エディタで開いている .s に置くと本文に入り、そのまま保存される（{label2}、未保存 {st['dirty']}）")
    # エディタを閉じた直後に置く（未保存の変更の無いタブ。保存の確認は出ない）
    z.call({"cmd": "editor.save", **W})
    z.call({"cmd": "close", **W})
    third = place(z, "person", 12, 14)
    z.call({"cmd": "script.settle"})
    label3 = third["label"]
    labels = z.call({"cmd": "script.labels", "bank": 3, "map": 0})
    in_script = [p for p in labels.get("person", []) if p.get("label") == label3]
    check(f"{label3}:" in disk(proj) and bool(in_script) and in_script[0].get("inScript"),
          f"エディタを閉じた直後に置いても .s に書かれる（{label3}、{in_script}）")
    check(wait_editor(z, ready=False), "エディタが閉じる")
    # タブを閉じた直後に置く（エディタは開いたまま。ほかのタブを残す）
    z.call({"cmd": "script.open", "path": "assembly/overworld_scripts/zz_order.s"})
    check(wait_editor(z), "エディタをもう一度開く")
    time.sleep(1)
    z.call({"cmd": "editor.closeTab", "path": SCRIPT, **W})
    fourth = place(z, "sign", 14, 14)
    z.call({"cmd": "script.settle"})
    label4 = fourth["label"]
    check(f"{label4}:" in disk(proj), f"タブを閉じた直後に置いても .s に書かれる（{label4}）")
    # 取り消すと 4 つ目が .s から除かれる（エディタで開いていない）
    z.call({"cmd": "undo"})
    z.call({"cmd": "script.settle"})
    check(f"{label4}:" not in disk(proj) and f"{label3}:" in disk(proj), "取り消すと最後のひな形だけが .s から除かれる")
    z.call({"cmd": "close", **W})
    wait_editor(z, ready=False)


def check_294(z: Zigzagu, proj: pathlib.Path) -> None:
    z.call({"cmd": "selectMap", "bank": 3, "map": 1})
    z.call({"cmd": "tab", "name": "event"})
    # 窓から置く（3.1 は対応表に無いので「.s を新しく作る」が出る）
    z.call({"cmd": "template.picker", "x": 3, "y": 3})
    z.call({"cmd": "dialog", "press": "ok"})
    t0 = time.time()
    shown = False
    while time.time() - t0 < 10 and not shown:
        shown = any("新しく" in (d.get("title") or "") for d in z.call({"cmd": "dialogs"})["dialogs"])
        time.sleep(0.1)
    check(shown, "「.s を新しく作る」の入力が出る")
    t0 = time.time()
    try:
        place(z, "sign", 4, 3, timeout=30)
        check(False, "入力が出ている間の template.place はエラーになる")
    except AppError as e:
        check(time.time() - t0 < 10, f"入力が出ている間の template.place はすぐにエラーになる（{e}）")
    except Exception as e:  # noqa: BLE001
        check(False, f"入力が出ている間の template.place はエラーを返す（{type(e).__name__}: {e}）")
    alive = True
    try:
        z.call({"cmd": "state"}, timeout=10)
    except Exception:  # noqa: BLE001
        alive = False
    check(alive and z.proc is not None and z.proc.poll() is None, "アプリは落ちない")
    if not alive:
        return
    dialogs = z.call({"cmd": "dialogs"})["dialogs"]
    check(sum("新しく" in (d.get("title") or "") for d in dialogs) == 1, f"入力は 1 つだけ（{[d.get('title') for d in dialogs]}）")
    # 入力に答えると、窓から置いたものが置ける
    z.call({"cmd": "setField", "id": "scriptsTable.new.name", "value": "zz_order_new"})
    z.call({"cmd": "click", "id": "scriptsTable.new.create"})
    z.call({"cmd": "script.settle"})
    time.sleep(0.5)
    z.call({"cmd": "script.settle"})
    persons = z.call({"cmd": "script.labels", "bank": 3, "map": 1}).get("person", [])
    check(any(p.get("inScript") for p in persons), "入力に答えると、窓から置いたひな形が新しい .s に書かれる")
    res = place(z, "sign", 4, 3)
    check(bool(res.get("label")), f"そのあとの template.place は置ける（{res.get('label')}）")


def check_cancel(z: Zigzagu, proj: pathlib.Path) -> None:
    """× で閉じて、未保存の確認で「キャンセル」を押す（#293 の書き込みの列。閉じるのをやめたら列を解く）。"""
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "scripts.table", "action": "add", "entry": {"bank": 3, "map": 0, "name": "zz", "script": SCRIPT}, "create": True})
    first = place(z, "person", 12, 12)
    z.call({"cmd": "script.settle"})
    z.call({"cmd": "script.open", "bank": 3, "map": 0, "kind": "person", "index": first["event"]["index"]})
    check(wait_editor(z), "エディタが開く")
    time.sleep(1)
    # 未保存の変更を作る（末尾に 1 行）
    z.call({"cmd": "editor.activate", "path": SCRIPT, **W})
    body = z.call({"cmd": "editor.text", "path": SCRIPT, **W})["text"]
    mark = "@ zz_cancel_mark"
    z.call({"cmd": "editor.type", "text": "\n" + mark, "offset": len(body), **W})
    before_disk = disk(proj)
    r = z.call({"cmd": "close", **W})
    asked = [d for d in r.get("dialogs", []) if "cancel" in str(d.get("buttons", "")).lower() or "キャンセル" in str(d.get("buttons", ""))]
    check(r.get("closing") is False and bool(asked), f"未保存があると × で確認が出る（{r}）")
    # 確認が出ている間に置く（メインは書き込みを待たせる。キャンセルで解く）
    result: dict = {}

    def run() -> None:
        try:
            result["placed"] = place(z, "sign", 14, 12, timeout=60)
        except Exception as e:  # noqa: BLE001
            result["error"] = e

    th = threading.Thread(target=run)
    th.start()
    time.sleep(1.5)
    check(disk(proj) == before_disk, "確認が出ている間は .s に書かない")
    z.call({"cmd": "dialog", "press": "cancel", **W})
    th.join(60)
    check(not th.is_alive() and "placed" in result, f"キャンセルすると待っていたひな形が置ける（{result.get('error')}）")
    z.call({"cmd": "script.settle"})
    time.sleep(0.5)
    check(wait_editor(z) and any(w["label"] == "script-editor" for w in windows(z)), "キャンセルすると窓が残る")
    st = z.call({"cmd": "editor.state", **W})
    text = z.call({"cmd": "editor.text", "path": SCRIPT, **W})["text"]
    label = (result.get("placed") or {}).get("label")
    check(mark in text and st["dirty"], f"キャンセルしても未保存の変更が残る（未保存 {st['dirty']}）")
    check(bool(label) and f"{label}:" in text, f"待っていたひな形はエディタの本文に入る（{label}）")
    check(mark not in disk(proj), "未保存の変更はディスクに書かれない")
    # そのあとの保存で両方がディスクに入る
    z.call({"cmd": "editor.save", **W})
    d = disk(proj)
    check(mark in d and bool(label) and f"{label}:" in d, "保存すると変更とひな形の両方がディスクに入る")
    # 列が解けている: もう 1 つ置ける（エディタの本文に入り、保存される）
    third = place(z, "person", 12, 14, timeout=30)
    z.call({"cmd": "script.settle"})
    check(f"{third['label']}:" in disk(proj), f"キャンセルのあとの書き込みも止まらない（{third['label']}）")
    z.call({"cmd": "close", **W})
    check(wait_editor(z, ready=False), "未保存が無ければ × で閉じる")


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--project", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--only", help="確かめる issue の番号（カンマ区切り）")
    args = ap.parse_args()
    work = pathlib.Path(args.work)
    only = args.only.split(",") if args.only else ["293", "294", "cancel"]
    for number in only:
        print(f"== #{number}")
        proj = prepare(pathlib.Path(args.project), work)
        with Zigzagu(args.exe, profile=work / f"profile{number}", extra=["--mute-audio"]) as z:
            z.call({"cmd": "open", "rom": args.rom, "project": str(proj)})
            {"293": check_293, "294": check_294, "cancel": check_cancel}[number](z, proj)
    print(f"\n失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
