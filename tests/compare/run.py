"""AdvanceMap 1.92 と ZigzaguMap を同じ操作で動かし、途中の状態を比べる。

使い方:
  python tests/compare/run.py                       # 全シナリオ
  python tests/compare/run.py --scenario S04 S08    # 名前（の先頭）で選ぶ
  python tests/compare/run.py --only-zigzagu        # AdvanceMap は前回の結果を使う
  python tests/compare/run.py --list-ops            # 抽象操作 → 実操作の対応表
結果: <resultsDir>/<日時>/（summary.md, summary.json, シナリオごとのフォルダ）。失敗かエラーがあれば終了コード 1。
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from lib import config, ops, report  # noqa: E402
from lib.drivers import AdvanceMapDriver, ZigzaguDriver  # noqa: E402
from lib.runner import ERROR, FAIL, run_scenario  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent


def load_scenarios(names: list[str] | None) -> list[dict]:
    out = []
    for p in sorted((HERE / "scenarios").glob("*.json")):
        scn = json.loads(p.read_text(encoding="utf-8"))
        scn.setdefault("name", p.stem)
        if names and not any(scn["name"] == n or scn["name"].startswith(n) or p.stem.startswith(n) for n in names):
            continue
        errs = ops.validate(scn)
        if errs:
            raise SystemExit(f"{p.name}: " + "; ".join(errs))
        out.append(scn)
    return out


def old_runs(cfg) -> list[str]:
    """直近 keepRuns 回より古い結果フォルダ（削除候補。自動では消さない）。"""
    runs = sorted(p for p in cfg.resultsDir.iterdir() if p.is_dir() and re.fullmatch(r"\d{8}-\d{6}", p.name))
    return [str(p) for p in runs[:-cfg.keepRuns]] if cfg.keepRuns > 0 else []


def list_ops():
    print("| 抽象操作 | 説明 | AdvanceMap | ZigzaguMap |")
    print("|---|---|---|---|")
    for name, spec in ops.OPS.items():
        a = AdvanceMapDriver.MAPPING.get(name)
        z = ZigzaguDriver.MAPPING.get(name)
        print(f"| `{name}` | {spec['desc']} | {a or '未対応'} | {z or '未対応'} |")


def main():
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenario", nargs="*", help="実行するシナリオの名前（先頭一致）")
    ap.add_argument("--only-zigzagu", action="store_true", help="ZigzaguMap だけ動かし、AdvanceMap は前回の結果と比べる")
    ap.add_argument("--config", help="設定ファイル（既定 tests/compare/local.config.json）")
    ap.add_argument("--list-ops", action="store_true")
    a = ap.parse_args()
    if a.list_ops:
        list_ops()
        return 0
    cfg = config.load(a.config)
    scns = load_scenarios(a.scenario)
    if not scns:
        print("シナリオがありません")
        return 2
    started = datetime.datetime.now()
    run_dir = cfg.resultsDir / started.strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    try:
        commit = subprocess.run(["git", "-C", str(config.REPO), "rev-parse", "--short", "HEAD"],
                                capture_output=True, text=True).stdout.strip()
    except OSError:
        commit = ""
    logf = (run_dir / "run.log").open("w", encoding="utf-8")

    def log(s):
        print(s, flush=True)
        logf.write(s + "\n")
        logf.flush()

    log(f"結果: {run_dir}")
    results = []
    try:
        for scn in scns:
            log(f"■ {scn['name']} {scn.get('title', '')}")
            r = run_scenario(cfg, scn, run_dir, a.only_zigzagu, log)
            log(f"  → {r['verdict']} {r['counts']}")
            results.append(r)
    finally:
        meta = {"started": started.isoformat(timespec="seconds"), "exe": str(cfg.zigzaguExe), "commit": commit,
                "onlyZigzagu": a.only_zigzagu, "keepRuns": cfg.keepRuns, "deleteCandidates": old_runs(cfg)}
        tot = report.write(run_dir, results, meta)
        # ZigzaguMap のプロファイル（設定と WebView2 のデータ）は結果に残さない
        shutil.rmtree(run_dir / "_zigzagu-profile", ignore_errors=True)
        log(f"合計: {tot}")
        log(f"まとめ: {run_dir / 'summary.md'}")
        logf.close()
    return 1 if tot[FAIL] or tot[ERROR] else 0


if __name__ == "__main__":
    sys.exit(main())
