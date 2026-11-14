"""スクリプト連携の写しでの確認（--link。#198・#200・#202・#204・#206・#207・#208）。

写しの ROM とプロジェクトを開き、次を順に確かめる（ND と Chronos の両方）。
1. maps\\scripts.json に新しい .s の行を足し（出力のときに作る行）、マップ 3.0 に人・看板・スクリプトタイルを置くと、
   ラベルが自動で付き、ひな形がすぐ .s と .string に書かれる。元に戻すとひな形が消え、やり直すと戻る。
2. ラベルを変えるコマンドと、その取り消し。
   続けてスクリプトエディタで人のスクリプトを開き（イベントから）、本文に 1 行足して保存し、文字列の本文をその場編集で変え
   （長すぎる本文は字数の幅検査の波線になり、直すと消える。Chronos は保存時に check_text_width.py も動く）、
   F2 と同じラベル名の変更で人のラベルを変えると、イベントのラベルも変わる。
3. 素の ROM の人のスクリプトを読み取り専用で出し（#206）、.s に取り込む（#207）。
4. マップスクリプトの表（#208）を作り、ROM のアドレスのままの行き先があれば 1 つ .s に取り込む（元に戻す・やり直すも）。
5. 出力すると eventscripts・maps\\03\\scripts_00.json・.s・.string ができる。
6. スクリプトエディタのビルドの欄で写しをビルドする（ND は CFRU → DPE へのコピー → DPE、Chronos は build.py）。
7. できた ROM（ND は DPE の test.gba）を開き、マップ 3.0 のイベントのスクリプトの番地が、offsets.ini のラベルの位置と同じ
   （人は名前を変えたあとのラベル）。足した 1 行（nop）がスクリプトの先頭に入り、変えた文字列のラベルも ROM に入る。
   取り込んだスクリプトのバイト列は、ポインタ以外は元の ROM と同じ。
写しのテキストファイル（eventscripts、maps、assembly\\overworld_scripts、strings、zigzagumap.json）は、最後に元へ戻す。
"""
from __future__ import annotations

import pathlib
import re
import time

from .app import Zigzagu
from .fixtures import Fixture
from .guard import require_inside

BANK, MAP = 3, 0
SCRIPT = "assembly/overworld_scripts/zz_link_test.s"
STRINGS = "strings/overworld_strings_zz_link_test.string"
WATCH = ["eventscripts", "zigzagumap.json"]
WATCH_DIRS = ["maps", "assembly/overworld_scripts", "strings"]


class TextSnapshot:
    """写しのテキストファイルを控え、最後に元へ戻す（足したファイルは消す）。"""

    def __init__(self, root: pathlib.Path, copy_root: pathlib.Path):
        self.root = root
        self.copy_root = copy_root
        self.files: dict[pathlib.Path, bytes] = {}
        for rel in WATCH:
            p = root / rel
            if p.is_file():
                self.files[p] = p.read_bytes()
        for d in WATCH_DIRS:
            for p in (root / d).rglob("*"):
                if p.is_file():
                    self.files[p] = p.read_bytes()

    def restore(self) -> int:
        changed = 0
        now = [root_file for d in WATCH_DIRS for root_file in (self.root / d).rglob("*") if root_file.is_file()]
        now += [self.root / r for r in WATCH if (self.root / r).is_file()]
        for p in now:
            require_inside(p, self.copy_root, "戻すファイル")
            if p not in self.files:
                p.unlink()
                changed += 1
            elif p.read_bytes() != self.files[p]:
                p.write_bytes(self.files[p])
                changed += 1
        for p, b in self.files.items():
            if not p.exists():
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(b)
                changed += 1
        return changed


def read_symbols(path: pathlib.Path) -> dict[str, int]:
    out = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"^(\S+):\s+([0-9A-Fa-f]{8})\s*$", line)
        if m:
            out[m.group(1)] = int(m.group(2), 16)
    return out


