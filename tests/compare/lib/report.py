"""結果フォルダの summary.md / summary.json と、シナリオごとの report.md。"""
from __future__ import annotations

import json
import pathlib

from .runner import ERROR, FAIL, PASS, UNSUP


def _short(v, n=120):
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    return s if len(s) <= n else s[: n - 1] + "…"


def _cell(s):
    return str(s).replace("|", "\\|").replace("\n", " ")


def scenario_md(r: dict) -> str:
    out = [f"# {r['name']} {r.get('title', '')}", "",
           f"- 判定: **{r['verdict']}**（合格 {r['counts'][PASS]} / 失敗 {r['counts'][FAIL]} / 未対応 {r['counts'][UNSUP]} / エラー {r['counts'][ERROR]}）",
           f"- 元のシナリオ案: {r.get('source', '')}、issue: {', '.join('#' + str(i) for i in r.get('issues', []))}",
           f"- AdvanceMap の結果: {'前回の実行のもの' if r.get('amFromCache') else 'この実行'}", "",
           "| # | 操作 | AdvanceMap | ZigzaguMap | 結果 | 内容 |", "|---|---|---|---|---|---|"]
    for row in r["rows"]:
        st = row.get("step", {})
        args = {k: v for k, v in st.items() if k not in ("op", "compare")}
        out.append(f"| {row['i']} | {_cell(row['op'])} {_cell(_short(args, 60)) if args else ''} | {row.get('am', '')} | {row.get('zz', '')} | "
                   f"{row.get('result', '')} | {_cell(_short(row.get('detail', ''), 200))} |")
    # 値の対応表
    for row in r["rows"]:
        if row.get("fields"):
            out += ["", f"## ステップ {row['i']} の値", "", "| 欄 | AdvanceMap | ZigzaguMap | 結果 |", "|---|---|---|---|"]
            for f in row["fields"]:
                out.append(f"| {f['field']} | {_cell(_short(f.get('advancemap', ''), 200))} | {_cell(_short(f.get('zigzagu', ''), 200))} | "
                           f"{f['result']}{(' ' + _cell(f.get('detail', ''))) if f.get('detail') else ''} |")
                if f.get("diffKeys"):
                    out.append(f"|  | 違う項目: {_cell(_short(f['diffKeys'], 400))} | | |")
        if row.get("files"):
            fl = row["files"]
            out += ["", f"## ステップ {row['i']} の画像（{row['step'].get('name')}）", "",
                    f"- AdvanceMap: `{fl['advancemap']}`", f"- ZigzaguMap: `{fl['zigzagu']}`",
                    f"- 差分（左 AdvanceMap、中 ZigzaguMap、右 差分。赤 = 違う画素、黄の枠 = 違うマス）: `{fl['diff']}`",
                    f"- 窓全体: `{fl.get('advancemapWindow')}` / `{fl.get('zigzaguWindow')}`"]
    return "\n".join(out) + "\n"


def write(run_dir: pathlib.Path, results: list[dict], meta: dict):
    tot = {PASS: 0, FAIL: 0, UNSUP: 0, ERROR: 0}
    for r in results:
        tot[r["verdict"]] += 1
        (run_dir / r["name"] / "report.md").write_text(scenario_md(r), encoding="utf-8")
    summary = {"meta": meta, "totals": tot,
               "scenarios": [{k: r[k] for k in ("name", "title", "issues", "verdict", "counts", "seconds")} for r in results]}
    (run_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    md = ["# 比較テストの結果", "",
          f"- 日時: {meta['started']}",
          f"- ZigzaguMap: `{meta['exe']}`（{meta.get('commit', '')}）",
          f"- シナリオ: {len(results)} 本（合格 {tot[PASS]} / 失敗 {tot[FAIL]} / 未対応 {tot[UNSUP]} / エラー {tot[ERROR]}）",
          "- 判定: 失敗 = 比べた結果が違う、または ZigzaguMap がエラーを返した。未対応 = 比べられない手順がある（失敗はない）。"
          "エラー = AdvanceMap 側の操作が通らなかった（テストの不具合）", "",
          "| シナリオ | 判定 | 合格 | 失敗 | 未対応 | エラー | issue | 詳細 |", "|---|---|---|---|---|---|---|---|"]
    for r in results:
        c = r["counts"]
        md.append(f"| {r['name']} {r.get('title', '')} | **{r['verdict']}** | {c[PASS]} | {c[FAIL]} | {c[UNSUP]} | {c[ERROR]} | "
                  f"{', '.join('#' + str(i) for i in r.get('issues', []))} | [report]({r['name']}/report.md) |")
    fails = [r for r in results if r["verdict"] == FAIL]
    if fails:
        md += ["", "## 失敗の中身", ""]
        for r in fails:
            md.append(f"### {r['name']}")
            for row in r["rows"]:
                if row.get("result") == FAIL:
                    md.append(f"- ステップ {row['i']} `{row['op']}`: {row.get('detail', '')}")
            md.append("")
    cands = meta.get("deleteCandidates") or []
    if cands:
        md += ["", f"## 削除候補（直近 {meta.get('keepRuns')} 回より古い結果。自動では消さない）", ""]
        md += [f"- `{c}`" for c in cands]
    (run_dir / "summary.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    return tot
