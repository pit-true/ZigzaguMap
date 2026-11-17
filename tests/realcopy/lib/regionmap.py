r"""タウンマップ（maps\regionmap.json）の写しでの往復の確認（--regionmap。#119・#499）。

1. 写しを今のままビルドし、できた ROM を控える（regionmap.json が無いときの ROM）。
2. ワールドマップエディターで、マサラタウン（0x58）の座標・幅/高さ・空を飛ぶの行き先・飛び先、人ID（基本レイヤーの
   0x58 と 0x59、トップレイヤーの 0x7E）、カントーの基本レイヤーのマス 1 つ、1〜3のしまのトップレイヤーのマス 1 つを変えて出力する。
   人ID の欄の注意（このプロジェクトでは、ゲームに反映されません）は、ND では出て、Chronos では出ない。
3. maps\regionmap.json に Layouts（2 件）・Positions・Sizes・FlyDestinations・HealLocations・MapVisitFlags・
   DungeonVisitFlags が書かれる。
4. 写しをビルドすると、ROM の表（ポインタの指す先）が JSON のとおりになり、1 の ROM との違いが表の範囲の中だけ。
   ND は人ID を取り込まず、ビルドのログに「未対応のキー」の注意が出る。Chronos は人ID の表（フックの直後のポインタが指す表）
   が JSON のとおりになり、tools/check_town_map_flags.py（GetMapState / GetCaveState を全部の地名で動かす）が通る。
5. できた ROM だけを開き直し、ワールドマップエディターに同じ値が出る（ND の人ID は元の値のまま）。
写しのテキストファイル（maps など）は、最後に元へ戻す。
"""
from __future__ import annotations

import json
import pathlib
import shutil
import struct
import subprocess
import sys
import time

from .app import Zigzagu
from .builder import build_fixture
from .fixtures import Fixture
from .link import TextSnapshot

ROM_BASE = 0x08000000
LAYOUT_POINTERS = {"kanto": 0xC5378, "sevii123": 0xC5380, "sevii45": 0xC5388, "sevii67": 0xC53B0}
LAYERS = ("map", "dungeon")
CELLS = 22 * 15
POSITION_POINTER, SIZE_POINTER, FLY_POINTER, HEAL_POINTER = 0xC4F20, 0xC4F1C, 0xC648C, 0xC0E94

PALLET = 0x58
NEW_POS = (3, 11)
NEW_SIZE = (2, 1)
NEW_FLY = "030101"  # バンク 3・マップ 1・飛び先 1
NEW_HEAL = (3, 1, 7, 9)  # 飛び先 1: バンク 3・マップ 1・X 7・Y 9
NEW_FLAG = "0899"
CLEARED_FLAG = 0x59        # 基本レイヤーの 0x59 の人ID を FFFF（無し）に
CAVE = (0x7E, "08C3")      # トップレイヤーのトキワのもり（0x7E）の人ID を 0x08C3 に
FLAG_HOOKS = {"MapVisitFlags": 0xC47C0, "DungeonVisitFlags": 0xC4A5C}  # Chronos: フックの直後（+8）に表へのポインタ
KANTO_CELL = (1, 1, 0x6A)  # カントーの基本レイヤーの (1, 1) を 0x6A に
SEVII_CELL = (3, 2, 0xA0)  # 1〜3のしまのトップレイヤーの (3, 2) を 0xA0 に


def _u32(d: bytes, at: int) -> int:
    return struct.unpack_from("<I", d, at)[0]


def _tables(d: bytes) -> dict[str, tuple[int, int]]:
    """表の名前 → (ROM の先頭からの位置, 大きさ)。ポインタをたどる。"""
    out = {}
    for page, p in LAYOUT_POINTERS.items():
        out[f"Layouts {page}"] = (_u32(d, p) - ROM_BASE, CELLS * 2)
    out["Positions"] = (_u32(d, POSITION_POINTER) - ROM_BASE, 110 * 4)
    out["Sizes"] = (_u32(d, SIZE_POINTER) - ROM_BASE, 110 * 4)
    out["FlyDestinations"] = (_u32(d, FLY_POINTER) - ROM_BASE, 108 * 3)
    out["HealLocations"] = (_u32(d, HEAL_POINTER) - ROM_BASE + 8, 20 * 8)
    for key, hook in FLAG_HOOKS.items():
        if d[hook:hook + 4] == bytes((0x00, 0x49, 0x08, 0x47)):
            out[key] = (_u32(d, hook + 8) - ROM_BASE, 110 * 2)
    return out