def _wait_editor(z: Zigzagu, timeout: float = 30) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if any(w["label"] == "script-editor" and w.get("ready") for w in z.call({"cmd": "windows"})):
            return True
        time.sleep(0.1)
    return False


def _person_label(labels: dict, index: int) -> str | None:
    """script.labels の人のうち、番号が index のもののラベル（無ければ None）。"""
    return next((x["label"] for x in labels["person"] if x["index"] == index), None)


def _edit_in_editor(fx: Fixture, z: Zigzagu, proj: pathlib.Path, check, log, npc: str, index: int) -> str:
    """エディタで人のスクリプトの本文と文字列を変え、ラベル名を変える。新しいラベル名を返す。"""
    ed = {"window": "script-editor"}
    r = z.call({"cmd": "script.open", "bank": BANK, "map": MAP, "kind": "person", "index": index})
    check(bool(r.get("opened")) and (r.get("location") or {}).get("label") == npc, f"イベントからエディタでスクリプトを開く（{r.get('location')}）")
    check(_wait_editor(z), "エディタのウィンドウが開く")
    z.call({"cmd": "editor.project", **ed})
    st = z.call({"cmd": "editor.state", **ed})
    lines = z.call({"cmd": "editor.text", **ed})["text"].split("\n")
    at = next((i + 1 for i, l in enumerate(lines) if l.strip() == f"{npc}:"), None)
    check(st.get("active") == SCRIPT and at is not None and st["cursor"]["line"] == at, f"ラベルの行を開く（{st.get('active')} {st.get('cursor')} / {at}）")
    if at is None:
        return npc
    # 本文: ラベルの次の行に nop を足して保存
    z.call({"cmd": "editor.type", "line": at + 1, "column": 1, "text": "\tnop\n", **ed})
    saved = z.call({"cmd": "editor.save", **ed})
    s = (proj / SCRIPT).read_text(encoding="utf-8")
    check(bool(saved.get("saved")) and f"{npc}:\n\tnop\n\tlock\n" in s, "エディタで足した行が保存される")

    # 文字列: その場編集（長すぎる本文は幅検査の波線、直すと消える）
    text_label = f"gText_{npc}"
    z.call({"cmd": "editor.stringEdit", "label": text_label, "text": "あ" * 25, **ed})
    z.call({"cmd": "editor.open", "path": STRINGS, **ed})
    diags = z.call({"cmd": "editor.diagnostics", **ed})
    width = [d for d in diags.get("diagnostics", diags if isinstance(diags, list) else []) if d.get("source") == "textWidth"]
    check(len(width) > 0, f"長すぎる本文は字数の幅検査の波線になる（{len(width)} 件）")
    body = "ジグザグマップの　テストです"
    z.call({"cmd": "editor.stringEdit", "label": text_label, "text": body, **ed})
    diags = z.call({"cmd": "editor.diagnostics", **ed})
    width = [d for d in diags.get("diagnostics", diags if isinstance(diags, list) else []) if d.get("source") == "textWidth"]
    check(len(width) == 0, f"直すと幅検査の波線が消える（{len(width)} 件）")
    z.call({"cmd": "editor.save", **ed})
    st_text = (proj / STRINGS).read_text(encoding="utf-8")
    check(f"#org @{text_label}\n{body}" in st_text.replace("\r\n", "\n"), "その場編集した本文が .string に保存される")
    wc = z.call({"cmd": "editor.widthCheck", "wait": True, **ed})
    if fx.name == "chronos":
        last = wc.get("last") or {}
        check(wc.get("runs", 0) >= 1 and last.get("failed") is None, f"Chronos は保存時に check_text_width.py が動く（終了コード {last.get('exit')}、誤り {len(last.get('errors') or [])} 件）")
        log_lines = z.call({"cmd": "build.log", **ed})["lines"]
        check(any("保存時の幅検査" in l["line"] for l in log_lines), "幅検査の出力がビルドの欄のログに出る")
    else:
        check(wc.get("runs", 0) == 0, "ND は保存時の幅検査のコマンドが無いので動かない")

    # F2 と同じラベル名の変更
    new = f"ZzLinkTest_Hero{index}"
    r = z.call({"cmd": "editor.rename", "from": npc, "to": new, **ed})
    result = r.get("result") or {}
    check(result.get("uses", 0) >= 1, f"ラベル名を変えると、使っているイベントも変わる（{result}）")
    z.call({"cmd": "editor.activate", "path": SCRIPT, **ed})
    z.call({"cmd": "editor.save", **ed})
    labels = z.call({"cmd": "script.labels"})
    check(_person_label(labels, index) == new, f"イベントタブのラベルも新しい名前になる（{_person_label(labels, index)}）")
    s = (proj / SCRIPT).read_text(encoding="utf-8")
    check(f"{new}:" in s and f"{npc}:" not in s, ".s の定義も新しい名前になる")
    z.call({"cmd": "undo"})
    check(_person_label(z.call({"cmd": "script.labels"}), index) == npc, "イベントのラベルの変更はメインの Ctrl+Z で戻せる")
    z.call({"cmd": "redo"})
    check(_person_label(z.call({"cmd": "script.labels"}), index) == new, "やり直すと新しい名前に戻る")
    # エディタを閉じる（開いたままだと、このあとの取り込みはエディタの本文へ書かれ、ディスクには保存するまで出ない）
    closing = z.call({"cmd": "close", **ed})
    check(bool(closing.get("closing")), "未保存のファイルが無いのでエディタを閉じられる")
    t0 = time.time()
    while time.time() - t0 < 10 and any(w["label"] == "script-editor" for w in z.call({"cmd": "windows"})):
        time.sleep(0.2)
    return new


