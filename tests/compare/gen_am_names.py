"""AdvanceMap の部品名 → ZigzaguMap の部品の ID の対応表（tests/compare/am-names.json）を、実際の画面から集めて作る。

  python tests/compare/gen_am_names.py --rom <素の BPRJ> [--exe <zigzagumap.exe>]

ZigzaguMap を `--automation --profile <一時フォルダ>` で起動し、各画面（タブ・イベントの種別・高度なヘッダーの表示/非表示・
コネクションマネージャー・新規マップなどのダイアログ・ブロックエディタ・パレットエディタ・ブロックパレット一括変更・
ワールドマップエディター）を順に開いて、`ui.list` の `amName`（自動操作の入口が amNames.ts の表から付ける `data-am-name`）を集める。
ワールドマップエディターは部品の ID が AdvanceMap の部品名そのもの。

出力: {"<ウィンドウ>": {"<AdvanceMap の部品名>": ["<ZigzaguMap の ID>", ...]}, "_screens": {"<画面>": 件数}}
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import sys
import tempfile
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "automation"))
from zz import AppError, Zigzagu  # noqa: E402


def collect(z: Zigzagu, out: dict, window: str, screen: str, screens: dict) -> None:
    req = {"cmd": "ui.list"} if window == "main" else {"cmd": "fields" if window == "world-map" else "ui.list", "window": window}
    items = z.call(req)
    if isinstance(items, dict):  # ワールドマップエディターの fields は {ID: 値}
        items = [{"id": k, "amName": k} for k in items]
    table = out.setdefault(window, {})
    n = 0
    for it in items:
        name, fid = it.get("amName"), it.get("id")
        if not name or not fid:
            continue
        ids = table.setdefault(name, [])
        if fid not in ids:
            ids.append(fid)
            n += 1
    screens[f"{window}: {screen}"] = n


def wait_window(z: Zigzagu, label: str, timeout: float = 15) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if any(w["label"] == label and w["ready"] for w in z.call({"cmd": "windows"})):
            return True
        time.sleep(0.2)
    return False


def close_dialogs(z: Zigzagu) -> None:
    for _ in range(5):
        if not z.call({"cmd": "dialogs"})["dialogs"]:
            return
        try:
            z.call({"cmd": "dialog", "press": "close"})
        except AppError:
            z.call({"cmd": "dialog", "press": "cancel"})


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--out", default=str(HERE / "am-names.json"))
    a = ap.parse_args()
    out: dict = {}
    screens: dict = {}
    profile = pathlib.Path(tempfile.mkdtemp(prefix="zzm-am-names-"))
    try:
        with Zigzagu(a.exe, profile=profile) as z:
            z.call({"cmd": "open", "rom": a.rom})
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            for tab in ("map", "movement", "event"):
                z.call({"cmd": "tab", "name": tab})
                collect(z, out, "main", f"{tab} タブ", screens)
            for kind in ("person", "sign", "warp", "trap", "fly"):
                try:
                    z.call({"cmd": "event.select", "kind": kind, "index": 0})
                    collect(z, out, "main", f"イベント {kind}", screens)
                except AppError as e:
                    print(f"イベント {kind}: {e}")
            z.call({"cmd": "selectMap", "bank": 3, "map": 19})
            z.call({"cmd": "tab", "name": "wild"})
            collect(z, out, "main", "出現ポケモンタブ", screens)
            z.call({"cmd": "tab", "name": "header"})
            collect(z, out, "main", "場所の設定（高度な表示）", screens)
            z.call({"cmd": "action", "id": "opt.advancedHeader"})
            collect(z, out, "main", "場所の設定（通常の表示）", screens)
            z.call({"cmd": "action", "id": "opt.advancedHeader"})
            for action, screen in (("tools.connections", "コネクションマネージャー"), ("map.new", "新規マップ"),
                                   ("map.insert", "マップの追加/挿入"), ("dummy.manage", "マップバンクヘッダーの管理")):
                try:
                    z.call({"cmd": "action", "id": action})
                    time.sleep(0.3)
                    collect(z, out, "main", screen, screens)
                except AppError as e:
                    print(f"{screen}: {e}")
                close_dialogs(z)
            z.call({"cmd": "selectMap", "bank": 3, "map": 0})
            z.call({"cmd": "action", "id": "tools.blockEditor"})
            if wait_window(z, "block-editor"):
                collect(z, out, "block-editor", "ブロックエディタ", screens)
                for action, label in (("palette.editor", "palette-editor"), ("palette.remap", "block-adjust")):
                    z.call({"cmd": "action", "id": action, "window": "block-editor"})
                    if wait_window(z, label):
                        collect(z, out, label, label, screens)
            z.call({"cmd": "action", "id": "tools.worldMap"})
            if wait_window(z, "world-map"):
                time.sleep(1.0)
                collect(z, out, "world-map", "ワールドマップエディター", screens)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    result = {w: dict(sorted(t.items())) for w, t in sorted(out.items())}
    result["_screens"] = screens
    pathlib.Path(a.out).write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"{a.out}: " + ", ".join(f"{w} {len(t)} 件" for w, t in out.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