def expected_mismatches(d: bytes, source: dict) -> list[str]:
    """JSON の表と ROM の表の食い違い（無ければ空）。"""
    t = _tables(d)
    bad = []
    for item in source.get("Layouts", []):
        at = t[f"Layouts {item['Page']}"][0] + LAYERS.index(item["Layer"]) * CELLS
        want = bytes(int(v, 16) for row in item["Rows"] for v in row.split())
        if d[at:at + CELLS] != want:
            bad.append(f"Layouts {item['Page']}/{item['Layer']}")
    for key, fmt, fields, size in (("Positions", "<hh", ("X", "Y"), 4), ("Sizes", "<HH", ("Width", "Height"), 4)):
        if key in source:
            at = t[key][0]
            if d[at:at + 110 * size] != b"".join(struct.pack(fmt, *(e[f] for f in fields)) for e in source[key]):
                bad.append(key)
    if "FlyDestinations" in source:
        at = t["FlyDestinations"][0]
        want = b"".join(bytes((e["Bank"], e["Map"], e["HealLocation"])) for e in source["FlyDestinations"])
        if d[at:at + len(want)] != want:
            bad.append("FlyDestinations")
    for key in FLAG_HOOKS:
        if key in source and key in t:
            at = t[key][0]
            want = [0xFFFF if e["Flag"] is None else int(e["Flag"], 16) for e in source[key]]
            if list(struct.unpack_from("<110H", d, at)) != want:
                bad.append(key)
    if "HealLocations" in source:
        at = t["HealLocations"][0]
        for n, e in enumerate(source["HealLocations"]):
            got = struct.unpack_from("<BBhh", d, at + n * 8)
            unknown = struct.unpack_from("<H", d, at + n * 8 + 6)[0]
            if got != (e["Bank"], e["Map"], e["X"], e["Y"]) or ("Unknown" in e and unknown != e["Unknown"]):
                bad.append(f"HealLocations {n + 1}")
    return bad


def changed_outside(before: bytes, after: bytes) -> tuple[int, list[int]]:
    """違うバイトの数と、表の範囲の外で違う位置（先頭の 10 件）。"""
    ranges = list(_tables(after).values())
    n = 0
    outside = []
    for i in range(min(len(before), len(after))):
        if before[i] != after[i]:
            n += 1
            if not any(a <= i < a + s for a, s in ranges) and len(outside) < 10:
                outside.append(i)
    if len(before) != len(after):
        outside.append(-1)
    return n, outside


def _open_world_map(z: Zigzagu) -> None:
    z.call({"cmd": "action", "id": "tools.worldMap"})
    for _ in range(150):
        wins = {w["label"]: w for w in z.call({"cmd": "windows"})}
        if wins.get("world-map", {}).get("ready"):
            try:
                if z.call({"cmd": "state", "window": "world-map"}).get("loaded"):
                    return
            except Exception:  # noqa: BLE001  準備の途中
                pass
        time.sleep(0.2)
    raise RuntimeError("ワールドマップエディターが開きません")


def _close_world_map(z: Zigzagu) -> None:
    try:
        z.call({"cmd": "close", "window": "world-map"})
    except Exception:  # noqa: BLE001
        return
    for _ in range(50):
        if not any(w["label"] == "world-map" for w in z.call({"cmd": "windows"})):
            return
        time.sleep(0.2)


def _w(z: Zigzagu, req: dict):
    return z.call({**req, "window": "world-map"})


def _value(z: Zigzagu, id_: str) -> str:
    return _w(z, {"cmd": "getField", "id": id_}).get("value", "")


