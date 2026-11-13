"""比較テストの失敗を GitHub の issue にする。

使い方: python tests/compare/file_issues.py <結果フォルダ> [--dry-run] [--repo pit-true/ZigzaguMap]

- 判定が「失敗」のシナリオごとに 1 件（題名「比較テスト失敗: <シナリオ名> <題>」、ラベル「テスト失敗」、マイルストーン「Phase1」）。
- 同じ題名の issue が開いていれば、新しく作らずにコメントを足す。
- --notes で、差分画像を見て分かったことを本文に足せる。
- 画像は上げない（AdvanceMap の画面は公開しない）。結果フォルダ内の相対パスだけを書く。
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import tempfile

LABEL = "テスト失敗"
MILESTONE = "Phase1"


def gh(*args, input_text=None) -> str:
    r = subprocess.run(["gh", *args], capture_output=True, text=True, encoding="utf-8", input=input_text)
    if r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args[:3])}: {r.stderr.strip()}")
    return r.stdout


def short(v, n=300):
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    return s if len(s) <= n else s[: n - 1] + "…"


def body_of(r: dict, run_dir: pathlib.Path, meta: dict) -> str:
    sdir = r["name"]
    lines = [f"比較テスト（`tests/compare`）のシナリオ **{r['name']}**（{r.get('title', '')}）で、AdvanceMap 1.92 と ZigzaguMap の状態が食い違いました。", "",
             f"- 実行: {meta.get('started', '')}、ZigzaguMap のコミット {meta.get('commit', '')}",
             f"- 結果フォルダ: `{run_dir.name}/{sdir}/`（ローカルの `compare-results` の中。画像は公開しない）",
             f"- 関連: {', '.join('#' + str(i) for i in r.get('issues', []))}", "",
             "## 失敗したステップ", ""]
    for row in r["rows"]:
        if row.get("result") != "失敗":
            continue
        st = {k: v for k, v in row.get("step", {}).items() if k not in ("compare",)}
        lines.append(f"### ステップ {row['i']}: `{short(st, 200)}`")
        lines.append("")
        if row.get("fields"):
            lines += ["| 欄 | 期待（AdvanceMap） | 実際（ZigzaguMap） |", "|---|---|---|"]
            for f in row["fields"]:
                if f["result"] == "失敗":
                    a, z = f.get("advancemap", ""), f.get("zigzagu", "")
                    if f.get("diffKeys") and isinstance(a, dict):
                        a = {k: a.get(k) for k in f["diffKeys"]}
                        z = {k: z.get(k) for k in f["diffKeys"]} if isinstance(z, dict) else z
                    lines.append(f"| {f['field']} | {short(a).replace('|', '/')} | {short(z).replace('|', '/')} |")
        elif row.get("image"):
            im = row["image"]
            lines.append(f"- 画像の比較（{im.get('mode')}）: {row.get('detail', '')}")
            lines.append(f"- 大きさ: AdvanceMap {im['sizeA'][0]}x{im['sizeA'][1]}、ZigzaguMap {im['sizeB'][0]}x{im['sizeB'][1]}")
            fl = row.get("files", {})
            lines.append(f"- 差分画像: `{fl.get('diff')}`（左 AdvanceMap、中 ZigzaguMap、右 差分。赤 = 違う画素、黄の枠 = 違うマス）")
            lines.append(f"- ZigzaguMap の画像: `{fl.get('zigzagu')}`")
        else:
            lines.append(f"- {row.get('detail', '')}")
        lines.append("")
    lines += ["## 再現", "", "```", f"python tests/compare/run.py --scenario {r['name']}", "```", "",
              "シナリオ: " + f"`tests/compare/scenarios/{r['name']}.json`"]
    return "\n".join(lines) + "\n"


def main():
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--repo", default="pit-true/ZigzaguMap")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--notes", help="シナリオ名 → 所見（人が見て分かったこと）の JSON。本文に「所見」として足す")
    a = ap.parse_args()
    run_dir = pathlib.Path(a.run_dir)
    summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
    meta = summary["meta"]
    notes = json.loads(pathlib.Path(a.notes).read_text(encoding="utf-8")) if a.notes else {}
    fails = [s for s in summary["scenarios"] if s["verdict"] == "失敗"]
    if not fails:
        print("失敗したシナリオはありません")
        return 0
    open_issues = json.loads(gh("issue", "list", "-R", a.repo, "--state", "open", "--label", LABEL, "--limit", "200",
                                "--json", "number,title")) if not a.dry_run else []
    by_title = {i["title"]: i["number"] for i in open_issues}
    for s in fails:
        r = json.loads((run_dir / s["name"] / "result.json").read_text(encoding="utf-8"))
        title = f"比較テスト失敗: {r['name']} {r.get('title', '')}".strip()
        body = body_of(r, run_dir, meta)
        if notes.get(r["name"]):
            body += "\n## 所見\n\n" + notes[r["name"]] + "\n"
        if a.dry_run:
            print(f"--- {title}\n{body}")
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
            f.write(body)
            path = f.name
        try:
            if title in by_title:
                n = by_title[title]
                gh("issue", "comment", str(n), "-R", a.repo, "--body-file", path)
                print(f"#{n} にコメントを追加: {title}")
            else:
                url = gh("issue", "create", "-R", a.repo, "--title", title, "--body-file", path,
                         "--label", LABEL, "--milestone", MILESTONE).strip()
                print(f"作成: {url} {title}")
        finally:
            os.unlink(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
