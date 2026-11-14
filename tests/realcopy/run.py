"""ND と Chronos の実フォルダの写しで、ZigzaguMap の出力とプロジェクトのビルドを確かめる（ローカルだけで動かす）。

使い方:
  python tests/realcopy/run.py --smoke                 # ND と Chronos の両方
  python tests/realcopy/run.py --smoke --only nd       # ND だけ（nd / chronos）
  python tests/realcopy/run.py --smoke --reuse         # 前の写しがあればそのまま使う（ビルドのキャッシュが残る）
  python tests/realcopy/run.py --smoke --dpe           # ND は DPE のビルドまで動かす
  python tests/realcopy/run.py --link --reuse          # スクリプト連携（lib/link.py）。ビルドはスクリプトエディタのビルドの欄で行う
  python tests/realcopy/run.py --all --reuse           # --smoke と --link の両方（Phase2 の通しの確認）
  オプション: --exe <zigzagumap.exe>、--config <設定ファイル>、--timeout <ビルドの秒>

--smoke: 写しを作り、ZigzaguMap で写しの ROM とプロジェクトを開いて何もせずに出力し、写しでビルドする
（ND は CFRU の `python scripts/make.py`、Chronos はルートの `python build.py`）。
--link: 写しで、イベントのラベルの自動命名とひな形・ラベルの変更・ROM のスクリプトの表示と取り込み・マップスクリプトの表を
ZigzaguMap で行って出力し、ビルドの欄でビルドして、できた ROM のイベントのスクリプトの番地がラベルの位置と同じことを確かめる
（写しのテキストファイルは最後に元へ戻す）。
実行の前後で、実フォルダの全ファイル・全フォルダの更新日時と大きさが変わっていないことを確かめる。
失敗があれば終了コード 1。
"""
from __future__ import annotations

import argparse
import os
import pathlib
import sys
import time
import traceback

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from lib import config, fixtures, snapshot  # noqa: E402
from lib.app import Zigzagu  # noqa: E402
from lib.builder import build_fixture, build_nd_dpe  # noqa: E402
from lib.link import link_one  # noqa: E402

APP_ID = "io.github.pit-true.zigzagumap"


def normal_settings() -> bytes | None:
    p = pathlib.Path(os.environ.get("APPDATA", "")) / APP_ID / "settings.json"
    return p.read_bytes() if p.is_file() else None


def smoke_one(cfg, name: str, args, log_dir: pathlib.Path) -> tuple[bool, list[str]]:
    fx = fixtures.get(cfg, name)
    lines: list[str] = []
    ok = True
    t0 = time.perf_counter()
    c = fixtures.make_copy(fx, reuse=args.reuse)
    if c["reused"]:
        lines.append(f"写し: 前のものを使用 {fx.dir}")
    else:
        lines.append(f"写し: {c['files']} ファイル {c['bytes'] / 1e6:.0f}MB {c['seconds']:.1f} 秒 → {fx.dir}")

    before = snapshot.take(fx.project_path)
    t1 = time.perf_counter()
    with Zigzagu(cfg, name, args.exe) as z:
        st = z.open_fixture(fx)
        opened = st.get("project") if isinstance(st, dict) else None
        res = z.export()
    after = snapshot.take(fx.project_path)
    d = snapshot.diff(before, after)
    written = len(res.get("written", [])) if isinstance(res, dict) else "?"
    deleted = len(res.get("removed", [])) if isinstance(res, dict) else "?"
    lines.append(f"ZigzaguMap: 開いて出力 {time.perf_counter() - t1:.1f} 秒（プロジェクト {opened}、"
                 f"書いた {written} 件・消した {deleted} 件、プロジェクトの変化: {snapshot.describe(d, 5)}）")

    r = build_fixture(fx, log_dir / name, args.timeout)
    lines.append(r.summary())
    ok &= r.ok
    if r.ok and name == "nd" and args.dpe and "dpe" in fx.extra_builds:
        r2 = build_nd_dpe(fx, log_dir / name, args.timeout)
        lines.append(r2.summary())
        ok &= r2.ok
    lines.append(f"合計 {time.perf_counter() - t0:.1f} 秒")
    return ok, lines


