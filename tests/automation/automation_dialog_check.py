"""自動操作の命令が、画面内のダイアログの答えを待って止まらないことを確かめる（issue #380）。

  python tests/automation/automation_dialog_check.py --rom <素の BPRJ の写し> [--exe <zigzagumap.exe>]
      [--project <CFRU-JP のフォルダ（読むだけ。一時フォルダへ写して使う）>] [--only <名前> ...]

- 自動操作の入口つき・一時フォルダの --profile で起動する（通常の設定には触れない）。ROM には書かない。
- 確かめる命令ごとに起動し直す（止まったときに、後の確認を巻き込まないため）。
- どの命令も LIMIT 秒（15 秒）で返らなければ「止まった」として失敗に数える。
- 名前（--only）:
    missingProject  open に無いプロジェクトフォルダ → すぐエラー、dialogs が空、開いていた ROM は残る
    unknownRom      open に知らない種類の ROM（適当なバイト列の .gba）→ すぐエラー、dialogs が空
    unexported      マップを変えて未出力のまま open → 聞かずにエラー、変更は残る
    scriptsTable    ROM だけで開いて scripts.table の action: "open" → すぐエラー
    warpMap         warp.createMap にワープが無い index・範囲外のバンク → すぐエラー、マップは増えない
    scriptEditor    （--project を付けたとき）editor.rename の正しくない名前はエラー、to を省くとダイアログを出したまま返る、
                    未保存のまま build.run の wait: true は確認を出したまま返る、未保存のまま別のフォルダを open するとエラー
- ポートは環境変数 ZZM_PORTS（例 `ZZM_PORTS=47830-47839`）で渡す。
失敗があれば終了コード 1。
"""
from __future__ import annotations

import argparse
import os
import pathlib
import shutil
import socket
import sys
import tempfile
import time
import urllib.error

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import AppError, Zigzagu  # noqa: E402

# 1 つの命令の返事を待つ時間の上限（秒）。これを過ぎたら「ダイアログで止まった」とみなす
LIMIT = 15
W = {"window": "script-editor"}
# スクリプトエディタの確認で写すもの（script_editor_check.py と同じ）
COPY_DIRS = ["assembly", "strings", "maps"]
COPY_FILES = ["xse_commands.s", "xse_defines.s", "asm_defines.s", "eventscripts", "charmap.tbl", "zigzagumap.json"]

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "NG   ") + what)
    if not cond:
        failures.append(what)


class Reply:
    """1 つの命令の結果（返事・エラー・止まったか・かかった秒数）。"""

    def __init__(self, result=None, error: str | None = None, hung: bool = False, seconds: float = 0.0):
        self.result = result
        self.error = error
        self.hung = hung
        self.seconds = seconds

    def __repr__(self) -> str:
        if self.hung:
            return f"{LIMIT} 秒で返らない"
        return f"{self.seconds:.1f} 秒、" + (f"エラー「{self.error}」" if self.error is not None else "成功")


def send(z: Zigzagu, obj: dict) -> Reply:
    """時間の上限つきで命令を送る。上限を過ぎたら hung。"""
    t0 = time.time()
    try:
        r = z.call(obj, timeout=LIMIT)
        return Reply(result=r, seconds=time.time() - t0)
    except AppError as e:
        return Reply(error=str(e), seconds=time.time() - t0)
    except (TimeoutError, socket.timeout):
        return Reply(hung=True, seconds=time.time() - t0)
    except urllib.error.URLError as e:
        if isinstance(e.reason, (TimeoutError, socket.timeout)):
            return Reply(hung=True, seconds=time.time() - t0)
        raise


def expect_error(z: Zigzagu, obj: dict, what: str, contains: str | None = None, window: dict | None = None) -> Reply:
    """すぐにエラーが返り、ダイアログが出ていないこと。"""
    r = send(z, {**obj, **(window or {})})
    ok = not r.hung and r.error is not None and (contains is None or contains in r.error)
    check(ok, f"{what}（{r}）")
    if r.hung:
        close_dialogs(z, window)
    else:
        dialogs = dialogs_of(z, window)
        check(not dialogs, f"{what}: ダイアログが出ていない（{titles(dialogs)}）")
        close_dialogs(z, window)
    return r


def dialogs_of(z: Zigzagu, window: dict | None = None) -> list[dict]:
    r = send(z, {"cmd": "dialogs", **(window or {})})
    if r.hung or r.error is not None:
        return [{"title": f"dialogs の命令が返らない（{r}）"}]
    return r.result["dialogs"] if isinstance(r.result, dict) else r.result


def titles(dialogs: list[dict]) -> str:
    return "、".join(str(d.get("title")) for d in dialogs) or "なし"


