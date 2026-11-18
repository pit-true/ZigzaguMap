"""場所の設定タブの「このマップの .s」（#555）を、Chronos のコピーで確かめる。

  python tests/automation/map_script_link_check.py --chronos <Chronos のルート（読むだけ）> --work <作業フォルダ>
      [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- `--chronos` には書き込まない。要る分（base の BPRJ0.gba と cfru の src/config.h・assembly・strings・maps・eventscripts など）を
  `--work` の下に写し、写しを開く。
- 見ること
  - Chronos には maps\\scripts.json が無いので、トキワシティ（3.1）の「このマップの .s」は決まっていない。
  - 「選ぶ…」（ファイルを選ぶ画面に queuePath で答える）で assembly の外のファイルを選ぶと、理由を出して断る（紐づけない）。
  - zigzagu_playback_demo_scripts.s を選ぶと紐づき、見本のラベルはマップの .s のラベルになる（注意なし）。元に戻すと消え、やり直すと戻る。
  - 出力すると maps\\scripts.json にマップを指定した行が書かれる。ZigzaguMap を閉じて開き直しても、紐づけが残り、注意が出ない。
  - 「外す」で紐づけが消え（出力でファイルの行も消える）、自動操作の `scripts.mapLink` の set / clear も同じ動き。
"""
from __future__ import annotations

import argparse
import base64
import json
import pathlib
import shutil
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import AppError, Zigzagu  # noqa: E402

failures: list[str] = []
DEMO = "assembly/overworld_scripts/zigzagu_playback_demo_scripts.s"
LABEL = "EventScript_ZzmPlaybackDemo"
CFRU_DIRS = ["assembly", "strings", "maps"]
CFRU_FILES = ["src/config.h", "eventscripts", "xse_commands.s", "xse_defines.s", "asm_defines.s", "charmap.tbl", "BPRJ.ld", "zigzagumap.json"]


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what, flush=True)
    if not cond:
        failures.append(what)


def copy(src: pathlib.Path, work: pathlib.Path) -> pathlib.Path:
    root = work / "Chronos"
    shutil.rmtree(work, ignore_errors=True)
    (root / "base").mkdir(parents=True)
    shutil.copyfile(src / "base" / "BPRJ0.gba", root / "base" / "BPRJ0.gba")
    for d in CFRU_DIRS:
        shutil.copytree(src / "cfru" / d, root / "cfru" / d)
    for f in CFRU_FILES:
        if (src / "cfru" / f).exists():
            (root / "cfru" / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src / "cfru" / f, root / "cfru" / f)
    return root


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    if shots:
        data = z.call({"cmd": "screenshot"})
        (shots / f"{name}.png").write_bytes(base64.b64decode(data["png"] if isinstance(data, dict) else data))


def demo_places(z: Zigzagu) -> list[tuple[int, str, bool]]:
    return [(p["index"], p["place"], p["inScript"]) for p in z.call({"cmd": "script.labels", "bank": 3, "map": 1})["person"] if p["label"] == LABEL]


def person_field(z: Zigzagu, index: int) -> dict:
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "event.select", "kind": "person", "index": index})
    z.call({"cmd": "script.settle"})
    time.sleep(0.2)
    return z.call({"cmd": "getField", "id": "event.person.label"})


def link(z: Zigzagu) -> dict:
    return z.call({"cmd": "scripts.mapLink", "bank": 3, "map": 1})


def open_chronos(z: Zigzagu, root: pathlib.Path) -> None:
    z.call({"cmd": "openFolder", "folder": str(root)}, timeout=300)
    z.call({"cmd": "selectMap", "bank": 3, "map": 1})
    z.call({"cmd": "tab", "name": "header"})
    z.call({"cmd": "setField", "id": "header.mode.simple", "value": True})


