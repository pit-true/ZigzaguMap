"""スクリプトエディタの機能（#191〜#196）を確かめる。

  python tests/automation/script_editor_features_check.py --rom <ベース ROM> --project <CFRU-JP のフォルダ（読むだけ）> --work <作業フォルダ>
      [--exe <zigzagumap.exe>] [--shots <スクリーンショットのフォルダ>] [--name <スクリーンショットの名前の頭>]

- `--project` のフォルダには書き込まない。必要な分を `--work` の下の `project/` に写し、写しを開いて編集する（script_editor_check.py と同じ）。
  `--work` が `--project` の中なら止める。写しには確かめ用の `zz_feature.s`・`zz_feature.string`・`zz_big.s`（数千行）を足す。
- 方言（ND の 2 ポインタ / Chronos の 1 ポインタ）は写しの xse_commands.s から決まる。どちらでも同じ確かめ方で、期待する値だけを変える。
- 見ること: 色付けの種類とテーマ 4 つの色、打鍵から描画までの時間、ホバー・補完・定義へ移動と戻る、検索と置換・矩形選択・
  複数カーソル・行の移動と複製・コメントの切り替え、波線（実ファイルで誤った波線が出ない・わざと誤ると出る）、
  文字列の本文のホバーとその場編集（差分がそのラベルだけ）と簡易の幅検査。
"""
from __future__ import annotations

import argparse
import base64
import os
import pathlib
import re
import shutil
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from zz import Zigzagu  # noqa: E402

W = {"window": "script-editor"}
COPY_DIRS = ["assembly", "strings", "maps"]
COPY_FILES = ["xse_commands.s", "xse_defines.s", "asm_defines.s", "eventscripts", "charmap.tbl", "zigzagumap.json", "BPRJ.ld"]
SCRIPTS = "assembly/overworld_scripts"
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


def find_line(text: str, pattern: str) -> tuple[int, str] | None:
    for i, line in enumerate(text.split("\n"), 1):
        if re.search(pattern, line):
            return i, line
    return None