def close_dialogs(z: Zigzagu, window: dict | None = None) -> None:
    """残ったダイアログを閉じる（次の確認のため。キャンセルで閉じられなければ close）。"""
    for _ in range(5):
        if not dialogs_of(z, window):
            return
        r = send(z, {"cmd": "dialog", "press": "cancel", **(window or {})})
        if r.error is not None:
            send(z, {"cmd": "dialog", "press": "close", **(window or {})})


def state(z: Zigzagu) -> dict:
    r = send(z, {"cmd": "state"})
    if r.hung or r.error is not None:
        raise AppError(f"state が返らない（{r}）")
    return r.result


# ---- 確認 ----


def case_missing_project(z: Zigzagu, ctx: dict) -> None:
    rom = ctx["rom"]
    r = send(z, {"cmd": "open", "rom": rom})
    check(r.error is None and not r.hung, f"ROM だけで開く（{r}）")
    missing = str(ctx["tmp"] / "no-such-project")
    expect_error(z, {"cmd": "open", "rom": rom, "project": missing}, "open に無いプロジェクトフォルダを渡すとエラーが返る")
    st = state(z)
    check(st["rom"] is not None and st["project"] is None, f"開いていた ROM が残る（rom {st['rom']}、project {st['project']}）")
    check(not st["dialogs"], f"state の dialogs が空（{titles(st['dialogs'])}）")


def case_unknown_rom(z: Zigzagu, ctx: dict) -> None:
    bad = ctx["tmp"] / "unknown.gba"
    bad.write_bytes(bytes((i * 7 + 3) & 0xFF for i in range(0x100000)))
    expect_error(z, {"cmd": "open", "rom": str(bad)}, "open に知らない種類の ROM を渡すとエラーが返る")
    st = state(z)
    check(st["rom"] is None, f"何も開いていないまま（{st['rom']}）")
    check(not st["dialogs"], f"state の dialogs が空（{titles(st['dialogs'])}）")


def case_unexported(z: Zigzagu, ctx: dict) -> None:
    rom = ctx["rom"]
    check(send(z, {"cmd": "open", "rom": rom}).error is None, "ROM だけで開く")
    send(z, {"cmd": "selectMap", "bank": 3, "map": 0})
    r = send(z, {"cmd": "command", "name": "moveEvent", "args": {"bank": 3, "map": 0, "kind": "person", "index": 0, "x": 2, "y": 2}})
    check(r.error is None and not r.hung, f"3.0 の人 0 を動かす（{r}）")
    st = state(z)
    check(bool(st["dirty"]), f"未出力の変更がある（dirty {st['dirty']}）")
    expect_error(z, {"cmd": "open", "rom": rom}, "未出力のまま open すると、聞かずにエラーが返る", contains="出力")
    st = state(z)
    check(bool(st["dirty"]) and st["map"] is not None, f"変更と開いていたマップが残る（dirty {st['dirty']}）")


def case_scripts_table(z: Zigzagu, ctx: dict) -> None:
    check(send(z, {"cmd": "open", "rom": ctx["rom"]}).error is None, "ROM だけで開く")
    expect_error(z, {"cmd": "scripts.table", "action": "open"}, "プロジェクトフォルダが無いと scripts.table の open がエラーを返す")
    st = state(z)
    check(not st["dialogs"], f"state の dialogs が空（{titles(st['dialogs'])}）")


def case_warp_map(z: Zigzagu, ctx: dict) -> None:
    check(send(z, {"cmd": "open", "rom": ctx["rom"]}).error is None, "ROM だけで開く")
    send(z, {"cmd": "selectMap", "bank": 3, "map": 0})
    before = state(z)["history"]
    expect_error(z, {"cmd": "warp.createMap", "index": 99, "sample": None, "bank": 3}, "ワープが無い index で warp.createMap がエラーを返す")
    expect_error(z, {"cmd": "warp.createMap", "index": 99, "sample": None}, "bank を省いても、ワープが無ければ聞く前にエラーを返す")
    expect_error(z, {"cmd": "warp.createMap", "index": 0, "sample": None, "bank": 999}, "範囲外のバンクで warp.createMap がエラーを返す")
    st = state(z)
    check(st["history"] == before and st["map"] is not None and st["map"]["bank"] == 3 and st["map"]["map"] == 0,
          f"マップは作られず、3.0 を開いたまま（履歴 {before} → {st['history']}）")
    check(not st["dialogs"], f"state の dialogs が空（{titles(st['dialogs'])}）")


def prepare_project(src: pathlib.Path, dst: pathlib.Path) -> pathlib.Path:
    dst.mkdir(parents=True)
    for d in COPY_DIRS:
        if (src / d).is_dir():
            shutil.copytree(src / d, dst / d)
    for f in COPY_FILES:
        if (src / f).is_file():
            shutil.copy2(src / f, dst / f)
    return dst


