"""自動操作で起動したときに、通常の個人設定と WebView2 のデータへ触れないことを確かめる（issue #109）。

  python tests/automation/profile_check.py --rom <素の BPRJ> [--exe <zigzagumap.exe>]

1. --profile を付けずに --automation で起動（一時フォルダを使うはず）
2. --profile <一時の作業フォルダ> を付けて起動
どちらも設定を変える操作（グリッド、ツールバー、並べ替え、ROM を開いて最近開いたものに足す）をしてから終了し、
- 通常の settings.json が 1 バイトも変わっていない（無ければ作られていない）
- 通常の WebView2 のフォルダ（%LOCALAPPDATA%\\io.github.pit-true.zigzagumap\\EBWebView）の中のファイルが増減・更新されていない
- 2 では、指定したフォルダに settings.json と EBWebView ができ、変えた値が入っている
- 1 では、使った一時フォルダが終了後に消えている
を確かめる。失敗があれば終了コード 1。
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

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

APP_ID = "io.github.pit-true.zigzagumap"


def snapshot_file(p: pathlib.Path):
    return p.read_bytes() if p.exists() else None


def snapshot_tree(d: pathlib.Path) -> dict[str, tuple[int, int]]:
    out = {}
    if d.exists():
        for f in d.rglob("*"):
            try:
                if f.is_file():
                    st = f.stat()
                    out[str(f.relative_to(d))] = (st.st_size, st.st_mtime_ns)
            except OSError:
                pass
    return out


def exercise(z: Zigzagu, rom: str) -> dict:
    for a in ("view.grid", "view.toolbar", "sort.1"):
        z.call({"cmd": "action", "id": a})
    z.call({"cmd": "open", "rom": rom})
    z.call({"cmd": "selectMap", "bank": 3, "map": 0})
    time.sleep(0.6)  # 設定の保存は 300ms 待ってまとめる
    return z.call({"cmd": "state"})


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--exe")
    a = ap.parse_args()
    normal_settings = pathlib.Path(os.environ["APPDATA"]) / APP_ID / "settings.json"
    normal_webview = pathlib.Path(os.environ["LOCALAPPDATA"]) / APP_ID / "EBWebView"
    before_settings = snapshot_file(normal_settings)
    before_webview = snapshot_tree(normal_webview)
    fails: list[str] = []

    # 1. --profile なし
    with Zigzagu(a.exe, profile=None) as z:
        st = exercise(z, a.rom)
        temp_profile = st.get("profile")
        print(f"1. 一時プロファイル: {temp_profile}")
        if not temp_profile or not pathlib.Path(temp_profile).is_dir():
            fails.append("1: 一時プロファイルのフォルダがありません")
        elif not (pathlib.Path(temp_profile) / "settings.json").exists():
            fails.append("1: 一時プロファイルに settings.json が書かれていません")
    # WebView2 が終わるのを待ってから消すので、少し待つ
    for _ in range(30):
        if not temp_profile or not pathlib.Path(temp_profile).exists():
            break
        time.sleep(0.5)
    if temp_profile and pathlib.Path(temp_profile).exists():
        fails.append(f"1: 終了後も一時プロファイルが残っています: {temp_profile}")

    # 2. --profile <フォルダ>
    work = pathlib.Path(tempfile.mkdtemp(prefix="zzm-profile-check-"))
    try:
        with Zigzagu(a.exe, profile=work) as z:
            st = exercise(z, a.rom)
            print(f"2. 指定したプロファイル: {st.get('profile')}")
        saved = json.loads((work / "settings.json").read_text(encoding="utf-8")) if (work / "settings.json").exists() else None
        if not saved:
            fails.append("2: 指定したフォルダに settings.json がありません")
        else:
            if saved.get("grid") is not True or saved.get("sortMode") != 1:
                fails.append(f"2: 変えた値が入っていません（grid={saved.get('grid')}, sortMode={saved.get('sortMode')}）")
            if not saved.get("recent") or saved["recent"][0]["rom"] != a.rom:
                fails.append("2: 最近開いたものに ROM が入っていません")
        if not (work / "EBWebView").is_dir():
            fails.append("2: 指定したフォルダに EBWebView がありません")
    finally:
        time.sleep(1.0)
        shutil.rmtree(work, ignore_errors=True)

    if snapshot_file(normal_settings) != before_settings:
        fails.append(f"通常の settings.json が変わりました: {normal_settings}")
    after_webview = snapshot_tree(normal_webview)
    if after_webview != before_webview:
        changed = sorted(set(after_webview.items()) ^ set(before_webview.items()))[:5]
        fails.append(f"通常の WebView2 のフォルダが変わりました: {changed}")

    for f in fails:
        print("失敗:", f)
    print("合格" if not fails else f"失敗 {len(fails)} 件")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
