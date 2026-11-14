"""scripts.json の対応表と .s の新規作成（issue #201）を、ND と Chronos の写しで確かめる。

  python tests/automation/scripts_table_check.py --nd <NeoDark-CFRU-main> --chronos <Chronos> --copy-root <写し先>
      [--exe <zigzagumap.exe>] [--only nd|chronos] [--reuse] [--no-build] [--shot <png>]

- 実フォルダ（--nd・--chronos。環境変数 ZZM_RC_ND_CFRU・ZZM_RC_CHRONOS でも可）は読むだけで、写し先（--copy-root、
  環境変数 ZZM_RC_COPY_ROOT）の下に写してから使う。build/・.git・.gba（ベース ROM を除く）は写さない。
  写し先が実フォルダの下にならないこと、テストが写し先の外へ書かないことを最初に確かめる。
- 写しを ZigzaguMap（--profile は写し先の下、--mute-audio、画面外）で開き、ツール > スクリプトファイルの対応表を開いて、
  「新しい .s を作る」（ファイル名の入力）・行の追加・変更・アンドゥを画面の部品で行い、自動操作の scripts.table でも編集する。
- 出力（export）で maps/scripts.json・新しい .s・.string が書かれること、.s の先頭が既存の .s と同じこと、
  開き直すと同じ表になることを確かめ、写しでビルドする（ND は CFRU で python scripts/make.py、Chronos はルートで python build.py）。
失敗があれば終了コード 1。
"""
from __future__ import annotations

import argparse
import base64
import os
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import AppError, Zigzagu  # noqa: E402

failures: list[str] = []

EXCLUDE_DIRS = {"build", ".git", "__pycache__", "node_modules"}
EXCLUDE_SUFFIXES = {".gba", ".bak", ".sav", ".sa1", ".sa2"}
HEADER_LINES = [".text", ".thumb", ".align 2", "", '.include "../xse_commands.s"', '.include "../xse_defines.s"', '.include "../asm_defines.s"']
NEW_NAME = "zz201_table_test"
ERROR_PATTERNS = [re.compile(p) for p in (r"Symbol missing", r"\berror:", r"^Error", r"There was an error", r"Traceback \(most recent", r"TEXT WIDTH ERROR")]


def check(cond: bool, what: str) -> bool:
    print(("OK   " if cond else "NG   ") + what, flush=True)
    if not cond:
        failures.append(what)
    return cond


def norm(p: os.PathLike | str) -> pathlib.Path:
    return pathlib.Path(os.path.normcase(os.path.abspath(p)))


def inside(path: os.PathLike | str, root: os.PathLike | str) -> bool:
    a, b = norm(path), norm(root)
    return a == b or b in a.parents


def guard(path: pathlib.Path, root: pathlib.Path) -> pathlib.Path:
    if not inside(path, root):
        raise SystemExit(f"写し先の外を指しています: {path}")
    return path


class Fixture:
    def __init__(self, name: str, real: pathlib.Path, base_rom: str, project: str, build_cwd: str, build_args: list[str], output: str):
        self.name, self.real, self.base_rom = name, real, base_rom
        self.project_rel, self.build_cwd_rel, self.build_args, self.output = project, build_cwd, build_args, output
        self.root = pathlib.Path()

    @property
    def dir(self) -> pathlib.Path:
        return guard(self.root / self.name / self.real.name, self.root)

    @property
    def rom(self) -> pathlib.Path:
        return self.dir / self.base_rom

    @property
    def project(self) -> pathlib.Path:
        return self.dir / self.project_rel if self.project_rel else self.dir

    @property
    def build_cwd(self) -> pathlib.Path:
        return self.dir / self.build_cwd_rel if self.build_cwd_rel else self.dir


def _rm_error(func, path, _exc):
    os.chmod(path, stat.S_IWRITE)
    func(path)


