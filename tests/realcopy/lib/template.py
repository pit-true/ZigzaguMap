"""イベントのひな形の写しでの確認（--template。#227・#243・#244・#245）。

写しの ROM とプロジェクトを開き、次を順に確かめる（ND と Chronos の両方）。
1. 使われている番号の索引（#227）を作り終え、未使用の最小のフラグ・変数・隠しアイテムの番号が、索引のどこにも出てこない。
   「未使用」ボタンで人のフラグとスクリプトタイルの変数を入れると、その値になる（元に戻せる）。
2. maps\\scripts.json に新しい .s の行を足し、マップ 3.0 にひな形を 1 つずつ置く（人・看板・スクリプトタイル・落とし物（看板と
   見えるボール）・アイテムをくれる人・ショップ・トレーナー（既存の番号と、#245 の新しいトレーナー））。
   置くたびにイベント・ラベル・.s・.string（ND は _k も）が増え、1 回の元に戻すで全部消え、やり直すと戻る。
3. 出力してビルドする（ND は CFRU → DPE、Chronos は build.py）。
4. できた ROM で、置いたイベントのスクリプトの番地が offsets.ini のラベルの位置と同じで、スクリプトの中身
   （checkflag のフラグ、mart の品物、trainerbattle の番号）と、隠しアイテムの看板の中身が置いたとおり。
   トレーナーの表（#245）は trainers.json のとおりで、ほかの行は元の ROM と同じ。
写しのテキストファイルは最後に元へ戻す。
"""
from __future__ import annotations

import json
import pathlib
import re
import struct
import time

from .app import Zigzagu
from .builder import build_fixture, build_nd_dpe
from .fixtures import Fixture
from .guard import require_inside
from .link import TextSnapshot, read_symbols

BANK, MAP = 3, 0
SCRIPT = "assembly/overworld_scripts/zz_template_test.s"
STRINGS = "strings/overworld_strings_zz_template_test.string"
SHOTS = pathlib.Path(r"D:\zigzagu-build\p3-shots")

# 置くひな形（種類、マス、入力）。マップ 3.0 の空いているあたり
PLACES = [
    ("person", (6, 4), {"graphicsId": 16}),
    ("sign", (7, 4), {}),
    ("tile", (8, 4), {}),
    ("hiddenItem", (9, 4), {"item": 13, "amount": 1}),
    ("hiddenItem", (10, 4), {"item": 4, "ball": True}),
    ("itemGiver", (11, 4), {"item": 13, "amount": 2}),
    ("mart", (12, 4), {"martItems": [4, 13, 17]}),
]


def _shot(z: Zigzagu, name: str) -> None:
    import base64

    try:
        SHOTS.mkdir(parents=True, exist_ok=True)
        png = z.call({"cmd": "screenshot"})
        (SHOTS / name).write_bytes(base64.b64decode(png if isinstance(png, str) else png["png"]))
    except Exception:  # noqa: BLE001  画像は確認の助けなので、撮れなくても続ける
        pass


def template_one(fx: Fixture, z: Zigzagu, check, log, timeout: int, extra=None) -> None:
    extra = extra or TrainerExtra()
    proj = fx.project_path
    snap = TextSnapshot(proj, fx.copy_root)
    trainers_json = proj / "maps" / "trainers.json"
    trainers_before = trainers_json.read_bytes() if trainers_json.is_file() else None
    try:
        _run(fx, z, proj, check, log, timeout, extra)
    finally:
        n = snap.restore()
        if trainers_before is None and trainers_json.exists():
            trainers_json.unlink()
        log(f"写しのテキストファイルを元に戻しました（{n} 件）")


def _counts(z: Zigzagu) -> dict:
    ev = z.call({"cmd": "event.state"})["events"]
    return {k: len(ev[k]) for k in ("persons", "signs", "traps")}


