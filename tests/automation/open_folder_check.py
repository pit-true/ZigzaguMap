"""CFRU-JP のフォルダを開く（#540）と、CFRU のソースの場所（#543 時間帯の色）を確かめる。

  python tests/automation/open_folder_check.py --nd <NeoDark-CFRU-main の写し> --chronos <Chronos のルートの写し>
      --rom <素の BPRJ> --work <作業フォルダ> [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- 起動は --automation・--profile（一時フォルダ）。写しには書き込まない（出力しない）。作業フォルダには、候補が複数・無い形の
  小さなフォルダを作る（素の ROM の写しを置く）。
- 見ること
  - ファイルメニューの一番上が「CFRU-JP のフォルダを開く…」（Ctrl+O）。「ROMを開く」は残り、Ctrl+Shift+O。
  - `openFolder` で ND・Chronos のルート・Chronos の cfru を開くと、プロジェクトのフォルダとベース ROM が決まり、マップが開ける。
  - メニューから（フォルダのダイアログに答えるだけで）開ける。
  - ベース ROM の候補が複数なら一覧のダイアログ、無ければ ROM を選ぶダイアログ。`openFolder` はエラーで理由を返す。
  - 時間帯（#543）: ND、Chronos（`openFolder` と、`open` で Chronos のルートをプロジェクトにした形）で夜に変わる。ROM だけなら
    コンボが使えず、理由を返す。ソースが見つからないフォルダでは、探した場所をエラーに書く。
"""
from __future__ import annotations

import argparse
import base64
import pathlib
import shutil
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import AppError, Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def same(a: str | None, b: str | pathlib.Path) -> bool:
    return a is not None and pathlib.Path(a).resolve() == pathlib.Path(b).resolve()


def error_of(z: Zigzagu, req: dict) -> str:
    try:
        z.call(req, timeout=180)
    except AppError as e:
        return str(e)
    return ""