def link_one(fx: Fixture, z: Zigzagu, check, log, timeout: int) -> None:
    proj = fx.project_path
    snap = TextSnapshot(proj, fx.copy_root)
    try:
        _run(fx, z, proj, check, log, timeout)
    finally:
        n = snap.restore()
        log(f"写しのテキストファイルを元に戻しました（{n} 件）")


def _run(fx: Fixture, z: Zigzagu, proj: pathlib.Path, check, log, timeout: int) -> None:
    z.open_fixture(fx)
    z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
    z.call({"cmd": "tab", "name": "event"})
    before = z.call({"cmd": "event.state"})["events"]
    counts = {k: len(before[k]) for k in ("persons", "signs", "traps")}
    log(f"マップ {BANK}.{MAP} のイベント: {counts}")
    original_person = before["persons"][0]["script"] if counts["persons"] > 0 else None

    # 1. .s を作る行と、イベントを置く（ひな形）
    z.call({"cmd": "scripts.table", "action": "add", "entry": {"bank": BANK, "map": MAP, "name": "ZzLinkTest", "script": SCRIPT, "strings": None}, "create": True})
    for kind, x in (("person", 2), ("sign", 3), ("trap", 4)):
        z.call({"cmd": "command", "name": "addEvent", "args": {"bank": BANK, "map": MAP, "kind": kind, "x": x, "y": 2}})
    z.call({"cmd": "script.settle"})
    labels = z.call({"cmd": "script.labels"})
    npc = f"ZzLinkTest_Npc{counts['persons']}"
    sign = f"ZzLinkTest_Sign{counts['signs']}"
    tile = f"ZzLinkTest_Tile{counts['traps']}"
    got = {t: [x["label"] for x in labels[t]] for t in ("person", "sign", "tile")}
    check(npc in got["person"] and sign in got["sign"] and tile in got["tile"], f"置いたイベントに自動のラベルが付く（{got}）")
    s = (proj / SCRIPT).read_text(encoding="utf-8")
    check(all(f"{l}:" in s for l in (npc, sign, tile)), "ひな形がすぐ .s に書かれる")
    check(s.startswith(".text\n.thumb\n.align 2\n"), ".s の先頭は既存の .s と同じ")
    st = (proj / STRINGS).read_text(encoding="utf-8")
    nd = fx.name == "nd"
    check((f"#org @gText_{npc}_k" in st) == nd, f".string のひな形（ND は _k も）: {'あり' if '_k' in st else 'なし'}")
    if nd:
        check(f"msgbox gText_{npc} MSG_FACE gText_{npc}_k" in s, "ND は msgbox に漢字のポインタも書く")
    else:
        check(f"msgbox gText_{npc} MSG_FACE\n" in s, "Chronos は msgbox が 1 ポインタ")
    z.call({"cmd": "undo"})
    z.call({"cmd": "script.settle"})
    check(f"{tile}:" not in (proj / SCRIPT).read_text(encoding="utf-8"), "元に戻すと、手を入れていないひな形は消える")
    z.call({"cmd": "redo"})
    z.call({"cmd": "script.settle"})
    check(f"{tile}:" in (proj / SCRIPT).read_text(encoding="utf-8"), "やり直すとひな形が戻る")

    # 2. ラベルを変えるコマンドと取り消し
    z.call({"cmd": "script.setLabel", "target": "sign", "index": counts["signs"], "label": npc})
    check(z.call({"cmd": "script.labels"})["sign"][-1]["label"] == npc, "ラベルを一覧の別のラベルに変えられる")
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "script.labels"})["sign"][-1]["label"] == sign, "ラベルの変更は元に戻せる")

    # 2b. エディタで本文と文字列を編集し、ラベル名を変える
    npc = _edit_in_editor(fx, z, proj, check, log, npc, counts["persons"])

    # 3. 素の ROM のスクリプトの表示と取り込み（元からいる人 0。ND のベース ROM の人はスクリプトを持たないので、
    #    ベース ROM のいあいぎりのスクリプト 0x08800300 を人 0 に取り込む）
    imported = None
    if original_person is not None:
        source = original_person if original_person >= 0x08000000 else 0x08800300
        req = {"bank": BANK, "map": MAP, "kind": "person", "index": 0, "pointer": source}
        rom = z.call({"cmd": "script.rom", **req})
        check("loadpointer" in (rom.get("text") or "") or "msgbox" in (rom.get("text") or "") or "end" in (rom.get("text") or ""), "読み取り専用のタブに逆アセンブルした文が出る")
        check(rom.get("opened") and "ROM:" in (rom.get("tab") or ""), f"ROM のスクリプトを読み取り専用で出す（{rom.get('tab')}）")
        plan = z.call({"cmd": "script.import", **req})
        z.call({"cmd": "script.settle"})
        imported = plan
        check(plan.get("entryLabel") and plan["entryLabel"] in (proj / SCRIPT).read_text(encoding="utf-8"), f"取り込んだスクリプトが .s に入る（{plan.get('entryLabel')}）")
        if nd and any(i["kind"] == "string" for i in plan["items"]):
            first = next(i["label"] for i in plan["items"] if i["kind"] == "string")
            check(f"#org @{first}_k" in (proj / STRINGS).read_text(encoding="utf-8"), "ND の取り込みは同じ本文の _k も作る")
        check(z.call({"cmd": "script.labels"})["person"][0]["label"] == plan["entryLabel"], "イベントのラベルが取り込んだラベルになる")

    # 4. マップスクリプトの表（場所の設定タブのかんたん表示のパネル）
    z.call({"cmd": "tab", "name": "header"})
    ms = z.call({"cmd": "script.mapScripts", "action": "create"})
    check(ms["ok"] and ms["table"] is not None, f"今のマップスクリプトから表を作れる（{ms['table'] and len(ms['table']['items'])} 件）")
    ms_import = None
    dests = [i["script"] for i in ms["table"]["items"]] + [c["script"] for i in ms["table"]["items"] for c in i["conditions"]] if ms["table"] else []
    dest = next((d for d in dests if d.lower().startswith("0x")), None)
    if dest is not None:
        ptr = int(dest, 16)
        req = {"bank": BANK, "map": MAP, "kind": "map", "pointer": ptr}
        rom = z.call({"cmd": "script.rom", **req})
        check(rom.get("importable"), f"マップスクリプトの行き先 {dest} は取り込める（{rom.get('items') and rom['items'][0]['label']}）")
        ms_import = z.call({"cmd": "script.import", **req})
        z.call({"cmd": "script.settle"})
        label = ms_import.get("entryLabel")
        now = z.call({"cmd": "script.mapScripts", "action": "get"})["table"]
        dests_now = [i["script"] for i in now["items"]] + [c["script"] for i in now["items"] for c in i["conditions"]]
        check(label in dests_now and dest not in dests_now, f"取り込むと、表の行き先 {dest} が {label} になる")
        check(ms_import.get("reused") or f"{label}:" in (proj / SCRIPT).read_text(encoding="utf-8"), f"マップスクリプトの行き先が .s に入る（{label}）")
        z.call({"cmd": "undo"})
        z.call({"cmd": "script.settle"})
        back = z.call({"cmd": "script.mapScripts", "action": "get"})["table"]
        check(back is not None and dest in [i["script"] for i in back["items"]] + [c["script"] for i in back["items"] for c in i["conditions"]],
              "元に戻すと、表の行き先がアドレスに戻る")
        check(ms_import.get("reused") or f"{label}:" not in (proj / SCRIPT).read_text(encoding="utf-8"), "元に戻すと、取り込んだ文も消える")
        z.call({"cmd": "redo"})
        z.call({"cmd": "script.settle"})
        check(f"{label}:" in (proj / SCRIPT).read_text(encoding="utf-8") or ms_import.get("reused"), "やり直すと、取り込んだ文が戻る")
        ms = z.call({"cmd": "script.mapScripts", "action": "get"})
    else:
        log("マップ 3.0 の表にアドレスの行き先が無いので、マップスクリプトの取り込みは確かめません")
    have = {i["type"] for i in ms["table"]["items"]} if ms["table"] else set()
    add_type = next(t for t in (5, 7, 3, 1) if t not in have)
    ms = z.call({"cmd": "script.mapScripts", "action": "add", "type": add_type})
    table = ms["table"]
    added = next((i for i in table["items"] if i["type"] == add_type), None) if table else None
    check(added is not None and added["script"] in (proj / SCRIPT).read_text(encoding="utf-8"), f"種類 {add_type} を足すと、ひな形を書いて行き先にする（{added and added['script']}）")
    z.call({"cmd": "tab", "name": "event"})

    # 5. 出力
    res = z.export()
    written = set(res.get("written", []))
    log(f"出力: {sorted(written)}")
    es = (proj / "eventscripts").read_text(encoding="utf-8")
    check(f"npc {BANK} {MAP} {counts['persons']} {npc}" in es and f"sign {BANK} {MAP} {counts['signs']} {sign}" in es and f"tile {BANK} {MAP} {counts['traps']} {tile}" in es,
          "eventscripts に人・看板・スクリプトタイルの行ができる")
    check(table is None or f"map {BANK} {MAP} {table['label']}" in es, "eventscripts に map の行ができる")
    check((proj / f"maps/{BANK:02d}/scripts_{MAP:02d}.json").is_file(), "maps\\BB\\scripts_MM.json ができる")
    s = (proj / SCRIPT).read_text(encoding="utf-8")
    check(table is None or f"{table['label']}:" in s, ".s にマップスクリプトの表が書かれる")

    # 6. ビルドの欄でビルドする
    z.call({"cmd": "action", "id": "tools.build"})
    t0 = time.time()
    state = None
    while time.time() - t0 < timeout:
        try:
            state = z.call({"cmd": "build.state", "window": "script-editor"}, timeout=30)
            if state and state.get("result") is not None and not state.get("running"):
                break
        except Exception:  # noqa: BLE001  ウィンドウの準備ができるまで
            pass
        time.sleep(2)
    ok = bool(state and state.get("result") and state["result"]["ok"])
    log(f"ビルドの欄: {state and state.get('result')}（手順 {len(state['steps']) if state else '?'}）")
    if not ok and state:
        lines = z.call({"cmd": "build.log", "window": "script-editor"})["lines"]
        for l in lines[-30:]:
            log("  | " + l["line"])
        for p in state.get("problems", [])[:10]:
            log(f"  エラー: {p['path']}:{p['line']} {p['message']}")
    check(ok, "写しでビルドが通る")
    if nd:
        check(state is not None and len(state["steps"]) == 3 and state["steps"][1]["command"] == "copy", "ND は CFRU → DPE へのコピー → DPE を 1 回で行う")
    z.call({"cmd": "close", "window": "script-editor"})
    if not ok:
        return

    # 7. できた ROM のイベントのスクリプトの番地
    sym_path = proj / "offsets.ini"
    symbols = read_symbols(sym_path)
    out_rom = fx.path("NeoDark-DPE-main/test.gba") if nd else fx.path("Chronos/build/Chronos.gba")
    z.call({"cmd": "open", "rom": str(require_inside(out_rom, fx.copy_root, "開く ROM "))})
    z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
    ev = z.call({"cmd": "event.state"})["events"]
    for label, kind, index in ((npc, "persons", counts["persons"]), (sign, "signs", counts["signs"]), (tile, "traps", counts["traps"])):
        e = ev[kind][index]
        ptr = e["script"] if kind != "signs" else e["content"].get("script")
        check(label in symbols and ptr == symbols[label], f"ROM の {kind}[{index}] のスクリプトが {label}（{hex(ptr or 0)} / {hex(symbols.get(label, 0))}）")
    if npc in symbols:
        head = out_rom.read_bytes()[symbols[npc] - 0x08000000: symbols[npc] - 0x08000000 + 2]
        check(head == bytes([0x00, 0x6A]), f"エディタで足した nop がスクリプトの先頭に入る（{head.hex()}、続きは lock）")
    check(f"gText_{npc.replace('ZzLinkTest_Hero', 'ZzLinkTest_Npc')}" in symbols, "その場編集した文字列のラベルが ROM に入る")
    if imported:
        label = imported["entryLabel"]
        check(ev["persons"][0]["script"] == symbols.get(label), f"取り込んだ人 0 のスクリプトが {label} を指す")
        orig = fx.rom_path.read_bytes()
        new = out_rom.read_bytes()
        same = True
        for b in imported["blocks"]:
            addr = symbols.get(b["label"])
            if addr is None:
                same = False
                continue
            a = bytes(orig[b["offset"]:b["offset"] + b["size"]])
            n = bytes(new[addr - 0x08000000: addr - 0x08000000 + b["size"]])
            mask = set()
            for p in b["pointers"]:
                mask.update(range(p, p + 4))
            if any(a[i] != n[i] for i in range(len(a)) if i not in mask):
                same = False
                log(f"  違い: {b['label']} 元 {a.hex()} / 新 {n.hex()}")
        check(same, f"取り込んだスクリプトのバイト列は、ポインタ以外は元と同じ（{len(imported['blocks'])} まとまり）")
    if table:
        check(table["label"] in symbols, f"マップスクリプトの表 {table['label']} が ROM に入る")
        if added:
            check(added["script"] in symbols, f"足したマップスクリプト {added['script']} が ROM に入る")
    if ms_import:
        check(ms_import["entryLabel"] in symbols, f"取り込んだマップスクリプト {ms_import['entryLabel']} が ROM に入る")