def _run(fx: Fixture, z: Zigzagu, proj: pathlib.Path, check, log, timeout: int, extra) -> None:
    nd = fx.name == "nd"
    z.open_fixture(fx)
    z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
    z.call({"cmd": "tab", "name": "event"})

    # 1. 索引（#227）
    st = z.call({"cmd": "usage.state", "wait": True}, timeout=300)
    check(st["ready"] and st["error"] is None, f"使われている番号の索引を作り終える（{st['stats']}）")
    nexts = {}
    for kind in ("flag", "var", "hiddenItem", "trainer"):
        v = z.call({"cmd": "usage.next", "kind": kind})["value"]
        nexts[kind] = v
        sites = z.call({"cmd": "usage.find", "kind": kind, "value": v})["sites"] if v is not None else []
        check(v is not None and sites == [], f"未使用の最小の {kind} は {hex(v) if v is not None else None} で、使っている場所が無い")
    _cross_check(fx, proj, nexts, check, log)

    # 2. ひな形
    z.call({"cmd": "scripts.table", "action": "add", "entry": {"bank": BANK, "map": MAP, "name": "ZzTemplate", "script": SCRIPT, "strings": None}, "create": True})
    placed = []
    for kind, (x, y), values in PLACES + (extra.places(z, nexts) if extra else []):
        before = _counts(z)
        r = z.call({"cmd": "template.place", "kind": kind, "x": x, "y": y, "values": values}, timeout=120)
        z.call({"cmd": "script.settle"})
        after = _counts(z)
        key = {"person": "persons", "sign": "signs", "trap": "traps"}[r["event"]["kind"]]
        check(after[key] == before[key] + 1, f"{kind}: {key} が 1 つ増える（{r['event']}、ラベル {r['label']}）")
        s = (proj / SCRIPT).read_text(encoding="utf-8") if (proj / SCRIPT).is_file() else ""
        st_text = (proj / STRINGS).read_text(encoding="utf-8") if (proj / STRINGS).is_file() else ""
        if r["label"]:
            check(f"{r['label']}:" in s, f"{kind}: .s に {r['label']} が書かれる")
            check(("_k\n" in st_text) == nd or kind == "mart", f"{kind}: .string（ND は _k も）")
            if not nd:
                check(f".global {r['label']}" in s, f"{kind}: Chronos は .global を付ける")
        if kind == "itemGiver" and r["label"]:
            # obtainitem は、写しの xse_commands.s で setorcopyvar が定義されていて組めるときだけ使う（#268）
            body = s.split(f"{r['label']}:", 1)[1].split(f"{r['label']}_After:", 1)[0]
            xse = (proj / "xse_commands.s").read_text(encoding="utf-8", errors="replace")
            macro = re.search(r"^\s*\.macro\s+setorcopyvar\b", xse, re.MULTILINE | re.IGNORECASE) is not None
            used = "obtainitem" if "\tobtainitem " in body else "setvarifnotzero" if "\tsetvarifnotzero 0x8000 " in body else None
            check(used == ("obtainitem" if macro else "setvarifnotzero"), f"itemGiver: setorcopyvar が{'ある' if macro else '無い'}ので {used} で書く")
        placed.append((kind, values, r))
    shot_kind = placed[-1][0]
    _shot(z, f"template-1-placed-{fx.name}.png")
    log(f"置いた: {[(k, r['label'], r['event']) for k, _, r in placed]}（最後は {shot_kind}）")

    # 元に戻す・やり直す（最後に置いたもの）
    kind, _, last = placed[-1]
    before = _counts(z)
    z.call({"cmd": "undo"})
    z.call({"cmd": "script.settle"})
    s = (proj / SCRIPT).read_text(encoding="utf-8")
    key = {"person": "persons", "sign": "signs", "trap": "traps"}[last["event"]["kind"]]
    check(_counts(z)[key] == before[key] - 1 and (not last["label"] or f"{last['label']}:" not in s), f"1 回の元に戻すで {kind} のイベントとスクリプトが消える")
    z.call({"cmd": "redo"})
    z.call({"cmd": "script.settle"})
    s = (proj / SCRIPT).read_text(encoding="utf-8")
    check(_counts(z)[key] == before[key] and (not last["label"] or f"{last['label']}:" in s), "やり直すと戻る")

    # 「未使用」ボタン（#227）: 置いた人のフラグとスクリプトタイルの変数
    person = next(r for k, _, r in placed if k == "person")
    z.call({"cmd": "event.select", "kind": "person", "index": person["event"]["index"]})
    expected = z.call({"cmd": "usage.next", "kind": "flag"})["value"]
    z.call({"cmd": "click", "id": "event.person.flagUnused"})
    time.sleep(0.8)
    flag_now = z.call({"cmd": "event.state"})["events"]["persons"][person["event"]["index"]]["flag"]
    check(flag_now == expected, f"人の「未使用」ボタンで未使用の最小のフラグが入る（{hex(flag_now)} / {hex(expected)}）")
    person_flag = flag_now
    z.call({"cmd": "undo"})
    check(z.call({"cmd": "event.state"})["events"]["persons"][person["event"]["index"]]["flag"] == 0, "「未使用」ボタンで入れた値は元に戻せる")
    z.call({"cmd": "redo"})
    tile = next(r for k, _, r in placed if k == "tile")
    z.call({"cmd": "event.select", "kind": "trap", "index": tile["event"]["index"]})
    old_var = z.call({"cmd": "event.state"})["events"]["traps"][tile["event"]["index"]]["variable"]
    z.call({"cmd": "click", "id": "event.trap.variableUnused"})
    time.sleep(0.8)
    new_var = z.call({"cmd": "event.state"})["events"]["traps"][tile["event"]["index"]]["variable"]
    check(new_var != old_var and new_var >= 0x4034, f"スクリプトタイルの「未使用」ボタンで、置いたときと別の未使用の変数になる（{hex(old_var)} → {hex(new_var)}）")
    _shot(z, f"template-2-unused-button-{fx.name}.png")

    # 窓（#243）のスクリーンショット
    z.call({"cmd": "mouse", "target": "event", "cell": [13, 6], "action": "rightClick"})
    menu = z.call({"cmd": "contextMenu.state"})
    check(bool(menu) and any(i["id"] == "placeTemplate" for i in menu["items"]), "空いているマスの右クリックで「ここにひな形を置く」が出る")
    z.call({"cmd": "contextMenu.press", "id": "placeTemplate"})
    time.sleep(1.0)
    z.call({"cmd": "setField", "id": "template.kind", "value": "アイテムをくれる人"})
    time.sleep(1.0)
    _shot(z, f"template-3-picker-{fx.name}.png")
    z.call({"cmd": "dialog", "press": "cancel"})

    # 3. 出力とビルド
    res = z.export()
    log(f"出力: {sorted(res.get('written', []))}")
    if extra:
        extra.after_export(z, proj, check, log)
    es = (proj / "eventscripts").read_text(encoding="utf-8")
    for kind, _, r in placed:
        if not r["label"]:
            continue
        sym = r["label"][len("EventScript_"):] if kind == "trainer" else r["label"]
        etype = {"person": "npc", "sign": "sign", "trap": "tile"}[r["event"]["kind"]]
        if kind == "trainer":
            etype = "trainer"
        check(f"{etype} {BANK} {MAP} {r['event']['index']} {sym}" in es, f"eventscripts に {kind} の行（{etype} … {sym}）")
    log_dir = fx.copy_root / "logs" / time.strftime("%Y%m%d-%H%M%S") / f"template-{fx.name}"
    b = build_fixture(fx, log_dir, timeout)
    log(b.summary())
    check(b.ok, "写しでビルドが通る")
    if not b.ok:
        return
    out_rom = b.output
    if nd and "dpe" in fx.extra_builds:
        b2 = build_nd_dpe(fx, log_dir, timeout)
        log(b2.summary())
        check(b2.ok, "ND の DPE のビルドも通る")
        if b2.ok:
            out_rom = b2.output

    # 4. できた ROM
    symbols = read_symbols(proj / "offsets.ini")
    rom = out_rom.read_bytes()
    z.call({"cmd": "open", "rom": str(require_inside(out_rom, fx.copy_root, "開く ROM "))})
    z.call({"cmd": "selectMap", "bank": BANK, "map": MAP})
    ev = z.call({"cmd": "event.state"})["events"]
    for kind, values, r in placed:
        e = r["event"]
        lst = {"person": "persons", "sign": "signs", "trap": "traps"}[e["kind"]]
        item = ev[lst][e["index"]]
        if kind == "hiddenItem" and not values.get("ball"):
            c = item["content"]
            check(item["kind"] == 7 and c.get("item") == values["item"] and c.get("flag") == r["values"]["hiddenId"],
                  f"隠しアイテムの看板が ROM に入る（{item['kind']}、{c}）")
            continue
        if kind == "hiddenItem":
            check(item["graphicsId"] == 92 and item["flag"] == r["values"]["flag"], f"見えるボールの人（見た目 92、フラグ {hex(r['values']['flag'])}）")
            continue
        ptr = item["script"] if e["kind"] != "sign" else item["content"].get("script")
        label = r["label"]
        check(label in symbols and ptr == symbols[label], f"{kind}: ROM のスクリプトが {label}（{hex(ptr or 0)} / {hex(symbols.get(label, 0))}）")
        if label not in symbols:
            continue
        at = symbols[label] - 0x08000000
        if kind == "itemGiver":
            flag = r["values"]["flag"]
            check(rom[at:at + 5] == bytes([0x6A, 0x5A, 0x2B, flag & 0xFF, flag >> 8]), f"アイテムをくれる人: lock faceplayer checkflag {hex(flag)}（{rom[at:at + 5].hex()}）")
        if kind == "mart":
            mart = symbols.get(f"{label}_Mart1")
            items = []
            if mart:
                o = mart - 0x08000000
                while True:
                    (v,) = struct.unpack_from("<H", rom, o)
                    if v == 0:
                        break
                    items.append(v)
                    o += 2
            check(items == values["martItems"], f"ショップの品物が ROM に入る（{items}）")
            check(rom[at:at + 3] == bytes([0x6A, 0x5A, 0x86]), f"ショップ: lock faceplayer mart（{rom[at:at + 3].hex()}）")
        if kind == "person":
            check(item["flag"] == person_flag, f"「未使用」ボタンで入れた人のフラグ {hex(person_flag)} が出力され ROM に入る（{hex(item['flag'])}）")
        if kind == "trainer":
            tid = r["values"]["newTrainer"]["id"] if r["values"].get("newTrainer") else r["values"]["trainerId"]
            check(rom[at] == 0x5C and rom[at + 1] == 0 and struct.unpack_from("<H", rom, at + 2)[0] == tid, f"トレーナー: trainerbattle 0 {tid}（{rom[at:at + 4].hex()}）")
            check(item["trainerType"] == 1 and item["trainerRangeOrBerryTree"] == r["values"]["sight"], f"トレーナーの人: 種類 1、視界 {r['values']['sight']}")
    if extra:
        extra.check_rom(fx, rom, check, log)


