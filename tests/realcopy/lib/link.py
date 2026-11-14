"""スクリプト連携の写しでの確認（--link。#198・#200・#202・#204・#206・#207・#208）。

写しの ROM とプロジェクトを開き、次を順に確かめる（ND と Chronos の両方）。
1. maps\\scripts.json に新しい .s の行を足し（出力のときに作る行）、マップ 3.0 に人・看板・スクリプトタイルを置くと、
   ラベルが自動で付き、ひな形がすぐ .s と .string に書かれる。元に戻すとひな形が消え、やり直すと戻る。
2. ラベルを変えるコマンドと、その取り消し。
3. 素の ROM の人のスクリプトを読み取り専用で出し（#206）、.s に取り込む（#207）。
4. マップスクリプトの表（#208）を作る。
5. 出力すると eventscripts・maps\\03\\scripts_00.json・.s・.string ができる。
6. スクリプトエディタのビルドの欄で写しをビルドする（ND は CFRU → DPE へのコピー → DPE、Chronos は build.py）。
7. できた ROM（ND は DPE の test.gba）を開き、マップ 3.0 のイベントのスクリプトの番地が、offsets.ini のラベルの位置と同じ。
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