def make_copy(fx: Fixture, reuse: bool) -> None:
    done = fx.dir.parent / ".copy-complete"
    if reuse and done.exists():
        print(f"     {fx.name}: 前の写しを使う {fx.dir}")
        return
    if fx.dir.parent.exists():
        shutil.rmtree(guard(fx.dir.parent, fx.root), onerror=_rm_error)
    t0 = time.time()
    count = 0
    for cur, dirs, names in os.walk(fx.real):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        rel = os.path.relpath(cur, fx.real)
        out = fx.dir / rel if rel != "." else fx.dir
        out.mkdir(parents=True, exist_ok=True)
        for n in names:
            if os.path.splitext(n)[1].lower() in EXCLUDE_SUFFIXES:
                continue
            shutil.copy2(os.path.join(cur, n), out / n)
            count += 1
    fx.rom.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(fx.real / fx.base_rom, fx.rom)
    done.write_text(time.strftime("%Y-%m-%d %H:%M:%S"), encoding="utf-8")
    print(f"     {fx.name}: {count} ファイルを写した（{time.time() - t0:.0f} 秒）{fx.dir}")


def run_build(fx: Fixture, log: pathlib.Path) -> tuple[bool, str]:
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    env["PATH"] = os.pathsep.join([os.path.dirname(sys.executable)] + [p for p in env.get("PATH", "").split(os.pathsep) if "WindowsApps" not in p])
    args = [sys.executable if a == "python" else a for a in fx.build_args]
    output = guard(fx.build_cwd / fx.output, fx.root)
    t0 = time.time()
    with open(guard(log, fx.root), "w", encoding="utf-8", errors="replace") as f:
        rc = subprocess.call(args, cwd=fx.build_cwd, stdout=f, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=env,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    text = log.read_text(encoding="utf-8", errors="replace")
    errors = [l.strip()[:200] for l in text.splitlines() if any(p.search(l) for p in ERROR_PATTERNS)]
    written = output.is_file() and output.stat().st_mtime >= t0 - 1
    ok = rc == 0 and written and not errors
    return ok, f"終了コード {rc}、{fx.output} {'あり' if written else 'なし'}、エラー行 {len(errors)} {errors[:3]}、{time.time() - t0:.0f} 秒、ログ {log}"


def rows_of(table: dict) -> list[dict]:
    return [{k: r[k] for k in ("bank", "map", "name", "script", "strings")} for r in table["rows"]]


def check_fixture(fx: Fixture, exe: pathlib.Path | None, build: bool, shot: pathlib.Path | None) -> None:
    print(f"== {fx.name}", flush=True)
    project = fx.project
    script_rel = f"assembly/overworld_scripts/{NEW_NAME}.s"
    strings_rel = f"strings/overworld_strings_{NEW_NAME}.string"
    for rel in (script_rel, strings_rel, "maps/scripts.json"):
        p = guard(project / rel, fx.root)
        if p.exists():
            p.unlink()
    existing = sorted((project / "assembly/overworld_scripts").glob("*.s"))
    profile = guard(fx.root / "profiles" / fx.name, fx.root)
    with Zigzagu(exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": str(fx.rom), "project": str(project)})
        t = z.call({"cmd": "scripts.table"})
        check(t["rows"] == [] and t["loadError"] is None and not t["modified"], "scripts.json が無いときは空の表")
        z.call({"cmd": "menu.run", "id": "tools.scriptsTable"})
        t = z.call({"cmd": "scripts.table"})
        check(t["open"], "ツール > スクリプトファイルの対応表 で画面が開く")

        # 新しい .s（ファイル名の入力）
        z.call({"cmd": "click", "id": "scriptsTable.newScript"})
        z.call({"cmd": "setField", "id": "scriptsTable.new.name", "value": NEW_NAME})
        z.call({"cmd": "setField", "id": "scriptsTable.new.bank", "value": "3"})
        z.call({"cmd": "setField", "id": "scriptsTable.new.map", "value": "0"})
        z.call({"cmd": "setField", "id": "scriptsTable.new.mapName", "value": "マサラタウン"})
        auto = z.call({"cmd": "getField", "id": "scriptsTable.new.strings"})["value"]
        check(auto == strings_rel, f".string に既定の名前が入る（{auto}）")
        z.call({"cmd": "click", "id": "scriptsTable.new.create"})
        t = z.call({"cmd": "scripts.table"})
        check(len(t["rows"]) == 1 and t["rows"][0]["create"] and t["rows"][0]["script"] == script_rel and t["rows"][0]["strings"] is None,
              "作成で対応表に行が増え、出力で作る印が付く")
        check(t["pendingFiles"] == [{"script": script_rel, "strings": strings_rel}], "出力で作るファイルは .s と .string")
        check(not (project / script_rel).exists(), "出力するまではファイルを作らない")

        # 画面の欄で行を足す・変える
        other = existing[0].name
        z.call({"cmd": "setField", "id": "scriptsTable.bank", "value": "1"})
        z.call({"cmd": "setField", "id": "scriptsTable.map", "value": ""})
        z.call({"cmd": "setField", "id": "scriptsTable.name", "value": "Bank1"})
        z.call({"cmd": "setField", "id": "scriptsTable.script", "value": f"assembly\\overworld_scripts\\{other}"})
        z.call({"cmd": "setField", "id": "scriptsTable.strings", "value": "strings/zz201_custom.string"})
        z.call({"cmd": "click", "id": "scriptsTable.add"})
        t = z.call({"cmd": "scripts.table"})
        check(len(t["rows"]) == 2 and t["rows"][1]["map"] is None and t["rows"][1]["script"] == f"assembly/overworld_scripts/{other}"
              and t["rows"][1]["strings"] == "strings/zz201_custom.string" and not t["rows"][1]["create"], "追加で行が増える（区切りは / にそろえる）")
        z.call({"cmd": "setField", "id": "scriptsTable.name", "value": "Bank1 全体"})
        z.call({"cmd": "click", "id": "scriptsTable.save"})
        t = z.call({"cmd": "scripts.table"})
        check(t["rows"][1]["name"] == "Bank1 全体", "変更を保存で行が変わる")
        z.call({"cmd": "undo"})
        check(z.call({"cmd": "scripts.table"})["rows"][1]["name"] == "Bank1", "アンドゥで戻る")
        z.call({"cmd": "redo"})
        check(z.call({"cmd": "scripts.table"})["rows"][1]["name"] == "Bank1 全体", "リドゥでやり直す")

        # 自動操作の scripts.table で編集する
        z.call({"cmd": "scripts.table", "action": "add", "entry": {"bank": 1, "map": 0, "name": "Moegi", "script": f"assembly/overworld_scripts/{other}", "strings": None}})
        z.call({"cmd": "scripts.table", "action": "move", "index": 2, "to": 1})
        t = z.call({"cmd": "scripts.table"})
        check([r["name"] for r in t["rows"]] == ["マサラタウン", "Moegi", "Bank1 全体"], "scripts.table の add と move")
        check(z.call({"cmd": "scripts.table", "action": "resolve", "bank": 1, "map": 0})["entryIndex"] == 1, "マップを指定した行が優先される")
        check(z.call({"cmd": "scripts.table", "action": "resolve", "bank": 1, "map": 9})["entryIndex"] == 2, "バンク全体の行に当たる")
        try:
            z.call({"cmd": "scripts.table", "action": "add", "entry": {"bank": 1, "script": "../outside.s"}})
            check(False, "プロジェクトの外のパスは足せない")
        except AppError:
            check(True, "プロジェクトの外のパスは足せない")
        z.call({"cmd": "scripts.table", "action": "select", "index": 0})
        if shot:
            shot.parent.mkdir(parents=True, exist_ok=True)
            shot.write_bytes(base64.b64decode(z.call({"cmd": "screenshot"})["png"]))
            print(f"     スクリーンショット: {shot}")

        # 対応表に無いマップ: ファイル名の入力が出る（キャンセル）
        r = z.call({"cmd": "scripts.table", "action": "ensure", "bank": 7, "map": 7})
        titles = [d.get("title") for d in r["dialogs"]]
        check(r["resolved"] is None and ".s を新しく作る" in titles, "対応する .s が無いマップでファイル名の入力が出る")
        z.call({"cmd": "dialog", "title": ".s を新しく作る", "press": "cancel"})
        check(z.call({"cmd": "scripts.table", "action": "ensure", "bank": 3, "map": 0})["resolved"]["script"] == script_rel, "あるマップはそのまま返す")

        before = rows_of(z.call({"cmd": "scripts.table"}))
        out = z.call({"cmd": "export"})
        written = out.get("written", []) if isinstance(out, dict) else []
        check(all(any(w.replace("\\", "/").endswith(p) for w in written) for p in (script_rel, strings_rel, "maps/scripts.json")),
              f"出力で scripts.json・.s・.string を書く（{written}）")
        t = z.call({"cmd": "scripts.table"})
        check(not t["modified"] and t["pendingFiles"] == [], "出力のあとは未出力の変更が無い")

        z.call({"cmd": "open", "rom": str(fx.rom), "project": str(project)})
        after = rows_of(z.call({"cmd": "scripts.table"}))
        check(after == before, "開き直すと同じ表になる")

    s_text = (project / script_rel).read_bytes()
    check(s_text.decode("utf-8").split("\n")[:7] == HEADER_LINES and b"\r" not in s_text, ".s の先頭は .text・.thumb・.align 2・空行・3 つの .include（LF）")
    same = [p.name for p in existing if p.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n").split("\n")[:7] == HEADER_LINES]
    check(len(same) > 0, f"既存の .s と同じ先頭（同じもの: {', '.join(same)}）")
    check((project / strings_rel).read_bytes() == b"", ".string は空で作る")
    raw = (project / "maps/scripts.json").read_bytes()
    check(b"\r\n" in raw and b'"Format": 1' in raw, "scripts.json は Bochi と同じ整形（CRLF・2 空白）")

    if build:
        log = guard(fx.root / "logs" / f"{fx.name}-build.log", fx.root)
        log.parent.mkdir(parents=True, exist_ok=True)
        ok, why = run_build(fx, log)
        check(ok, f"写しでビルドが通る（{why}）")
        text = log.read_text(encoding="utf-8", errors="replace")
        # Chronos の build.py は、ファイルごとのアセンブルを build/logs/*.log にだけ書く（標準出力には出さない）
        for extra in sorted((fx.build_cwd / "build" / "logs").glob("*.log")):
            if extra.stat().st_mtime >= log.stat().st_mtime - 3600:
                text += extra.read_text(encoding="utf-8", errors="replace")
        check(NEW_NAME in text, f"ビルドが新しい .s をアセンブルする（ログに {NEW_NAME}）")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", type=pathlib.Path)
    ap.add_argument("--nd", type=pathlib.Path, default=os.environ.get("ZZM_RC_ND_CFRU"))
    ap.add_argument("--chronos", type=pathlib.Path, default=os.environ.get("ZZM_RC_CHRONOS"))
    ap.add_argument("--copy-root", type=pathlib.Path, default=os.environ.get("ZZM_RC_COPY_ROOT"))
    ap.add_argument("--only", choices=["nd", "chronos"])
    ap.add_argument("--reuse", action="store_true", help="前の写しがあればそのまま使う")
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--shot", type=pathlib.Path, help="対応表の画面のスクリーンショット（最初の写しで撮る）")
    a = ap.parse_args()
    if not a.copy_root:
        raise SystemExit("--copy-root（写し先）を指定してください")
    root = pathlib.Path(a.copy_root).resolve()
    fixtures = []
    if a.nd and a.only in (None, "nd"):
        fixtures.append(Fixture("nd", pathlib.Path(a.nd).resolve(), "BPRJ0.gba", "", "", ["python", "scripts/make.py"], "test.gba"))
    if a.chronos and a.only in (None, "chronos"):
        fixtures.append(Fixture("chronos", pathlib.Path(a.chronos).resolve(), "base/BPRJ0.gba", "cfru", "", ["python", "build.py"], "build/Chronos.gba"))
    if not fixtures:
        raise SystemExit("--nd か --chronos を指定してください")
    if len(norm(root).parts) < 3:
        raise SystemExit(f"写し先が浅すぎます: {root}")
    for fx in fixtures:
        if inside(root, fx.real) or inside(fx.real, root):
            raise SystemExit(f"写し先と実フォルダが重なっています: {root} / {fx.real}")
        fx.root = root
    shot = a.shot
    for fx in fixtures:
        make_copy(fx, a.reuse)
        check_fixture(fx, a.exe, not a.no_build, shot)
        shot = None
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    for f in failures:
        print("  - " + f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