def _pick(z: Zigzagu, x: int, y: int) -> None:
    px, py = 32 + x * 8 + 4, 32 + y * 8 + 4
    for t in ("down", "up"):
        _w(z, {"cmd": "pointer", "id": "WorldmapBox", "type": t, "x": px, "y": py})


def _no_dialog(z: Zigzagu, check, what: str) -> None:
    dialogs = _w(z, {"cmd": "dialogs"}).get("dialogs", [])
    check(not dialogs, f"{what}でダイアログが出ない（{[d.get('text') for d in dialogs]}）")
    for _ in dialogs:
        _w(z, {"cmd": "dialog", "press": "close"})


def _edit(z: Zigzagu, check) -> None:
    """ワールドマップエディターで変えて、メインへ確定する。"""
    _w(z, {"cmd": "setField", "id": "Cbo_Anzahl", "value": 0})
    _w(z, {"cmd": "setField", "id": "Cbo_Wert_NamenListe", "value": PALLET - 0x58})
    for id_, v in (("Txt_PosX", NEW_POS[0]), ("Txt_PosY", NEW_POS[1]), ("Txt_Breite", NEW_SIZE[0]), ("Txt_Hoehe", NEW_SIZE[1])):
        _w(z, {"cmd": "setField", "id": id_, "value": str(v)})
    _w(z, {"cmd": "setField", "id": "Txt_FlugWert", "value": NEW_FLY})
    b, m, x, y = NEW_HEAL
    _w(z, {"cmd": "setField", "id": "Txt_FlugPosWerte",
           "value": f"{b:02X}{m:02X}{x & 0xFF:02X}{x >> 8 & 0xFF:02X}{y & 0xFF:02X}{y >> 8 & 0xFF:02X}"})
    _w(z, {"cmd": "click", "id": "Cmd_NameSpeichern"})
    _no_dialog(z, check, "ポジションの保存")
    _w(z, {"cmd": "setField", "id": "Txt_FlugShowFlag", "value": NEW_FLAG})
    _w(z, {"cmd": "click", "id": "Cmd_SaveFlugShowFlag"})
    _no_dialog(z, check, "フラグの保存")
    _w(z, {"cmd": "setField", "id": "Cbo_Wert_NamenListe", "value": CLEARED_FLAG - 0x58})
    _w(z, {"cmd": "setField", "id": "Txt_FlugShowFlag", "value": "FFFF"})
    _w(z, {"cmd": "click", "id": "Cmd_SaveFlugShowFlag"})
    _no_dialog(z, check, "人ID を FFFF にする保存")
    _w(z, {"cmd": "setField", "id": "Cbo_Wert2_NamenListe", "value": CAVE[0] - 0x58})
    _w(z, {"cmd": "setField", "id": "Txt_FlugShowFlag2", "value": CAVE[1]})
    _w(z, {"cmd": "click", "id": "Cmd_SaveFlugShowFlag2"})
    _no_dialog(z, check, "トップレイヤーの人ID の保存")

    x, y, v = KANTO_CELL
    _pick(z, x, y)
    _w(z, {"cmd": "setField", "id": "Txt_Wert", "value": f"{v:02X}"})
    _w(z, {"cmd": "click", "id": "Cmd_MapSpeichern"})
    _no_dialog(z, check, "カントーのマップの保存")

    _w(z, {"cmd": "setField", "id": "Cbo_Anzahl", "value": 1})
    x, y, v = SEVII_CELL
    _pick(z, x, y)
    _w(z, {"cmd": "setField", "id": "Txt_Wert2", "value": f"{v:02X}"})
    _w(z, {"cmd": "click", "id": "Cmd_MapSpeichern"})
    _no_dialog(z, check, "1〜3のしまのマップの保存")


