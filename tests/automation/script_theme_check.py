"""スクリプトエディタのテーマをウィンドウ全体に当てること（#218）を確かめる。

  python tests/automation/script_theme_check.py --rom <ベース ROM> --project <CFRU-JP のフォルダ（読むだけ）> --work <作業フォルダ>
      [--exe <zigzagumap.exe>] [--shots <スクリーンショットのフォルダ>]

- `--project` のフォルダには書き込まない。必要な分を `--work` の下の `project/` に写し、写しを開く（script_editor_check.py と同じ）。
  写しの zigzagumap.json は、すぐ終わってエラーの行を 1 つ出すビルドの手順に置き換える（ビルドの欄と誤りの一覧を出すため）。
- テーマ 4 つのそれぞれで、検索の欄・ビルドの欄・誤りの一覧・補完・ホバー・波線の一覧・画面内のダイアログを出し、
  `editor.theme` の `ui`（部品ごとに実際に描かれている色）を見る。暗いテーマでは部品の地が暗く、明るいテーマでは明るいこと
  （明るいまま残る部品が無い）、文字と地のコントラストが読める大きさであること、スクロールバーがテーマの色であること。
- `--shots` で各テーマの画面を `theme-<名前>-<場面>.png` に書く。
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib
import re
import shutil
import sys
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

W = {"window": "script-editor"}
COPY_DIRS = ["assembly", "strings", "maps"]
COPY_FILES = ["xse_commands.s", "xse_defines.s", "asm_defines.s", "eventscripts", "charmap.tbl", "BPRJ.ld"]
SCRIPTS = "assembly/overworld_scripts"
THEMES = {"darkPlus": True, "lightPlus": False, "monokai": True, "solarizedDark": True}
ACCENT_PARTS = {"completionSelected", "statusBar"}
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


def ed(z: Zigzagu, cmd: str, **kw):
    return z.call({"cmd": cmd, **W, **kw}, timeout=60)


def ed_quiet(z: Zigzagu, cmd: str, **kw) -> None:
    try:
        ed(z, cmd, **kw)
    except Exception:  # noqa: BLE001 - 答えを待つ命令。ダイアログを閉じたあとの返事は見ない
        pass


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
    png = r["png"] if isinstance(r, dict) else r
    (shots / name).write_bytes(base64.b64decode(png))
    print("撮影:", shots / name)


def rgb(css: str) -> tuple[float, float, float] | None:
    m = re.match(r"rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)", css or "")
    return (float(m.group(1)), float(m.group(2)), float(m.group(3))) if m else None


def luminance(c: tuple[float, float, float]) -> float:
    def ch(v: float) -> float:
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def contrast(a, b) -> float:
    x, y = sorted([luminance(a), luminance(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)


def judge(theme: str, dark: bool, ui: dict, scene: str, wanted: list[str]) -> None:
    for part in wanted:
        got = ui.get(part)
        check(got is not None, f"{theme} {scene}: {part} が出ている")
        if not got:
            continue
        bg = rgb(got["background"])
        fg = rgb(got["color"])
        if bg is None or fg is None:
            check(False, f"{theme} {scene}: {part} の色が読めない（{got}）")
            continue
        lum = luminance(bg)
        # 選んだ行と下の帯は、テーマの色を塗る部品（VS Code と同じく、明るいテーマでも濃い青に白い字）なので明暗は見ない
        bright_ok = part in ACCENT_PARTS or (lum < 0.25 if dark else lum > 0.4)
        check(bright_ok, f"{theme} {scene}: {part} の地 {got['background']} が{'暗い' if dark else '明るい'}（輝度 {lum:.2f}）")
        c = contrast(bg, fg)
        check(c >= 3, f"{theme} {scene}: {part} の文字 {got['color']} が読める（コントラスト {c:.1f}）")


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--project", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    a = ap.parse_args()
    work = pathlib.Path(a.work)
    shots = pathlib.Path(a.shots) if a.shots else None
    proj = prepare(pathlib.Path(a.project), work)

    rel = f"{SCRIPTS}/zz_theme.s"
    (proj / rel).write_text(
        ".text\n.thumb\n.align 2\n\n.include \"../xse_commands.s\"\n.include \"../xse_defines.s\"\n.include \"../asm_defines.s\"\n\n"
        "EventScript_ZzTheme:\n\tlock\n\tfaceplayer\n\tzzunknowncommand 1\n\trelease\n\tend\n"
        + "".join(f"\n@ 長い本文でスクロールバーを出すための行 {i}\n" for i in range(80)),
        encoding="utf-8",
        newline="\n",
    )
    # すぐ終わって誤りの行を 1 つ出すビルド（ビルドの欄・誤りの一覧の色を見るため）
    err = f"{rel}:11: Error: zz theme check"
    (proj / "zigzagumap.json").write_text(
        json.dumps({"script": {"build": [{"command": "python", "args": ["-c", f"import sys; print('build start'); print({err!r}); sys.exit(1)"], "cwd": "."}], "widthCheck": None}}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    profile = work / "profile"
    shutil.rmtree(profile, ignore_errors=True)
    with Zigzagu(a.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": a.rom, "project": str(proj)})
        r = z.call({"cmd": "script.open", "path": rel, "line": 9})
        check(r["opened"] and wait_ready(z), "エディタを開く")
        ed(z, "editor.project")
        ed(z, "build.run", wait=True, confirm=False)
        bs = ed(z, "build.state")
        check(bool(bs["problems"]), f"ビルドの誤りの一覧に行が出る（{len(bs['problems'])}）")

        for theme, dark in THEMES.items():
            r = ed(z, "editor.theme", theme=theme)
            check(r["theme"] == theme, f"テーマを {theme} にする")
            # 場面 1: 検索の欄・ビルドの欄・誤りの一覧・補完
            ed(z, "editor.search", query="lock", action="find")
            ed(z, "editor.complete", line=10, column=3, filter="f", show=True)
            ui = ed(z, "editor.theme")["ui"]
            judge(theme, dark, ui, "検索と補完", ["page", "tabBar", "activeTab", "statusBar", "themeSelect", "buildPanel", "buildButton", "buildLog",
                                                 "buildProblems", "searchPanel", "searchField", "searchButton", "completion", "completionSelected"])
            sc = ui.get("scrollbar") or {}
            thumb = r["palette"]["ui"]["scrollThumb"]
            want = "rgb({}, {}, {})".format(*(int(thumb[i:i + 2], 16) for i in (1, 3, 5)))
            check(want in (sc.get("background") or ""), f"{theme}: スクロールバーがテーマの色（{sc.get('background')}）")
            shot(z, shots, f"theme-{theme}-1-search.png")
            ed(z, "editor.key", key="Escape")
            ed(z, "editor.search", action="close")
            # 場面 2: ホバーと波線の一覧
            ed(z, "editor.diagnostics")
            ed(z, "editor.command", name="openLintPanel")
            ed(z, "editor.hover", line=10, column=3, show=True)
            ui = ed(z, "editor.theme")["ui"]
            judge(theme, dark, ui, "ホバーと波線の一覧", ["tooltip", "lintPanel"])
            shot(z, shots, f"theme-{theme}-2-hover.png")
            ed(z, "editor.closeHover")
            ed(z, "editor.command", name="closeLintPanel")
            # 場面 3: 画面内のダイアログ（ラベル名の変更の入力）
            # editor.rename は名前の答えを待つので、別の糸で送り、ダイアログが出たところで色を見る
            t = threading.Thread(target=lambda: ed_quiet(z, "editor.rename", **{"from": "EventScript_ZzTheme"}), daemon=True)
            t.start()
            for _ in range(50):
                if ed(z, "dialogs")["dialogs"]:
                    break
                time.sleep(0.1)
            ui = ed(z, "editor.theme")["ui"]
            judge(theme, dark, ui, "ダイアログ", ["dialog", "dialogBody", "dialogButton", "dialogInput"])
            shot(z, shots, f"theme-{theme}-3-dialog.png")
            ed(z, "dialog", press="close")
            t.join(timeout=10)
        ed(z, "editor.theme", theme="lightPlus")

    if failures:
        print(f"\n失敗 {len(failures)} 件")
        for f in failures:
            print(" -", f)
        return 1
    print("\nすべて OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
