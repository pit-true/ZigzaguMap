"""ND と Chronos の実フォルダの写しで、ZigzaguMap の出力とプロジェクトのビルドを確かめる（ローカルだけで動かす）。

使い方:
  python tests/realcopy/run.py --smoke                 # ND と Chronos の両方
  python tests/realcopy/run.py --smoke --only nd       # ND だけ（nd / chronos）
  python tests/realcopy/run.py --smoke --reuse         # 前の写しがあればそのまま使う（ビルドのキャッシュが残る）
  python tests/realcopy/run.py --smoke --dpe           # ND は DPE のビルドまで動かす
  python tests/realcopy/run.py --link --reuse          # スクリプト連携（lib/link.py）。ビルドはスクリプトエディタのビルドの欄で行う
  python tests/realcopy/run.py --all --reuse           # --smoke と --link の両方（Phase2 の通しの確認）
  python tests/realcopy/run.py --connection --only nd  # 接続の編集（lib/connection.py。Phase3）を出力してビルドし、ROM の接続を確かめる
  python tests/realcopy/run.py --template --reuse      # 使われている番号の索引とイベントのひな形（lib/template.py）
  python tests/realcopy/run.py --transplant --source-rom <素の BPRJ> --reuse  # 別の ROM からのタイルセットの移植（lib/transplant.py。Phase4 #314）
  python tests/realcopy/run.py --triple --reuse        # トリプルレイヤーの出力・ビルド・できた ROM の中身（lib/triple.py。Phase4 #317）
  python tests/realcopy/run.py --maplist --only nd     # マップ一覧の「このマップを複製」を出力してビルドする（lib/maplist.py。Phase5 #401）
  python tests/realcopy/run.py --swap --reuse --only nd  # ブロックの入れ替え（lib/swap.py。Phase5 #394）
  python tests/realcopy/run.py --newtileset --reuse --only nd  # 新しいタイルセット（lib/newtileset.py。Phase5 #397）
  python tests/realcopy/run.py --tileimport --reuse           # 画像からタイルとブロックを作る（lib/tileimport.py。Phase6 #443）
  python tests/realcopy/run.py --phase5                        # Phase5 の全体の往復テスト（lib/phase5.py。#406）
  python tests/realcopy/run.py --phase6 --reuse                # Phase6 の全体の往復テスト（lib/phase6.py。#493）
  python tests/realcopy/run.py --pathdraw --reuse              # 道をなぞって .s に書き、写しでビルドする（lib/pathdraw.py。Phase7 #518）
  python tests/realcopy/run.py --regionmap --reuse             # タウンマップ（mapsegionmap.json）の出力・ビルド・開き直し（lib/regionmap.py。#119）
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
from lib.connection import connection_one  # noqa: E402
from lib.template import template_one  # noqa: E402
from lib.transplant import transplant_one  # noqa: E402
from lib.maplist import maplist_one  # noqa: E402
from lib.triple import triple_one  # noqa: E402
from lib.swap import swap_one  # noqa: E402
from lib.newtileset import newtileset_one  # noqa: E402
from lib.phase5 import phase5_one  # noqa: E402
from lib.phase6 import phase6_one  # noqa: E402
from lib.tileimport import tileimport_one  # noqa: E402
from lib.wildtime import wildtime_one  # noqa: E402
from lib.species import species_one  # noqa: E402
from lib.delete import delete_one  # noqa: E402
from lib.link import link_one  # noqa: E402
from lib.regionmap import regionmap_one  # noqa: E402
from lib.pathdraw import pathdraw_one  # noqa: E402

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


def delete_fixture(cfg, name: str, args, log_dir: pathlib.Path) -> tuple[bool, list[str]]:
    """--delete: イベントの削除と複数行の文字列（lib/delete.py）。"""
    fx = fixtures.get(cfg, name)
    lines: list[str] = []
    failures: list[str] = []
    t0 = time.perf_counter()
    c = fixtures.make_copy(fx, reuse=args.reuse)
    lines.append(f"写し: {'前のものを使用' if c['reused'] else str(c['files']) + ' ファイルを写した'} {fx.dir}")

    def check(cond: bool, what: str) -> None:
        print(("  OK   " if cond else "  NG   ") + what, flush=True)
        if not cond:
            failures.append(what)
            lines.append("NG   " + what)

    def log(text: str) -> None:
        print("       " + text, flush=True)

    with Zigzagu(cfg, f"delete-{name}", args.exe) as z:
        delete_one(fx, z, check, log, args.timeout, cfg.chronos)
    lines.append(f"合計 {time.perf_counter() - t0:.1f} 秒、失敗 {len(failures)} 件")
    return not failures, lines


def template_fixture(cfg, name: str, args, log_dir: pathlib.Path) -> tuple[bool, list[str]]:
    """--template: 使われている番号の索引とイベントのひな形（lib/template.py）。"""
    fx = fixtures.get(cfg, name)
    lines: list[str] = []
    failures: list[str] = []
    t0 = time.perf_counter()
    c = fixtures.make_copy(fx, reuse=args.reuse)
    lines.append(f"写し: {'前のものを使用' if c['reused'] else str(c['files']) + ' ファイルを写した'} {fx.dir}")

    def check(cond: bool, what: str) -> None:
        print(("  OK   " if cond else "  NG   ") + what, flush=True)
        if not cond:
            failures.append(what)
            lines.append("NG   " + what)

    def log(text: str) -> None:
        print("       " + text, flush=True)

    with Zigzagu(cfg, f"template-{name}", args.exe) as z:
        template_one(fx, z, check, log, args.timeout)
    lines.append(f"合計 {time.perf_counter() - t0:.1f} 秒、失敗 {len(failures)} 件")
    return not failures, lines


def connection_fixture(cfg, name: str, args, log_dir: pathlib.Path) -> tuple[bool, list[str]]:
    """--connection: 接続の編集（lib/connection.py）。"""
    fx = fixtures.get(cfg, name)
    lines: list[str] = []
    failures: list[str] = []
    t0 = time.perf_counter()
    c = fixtures.make_copy(fx, reuse=args.reuse)
    lines.append(f"写し: {'前のものを使用' if c['reused'] else str(c['files']) + ' ファイルを写した'} {fx.dir}")

    def check(cond: bool, what: str) -> None:
        print(("  OK   " if cond else "  NG   ") + what, flush=True)
        if not cond:
            failures.append(what)
            lines.append("NG   " + what)

    def log(text: str) -> None:
        print("       " + text, flush=True)

    with Zigzagu(cfg, f"connection-{name}", args.exe) as z:
        connection_one(fx, z, check, log, args.timeout, log_dir / f"connection-{name}")
    lines.append(f"合計 {time.perf_counter() - t0:.1f} 秒、失敗 {len(failures)} 件")
    return not failures, lines


def phase4_fixture(cfg, name: str, args, log_dir: pathlib.Path, kind: str) -> tuple[bool, list[str]]:
    """--transplant・--triple（Phase4。lib/transplant.py・lib/triple.py）と --swap（Phase5。lib/swap.py）。"""
    fx = fixtures.get(cfg, name)
    lines: list[str] = []
    failures: list[str] = []
    t0 = time.perf_counter()
    c = fixtures.make_copy(fx, reuse=args.reuse)
    lines.append(f"写し: {'前のものを使用' if c['reused'] else str(c['files']) + ' ファイルを写した'} {fx.dir}")

    def check(cond: bool, what: str) -> None:
        print(("  OK   " if cond else "  NG   ") + what, flush=True)
        if not cond:
            failures.append(what)
            lines.append("NG   " + what)

    def log(text: str) -> None:
        print("       " + text, flush=True)

    with Zigzagu(cfg, f"{kind}-{name}", args.exe) as z:
        if kind == "maplist":
            maplist_one(fx, z, check, log, args.timeout, log_dir / f"maplist-{name}")
        elif kind == "transplant":
            transplant_one(fx, z, check, log, args.timeout, log_dir / f"transplant-{name}", pathlib.Path(args.source_rom))
        elif kind == "swap":
            swap_one(fx, z, check, log, args.timeout, log_dir / f"swap-{name}")
        elif kind == "newtileset":
            newtileset_one(fx, z, check, log, args.timeout, log_dir / f"newtileset-{name}")
        elif kind == "tileimport":
            tileimport_one(fx, z, check, log, args.timeout, log_dir / f"tileimport-{name}")
        elif kind == "wildtime":
            wildtime_one(fx, z, check, log, args.timeout, log_dir / f"wildtime-{name}")
        elif kind == "species":
            species_one(fx, z, check, log, args.timeout, log_dir / f"species-{name}")
        elif kind == "phase5":
            phase5_one(fx, z, check, log, args.timeout, log_dir / f"phase5-{name}")
        elif kind == "phase6":
            phase6_one(fx, z, check, log, args.timeout, log_dir / f"phase6-{name}")
        elif kind == "pathdraw":
            pathdraw_one(fx, z, check, log, args.timeout, log_dir / f"pathdraw-{name}")
        elif kind == "regionmap":
            regionmap_one(fx, z, check, log, args.timeout, log_dir / f"regionmap-{name}")
        else:
            triple_one(fx, z, check, log, args.timeout, log_dir / f"triple-{name}")
    lines.append(f"合計 {time.perf_counter() - t0:.1f} 秒、失敗 {len(failures)} 件")
    return not failures, lines


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--link", action="store_true", help="スクリプト連携（ラベル・ひな形・取り込み・マップスクリプト・ビルドの欄）の確認")
    ap.add_argument("--delete", action="store_true", help="イベントの削除（.s の記述・ROM の埋める範囲）と複数行の文字列の確認")
    ap.add_argument("--all", action="store_true", help="--smoke と --link と --delete")
    ap.add_argument("--connection", action="store_true", help="接続の編集（Phase3）を出力してビルドし、ROM の接続を確かめる")
    ap.add_argument("--template", action="store_true", help="使われている番号の索引とイベントのひな形（置く・元に戻す・出力・ビルド・ROM の中身）の確認")
    ap.add_argument("--transplant", action="store_true", help="別の ROM からのタイルセットの移植（Phase4）を出力してビルドし、ROM の中身を確かめる")
    ap.add_argument("--source-rom", help="--transplant で取り込む元の ROM（素の BPRJ。読むだけ）")
    ap.add_argument("--triple", action="store_true", help="トリプルレイヤー（Phase4）を出力してビルドし、ROM の中身と開き直しを確かめる")
    ap.add_argument("--maplist", action="store_true", help="マップ一覧の「このマップを複製」（Phase5）を出力してビルドし、ROM の中身を確かめる")
    ap.add_argument("--swap", action="store_true", help="ブロックの入れ替え（Phase5）を出力してビルドし、ROM の中身と開き直しを確かめる")
    ap.add_argument("--newtileset", action="store_true", help="新しいタイルセット（Phase5）を出力してビルドし、ROM の中身と開き直しを確かめる")
    ap.add_argument("--tileimport", action="store_true", help="画像からタイルとブロックを作る（Phase6）を出力してビルドし、開き直しを確かめる")
    ap.add_argument("--wildtime", action="store_true", help="時間帯別の野生の出力・ビルド・開き直しの確認")
    ap.add_argument("--species", action="store_true", help="DPEの追加種族の表示とJSON往復の確認")
    ap.add_argument("--phase5", action="store_true", help="Phase5 の全体の往復テスト（塗りつぶし・シフト・リサイズ・入れ替え・イベント・新しいタイルセットを出力して開き直し、ビルドする）")
    ap.add_argument("--phase6", action="store_true", help="Phase6 の全体の往復テスト（時間帯別の野生・画像からのタイルセットの取り込み・タイムラインの編集の .s の書き戻しを出力して開き直し、ビルドする）")
    ap.add_argument("--pathdraw", action="store_true", help="道をなぞる窓で .s の移動データを置き換え・足して出力し、写しでビルドする（#518）")
    ap.add_argument("--regionmap", action="store_true", help="タウンマップ（maps\regionmap.json）を出力してビルドし、ROM の表と開き直しを確かめる")
    ap.add_argument("--only", choices=sorted(fixtures.FIXTURES), action="append")
    ap.add_argument("--reuse", action="store_true")
    ap.add_argument("--dpe", action="store_true")
    ap.add_argument("--exe")
    ap.add_argument("--config")
    ap.add_argument("--timeout", type=int)
    args = ap.parse_args()
    if args.all:
        args.smoke = args.link = args.delete = True
    if not any([args.smoke, args.link, args.delete, args.connection, args.template, args.transplant, args.triple, args.swap, args.maplist, args.newtileset, args.tileimport, args.wildtime, args.species, args.phase5, args.phase6, args.regionmap, args.pathdraw]):
        ap.error("--smoke か --link か --delete か --connection か --template か --transplant か --triple か --swap か --maplist か --newtileset か --tileimport か --wildtime か --phase5 か --phase6 か --regionmap か --pathdraw か --all を付けてください")
    if args.transplant and not args.source_rom:
        ap.error("--transplant には --source-rom（取り込む元の ROM）が要ります")
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
    runs = [(n, "smoke") for n in names if args.smoke] + [(n, "link") for n in names if args.link] + [(n, "delete") for n in names if args.delete]
    runs += [(n, "connection") for n in names if args.connection]
    runs += [(n, "template") for n in names if args.template]
    runs += [(n, "transplant") for n in names if args.transplant]
    runs += [(n, "triple") for n in names if args.triple]
    runs += [(n, "swap") for n in names if args.swap]
    runs += [(n, "maplist") for n in names if args.maplist]
    runs += [(n, "newtileset") for n in names if args.newtileset]
    runs += [(n, "tileimport") for n in names if args.tileimport]
    runs += [(n, "wildtime") for n in names if args.wildtime]
    runs += [(n, "species") for n in names if args.species]
    runs += [(n, "phase5") for n in names if args.phase5]
    runs += [(n, "phase6") for n in names if args.phase6]
    runs += [(n, "regionmap") for n in names if args.regionmap]
    runs += [(n, "pathdraw") for n in names if args.pathdraw]
    for name, kind in runs:
        key = name if sum([args.smoke, args.link, args.delete, args.connection, args.template, args.transplant, args.triple, args.swap, args.maplist, args.newtileset, args.tileimport, args.wildtime, args.species, args.phase5, args.phase6, args.regionmap, args.pathdraw]) == 1 else f"{name} ({kind})"
        print(f"\n== {key}")
        try:
            if kind in ("transplant", "triple", "swap", "maplist", "newtileset", "tileimport", "wildtime", "species", "phase5", "phase6", "regionmap", "pathdraw"):
                ok, lines = phase4_fixture(cfg, name, args, log_dir, kind)
            else:
                run = {"link": link_fixture, "delete": delete_fixture, "smoke": smoke_one, "connection": connection_fixture, "template": template_fixture}[kind]
                ok, lines = run(cfg, name, args, log_dir)
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