def _flags_shown(z: Zigzagu) -> tuple[str, str, str]:
    """人ID の欄の値（基本レイヤーの 0x58・0x59、トップレイヤーの 0x7E）。"""
    _w(z, {"cmd": "setField", "id": "Cbo_Wert_NamenListe", "value": PALLET - 0x58})
    a = _value(z, "Txt_FlugShowFlag").upper()
    _w(z, {"cmd": "setField", "id": "Cbo_Wert_NamenListe", "value": CLEARED_FLAG - 0x58})
    b = _value(z, "Txt_FlugShowFlag").upper()
    _w(z, {"cmd": "setField", "id": "Cbo_Wert2_NamenListe", "value": CAVE[0] - 0x58})
    c = _value(z, "Txt_FlugShowFlag2").upper()
    return a, b, c


def _check_editor(z: Zigzagu, check, where: str) -> None:
    """ワールドマップエディターに、変えた値が出るか。"""
    _w(z, {"cmd": "setField", "id": "Cbo_Anzahl", "value": 0})
    _w(z, {"cmd": "setField", "id": "Cbo_Wert_NamenListe", "value": PALLET - 0x58})
    got = tuple(_value(z, i) for i in ("Txt_PosX", "Txt_PosY", "Txt_Breite", "Txt_Hoehe"))
    want = tuple(str(v) for v in NEW_POS + NEW_SIZE)
    check(got == want, f"{where}: マサラタウンの座標・幅/高さ（{got}、期待 {want}）")
    fly = _value(z, "Txt_FlugWert").upper()
    check(fly == NEW_FLY, f"{where}: 空を飛ぶの行き先（{fly}）")
    b, m, x, y = NEW_HEAL
    heal = _value(z, "Txt_FlugPosWerte").upper()
    check(heal == f"{b:02X}{m:02X}{x:02X}00{y:02X}00", f"{where}: 飛び先（{heal}）")
    x, y, v = KANTO_CELL
    _pick(z, x, y)
    cell = _w(z, {"cmd": "state"}).get("cell")
    check(bool(cell) and cell[0] == v, f"{where}: カントーの ({x}, {y}) の基本レイヤー（{cell}）")
    _w(z, {"cmd": "setField", "id": "Cbo_Anzahl", "value": 1})
    x, y, v = SEVII_CELL
    _pick(z, x, y)
    cell = _w(z, {"cmd": "state"}).get("cell")
    check(bool(cell) and cell[1] == v, f"{where}: 1〜3のしまの ({x}, {y}) のトップレイヤー（{cell}）")