def night(z: Zigzagu) -> dict:
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    st = z.call({"cmd": "view.timeOfDay", "time": "night", "wait": True})
    z.call({"cmd": "view.timeOfDay", "time": "day"})
    return st


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--nd", required=True)
    ap.add_argument("--chronos", required=True)
    ap.add_argument("--rom", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    args = ap.parse_args()
    nd, ch = pathlib.Path(args.nd), pathlib.Path(args.chronos)
    work = pathlib.Path(args.work)
    shutil.rmtree(work, ignore_errors=True)
    many, many2, none = work / "many", work / "many2", work / "none"
    for d in (many, many2, none):
        (d / "src").mkdir(parents=True)
        (d / "src" / "config.h").write_text("// test\n", encoding="utf-8")
    for d in (many, many2):
        shutil.copyfile(args.rom, d / "a.gba")
        shutil.copyfile(args.rom, d / "b.gba")
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    exe = pathlib.Path(args.exe) if args.exe else None
    with tempfile.TemporaryDirectory(prefix="zzm-folder-", ignore_cleanup_errors=True) as profile:
        with Zigzagu(exe, profile=profile, extra=["--mute-audio"]) as z:
            items = z.call({"cmd": "menu.list"})
            file_items = [i for i in items if i["path"][0] == "ファイル" and len(i["path"]) == 2]
            first = file_items[0]
            check(first["id"] == "file.openProject" and first["path"][1] == "CFRU-JP のフォルダを開く…" and first["shortcut"] == "Ctrl+O",
                  f"ファイルの一番上は CFRU-JP のフォルダを開く…（Ctrl+O）: {first}")
            rom_item = next(i for i in file_items if i["id"] == "file.open")
            check(rom_item["shortcut"] == "Ctrl+Shift+O", f"ROMを開くは残り、Ctrl+Shift+O: {rom_item}")

            # ND
            st = z.call({"cmd": "openFolder", "folder": str(nd)}, timeout=180)
            check(same(st["project"], nd) and same(st["rom"], nd / "BPRJ0.gba"), f"ND: プロジェクトは直下、ROM は BPRJ0.gba（test.gba ではない）: {st['project']} / {st['rom']}")
            check("CFRU-JP のフォルダを開きました" in st["status"]["left"], "ステータスバーに開いたフォルダと ROM")
            t = night(z)
            check(t["ok"] and t["time"] == "night" and t["clock"] == "rtc", f"ND の時間帯は夜に変わる: {t.get('status')}")

            # Chronos のルートと cfru
            for name, folder in (("ルート", ch), ("cfru", ch / "cfru")):
                st = z.call({"cmd": "openFolder", "folder": str(folder)}, timeout=180)
                check(same(st["project"], ch / "cfru") and same(st["rom"], ch / "base" / "BPRJ0.gba"),
                      f"Chronos の{name}: プロジェクトは cfru、ROM は base の BPRJ0.gba: {st['project']} / {st['rom']}")
                t = night(z)
                check(t["ok"] and t["time"] == "night" and t["clock"] == "chronos", f"Chronos の{name}の時間帯は夜に変わる: {t.get('status')}")
                if shots and name == "ルート":
                    (shots / "chronos_root.png").write_bytes(base64.b64decode(z.call({"cmd": "screenshot"})["png"]))

            # #543: 前の形（Chronos のルートをプロジェクトにした `open`）でも、ソースを cfru/ の下に見つける
            z.call({"cmd": "open", "rom": str(ch / "base" / "BPRJ0.gba"), "project": str(ch)}, timeout=180)
            t = night(z)
            check(t["ok"] and t["time"] == "night" and t["clock"] == "chronos", f"Chronos のルートを open しても夜に変わる: {t.get('status')}")

            # ソースが見つからないフォルダ（ND の親）: 探した場所を出す
            z.call({"cmd": "open", "rom": str(nd / "BPRJ0.gba"), "project": str(work)}, timeout=180)
            t = night(z)
            check(not t["ok"] and t["error"] and "src/config.h" in t["error"] and "cfru/src/config.h" in t["error"] and "探しました" in t["error"],
                  f"ソースが無いフォルダでは、探した場所を出す: {t.get('error')}")

            # ROM だけ
            z.call({"cmd": "open", "rom": args.rom}, timeout=180)
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            st = z.call({"cmd": "view.timeOfDay"})
            check(st["combo"]["disabled"], "ROM だけのときは時間帯のコンボを使えない")
            t = z.call({"cmd": "view.timeOfDay", "time": "night"})
            check(not t["ok"] and t["time"] == "day" and "開くと使えます" in (t["error"] or ""), f"ROM だけのときは理由を返す: {t.get('error')}")

            # 候補が複数・無い
            e = error_of(z, {"cmd": "openFolder", "folder": str(many)})
            check("候補が複数" in e and "a.gba" in e and "b.gba" in e, f"openFolder は候補が複数ならエラー: {e}")
            st = z.call({"cmd": "openFolder", "folder": str(many), "rom": str(many / "b.gba")}, timeout=180)
            check(same(st["rom"], many / "b.gba") and same(st["project"], many), "rom を渡せばそれで開く")
            e = error_of(z, {"cmd": "openFolder", "folder": str(none)})
            check("見つかりません" in e and str(none) in e, f"openFolder は ROM が無ければエラー（探した場所つき）: {e}")

            # メニューから: 前にそのフォルダと組で開いた ROM が候補にあれば、それを使う
            z.call({"cmd": "open", "rom": args.rom}, timeout=180)
            z.call({"cmd": "queuePath", "path": str(many)})
            z.call({"cmd": "menu.run", "id": "file.openProject", "wait": 1500})
            st = z.call({"cmd": "state"})
            check(same(st["rom"], many / "b.gba") and not st["dialogs"], f"前に組で開いた ROM（b.gba）を使い、聞かない: {st['rom']}")
            # 候補が複数で記録も無ければ、一覧のダイアログ
            z.call({"cmd": "queuePath", "path": str(many2)})
            z.call({"cmd": "menu.run", "id": "file.openProject", "wait": 1500})
            dialogs = z.call({"cmd": "dialogs"})["dialogs"]
            choice = [d for d in dialogs if d.get("kind") == "app" and d.get("title") == "ベース ROM を選んでください"]
            check(len(choice) == 1, f"候補が複数なら一覧のダイアログ: {dialogs}")
            if choice:
                z.call({"cmd": "dialog", "input": "0", "press": "ok"})
                for _ in range(60):
                    st = z.call({"cmd": "state"})
                    if same(st["project"], many2):
                        break
                    time.sleep(0.5)
                check(same(st["rom"], many2 / "a.gba"), f"選んだ ROM で開く: {st['rom']}")
            # 無ければ ROM を選ぶダイアログ（キャンセルで何も変えない）
            before = z.call({"cmd": "state"})
            z.call({"cmd": "queuePath", "path": str(none)})
            z.call({"cmd": "menu.run", "id": "file.openProject", "wait": 1500})
            dialogs = z.call({"cmd": "dialogs"})["dialogs"]
            native = [d for d in dialogs if d.get("kind") == "native" and d.get("type") == "rom"]
            status = z.call({"cmd": "state"})["status"]["left"]
            check(len(native) == 1 and "ベース ROM が見つかりません" in status, f"ROM が無ければ理由を出して ROM を選ぶダイアログ: {status}")
            if native:
                z.call({"cmd": "queuePath", "path": None})
            after = z.call({"cmd": "state"})
            check(after["rom"] == before["rom"] and after["project"] == before["project"], "キャンセルなら開いていたものはそのまま")

            # メニューから ND を開く（フォルダのダイアログに答えるだけ）
            z.call({"cmd": "queuePath", "path": str(nd)})
            z.call({"cmd": "key", "key": "o", "ctrl": True})
            for _ in range(60):
                st = z.call({"cmd": "state"})
                if same(st["project"], nd):
                    break
                time.sleep(0.5)
            check(same(st["project"], nd) and same(st["rom"], nd / "BPRJ0.gba"), "Ctrl+O でフォルダを選ぶだけで ND が開く")
    print(f"\n失敗 {len(failures)} 件" if failures else "\nすべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
