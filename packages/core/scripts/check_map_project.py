"""ZigzaguMap が書いた maps\\ を、ビルド側の map_project.py に通して確かめる手元用の検査。

    python -I scripts/check_map_project.py <出力フォルダ> <ベース ROM> <map_project.py> [<map_project.py> ...]

- <出力フォルダ> は maps\\ と assembly\\overworld_scripts\\HiddenItem.s を持つフォルダ（ZigzaguMap の保存先）。
- map_project.py はファイルとして読み込むだけで、そのフォルダには何も書かない。
  ROM はメモリ上（io.BytesIO）で組み立て、ディスクには書かない。
- 落とし物のラベルは HiddenItem.s から拾い、仮のアドレスを渡す（CFRU のリンク結果の代わり）。
- 組み立てた ROM から、各マップ・タイルセット・マップ名・昼の野生を読み戻して JSON と同じかを確かめる。
"""

import base64
import importlib.util
import io
import json
import os
import re
import struct
import sys
from pathlib import Path

ROM_BASE = 0x08000000
MAP_BANK_POINTER = 0x54B0C
DAY_WILD_POINTER = 0x8257C
MAP_NAME_POINTER = 0xC1E78
# CFRU のコードの後ろを想定した、マップを置き始める位置（DPE の 0x1600000 より前）。
ALLOCATION_START = 0x1400000
# 落とし物のスクリプトの仮の位置。
FAKE_SYMBOL_START = 0x13F0000
WILD_SLOT_COUNTS = (12, 5, 5, 10)


def u32(data, at):
    return struct.unpack_from("<I", data, at)[0]


def ptr(data, at):
    value = u32(data, at)
    if value < ROM_BASE or value - ROM_BASE >= len(data):
        raise ValueError(f"pointer at {at:#x} is invalid: {value:#x}")
    return value - ROM_BASE


def b64(source, name):
    return base64.b64decode(source[name])


def lz77(data, at):
    if data[at] != 0x10:
        raise ValueError(f"not LZ77 at {at:#x}")
    size = data[at + 1] | (data[at + 2] << 8) | (data[at + 3] << 16)
    out = bytearray()
    pos = at + 4
    while len(out) < size:
        flags = data[pos]
        pos += 1
        for bit in range(8):
            if len(out) >= size:
                break
            if flags & (0x80 >> bit):
                b1, b2 = data[pos], data[pos + 1]
                pos += 2
                length = (b1 >> 4) + 3
                disp = ((b1 & 0xF) << 8 | b2) + 1
                for _ in range(length):
                    out.append(out[-disp])
            else:
                out.append(data[pos])
                pos += 1
    return bytes(out[:size])


def load_module(path, name):
    # 読み込むだけのフォルダに __pycache__ を作らない。
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def symbols_from_hidden_items(folder):
    path = folder / "assembly" / "overworld_scripts" / "HiddenItem.s"
    symbols = {}
    if path.exists():
        for i, label in enumerate(re.findall(r"(?m)^\.global (\S+)$", path.read_text(encoding="utf-8"))):
            symbols[label] = FAKE_SYMBOL_START + i * 0x20
    return symbols