def _cross_check(fx: Fixture, proj: pathlib.Path, nexts: dict, check, log) -> None:
    """未使用のフラグ・変数が、.s と C に（数でも名前でも）出てこないことを、索引と別の読み方で確かめる。"""
    flag, var = nexts["flag"], nexts["var"]
    pats = {
        "flag": re.compile(rf"\b(?:setflag|clearflag|checkflag)\s+(?:0x0*{flag:x}|{flag})\b", re.IGNORECASE),
        "var": re.compile(rf"\b(?:setvar|addvar|subvar|copyvar|compare)\s+(?:0x0*{var:x}|{var})\b", re.IGNORECASE),
    }
    hits = {"flag": [], "var": []}
    for p in (proj / "assembly").rglob("*.s"):
        text = p.read_text(encoding="utf-8", errors="replace")
        for k, pat in pats.items():
            if pat.search(text):
                hits[k].append(str(p.relative_to(proj)))
    defs = {"flag": re.compile(rf"#define\s+(FLAG_\w+)\s+\(?0x0*{flag:x}\)?\b", re.IGNORECASE), "var": re.compile(rf"#define\s+(VAR_\w+)\s+\(?0x0*{var:x}\)?\b", re.IGNORECASE)}
    names = {"flag": [], "var": []}
    for h in (proj / "include/constants/flags.h", proj / "include/constants/vars.h"):
        if h.is_file():
            t = h.read_text(encoding="utf-8", errors="replace")
            for k, d in defs.items():
                names[k] += d.findall(t)
    used_in_c = {"flag": [], "var": []}
    for p in list((proj / "src").rglob("*.[ch]")) + list((proj / "include").rglob("*.h")):
        if p.name in ("flags.h", "vars.h"):
            continue
        t = p.read_text(encoding="utf-8", errors="replace")
        for k in names:
            for n in names[k]:
                if re.search(rf"\b{n}\b", t):
                    used_in_c[k].append(f"{p.relative_to(proj)}:{n}")
    for k in ("flag", "var"):
        check(not hits[k] and not used_in_c[k], f"未使用の {k} {hex(nexts[k])} は .s にも C にも出てこない（.s {hits[k][:3]}、C {used_in_c[k][:3]}、定義名 {names[k][:3]}）")


