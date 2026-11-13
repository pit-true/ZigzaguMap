"""結果フォルダの summary.md / summary.json と、シナリオごとの report.md。"""
from __future__ import annotations

import json
import pathlib

from .judge import ALL_RESULTS, ERROR, FAIL, PASS, PENDING, SPEC, UNSUP


def _short(v, n=120):
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    return s if len(s) <= n else s[: n - 1] + "…"


def _cell(s):
    return str(s).replace("|", "\\|").replace("\n", " ")


def _counts(c) -> str:
    return " / ".join(f"{k} {c.get(k, 0)}" for k in ALL_RESULTS)


def scenario_md(r: dict) -> str:
    out = [f"# {r['name']} {r.get('title', '')}", "",
           f"- 判定: **{r['verdict']}**（{_counts(r['counts'])}）",
           f"- 元のシナリオ案: {r.get('source', '')}、issue: {', '.join('#' + str(i) for i in r.get('issues', []))}",
           f"- AdvanceMap の結果: {'前回の実行のもの' if r.get('amFromCache') else 'この実行'}", "",
           "| # | 操作 | AdvanceMap | ZigzaguMap | 結果 | 内容 |", "|---|---|---|---|---|---|"]
    for row in r["rows"]:
        st = row.get("step", {})
        args = {k: v for k, v in st.items() if k not in ("op", "compare", "expectedDifference", "pending", "expected")}
        detail = row.get("detail", "")
        if row.get("reason"):
            detail = f"{detail}（理由: {row['reason']}）"
        out.append(f"| {row['i']} | {_cell(row['op'])} {_cell(_short(args, 60)) if args else ''} | {row.get('am', '')} | {row.get('zz', '')} | "
                   f"{row.get('result', '')} | {_cell(_short(detail, 300))} |")
    # 値の対応表
    for row in r["rows"]:
        if row.get("fields"):
            out += ["", f"## ステップ {row['i']} の値", "", "| 欄 | AdvanceMap | ZigzaguMap | 結果 |", "|---|---|---|---|"]
            for f in row["fields"]:
                note = f.get("reason") or f.get("detail", "")
                out.append(f"| {f['field']} | {_cell(_short(f.get('advancemap', ''), 200))} | {_cell(_short(f.get('zigzagu', ''), 200))} | "
                           f"{f['result']}{(' ' + _cell(note)) if note else ''} |")
                if f.get("diffKeys"):
                    out.append(f"|  | 違う項目: {_cell(_short(f['diffKeys'], 400))} | | |")
        if row.get("files"):
            fl = row["files"]
            out += ["", f"## ステップ {row['i']} の画像（{row['step'].get('name')}）", "",
                    f"- AdvanceMap: `{fl['advancemap']}`", f"- ZigzaguMap: `{fl['zigzagu']}`",
                    f"- 差分（左 AdvanceMap、中 ZigzaguMap、右 差分。赤 = 違う画素、黄の枠 = 違うマス）: `{fl['diff']}`",
                    f"- 窓全体: `{fl.get('advancemapWindow')}` / `{fl.get('zigzaguWindow')}`"]
    return "\n".join(out) + "\n"


def _listed(results, kind):
    """結果が kind（仕様上の違い・保留）のステップと欄の一覧: (シナリオ, ステップ, 操作, 理由)。"""
    out = []
    for r in results:
        for row in r["rows"]:
            fields = row.get("fields") or []
            if fields:
                for f in fields:
                    if f.get("result") == kind:
                        out.append((r["name"], row["i"], f"{row['op']} {f['field']}", f.get("reason", "")))
                    elif kind == SPEC and f.get("specReason"):
                        # 保留の欄に含まれる仕様上の違いの項目
                        out.append((r["name"], row["i"], f"{row['op']} {f['field']}", f["specReason"]))
            elif row.get("result") == kind:
                out.append((r["name"], row["i"], row["op"], row.get("reason", "")))
    return out


def write(run_dir: pathlib.Path, results: list[dict], meta: dict):
    tot = {k: 0 for k in ALL_RESULTS}
    for r in results:
        tot[r["verdict"]] += 1
        (run_dir / r["name"] / "report.md").write_text(scenario_md(r), encoding="utf-8")
    specs, pend = _listed(results, SPEC), _listed(results, PENDING)
    summary = {"meta": meta, "totals": tot,
               "scenarios": [{k: r[k] for k in ("name", "title", "issues", "verdict", "counts", "seconds")} for r in results],
               "expectedDifferences": [dict(scenario=a, step=b, op=c, reason=d) for a, b, c, d in specs],
               "pending": [dict(scenario=a, step=b, op=c, reason=d) for a, b, c, d in pend]}
    (run_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    md = ["# 比較テストの結果", "",
          f"- 日時: {meta['started']}",
          f"- ZigzaguMap: `{meta['exe']}`（{meta.get('commit', '')}）",
          f"- シナリオ: {len(results)} 本（{_counts(tot)}）",
          f"- 仕様上の違いとして除外したステップ・欄: {len(specs)} 件、保留: {len(pend)} 件",
          "- 判定: 合格 = 比べたものがすべて同じか、シナリオに理由を書いた仕様上の違いだけ。失敗 = 比べた結果が違う、または ZigzaguMap がエラーを返した。"
          "未対応 = 比べられない手順がある（失敗はない）。エラー = AdvanceMap 側の操作が通らなかった（テストの不具合）。"
          "保留 = 要判断の結論待ちの違いがある（それ以外は合格）", "",
          f"| シナリオ | 判定 | {' | '.join(ALL_RESULTS)} | issue | 詳細 |", "|---|---|" + "---|" * len(ALL_RESULTS) + "---|---|"]
    for r in results:
        c = r["counts"]
        md.append(f"| {r['name']} {r.get('title', '')} | **{r['verdict']}** | {' | '.join(str(c.get(k, 0)) for k in ALL_RESULTS)} | "
                  f"{', '.join('#' + str(i) for i in r.get('issues', []))} | [report]({r['name']}/report.md) |")
    fails = [r for r in results if r["verdict"] in (FAIL, ERROR, UNSUP)]
    if fails:
        md += ["", "## 失敗・エラー・未対応の中身", ""]
        for r in fails:
            md.append(f"### {r['name']}（{r['verdict']}）")
            for row in r["rows"]:
                if row.get("result") in (FAIL, ERROR, UNSUP):
                    md.append(f"- ステップ {row['i']} `{row['op']}`（{row['result']}）: {row.get('detail', '')}")
            md.append("")
    if specs:
        md += ["", "## 仕様上の違いとして除外したステップ・欄", "", "| シナリオ | ステップ | 操作・欄 | 理由 |", "|---|---|---|---|"]
        md += [f"| {a} | {b} | {_cell(c)} | {_cell(d)} |" for a, b, c, d in specs]
    if pend:
        md += ["", "## 保留（要判断）", "", "| シナリオ | ステップ | 操作・欄 | 理由 |", "|---|---|---|---|"]
        md += [f"| {a} | {b} | {_cell(c)} | {_cell(d)} |" for a, b, c, d in pend]
    cands = meta.get("deleteCandidates") or []
    if cands:
        md += ["", f"## 消せなかった古い結果（直近 {meta.get("keepRuns")} 回より古いもの）", ""]
        md += [f"- `{c}`" for c in cands]
    (run_dir / "summary.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    return tot