class Checker:
    def __init__(self, data, folder, symbols, relocations):
        self.data = data
        self.folder = folder
        self.symbols = symbols
        self.relocations = relocations
        self.checked = 0
        self.errors = []

    def expect(self, ok, message):
        self.checked += 1
        if not ok:
            self.errors.append(message)

    def map(self, source):
        data = self.data
        bank, number = source["Bank"], source["Number"]
        tag = f"map {bank}.{number}"
        root = ptr(data, MAP_BANK_POINTER)
        header_at = ptr(data, ptr(data, root + bank * 4) + number * 4)
        header = data[header_at:header_at + 28]
        self.expect(header[0x10:] == b64(source, "Header")[0x10:], f"{tag}: header fields")
        footer_at = ptr(data, header_at)
        footer = data[footer_at:footer_at + 28]
        src_footer = b64(source, "Footer")
        self.expect(footer[0:8] == src_footer[0:8] and footer[24:28] == src_footer[24:28], f"{tag}: footer size")
        layout = b64(source, "Layout")
        border = b64(source, "Border")
        self.expect(data[ptr(data, footer_at + 12):][:len(layout)] == layout, f"{tag}: layout")
        self.expect(data[ptr(data, footer_at + 8):][:len(border)] == border, f"{tag}: border")
        for offset, key in ((16, "PrimaryTileset"), (20, "SecondaryTileset")):
            want = self.relocations.get(source[key], source[key])
            self.expect(u32(data, footer_at + offset) == want, f"{tag}: {key}")

        events = b64(source, "EventHeader")
        if events:
            ev = ptr(data, header_at + 4)
            self.expect(data[ev:ev + 4] == events[0:4], f"{tag}: event counts")
            persons = bytearray(b64(source, "Persons"))
            for item in source.get("ItemBalls", []):
                struct.pack_into("<I", persons, item["PersonIndex"] * 24 + 16, ROM_BASE + self.symbols[item["Label"]])
            for field, name, entries in ((4, "Persons", bytes(persons)), (8, "Warps", None), (12, "Traps", None), (16, "Signs", None)):
                entries = entries if entries is not None else b64(source, name)
                if entries:
                    at = ptr(data, ev + field)
                    self.expect(data[at:at + len(entries)] == entries, f"{tag}: {name}")
        else:
            self.expect(u32(data, header_at + 4) == 0, f"{tag}: no events")

        connections = b64(source, "ConnectionsHeader")
        if connections:
            ch = ptr(data, header_at + 12)
            entries = b64(source, "Connections")
            self.expect(u32(data, ch) == u32(connections, 0), f"{tag}: connection count")
            if entries:
                at = ptr(data, ch + 4)
                self.expect(data[at:at + len(entries)] == entries, f"{tag}: connections")

        scripts = bytearray(b64(source, "MapScripts"))
        if scripts:
            at = ptr(data, header_at + 8)
            for entry in source.get("MapScriptLists", []):
                table = ptr(data, at + entry["TableOffset"])
                body = b64(entry, "Data")
                self.expect(data[table:table + len(body)] == body, f"{tag}: map script table")
                scripts[entry["TableOffset"]:entry["TableOffset"] + 4] = data[at + entry["TableOffset"]:at + entry["TableOffset"] + 4]
            self.expect(data[at:at + len(scripts)] == scripts, f"{tag}: map scripts")

        name = b64(source, "MapName")
        region = header[0x14] - 0x58
        if name and 0 <= region < 109:
            at = ptr(data, ptr(data, MAP_NAME_POINTER) + region * 4)
            self.expect(data[at:at + len(name)] == name, f"{tag}: map name")

        for wild in source.get("Wild", []):
            if wild["Time"] != 1:
                continue
            table = ptr(data, DAY_WILD_POINTER)
            entry = None
            for at in range(table, table + 20 * 600, 20):
                if data[at] == 0xFF and data[at + 1] == 0xFF:
                    break
                if data[at] == bank and data[at + 1] == number:
                    entry = at
                    break
            self.expect(entry is not None, f"{tag}: day wild entry")
            if entry is None:
                continue
            for index, area in enumerate(wild["Areas"]):
                slots = b64(area, "Slots")
                pointer = u32(data, entry + 4 + index * 4)
                if not slots:
                    self.expect(pointer == 0, f"{tag}: wild area {index} empty")
                    continue
                info = pointer - ROM_BASE
                self.expect(data[info] == area["Rate"], f"{tag}: wild area {index} rate")
                at = ptr(data, info + 4)
                self.expect(data[at:at + len(slots)] == slots and len(slots) == WILD_SLOT_COUNTS[index] * 4, f"{tag}: wild area {index} slots")

    def tileset(self, module, folder):
        data = self.data
        source = json.loads((folder / "tileset.json").read_text(encoding="utf-8"))
        tag = f"tileset {folder.name}"
        at = self.relocations[ROM_BASE + source["HeaderAddress"]] - ROM_BASE
        header = data[at:at + 24]
        src_header = b64(source, "Header")
        self.expect(header[0:4] == src_header[0:4] and header[16:20] == src_header[16:20], f"{tag}: header")
        for offset, key in ((8, "Palettes"), (12, "Blocks"), (20, "Behaviors")):
            body = b64(source, key)
            self.expect(data[ptr(data, at + offset):][:len(body)] == body, f"{tag}: {key}")
        image = module._png_tiles(folder / "tiles.png", source["TileCount"])
        tiles_at = ptr(data, at + 4)
        stored = lz77(data, tiles_at) if source["Compressed"] else bytes(data[tiles_at:tiles_at + len(image)])
        self.expect(stored == image, f"{tag}: tiles")
        import hashlib
        self.expect(hashlib.sha256(image).hexdigest().upper() == source["ImageSha256"], f"{tag}: ImageSha256")


def check(folder, rom_path, project_path):
    module = load_module(project_path, f"map_project_{abs(hash(project_path))}")
    base = Path(rom_path).read_bytes()
    symbols = symbols_from_hidden_items(folder)
    cwd = os.getcwd()
    os.chdir(folder)
    try:
        rom = io.BytesIO(base)
        end = module.apply_project(rom, ALLOCATION_START, symbols)
        data = bytearray(rom.getvalue())
        sources = module._read_sources(Path("maps"))
        root_dir = Path("maps")
        probe = io.BytesIO(base)
        probe_data = bytearray(probe.getvalue())
        probe_data.extend(b"\xFF" * (0x2000000 - len(probe_data)))
        relocations = module._place_tilesets(probe_data, module._Allocator(probe_data, ALLOCATION_START), root_dir)
    finally:
        os.chdir(cwd)
    checker = Checker(data, folder, symbols, relocations)
    for source in sources:
        checker.map(source)
    tilesets = folder / "maps" / "tilesets"
    if tilesets.exists():
        for sub in sorted(tilesets.iterdir()):
            if (sub / "tileset.json").exists():
                checker.tileset(module, sub)
    return len(sources), end, checker


def main(argv):
    if len(argv) < 4:
        print(__doc__)
        return 2
    folder = Path(argv[1]).resolve()
    failed = False
    for project_path in argv[3:]:
        count, end, checker = check(folder, argv[2], str(Path(project_path).resolve()))
        status = "OK" if not checker.errors else "NG"
        print(f"[{status}] {project_path}: {count} maps, data end {end:#x}, {checker.checked} checks")
        for error in checker.errors:
            print("  - " + error)
        failed |= bool(checker.errors)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
