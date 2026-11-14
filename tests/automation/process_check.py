"""外部コマンドの実行（Rust の process.rs、issue #183）を自動操作の入口から確かめる。

  python tests/automation/process_check.py [--exe <zigzagumap.exe>]

- 一時フォルダの --profile で起動する（通常の設定には触れない。画面外・非アクティブ・音なし）。
- 一時フォルダで短いコマンドを動かし、出力の行と終了コードが届くこと、長いコマンドを途中で止められること、
  ビルドの手順の copy（process.copy）でファイルを写せることを確かめる。
失敗があれば終了コード 1。
"""
from __future__ import annotations

import argparse
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", type=pathlib.Path)
    a = ap.parse_args()
    py = sys.executable
    with tempfile.TemporaryDirectory(prefix="zzm-process-", ignore_cleanup_errors=True) as tmp:
        work = pathlib.Path(tmp) / "work"
        work.mkdir()
        profile = pathlib.Path(tmp) / "profile"
        with Zigzagu(a.exe, profile=profile, extra=["--mute-audio"]) as z:
            # 短いコマンド: 標準出力と標準エラー、日本語、終了コード
            code = "import sys; print(1); print('日本語'); print('err', file=sys.stderr); sys.exit(3)"
            r = z.call({"cmd": "process.run", "command": py, "args": ["-c", code], "cwd": str(work)})
            lines = [(l["stream"], l["line"]) for l in r["lines"]]
            check(("stdout", "1") in lines, "標準出力の行が届く")
            check(("stdout", "日本語") in lines, "日本語の行が UTF-8 で届く")
            check(("stderr", "err") in lines, "標準エラーの行が届く")
            check(r["code"] == 3 and r["done"] and not r["killed"], f"終了コードが届く（{r['code']}）")
            check(pathlib.Path(r["cwd"]).resolve() == work.resolve(), "指定の作業フォルダで動く")

            # 作業フォルダに書く
            r = z.call({"cmd": "process.run", "command": py, "args": ["-c", "open('out.txt','w').write('x')"], "cwd": str(work)})
            check(r["code"] == 0 and (work / "out.txt").exists(), "作業フォルダにファイルを書ける")

            # 長いコマンドを途中で止める
            long = "import time\nfor i in range(600):\n    print(i, flush=True)\n    time.sleep(0.1)"
            s = z.call({"cmd": "process.start", "command": py, "args": ["-c", long], "cwd": str(work)})
            time.sleep(1.5)
            o = z.call({"cmd": "process.output", "id": s["id"]})
            check(len(o["lines"]) > 0 and not o["done"], f"動いている間に出力が届く（{len(o['lines'])} 行）")
            t0 = time.time()
            k = z.call({"cmd": "process.kill", "id": s["id"]})
            check(k["killed"] and k["done"] and k["killed"] is True, f"途中で止められる（{time.time() - t0:.2f} 秒）")
            check(len(k["lines"]) < 600, "止めたあとは出力が続かない")

            # 無いコマンド
            try:
                z.call({"cmd": "process.run", "command": "zzm-no-such-command", "args": [], "cwd": str(work)})
                check(False, "無いコマンドはエラーになる")
            except AppError as e:
                check(True, f"無いコマンドはエラーになる（{e}）")

            # ファイルを写す（ビルドの手順の copy）
            (work / "copy_src.bin").write_bytes(b"zz" * 10)
            r = z.call({"cmd": "process.copy", "from": "copy_src.bin", "to": "copy_dest.bin", "cwd": str(work)})
            check(r["bytes"] == 20 and (work / "copy_dest.bin").read_bytes() == b"zz" * 10, "copy でファイルを写せる")
            try:
                z.call({"cmd": "process.copy", "from": "no_such.bin", "to": "x.bin", "cwd": str(work)})
                check(False, "無いファイルの copy はエラーになる")
            except AppError as e:
                check(True, f"無いファイルの copy はエラーになる（{e}）")
    if failures:
        print(f"\n失敗 {len(failures)} 件")
        return 1
    print("\nすべて通りました")
    return 0


if __name__ == "__main__":
    sys.exit(main())