class TrainerExtra:
    """トレーナー（#244 の既存の番号、#245 の新しいトレーナーと trainers.json）を足す確認。"""

    def __init__(self):
        self.new = None
        self.existing = None

    def places(self, z: Zigzagu, nexts: dict) -> list:
        lst = z.call({"cmd": "trainer.list"}, timeout=120)
        free = [t for t in lst if t["uses"] == 0 and t["partySize"] > 0 and not t["edited"]]
        self.existing = free[0]["id"]
        new_id = next(t["id"] for t in lst if t["uses"] == 0 and t["id"] != self.existing)
        gen = z.call({"cmd": "trainer.generate", "bank": BANK, "map": MAP, "seed": 12345})
        party = gen["party"] or [{"iv": 0, "level": 5, "species": 16}]
        base = z.call({"cmd": "trainer.get", "id": self.existing})
        self.new = {
            "id": new_id, "partyFlags": 0, "trainerClass": base["trainerClass"], "music": base["music"], "female": base["female"],
            "pic": base["pic"], "name": "タロウ", "items": [0, 0, 0, 0], "doubleBattle": False, "aiFlags": base["aiFlags"], "party": party,
        }
        self.gen = gen
        return [("trainer", (14, 4), {"trainerId": self.existing, "sight": 4}), ("trainer", (15, 4), {"newTrainer": self.new})]

    def after_export(self, z: Zigzagu, proj: pathlib.Path, check, log) -> None:
        log(f"自動生成（種 12345、マップ {self.gen['maps']}）: {self.gen['party']}")
        path = proj / "maps" / "trainers.json"
        check(path.is_file(), "出力で maps\trainers.json ができる")
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            t = data["Trainers"][0] if data.get("Trainers") else {}
            check(data.get("Format") == 1 and t.get("Id") == self.new["id"] and t.get("Name") == self.new["name"]
                  and [(m["Species"], m["Level"]) for m in t.get("Party", [])] == [(m["species"], m["level"]) for m in self.new["party"]],
                  f"trainers.json に新しいトレーナー {self.new['id']} が書かれる")
            check(b"\r\n" in path.read_bytes(), "trainers.json は CRLF")

    def check_rom(self, fx: Fixture, rom: bytes, check, log) -> None:
        base = fx.rom_path.read_bytes()
        tb = struct.unpack_from("<I", base, 0xF5C0)[0] - 0x08000000
        to = struct.unpack_from("<I", rom, 0xF5C0)[0] - 0x08000000
        check(tb == to, f"トレーナーの表の位置は変わらない（{hex(tb + 0x08000000)}）")
        nid = self.new["id"]
        e = rom[to + nid * 0x20: to + nid * 0x20 + 0x20]
        party_at = struct.unpack_from("<I", e, 0x1C)[0] - 0x08000000
        party = [struct.unpack_from("<HHH", rom, party_at + i * 8) for i in range(e[0x18])]
        check(e[1] == self.new["trainerClass"] and e[3] == self.new["pic"] and e[0x18] == len(self.new["party"])
              and [(p[2], p[1]) for p in party] == [(m["species"], m["level"]) for m in self.new["party"]],
              f"ROM のトレーナー {nid} が trainers.json のとおり（クラス {e[1]}、絵 {e[3]}、手持ち {[(p[2], p[1]) for p in party]}）")
        check(e[4] != 0xFF and 0xFF in e[4:10], f"名前が書かれる（{e[4:10].hex()}）")
        others = [i for i in range(743) if i != nid and rom[to + i * 0x20: to + i * 0x20 + 0x20] != base[tb + i * 0x20: tb + i * 0x20 + 0x20]]
        check(not others, f"ほかのトレーナーの行は元の ROM と同じ（違う行 {others[:5]}）")
