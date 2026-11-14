"""Phase1 のフィードバック（issue #169〜#181）で入れた動きを、ZigzaguMap だけで確かめる（AdvanceMap は使わない）。

  python tests/automation/feedback_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>] [--shots <フォルダ>]

- 自動操作の入口つき・一時フォルダの --profile で起動する（通常の設定には触れない。画面外・非アクティブ・音なし）。
- 表示メニュー、透明度のスライダー、マップの外のイベントの帯、場所の設定のかんたん表示、ROM を開いたあとのフォルダ選択、
  ヘルプ（Read me の描画・リンク・ショートカット一覧・バージョン情報）を順に操作して確かめる。
- `--shots` を付けると、新しい画面のスクリーンショットをそのフォルダに PNG で書く。
失敗があれば終了コード 1。
"""
from __future__ import annotations

import argparse
import base64
import os
import pathlib
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import AppError, Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "NG   ") + what)
    if not cond:
        failures.append(what)


def save_png(data: str | dict, path: pathlib.Path | None) -> None:
    if path is None:
        return
    b64 = data["png"] if isinstance(data, dict) else data
    path.write_bytes(base64.b64decode(b64))
    print(f"     -> {path}")


def field(z: Zigzagu, id_: str) -> dict:
    return z.call({"cmd": "getField", "id": id_})


def native_dialogs(z: Zigzagu) -> list[dict]:
    r = z.call({"cmd": "dialogs"})
    return [d for d in (r["dialogs"] if isinstance(r, dict) else r) if d.get("kind") == "native"]


def wait_native(z: Zigzagu, timeout: float = 10) -> list[dict]:
    t0 = time.time()
    while time.time() - t0 < timeout:
        found = native_dialogs(z)
        if found:
            return found
        time.sleep(0.1)
    return []


def wait_state(z: Zigzagu, pred, timeout: float = 30) -> dict:
    t0 = time.time()
    while True:
        st = z.call({"cmd": "state"})
        if pred(st) or time.time() - t0 > timeout:
            return st
        time.sleep(0.2)


