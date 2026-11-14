"""保存時の幅検査（#197）を、Chronos の写しで確かめる。

  python tests/automation/script_width_check.py --chronos <Chronos のフォルダ（読むだけ）> --work <作業フォルダ>
      [--nd <ND の CFRU-JP のフォルダ（読むだけ）>] [--exe <zigzagumap.exe>] [--shots <スクリーンショットのフォルダ>]

- `--chronos` には書き込まない。幅検査に要る分（tools/check_text_width.py、base/BPRJ0.gba、cfru の strings・scripts・assembly など、
  dpe の種族名と species.h）だけを `--work` の下の `Chronos/` に写し、写しの `cfru` を ZigzaguMap で開く。
  `--work` が `--chronos` の中なら止める。写しの tools/check_text_width.py は追加の登録ファイル（cfru/strings/text_width_registry.json）
  を読める版でなければならない。
- 見ること: 登録のある .string に 18 字を超える行を足して保存すると、登録ファイルに書き足され、その行に波線が出る。直して保存すると
  消える。`#org` を消すと登録ファイルからも消える。`[BUFFER1]` を使う文は unresolved で登録する。登録の無い .string は書き足さない。
  ND（幅検査のコマンドが無い）では何もしない。
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

W = {"window": "script-editor"}
COPY = [
    "tools/check_text_width.py",
    "base/BPRJ0.gba",
    "cfru/scripts",
    "cfru/strings",
    "cfru/assembly/overworld_scripts",
    "cfru/charmap.tbl",
    "cfru/bytereplacement",
    "cfru/src/config.h",
    "cfru/src/Tables/item_tables.c",
    "cfru/include/constants/items.h",
    "cfru/xse_commands.s",
    "cfru/xse_defines.s",
    "cfru/asm_defines.s",
    "cfru/BPRJ.ld",
    "cfru/eventscripts",
    "dpe/strings/Pokemon_Name_Table.string",
    "dpe/include/species.h",
]
TARGET = "strings/debug_famicom.string"
REGISTRY = "strings/text_width_registry.json"
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
    dst = work / "Chronos"
    if dst.exists():
        shutil.rmtree(dst)
    for rel in COPY:
        s = src / rel
        d = dst / rel
        d.parent.mkdir(parents=True, exist_ok=True)
        if s.is_dir():
            shutil.copytree(s, d)
        elif s.is_file():
            shutil.copy2(s, d)
    (dst / "cfru/strings/text_width_registry.json").unlink(missing_ok=True)
    return dst


def ed(z: Zigzagu, cmd: str, **kw):
    return z.call({"cmd": cmd, **W, **kw}, timeout=120)


def wait_ready(z: Zigzagu, timeout: float = 20) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if any(w["label"] == "script-editor" and w.get("ready") for w in z.call({"cmd": "windows"})):
            return True
        time.sleep(0.2)
    return False


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if not shots:
        return
    shots.mkdir(parents=True, exist_ok=True)
    r = z.call({"cmd": "screenshot", **W})
    (shots / name).write_bytes(base64.b64decode(r["png"] if isinstance(r, dict) else r))
    print("撮影:", shots / name)


def save_and_check(z: Zigzagu) -> dict:
    ed(z, "editor.save")
    r = ed(z, "editor.widthCheck", wait=True)
    time.sleep(0.3)
    return r


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--chronos", required=True)
    ap.add_argument("--nd")
    ap.add_argument("--work", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    a = ap.parse_args()
    work = pathlib.Path(a.work)
    shots = pathlib.Path(a.shots) if a.shots else None
    root = prepare(pathlib.Path(a.chronos), work)
    proj = root / "cfru"
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"}
    pre = subprocess.run([sys.executable, "tools/check_text_width.py", "--source"], cwd=root, capture_output=True, text=True, encoding="utf-8", env=env)
    check(pre.returncode == 0, "写しで幅検査が通る（始める前）")
    if "--list-registry" not in (root / "tools/check_text_width.py").read_text(encoding="utf-8"):
        raise SystemExit("写しの check_text_width.py が追加の登録ファイルに対応していません")
    target = proj / TARGET
    original = target.read_text(encoding="utf-8")
    registry = proj / REGISTRY
    profile = work / "profile"
    shutil.rmtree(profile, ignore_errors=True)

    with Zigzagu(a.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": str(root / "base/BPRJ0.gba"), "project": str(proj)})
        r = z.call({"cmd": "script.open", "path": TARGET})
        check(r["opened"] and wait_ready(z), "エディタで登録のある .string を開く")
        p = ed(z, "editor.project")
        check(p["dialect"] == "chronos", "Chronos として読む")
        text = ed(z, "editor.text")["text"]
        long_line = "あいうえおかきくけこさしすせそたちつてと"
        ed(z, "editor.setText", text=text.rstrip("\n") + f"\n\n#org @gText_ZzWidth\n{long_line}\n")
        line_no = len(text.rstrip("\n").split("\n")) + 3
        r = save_and_check(z)
        last = r["last"]
        reg = json.loads(registry.read_text(encoding="utf-8")) if registry.is_file() else {}
        check(reg.get("files", {}).get("cfru/" + TARGET, {}).get("gText_ZzWidth") == {"window": "field"}, f"新しい #org を登録ファイルに書き足す（{reg}）")
        check(last and last["exit"] == 1 and any(e["label"] == "gText_ZzWidth" and e["line"] == line_no for e in last["errors"]), f"幅検査が 18 字を超えた行を見つける（{last and last['errors']}）")
        d = ed(z, "editor.diagnostics")["diagnostics"]
        width = [x for x in d if x["source"] == "widthCheck"]
        check(len(width) == 1 and width[0]["line"] == line_no and "px > 208 px" in width[0]["message"], f"その行に波線（{width}）")
        check(any(x["source"] == "textWidth" and x["line"] == line_no for x in d), "簡易の幅検査（字数）の波線も同じ行に出る")
        check(any("TEXT WIDTH ERROR" in l for l in r["log"]) and any("source mode" in l for l in r["log"]), "出力をログに残す")
        shot(z, shots, "chronos-width-check.png")

        t2 = ed(z, "editor.text")["text"].replace(long_line, "みじかい　ぶん")
        ed(z, "editor.setText", text=t2)
        r = save_and_check(z)
        d = ed(z, "editor.diagnostics")["diagnostics"]
        check(r["last"]["exit"] == 0 and not [x for x in d if x["source"] == "widthCheck"], "直して保存すると波線が消える")

        ed(z, "editor.setText", text=t2.replace("#org @gText_ZzWidth\nみじかい　ぶん\n", "#org @gText_ZzBuf\n[BUFFER1]を　もらった\n"))
        r = save_and_check(z)
        reg = json.loads(registry.read_text(encoding="utf-8"))
        entries = reg["files"].get("cfru/" + TARGET, {})
        check("gText_ZzWidth" not in entries and "unresolved" in entries.get("gText_ZzBuf", {}), f"消えた #org は登録から消え、[BUFFER1] の文は unresolved で登録する（{entries}）")
        check(r["last"]["exit"] == 0, "unresolved の文があっても検査は通る")

        ed(z, "editor.setText", text=original)
        r = save_and_check(z)
        reg = json.loads(registry.read_text(encoding="utf-8"))
        check(reg["files"] == {} and r["last"]["exit"] == 0 and target.read_text(encoding="utf-8") == original, "元に戻すと登録も空に戻る")

        new_file = proj / "strings/zz_unregistered.string"
        new_file.write_text("#org @gText_ZzFree\nx\n", encoding="utf-8", newline="\n")
        ed(z, "editor.open", path="strings/zz_unregistered.string")
        ed(z, "editor.type", text="#org @gText_ZzFree2\nあいうえおかきくけこさしすせそたちつてと\n", line=3, column=1)
        r = save_and_check(z)
        check(r["last"]["registry"]["notChecked"] and json.loads(registry.read_text(encoding="utf-8"))["files"] == {}, "登録の無い .string は書き足さない")
        ed(z, "close")

    if a.nd:
        nd = pathlib.Path(a.nd).resolve()
        ndw = work / "nd"
        shutil.rmtree(ndw, ignore_errors=True)
        (ndw / "strings").mkdir(parents=True)
        for f in ["xse_commands.s", "xse_defines.s", "asm_defines.s"]:
            shutil.copy2(nd / f, ndw / f)
        shutil.copytree(nd / "assembly/overworld_scripts", ndw / "assembly/overworld_scripts")
        (ndw / "strings/zz.string").write_text("#org @gText_Zz\nx\n", encoding="utf-8", newline="\n")
        shutil.rmtree(work / "profile-nd", ignore_errors=True)
        with Zigzagu(a.exe, profile=work / "profile-nd", extra=["--mute-audio"]) as z:
            z.call({"cmd": "open", "rom": str(nd / "BPRJ0.gba"), "project": str(ndw)})
            z.call({"cmd": "script.open", "path": "strings/zz.string"})
            check(wait_ready(z), "ND のエディタを開く")
            ed(z, "editor.project")
            ed(z, "editor.type", text="y", line=2, column=1)
            r = save_and_check(z)
            check(r["runs"] == 0, "ND（幅検査のコマンドが無い）では何もしない")
            ed(z, "close")

    print()
    print("失敗:", len(failures))
    for f in failures:
        print("  -", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