def link_fixture(cfg, name: str, args, log_dir: pathlib.Path) -> tuple[bool, list[str]]:
    """--link: スクリプト連携の確認（lib/link.py）。"""
    fx = fixtures.get(cfg, name)
    lines: list[str] = []
    failures: list[str] = []
    t0 = time.perf_counter()
    c = fixtures.make_copy(fx, reuse=args.reuse)
    copied = "前のものを使用" if c["reused"] else f"{c['files']} ファイルを写した"
    lines.append(f"写し: {copied} {fx.dir}")

    def check(cond: bool, what: str) -> None:
        # 確かめたことはその場で出す（最後の一覧には失敗だけを残す）
        print(("  OK   " if cond else "  NG   ") + what, flush=True)
        if not cond:
            failures.append(what)
            lines.append("NG   " + what)

    def log(text: str) -> None:
        print("       " + text, flush=True)

    with Zigzagu(cfg, f"link-{name}", args.exe) as z:
        link_one(fx, z, check, log, args.timeout)
    lines.append(f"合計 {time.perf_counter() - t0:.1f} 秒、失敗 {len(failures)} 件")
    return not failures, lines


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--link", action="store_true", help="スクリプト連携（ラベル・ひな形・取り込み・マップスクリプト・ビルドの欄）の確認")
    ap.add_argument("--all", action="store_true", help="--smoke と --link の両方")
    ap.add_argument("--only", choices=sorted(fixtures.FIXTURES), action="append")
    ap.add_argument("--reuse", action="store_true")
    ap.add_argument("--dpe", action="store_true")
    ap.add_argument("--exe")
    ap.add_argument("--config")
    ap.add_argument("--timeout", type=int)
    args = ap.parse_args()
    if args.all:
        args.smoke = args.link = True
    if not args.smoke and not args.link:
        ap.error("--smoke か --link か --all を付けてください")
    cfg = config.load(args.config, args.exe)
    args.exe = cfg.zigzaguExe
    args.timeout = args.timeout or cfg.buildTimeout
    names = args.only or ["nd", "chronos"]
    fxs = [fixtures.get(cfg, n) for n in names]
    reals = [p for fx in fxs for p in fx.real_folders()]
    print(f"exe: {cfg.zigzaguExe}")
    print(f"写し先: {cfg.copyRoot}")

    snaps = {}
    for real in reals:
        s = snapshot.take(real)
        snaps[real] = s
        print(f"更新日時の記録: {real}（{s.files} ファイル、{len(s.entries) - s.files} フォルダ、{s.seconds:.1f} 秒）")
    settings_before = normal_settings()

    log_dir = cfg.copyRoot / "logs" / time.strftime("%Y%m%d-%H%M%S")
    results: dict[str, bool] = {}
    runs = [(n, "smoke") for n in names if args.smoke] + [(n, "link") for n in names if args.link]
    for name, kind in runs:
        key = name if not (args.smoke and args.link) else f"{name} ({kind})"
        print(f"\n== {key}")
        try:
            ok, lines = link_fixture(cfg, name, args, log_dir) if kind == "link" else smoke_one(cfg, name, args, log_dir)
        except Exception as e:  # noqa: BLE001  1 つが失敗しても残りと実フォルダの確認は続ける
            ok, lines = False, [f"エラー: {type(e).__name__}: {e}"]
            traceback.print_exc()
        results[key] = ok
        for line in lines:
            print("  " + line)

    print("\n== 実フォルダの確認")
    real_ok = True
    for real, s in snaps.items():
        after = snapshot.take(real)
        d = snapshot.diff(s, after)
        same = snapshot.is_same(d)
        real_ok &= same
        print(f"  {real}: {'変化なし' if same else '変化あり ' + snapshot.describe(d)}（{after.seconds:.1f} 秒）")
    settings_ok = normal_settings() == settings_before
    print(f"  通常の個人設定（%APPDATA%\\{APP_ID}\\settings.json）: {'変化なし' if settings_ok else '変化あり'}")

    print("\n== 結果")
    for name, ok in results.items():
        print(f"  {name}: {'成功' if ok else '失敗'}")
    print(f"  実フォルダ: {'変化なし' if real_ok and settings_ok else '変化あり'}")
    print(f"  ログ: {log_dir}")
    return 0 if all(results.values()) and real_ok and settings_ok else 1


if __name__ == "__main__":
    sys.exit(main())