def regionmap_one(fx: Fixture, z: Zigzagu, check, log, timeout: int | None, log_dir: pathlib.Path) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    snap = TextSnapshot(fx.project_path, fx.copy_root)
    json_path = fx.project_path / "maps" / "regionmap.json"
    rom_path = fx.path(f"{fx.build.cwd}/{fx.build.output}")
    try:
        check(not json_path.exists(), "写しに maps\\regionmap.json がまだ無い")
        r = build_fixture(fx, log_dir / "before", timeout or 3600)
        log(r.summary())
        check(r.ok, "regionmap.json が無いときのビルドが通る")
        if not r.ok:
            return
        before = rom_path.read_bytes()
        shutil.copyfile(rom_path, log_dir / "before.gba")

        in_game = fx.name == "chronos"   # 人ID をゲームに反映するのは Chronos だけ（#499）
        z.open_fixture(fx)
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})
        _open_world_map(z)
        st = _w(z, {"cmd": "state"})
        check(st.get("visitFlagsInGame") is in_game and st.get("flagNoteShown") is (not in_game),
              f"人ID の欄の注意が{'出ない' if in_game else '出る'}（{st.get('visitFlagsInGame')}、{st.get('flagNoteShown')}）")
        _edit(z, check)
        _close_world_map(z)
        z.export()
        check(json_path.exists(), "出力で maps\\regionmap.json ができる")
        if not json_path.exists():
            return
        source = json.loads(json_path.read_text(encoding="utf-8"))
        keys = sorted(k for k in source if k != "Format")
        log(f"regionmap.json のキー: {keys}")
        check(keys == sorted(["Layouts", "Positions", "Sizes", "FlyDestinations", "HealLocations", "MapVisitFlags", "DungeonVisitFlags"]),
              "変えた表（Layouts・Positions・Sizes・FlyDestinations・HealLocations・MapVisitFlags・DungeonVisitFlags）が書かれる")
        flags = {e["Id"]: e["Flag"] for e in source.get("MapVisitFlags", [])}
        caves = {e["Id"]: e["Flag"] for e in source.get("DungeonVisitFlags", [])}
        check(flags.get("0x58") == "0x" + NEW_FLAG and flags.get(f"0x{CLEARED_FLAG:02X}") is None
              and caves.get(f"0x{CAVE[0]:02X}") == "0x" + CAVE[1], "人ID の変更（0x58・0x59・トップレイヤーの 0x7E）が書かれる")
        check(sorted((e["Page"], e["Layer"]) for e in source.get("Layouts", [])) == [("kanto", "map"), ("sevii123", "dungeon")],
              "Layouts はカントーの基本レイヤーと 1〜3のしまのトップレイヤーの 2 件")

        r = build_fixture(fx, log_dir / "after", timeout or 3600)
        log(r.summary())
        check(r.ok, "regionmap.json があるときのビルドが通る")
        if not r.ok:
            return
        text = r.log.read_text(encoding="utf-8", errors="replace")
        if in_game:
            check("未対応のキー" not in text, "ビルドのログに人ID の注意が出ない（Chronos は取り込む）")
        else:
            check("MapVisitFlags は未対応のキーです" in text, "ビルドのログに人ID（MapVisitFlags）の注意が出る")
        check("Wrote the town map tables from maps/regionmap.json" in text, "ビルドのログに取り込んだ表が出る")
        after = rom_path.read_bytes()
        shutil.copyfile(rom_path, log_dir / "after.gba")
        bad = expected_mismatches(after, source)
        check(not bad, f"ROM の表が regionmap.json のとおり（食い違い: {bad}）")
        check(_tables(before) == _tables(after), "表を指すポインタは変わらない")
        n, outside = changed_outside(before, after)
        check(n > 0 and not outside, f"regionmap.json の有無で違うのは表の範囲だけ（{n} バイト、範囲の外: {[hex(i) for i in outside]}）")
        check(before[0xC47C0:0xC5348] == after[0xC47C0:0xC5348], "人ID の関数（GetMapState・GetCaveState とフック）は変わらない")
        if in_game:
            tool = fx.path(f"{fx.build.cwd}/tools/check_town_map_flags.py")
            r2 = subprocess.run([sys.executable, str(tool), "--vanilla", str(fx.path(fx.rom)), "--rom", str(rom_path),
                                 "--json", str(json_path)], capture_output=True, text=True, encoding="utf-8", errors="replace")
            log(r2.stdout.strip().splitlines()[-1] if r2.stdout.strip() else r2.stderr.strip()[-200:])
            check(r2.returncode == 0, "GetMapState・GetCaveState が全部の地名で JSON の人ID のとおりに動く（check_town_map_flags.py）")

        # できた ROM だけを開き直す（プロジェクトの regionmap.json を重ねずに ROM の表を読む）
        z.open(rom_path, None)
        z.call({"cmd": "selectMap", "bank": 3, "map": 0})
        _open_world_map(z)
        _check_editor(z, check, "できた ROM を開き直したワールドマップエディター")
        _w(z, {"cmd": "setField", "id": "Cbo_Anzahl", "value": 0})
        _w(z, {"cmd": "setField", "id": "Cbo_Wert_NamenListe", "value": PALLET - 0x58})
        shown = _flags_shown(z)
        if in_game:
            check(shown == (NEW_FLAG, "FFFF", CAVE[1]), f"開き直すと人ID が同じ（{shown}）")
        else:
            check(shown[0] != NEW_FLAG and shown[2] != CAVE[1], f"人ID は取り込まれず元の値のまま（{shown}）")
        _close_world_map(z)
    finally:
        changed = snap.restore()
        log(f"写しのテキストファイルを元に戻した（{changed} 件）")