def run(z: Zigzagu, rom: str, project_dir: str, shots: pathlib.Path | None) -> None:
    shot = (lambda name: shots / name) if shots else (lambda name: None)

    # ---- ROM を開いた直後のフォルダ選択（#181）----
    r = z.call({"cmd": "drop", "path": rom})
    dialogs = r.get("dialogs") or native_dialogs(z)
    check(any(d.get("kind") == "native" and d.get("type") == "folder" for d in dialogs), "ROM をドロップするとフォルダを選ぶダイアログが出る")
    z.call({"cmd": "queuePath", "path": None})
    st = wait_state(z, lambda s: s["rom"] is not None)
    check(st["rom"] is not None and st["project"] is None, "キャンセルすると ROM だけで開く")

    notrom = pathlib.Path(project_dir).parent / "notrom.gba"
    notrom.write_bytes(b"not a rom" * 100)
    z.call({"cmd": "menu.run", "id": "file.open"})
    z.call({"cmd": "queuePath", "path": str(notrom)})
    time.sleep(0.5)
    r = z.call({"cmd": "dialogs"})["dialogs"]
    check(not any(d.get("kind") == "native" for d in r) and any("Unknown Rom Type" in str(d.get("text")) for d in r),
          "ROM でないファイルは、フォルダを聞かずにエラーを出す")
    z.call({"cmd": "dialog", "press": "ok"})

    z.call({"cmd": "menu.run", "id": "file.open"})
    z.call({"cmd": "queuePath", "path": rom})
    check(any(d.get("type") == "folder" for d in wait_native(z)), "ファイル > ROMを開く のあともフォルダを選ぶダイアログが出る")
    z.call({"cmd": "queuePath", "path": project_dir})
    st = wait_state(z, lambda s: s["project"] is not None)
    check((st["project"] or "").lower() == project_dir.lower(), "フォルダを選ぶと ROM と組で開く")
    recent = st["settings"]["recent"]
    check(bool(recent) and (recent[0].get("project") or "").lower() == project_dir.lower(), "最近開いたものに組で記録される")

    z.call({"cmd": "menu.run", "id": "recent.0"})
    time.sleep(1.0)
    check(not native_dialogs(z), "組のフォルダが記録済みの最近開いたものでは、ダイアログを出さない")
    st = wait_state(z, lambda s: s["project"] is not None)
    check((st["project"] or "").lower() == project_dir.lower(), "最近開いたものから組で開き直せる")

    # ---- メニュー（#169・#172・#177・#178）----
    items = z.call({"cmd": "menu.list"})
    tops = []
    for it in items:
        if len(it["path"]) == 1 and it["path"][0] not in tops:
            tops.append(it["path"][0])
    check(tops == ["ファイル", "表示", "設定", "ツール", "ヘルプ"], f"メニューバーの並び: {tops}")
    view_ids = {it["id"] for it in items if it["path"][0] == "表示" and it["id"]}
    for wanted in ("view.grid", "view.objects", "zoom.map", "view.opacity", "view.paletteWidth", "view.toolbar", "view.combobox", "view.hideEventPanel", "opt.advancedHeader"):
        check(wanted in view_ids, f"表示メニューに {wanted}")
    all_ids = {it["id"] for it in items if it["id"]}
    for gone in ("lang.ja", "opt.scriptEditor", "display.ini", "display.header", "display.createIni"):
        check(gone not in all_ids, f"{gone} は無い")
    roots = [n["text"] for n in z.call({"cmd": "tree.list"}) if n["depth"] == 0]
    check(roots == ["ヘッダー", "マップファイル"], f"マップ一覧の根: {roots}")

    # ---- マップを開く ----
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    z.call({"cmd": "tab", "name": "map"})
    save_png(z.call({"cmd": "screenshot"}), shot("01_toolbar_hero_icon.png"))
    z.call({"cmd": "key", "key": "Alt"})
    z.call({"cmd": "key", "key": "v", "alt": True})
    time.sleep(0.2)
    save_png(z.call({"cmd": "screenshot"}), shot("02_view_menu.png"))
    z.call({"cmd": "key", "key": "Escape"})
    z.call({"cmd": "key", "key": "Escape"})

    # ---- 透明度のスライダー（#173）----
    z.call({"cmd": "tab", "name": "movement"})
    z.call({"cmd": "menu.run", "id": "view.opacity"})
    check(field(z, "view.opacity.slider")["visible"], "透明度のスライダーが出る")
    check(field(z, "view.opacity.value")["value"] == "30%", "初めの値は 30%")
    before = z.call({"cmd": "canvasPng", "target": "movement"})
    z.call({"cmd": "setField", "id": "view.opacity.slider", "value": "80"})
    st = z.call({"cmd": "state"})
    check(abs(st["settings"]["movementOpacity"] - 0.8) < 1e-9, "スライダーを動かすと設定が 0.8 になる")
    check(field(z, "view.opacity.value")["value"] == "80%", "値の表示が 80% になる")
    after = z.call({"cmd": "canvasPng", "target": "movement"})
    check(before != after, "移動エリアの描画がすぐ変わる")
    save_png(z.call({"cmd": "screenshot"}), shot("03_opacity_slider.png"))
    z.call({"cmd": "click", "id": "view.opacity.close"})
    r = z.call({"cmd": "dialogs"})
    check(not any(d.get("title") == "移動エリアの設定の透明度" for d in (r["dialogs"] if isinstance(r, dict) else r)), "閉じるで消える")

    # ---- マップの外のイベントの帯（#174）----
    z.call({"cmd": "tab", "name": "event"})
    m = z.call({"cmd": "state"})["map"]
    check(not field(z, "outside.bar")["visible"], "外にイベントが無ければ帯は出ない")
    z.call({"cmd": "command", "name": "moveEvent", "args": {"bank": 3, "map": 0, "kind": "warp", "index": 0, "x": m["width"] + 3, "y": 0xFFFE}})
    z.call({"cmd": "command", "name": "moveEvent", "args": {"bank": 3, "map": 0, "kind": "person", "index": 0, "x": 2, "y": m["height"] + 1}})
    check(field(z, "outside.bar")["visible"], "外にイベントがあると帯が出る")
    save_png(z.call({"cmd": "screenshot"}), shot("04_outside_events_bar.png"))
    hist = z.call({"cmd": "state"})["history"]
    z.call({"cmd": "click", "id": "outside.fix"})
    ev = z.call({"cmd": "event.state"})["events"]
    check(ev["warps"][0]["x"] == m["width"] - 1 and ev["warps"][0]["y"] == 0, "ワープは右上の内側へ寄る")
    check(ev["persons"][0]["x"] == 2 and ev["persons"][0]["y"] == m["height"] - 1, "人は下の内側へ寄る")
    check(not field(z, "outside.bar")["visible"], "内側に戻すと帯が消える")
    check(z.call({"cmd": "state"})["history"] == hist + 1, "1 回の操作として履歴に積まれる")
    z.call({"cmd": "undo"})
    check(field(z, "outside.bar")["visible"], "元に戻すと全部外へ戻り、帯が出る")
    z.call({"cmd": "undo"})
    z.call({"cmd": "undo"})
    check(not field(z, "outside.bar")["visible"], "動かす前まで戻すと帯は消える")

    # ---- 場所の設定のかんたん表示（#175）----
    z.call({"cmd": "tab", "name": "header"})
    check(field(z, "header.mode.simple")["value"] is True, "初めはかんたん（CFRU）")
    check(field(z, "easy.weather")["visible"], "かんたん表示の天候が見える")
    check(not field(z, "header.advanced")["visible"], "かんたん表示では「高度なヘッダーを表示」は隠れる")
    save_png(z.call({"cmd": "screenshot"}), shot("05_header_simple.png"))
    w0 = field(z, "easy.weather")["index"]
    z.call({"cmd": "setField", "id": "easy.weather", "value": 3 if w0 != 3 else 2})
    st = z.call({"cmd": "state"})
    check(field(z, "easy.weather")["index"] == (3 if w0 != 3 else 2), "天候を選ぶとすぐ反映する")
    check("3.0" in st["dirty"], "未出力の印が付く")
    z.call({"cmd": "undo"})
    check(field(z, "easy.weather")["index"] == w0, "元に戻せる")
    bike0 = field(z, "easy.bike")["value"]
    z.call({"cmd": "setField", "id": "easy.bike", "value": not bike0})
    check(field(z, "easy.bike")["value"] == (not bike0), "自転車のチェックが反映する")
    z.call({"cmd": "undo"})
    bw = field(z, "easy.borderWidth")["value"]
    z.call({"cmd": "setField", "id": "easy.borderWidth", "value": "3"})
    z.call({"cmd": "click", "id": "easy.resizeBorder"})
    check(field(z, "easy.borderWidth")["value"] == "3", "境界ブロックの横幅を変えられる")
    z.call({"cmd": "undo"})
    check(field(z, "easy.borderWidth")["value"] == bw, "境界ブロックの変更も元に戻せる")
    hidden_addr = all(not f["autoId"].startswith("pro.") or not f["visible"] for f in z.call({"cmd": "ui.list"}) if f.get("autoId"))
    check(hidden_addr, "かんたん表示ではオフセット・ポインタの欄が見えない")
    z.call({"cmd": "click", "id": "header.mode.classic"})
    st = z.call({"cmd": "state"})
    check(st["settings"]["headerView"] == "classic", "くわしく（従来）に切り替えると設定に残る")
    check(field(z, "header.advanced")["visible"], "くわしく表示では「高度なヘッダーを表示」が見える")
    check(field(z, "pro.footer")["visible"], "従来の高度な表示が出る（高度なヘッダーの初期はオン）")
    z.call({"cmd": "setField", "id": "header.advanced", "value": False})
    check(field(z, "field:Cbo_Wetter")["visible"], "「高度なヘッダーを表示」を外すと従来の通常表示が出る")
    save_png(z.call({"cmd": "screenshot"}), shot("06_header_classic.png"))
    z.call({"cmd": "setField", "id": "header.advanced", "value": True})
    z.call({"cmd": "click", "id": "header.mode.simple"})

    # ---- 外部のスクリプトエディタの入口（#178）----
    z.call({"cmd": "tab", "name": "event"})
    z.call({"cmd": "event.select", "kind": "person", "index": 0})
    check(not field(z, "event.person.openScript")["visible"], "イベントの「スクリプトを開く」は隠れている")

    # ---- ヘルプ（#171・#179・#180）----
    z.call({"cmd": "menu.run", "id": "help.about"})
    check(field(z, "about.version")["value"].startswith("バージョン "), "バージョン情報にバージョンが出る")
    save_png(z.call({"cmd": "screenshot"}), shot("07_about.png"))
    z.call({"cmd": "click", "id": "about.link"})
    check(z.call({"cmd": "state"})["openedUrls"][:1] == ["https://github.com/pit-true/ZigzaguMap"], "リンクで GitHub のページを開こうとする（自動操作中はブラウザを出さない）")
    z.call({"cmd": "dialog", "press": "ok"})

    z.call({"cmd": "menu.run", "id": "help.readme"})
    time.sleep(0.3)
    check(field(z, "help.doc")["value"] == "README.md", "Read me で README を開く")
    check(field(z, "help.link:docs/compare-test.md")["visible"], "README のリンクが描かれている")
    save_png(z.call({"cmd": "screenshot"}), shot("08_help_readme.png"))
    z.call({"cmd": "click", "id": "help.link:#ショートカット"})
    check(z.call({"cmd": "view.scroll", "id": "help.content"})["scrollTop"] > 0, "目次のリンクで見出しへ移る")
    z.call({"cmd": "click", "id": "help.link:docs/automation.md"})
    check(field(z, "help.doc")["value"] == "docs/automation.md", "docs/ へのリンクをヘルプの中で開く")
    z.call({"cmd": "click", "id": "help.back"})
    check(field(z, "help.doc")["value"] == "README.md", "戻るで README へ戻る")
    z.call({"cmd": "menu.run", "id": "help.shortcuts"})
    time.sleep(0.2)
    check(field(z, "help.doc")["value"] == "shortcuts.md", "ショートカット一覧を開く")
    save_png(z.call({"cmd": "screenshot"}), shot("09_help_shortcuts.png"))
    z.call({"cmd": "click", "id": "help.close"})


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    a = ap.parse_args()
    shots = pathlib.Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="zzm-fb-", ignore_cleanup_errors=True) as tmp:
        profile = pathlib.Path(tmp) / "profile"
        project = pathlib.Path(tmp) / "project"
        project.mkdir()
        with Zigzagu(a.exe, profile=profile) as z:
            z.call({"cmd": "resize", "width": 1280, "height": 860})
            try:
                run(z, a.rom, str(project), shots)
            except AppError as e:
                failures.append(f"自動操作のエラー: {e}")
                print(f"NG   自動操作のエラー: {e}")
    print()
    print("失敗なし" if not failures else f"失敗 {len(failures)} 件")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