def col_of(line: str, word: str) -> int:
    return line.index(word) + 2  # 1 から数えて、名前の 2 文字目


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--project", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--shots")
    ap.add_argument("--name", default="editor")
    a = ap.parse_args()
    work = pathlib.Path(a.work)
    shots = pathlib.Path(a.shots) if a.shots else None
    proj = prepare(pathlib.Path(a.project), work)
    xse = (proj / "xse_commands.s").read_text(encoding="utf-8")
    nd = re.search(r"\.macro\s+loadpointer\s+destination:req,\s*value:req,\s*value_kanji", xse) is not None
    print("方言:", "ND" if nd else "Chronos")

    # ---- 確かめ用のファイル ----
    feature_s = proj / SCRIPTS / "zz_feature.s"
    feature_str = proj / "strings/zz_feature.string"
    kanji = " gText_ZzHello_k" if nd else ""
    feature_s.write_text(
        ".text\n.thumb\n.align 2\n\n.include \"../xse_commands.s\"\n.include \"../xse_defines.s\"\n.include \"../asm_defines.s\"\n\n"
        "EventScript_ZzMain:\n"
        "\tlock\n"
        f"\tmsgbox gText_ZzHello MSG_FACE{kanji}\n"
        "\tsetvar 0x800D 1\n"
        "\tcall EventScript_ZzSub @ サブを呼ぶ\n"
        "\tgoto EventScript_ZzSub\n"
        "\trelease\n"
        "\tend\n"
        "\n"
        "EventScript_ZzSub:\n"
        "\tsetflag 0x200\n"
        "\treturn\n",
        encoding="utf-8",
        newline="\n",
    )
    feature_str.write_text(
        "#org @gText_ZzHello\nこんにちは\\nげんきかい？\n\n#org @gText_ZzHello_k\n今日は\\n元気かい？\n\n#org @gText_ZzOther\nほかの　ぶん\n",
        encoding="utf-8",
        newline="\n",
    )
    system = (proj / SCRIPTS / "system_scripts.s").read_text(encoding="utf-8")
    big = proj / SCRIPTS / "zz_big.s"
    body = re.sub(r"^([A-Za-z_]\w*):", lambda m: m.group(1) + "_ZZBIG:", system, flags=re.M)
    big.write_text("\n".join(body.replace("_ZZBIG:", f"_Z{i}:") for i in range(4)), encoding="utf-8", newline="\n")

    profile = work / "profile"
    shutil.rmtree(profile, ignore_errors=True)
    rel = f"{SCRIPTS}/zz_feature.s"
    with Zigzagu(a.exe, profile=profile, extra=["--mute-audio"]) as z:
        z.call({"cmd": "open", "rom": a.rom, "project": str(proj)})
        r = z.call({"cmd": "script.open", "path": rel, "line": 1})
        check(r["opened"] and wait_ready(z), "エディタを開く")
        p = ed(z, "editor.project")
        check(p["loaded"] and p["commands"] > 100 and p["labels"] > 100 and p["strings"] > 100, f"命令表と索引を読む（{p}）")
        print("  読み込み:", p["loadMs"], "ms")
        text = ed(z, "editor.text")["text"]

        # ---- #191 色付けの種類 ----
        msg_line, msg = find_line(text, r"^\tmsgbox")
        toks = ed(z, "editor.tokens", line=msg_line)["lines"][0]
        kinds = [(t["text"], t["kind"]) for t in toks["semantic"]]
        expect = [("msgbox", "command"), ("gText_ZzHello", "textRef"), ("MSG_FACE", "constant")] + ([("gText_ZzHello_k", "textRef")] if nd else [])
        check(kinds == expect, f"msgbox の行の種類（{kinds}）")
        call_line, _ = find_line(text, r"^\tcall ")
        toks = ed(z, "editor.tokens", line=call_line)["lines"][0]
        check(("EventScript_ZzSub", "labelRef") in [(t["text"], t["kind"]) for t in toks["semantic"]], "call の引数はラベルの参照")
        check(any(t["kind"] == "comment" for t in toks["syntax"]), "行末の @ はコメント")
        set_line, _ = find_line(text, r"^\tsetvar 0x800D")
        toks = ed(z, "editor.tokens", line=set_line)["lines"][0]
        check(("0x800D", "variable") in [(t["text"], t["kind"]) for t in toks["semantic"]], "setvar の 1 つ目は変数")
        lab = ed(z, "editor.tokens", line=9)["lines"][0]
        check(any(t["kind"] == "labelDef" and t["text"] == "EventScript_ZzMain" for t in lab["syntax"]), "ラベル定義")
        dirc = ed(z, "editor.tokens", line=1)["lines"][0]
        check(any(t["kind"] == "directive" for t in dirc["syntax"]), "ディレクティブ")

        for theme in ["darkPlus", "lightPlus", "monokai", "solarizedDark"]:
            r = ed(z, "editor.theme", theme=theme)
            colors = r["rendered"]
            wanted = ["command", "textRef", "labelRef", "variable", "constant", "comment"]
            got = [colors.get(k) for k in wanted]
            check(None not in got and len(set(got)) == len(got), f"テーマ {theme}: 命令・文字列の参照・ラベル・変数・定数・コメントが別の色（{dict(zip(wanted, got))}）")
            shot(z, shots, f"{a.name}-theme-{theme}.png")
        ed(z, "editor.theme", theme="darkPlus")
        st = ed(z, "editor.state")
        check(st["theme"] == "darkPlus", "テーマを変えると state にも出る")

        # 打鍵から描画まで（数千行の .s）
        r = ed(z, "editor.open", path=f"{SCRIPTS}/zz_big.s", line=2000)
        perf = ed(z, "editor.perf", line=2000, column=1, count=40)
        print("  打鍵:", perf)
        check(perf["lines"] > 3000 and perf["averageMs"] < 25, f"{perf['lines']} 行の .s で打鍵から描画まで平均 {perf['averageMs']} ms（最大 {perf['maxMs']} ms）")
        ed(z, "editor.closeTab")
        st = ed(z, "editor.state")
        if st["dialogs"]:
            ed(z, "dialog", press="no")
        ed(z, "editor.activate", path=rel)

        # ---- #192 ホバーと補完 ----
        h = ed(z, "editor.hover", line=msg_line, column=col_of(msg, "msgbox"))
        check(h is not None and h["type"] == "command" and "msgbox" in h["plain"], "命令のホバー")
        h = ed(z, "editor.hover", line=msg_line, column=col_of(msg, "gText_ZzHello"), show=True)
        check(h is not None and h["type"] == "string" and "こんにちは" in h["plain"], "文字列の参照のホバーで本文を出す")
        if nd:
            check(h is not None and "今日は" in h["plain"] and "漢字テキスト" in h["plain"], "ND はひらがなと漢字の両方（漢字テキスト）")
        else:
            check(h is not None and "漢字" not in h["plain"], "Chronos は 1 つだけ")
        shot(z, shots, f"{a.name}-hover-string.png")
        ed(z, "editor.closeHover")
        h = ed(z, "editor.hover", line=set_line, column=10)
        check(h is not None and "LASTRESULT" in h["plain"], f"0x800D のホバーに LASTRESULT（{h and h['plain']}）")
        h = ed(z, "editor.hover", line=call_line, column=8)
        check(h is not None and h["type"] == "label" and "setflag" in h["plain"], "ラベルのホバーで定義の先頭の行")

        ed(z, "editor.type", text="\tmsgbox gText_ZzHello ", line=msg_line + 1, column=1)
        c = ed(z, "editor.complete", line=msg_line + 1, column=len("\tmsgbox gText_ZzHello ") + 1, show=True)
        check(c is not None and c["kind"] == "msgType" and "MSG_FACE" in [i["label"] for i in c["items"]] and c["shown"], f"msgbox の 2 つ目は MSG_*（{c and c['items'][:3]}）")
        shot(z, shots, f"{a.name}-complete.png")
        ed(z, "key", key="Escape")
        ed(z, "editor.command", name="undo")
        c = ed(z, "editor.complete", line=msg_line, column=3)
        check(c is not None and c["context"] == "op" and any(i["label"] == "msgbox" for i in c["items"]), "命令名の位置では命令")
        ed(z, "editor.type", text="\tloadpointer 0 gText_Zz", line=msg_line + 1, column=1)
        c = ed(z, "editor.complete", line=msg_line + 1, column=len("\tloadpointer 0 gText_Zz") + 1)
        check(c is not None and c["kind"] == "string" and [i["label"] for i in c["items"]][:3] == ["gText_ZzHello", "gText_ZzHello_k", "gText_ZzOther"], f"loadpointer の 2 つ目は文字列のラベル（{c and c['items'][:3]}）")
        ed(z, "editor.command", name="undo")

        # ---- #193 定義へ移動 ----
        r = ed(z, "editor.definition", line=call_line, column=8, go=True)
        check(r["moved"] and r["active"] == rel and r["cursor"]["line"] == find_line(text, r"^EventScript_ZzSub:")[0], f"同じファイルのラベルへ移る（{r['cursor']}）")
        r = ed(z, "editor.back")
        check(r["moved"] and r["cursor"]["line"] == call_line, "Alt+← で戻る")
        r = ed(z, "editor.definition", line=msg_line, column=col_of(msg, "gText_ZzHello"), go=True)
        check(r["moved"] and r["active"] == "strings/zz_feature.string" and r["cursor"]["line"] == 1, f".string の #org の行へ移る（{r['active']}:{r['cursor']}）")
        ed(z, "editor.back")
        # 別のファイルのラベル（system_scripts.s のラベルを呼ぶ行を足す）
        other = find_line(system, r"^EventScript_[A-Za-z0-9_]+:")
        other_label = other[1].split(":")[0]
        ed(z, "editor.type", text=f"\tcall {other_label}\n", line=msg_line + 1, column=1)
        r = ed(z, "editor.definition", line=msg_line + 1, column=8, go=True)
        check(r["moved"] and r["active"] == f"{SCRIPTS}/system_scripts.s" and r["cursor"]["line"] == other[0], f"別のファイルのラベルへ移る（{r['active']}:{r['cursor']}）")
        ed(z, "editor.back")
        ed(z, "editor.command", name="undo")
        r = ed(z, "editor.definition", line=msg_line, column=3, go=True)
        check(not r["moved"] and "xse_commands.s" in r["message"], f"命令はマクロの場所を下の帯に出す（{r['message']}）")
        ed(z, "editor.type", text="\tgoto NoSuchLabelZz\n", line=msg_line + 1, column=1)
        r = ed(z, "editor.definition", line=msg_line + 1, column=8, go=True)
        check(not r["moved"] and "見つかりません" in r["message"], "見つからなければ下の帯に出す")
        ed(z, "editor.command", name="undo")
        # Ctrl+クリック（定義へ移動）
        r = ed(z, "editor.mouse", line=call_line, column=8, ctrl=True)
        st = ed(z, "editor.state")
        check(st["cursor"]["line"] == find_line(text, r"^EventScript_ZzSub:")[0], f"Ctrl+クリックで定義へ移る（{st['cursor']}）")
        ed(z, "editor.back")

        # ---- #194 検索と置換・矩形選択・複数カーソル・行の移動と複製・コメント ----
        r = ed(z, "editor.search", query="EventScript_ZzSub")
        check(r["open"] and r["count"] == 3, f"検索（{r['count']} 件）")
        shot(z, shots, f"{a.name}-search.png")
        r = ed(z, "editor.search", query=r"set(var|flag)", regexp=True)
        check(r["count"] == 2, f"正規表現で検索（{r['count']} 件）")
        r = ed(z, "editor.search", query="eventscript_zzsub", regexp=False, caseSensitive=True)
        check(r["count"] == 0, "大文字小文字を区別")
        r = ed(z, "editor.search", query="EventScript_ZzSub", caseSensitive=False, replace="EventScript_ZzSub2", action="replaceAll")
        t2 = ed(z, "editor.text")["text"]
        check(t2.count("EventScript_ZzSub2") == 3 and r["dirty"], "すべて置換")
        ed(z, "editor.command", name="undo")
        ed(z, "editor.select", line=1, column=1)
        ed(z, "editor.search", query="lock", wholeWord=True, replace="lockall", action="next")
        r = ed(z, "editor.search", action="replace")
        t2 = ed(z, "editor.text")["text"]
        check("\tlockall\n" in t2 and "\trelease\n" in t2, "単語単位で 1 つ置換")
        ed(z, "editor.command", name="undo")
        ed(z, "editor.search", action="close")

        ed(z, "editor.select", rect={"line": msg_line, "column": 1, "toLine": msg_line + 2, "toColumn": 1})
        ed(z, "editor.type", text="@")
        t2 = ed(z, "editor.text")["text"].split("\n")
        check(all(t2[i - 1].startswith("@\t") for i in range(msg_line, msg_line + 3)), "矩形選択で 3 行に同時に入力")
        ed(z, "editor.command", name="undo")
        ed(z, "editor.mouse", line=msg_line, column=1, toLine=msg_line + 2, toColumn=1, alt=True)
        st = ed(z, "editor.state")
        check(len(st["selection"]) == 3, f"Alt+ドラッグで矩形選択（{len(st['selection'])} 個の範囲）")
        ed(z, "editor.select", line=call_line, column=7, toLine=call_line, toColumn=24)
        ed(z, "editor.command", name="selectNextOccurrence")
        st = ed(z, "editor.state")
        check(len(st["selection"]) == 2 and all(s["text"] == "EventScript_ZzSub" for s in st["selection"]), "Ctrl+D で同じ文字列を選択に足す")
        ed(z, "editor.type", text="EventScript_ZzX")
        check(ed(z, "editor.text")["text"].count("EventScript_ZzX") == 2, "複数カーソルで同時に書き換える")
        ed(z, "editor.command", name="undo")
        ed(z, "editor.select", line=call_line, column=1)
        ed(z, "editor.mouse", line=call_line + 1, column=2, ctrl=False)
        ed(z, "editor.select", line=call_line, column=2)
        ed(z, "editor.select", line=call_line + 1, column=2, add=True)
        st = ed(z, "editor.state")
        check(len(st["selection"]) == 2, "カーソルを足す（複数カーソル）")
        before = ed(z, "editor.text")["text"].split("\n")
        ed(z, "editor.select", line=call_line, column=1)
        ed(z, "editor.key", key="ArrowDown", alt=True)
        after = ed(z, "editor.text")["text"].split("\n")
        check(after[call_line] == before[call_line - 1] and after[call_line - 1] == before[call_line], "Alt+↓ で行を下へ移す")
        ed(z, "editor.command", name="undo")
        ed(z, "editor.select", line=call_line, column=1)
        ed(z, "editor.key", key="ArrowDown", alt=True, shift=True)
        after = ed(z, "editor.text")["text"].split("\n")
        check(after[call_line] == after[call_line - 1] == before[call_line - 1], "Shift+Alt+↓ で行を複製")
        ed(z, "editor.command", name="undo")
        ed(z, "editor.select", line=set_line, column=1)
        ed(z, "editor.key", key="/", ctrl=True)
        after = ed(z, "editor.text")["text"].split("\n")
        check(after[set_line - 1].lstrip().startswith("@"), f"Ctrl+/ で .s は @ のコメント（{after[set_line - 1]!r}）")
        ed(z, "editor.key", key="/", ctrl=True)
        check(ed(z, "editor.text")["text"].split("\n")[set_line - 1] == before[set_line - 1], "もう一度 Ctrl+/ で戻る")
        st = ed(z, "editor.state")
        check(not st["dirty"] or ed(z, "editor.text")["text"] == text, "操作のあとは元の本文")

        # ---- #195 波線 ----
        found: list[str] = []
        for f in sorted((proj / SCRIPTS).glob("*.s")):
            if f.name.startswith("zz_big"):
                continue
            ed(z, "editor.open", path=f"{SCRIPTS}/{f.name}")
            d = ed(z, "editor.diagnostics")["diagnostics"]
            found += [f"{f.name}:{x['line']} {x['message']}" for x in d]
        check(found == [], f"overworld_scripts の .s をすべて開いて、誤った波線が出ない（{found[:5]}）")
        ed(z, "editor.activate", path=rel)
        ed(z, "editor.type", text="\tnosuchcmd 1\n\tgoto\n\tgoto MissingZz\n\tsetflag 1 2\n", line=msg_line + 1, column=1)
        d = ed(z, "editor.diagnostics")["diagnostics"]
        codes = sorted(x["source"] for x in d)
        check(codes == ["missingArgs", "tooManyArgs", "undefinedLabel", "unknownCommand"], f"わざと誤ると波線が出る（{codes}）")
        st = ed(z, "editor.state")
        check(len(st["diagnostics"]) == 4, "editor.state にも波線の一覧")
        shot(z, shots, f"{a.name}-lint.png")
        ed(z, "editor.setText", text=text)
        # ---- #268 組めないマクロの波線（xse_commands.s に setorcopyvar の定義が無ければ giveitem・obtainitem に出る）----
        xse = proj / "xse_commands.s"
        has_setorcopyvar = xse.is_file() and re.search(r"^\s*\.macro\s+setorcopyvar\b", xse.read_text(encoding="utf-8", errors="replace"), re.M) is not None
        ed(z, "editor.type", text="	giveitem 0xD 1 MSG_OBTAIN
	obtainitem 0xD 1
", line=msg_line + 1, column=1)
        d = [x for x in ed(z, "editor.diagnostics")["diagnostics"] if x["source"] == "unassemblableMacro"]
        if has_setorcopyvar:
            check(d == [], f"setorcopyvar が定義されていれば giveitem・obtainitem に波線は出ない（{d}）")
        else:
            check(sorted(x["text"] for x in d) == ["giveitem", "obtainitem"] and all("setorcopyvar" in x["message"] for x in d),
                  f"setorcopyvar が無いと giveitem・obtainitem に組めない波線（{[(x['text'], x['message']) for x in d]}）")
            shot(z, shots, f"{a.name}-macro.png")
        ed(z, "editor.setText", text=text)

        # ---- #196 文字列の本文の編集と幅検査 ----
        before_bytes = feature_str.read_bytes()
        r = ed(z, "editor.stringEdit", label="gText_ZzHello", text="さようなら\\nまたね")
        check(r["path"] == "strings/zz_feature.string" and r["dirty"], "本文を編集すると .string が未保存になる")
        ed(z, "editor.stringEdit", line=msg_line, column=col_of(msg, "gText_ZzHello"), label="gText_ZzHello", open=True)
        shot(z, shots, f"{a.name}-string-edit.png")
        ed(z, "editor.closeHover")
        ed(z, "editor.activate", path="strings/zz_feature.string")
        ed(z, "editor.save")
        after_bytes = feature_str.read_bytes()
        diff = [(x, y) for x, y in zip(before_bytes.decode().split("\n"), after_bytes.decode().split("\n")) if x != y]
        check(diff == [("こんにちは\\nげんきかい？", "さようなら\\nまたね")] and len(before_bytes.split(b"\n")) == len(after_bytes.split(b"\n")), f"差分はそのラベルの本文の行だけ（{diff}）")
        h = ed(z, "editor.hover", line=msg_line, column=col_of(msg, "gText_ZzHello")) if ed(z, "editor.activate", path=rel) else None
        check(h is not None and "さようなら" in h["plain"], "ホバーに編集した本文が出る")
        ed(z, "editor.stringEdit", label="gText_ZzOther", text="あいうえおかきくけこさしすせそたちつてと")
        ed(z, "editor.activate", path="strings/zz_feature.string")
        d = ed(z, "editor.diagnostics")["diagnostics"]
        width = [x for x in d if x["source"] == "textWidth"]
        check(len(width) == 1 and "20 字" in width[0]["message"] and width[0]["line"] == 8, f"18 字を超えた行に印（{width}）")
        shot(z, shots, f"{a.name}-width.png")
        ed(z, "editor.setText", text=feature_str.read_text(encoding="utf-8"))
        ed(z, "editor.save")

        # ---- 補完の候補のテーマ（暗い）と、ウィンドウを閉じる ----
        ed(z, "editor.theme", theme="lightPlus")
        settings = profile / "settings.json"
        time.sleep(0.8)
        check(settings.is_file() and '"scriptEditorTheme": "lightPlus"' in settings.read_text(encoding="utf-8"), "テーマを個人設定（--profile のフォルダ）に残す")
        ed(z, "close")
    print()
    print("失敗:", len(failures))
    for f in failures:
        print("  -", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