def wait_ready(z: Zigzagu, timeout: float = 20) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if any(w["label"] == "script-editor" and w.get("ready") for w in z.call({"cmd": "windows"}, timeout=LIMIT)):
            return True
        time.sleep(0.2)
    return False


def case_script_editor(z: Zigzagu, ctx: dict) -> None:
    proj = prepare_project(ctx["project"], ctx["tmp"] / "project")
    files = sorted(p.name for p in (proj / "assembly/overworld_scripts").glob("*.s"))
    if not files:
        check(False, "写したプロジェクトに assembly/overworld_scripts/*.s がある")
        return
    rel = "assembly/overworld_scripts/" + files[0]
    r = send(z, {"cmd": "open", "rom": ctx["rom"], "project": str(proj)})
    check(r.error is None and not r.hung, f"ROM とプロジェクトの写しを開く（{r}）")
    r = send(z, {"cmd": "script.open", "path": rel})
    check(r.error is None and not r.hung and r.result["opened"], f"スクリプトエディタで {rel} を開く（{r}）")
    check(wait_ready(z), "エディタのウィンドウの準備ができる")

    # editor.rename: 正しくない名前はエラー、to を省くと名前を聞くダイアログを出したまま返る
    expect_error(z, {"cmd": "editor.rename", "from": "EventScript_ZzNoSuchLabel", "to": "1 bad name"},
                 "editor.rename に正しくない名前を渡すとエラーが返る", window=W)
    r = send(z, {"cmd": "editor.rename", "from": "EventScript_ZzNoSuchLabel", **W})
    dialogs = dialogs_of(z, W)
    check(not r.hung and r.error is None and bool(dialogs), f"editor.rename の to を省くと、ダイアログを出したまま返る（{r}、{titles(dialogs)}）")
    close_dialogs(z, W)

    # 未保存にする
    r = send(z, {"cmd": "editor.type", "text": "@ zz-dialog-check\n", "line": 1, "column": 1, **W})
    check(r.error is None and not r.hung and r.result["dirty"], f"入力して未保存にする（{r}）")

    # build.run の wait: true: 保存の確認が出たら、答えを待たずに返る
    r = send(z, {"cmd": "build.run", "wait": True, **W})
    dialogs = dialogs_of(z, W)
    check(not r.hung and r.error is None and bool(dialogs), f"未保存のまま build.run の wait: true は、確認を出したまま返る（{r}、{titles(dialogs)}）")
    close_dialogs(z, W)

    # 未保存のまま別のフォルダを open: 聞かずにエラー
    other = ctx["tmp"] / "other-project"
    other.mkdir()
    expect_error(z, {"cmd": "open", "rom": ctx["rom"], "project": str(other)}, "スクリプトエディタが未保存のまま別のフォルダを open するとエラーが返る", contains="保存")
    st = state(z)
    check(st["project"] is not None and pathlib.Path(st["project"]).resolve() == proj.resolve(), f"開いていたプロジェクトが残る（{st['project']}）")
    check(not st["dialogs"], f"メインの dialogs が空（{titles(st['dialogs'])}）")
    check(not dialogs_of(z, W), "エディタの dialogs が空")


CASES = {
    "missingProject": case_missing_project,
    "unknownRom": case_unknown_rom,
    "unexported": case_unexported,
    "scriptsTable": case_scripts_table,
    "warpMap": case_warp_map,
    "scriptEditor": case_script_editor,
}


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True, help="素の BPRJ の写し（書き込まない）")
    ap.add_argument("--exe")
    ap.add_argument("--project", help="スクリプトエディタの確認に使う CFRU-JP のフォルダ（読むだけ。一時フォルダへ写す）")
    ap.add_argument("--only", nargs="*", choices=list(CASES), help="確かめる名前（省略ですべて）")
    a = ap.parse_args()
    names = a.only or list(CASES)
    if "scriptEditor" in names and not a.project:
        if a.only:
            raise SystemExit("scriptEditor には --project が要ります")
        names.remove("scriptEditor")
        print("（--project が無いので scriptEditor は飛ばす）")
    rom = str(pathlib.Path(a.rom).resolve())
    for name in names:
        print(f"---- {name} ----")
        # 一時フォルダは最後に消す（WebView2 がしばらく掴んでいるファイルは残す。TemporaryDirectory は消せないと例外になることがある）
        tmp = pathlib.Path(tempfile.mkdtemp(prefix=f"zzm-dlg-{name}-"))
        try:
            ctx = {"rom": rom, "tmp": tmp, "project": pathlib.Path(a.project).resolve() if a.project else None}
            with Zigzagu(a.exe, profile=tmp / "profile", extra=["--mute-audio"]) as z:
                try:
                    CASES[name](z, ctx)
                except AppError as e:
                    check(False, f"{name}: 自動操作のエラー: {e}")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print()
    print("失敗なし" if not failures else f"失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