def choose(z: Zigzagu, path: str) -> list:
    """「選ぶ…」を押し、ファイルを選ぶ画面に `path` で答える。開いているダイアログ（エラーの知らせ）を返す。"""
    z.call({"cmd": "queuePath", "path": path})
    z.call({"cmd": "click", "id": "easy.mapScript.choose"})
    time.sleep(0.5)
    return z.call({"cmd": "dialogs"})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chronos", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    root = copy(pathlib.Path(args.chronos), pathlib.Path(args.work))
    cfru = root / "cfru"
    table = cfru / "maps" / "scripts.json"
    exe = pathlib.Path(args.exe) if args.exe else None
    with tempfile.TemporaryDirectory(prefix="zzm-maplink-", ignore_cleanup_errors=True) as profile:
        with Zigzagu(exe, profile=profile) as z:
            open_chronos(z, root)
            st = link(z)
            check(st["script"] is None and st["from"] == "none" and not table.exists(), f"初めは紐づけが無い（{st}）")
            f = z.call({"cmd": "getField", "id": "easy.mapScript.path"})
            check(f["visible"] and "決まっていません" in f["value"], f"場所の設定タブに「このマップの .s」が出る（{f['value']}）")
            shot(z, shots, "maplink-01-none")

            # assembly の外は断る
            dialogs = choose(z, str(cfru / "xse_commands.s"))
            text = json.dumps(dialogs, ensure_ascii=False)
            check("assembly の中の .s ではない" in text and link(z)["from"] == "none", "assembly の外のファイルは理由を出して断る")
            shot(z, shots, "maplink-02-outside")
            z.call({"cmd": "dialog", "press": "ok"})
            time.sleep(0.3)

            # 選ぶ → 紐づく → 見本のラベルはマップの .s のラベル
            dialogs = choose(z, str(cfru / DEMO.replace("/", "\\")))
            st = link(z)
            check(st["script"] == DEMO and st["from"] == "map" and st["modified"], f"選ぶと紐づく（{st}）")
            f = z.call({"cmd": "getField", "id": "easy.mapScript.path"})
            check(f["value"] == DEMO and z.call({"cmd": "getField", "id": "easy.mapScript.clear"})["enabled"], f"欄に紐づけた .s が出て「外す」が使える（{f['value']}）")
            shot(z, shots, "maplink-03-linked")
            places = demo_places(z)
            check(len(places) == 3 and all(p == "map" and ok for _, p, ok in places), f"見本のラベルはマップの .s のラベル（{places}）")
            pf = person_field(z, places[1][0] if places else 10)
            check("missing" not in pf["classes"] and pf["title"] == LABEL, f"人の欄に注意が出ない（{pf['title']}）")
            shot(z, shots, "maplink-04-event")
            z.call({"cmd": "undo"})
            check(link(z)["from"] == "none", "元に戻すと紐づけが消える")
            z.call({"cmd": "redo"})
            check(link(z)["script"] == DEMO, "やり直すと紐づけが戻る")

            # 出力 → 閉じて開き直す
            z.call({"cmd": "export"}, timeout=300)
            saved = json.loads(table.read_text(encoding="utf-8")) if table.exists() else {}
            rows = [e for e in saved.get("Entries", []) if e.get("Bank") == 3 and e.get("Map") == 1]
            check(len(rows) == 1 and rows[0]["Script"] == DEMO, f"出力で maps\\scripts.json にマップの行が書かれる（{rows}）")
        with Zigzagu(exe, profile=profile) as z:
            open_chronos(z, root)
            st = link(z)
            check(st["script"] == DEMO and st["from"] == "map" and not st["modified"], f"開き直しても紐づけが残る（{st}）")
            places = demo_places(z)
            check(len(places) == 3 and all(p == "map" for _, p, _ in places), f"開き直しても注意が出ない（{places}）")
            shot(z, shots, "maplink-05-reopen")

            # 外す
            z.call({"cmd": "tab", "name": "header"})
            z.call({"cmd": "click", "id": "easy.mapScript.clear"})
            st = link(z)
            check(st["from"] == "none" and st["row"] == -1, f"「外す」で紐づけが消える（{st}）")
            places = demo_places(z)
            check(all(p == "global" for _, p, _ in places), f"外すと、見本のラベルは別のファイルの .global に戻る（{places}）")
            # 自動操作の set / clear
            try:
                z.call({"cmd": "scripts.mapLink", "bank": 3, "map": 1, "action": "set", "path": "strings/zigzagu_playback_demo.string"})
                check(False, "自動操作の set でも .s でないファイルは断る")
            except AppError as e:
                check(".s ではない" in str(e), f"自動操作の set でも .s でないファイルは断る（{e}）")
            st = z.call({"cmd": "scripts.mapLink", "bank": 3, "map": 1, "action": "set", "path": DEMO})
            check(st["script"] == DEMO and st["from"] == "map", "自動操作の set で紐づく")
            st = z.call({"cmd": "scripts.mapLink", "bank": 3, "map": 1, "action": "clear"})
            check(st["from"] == "none", "自動操作の clear で外れる")
            z.call({"cmd": "export"}, timeout=300)
            saved = json.loads(table.read_text(encoding="utf-8")) if table.exists() else {"Entries": []}
            check(not any(e.get("Bank") == 3 and e.get("Map") == 1 for e in saved.get("Entries", [])), "外して出力すると、ファイルの行も消える")
    print("結果: " + ("すべて OK" if not failures else f"失敗 {len(failures)} 件"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
