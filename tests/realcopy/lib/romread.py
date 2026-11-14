"""ビルドした ROM の中身（マップの配置とタイルセット）を読む小さな道具（Phase4 の写しのテスト用。読むだけ）。

マップバンク表は、表を引く関数の機械語を探して求める（core の transplant/SourceGame.ts と同じ）。
"""
from __future__ import annotations

import pathlib
import struct

ROM_BASE = 0x08000000
MAP_BANK_CODE = bytes.fromhex("00040904034a800b80180068890b091808687047")


def u32(d: bytes, o: int) -> int:
    return struct.unpack_from("<I", d, o)[0]


def u16s(d: bytes, o: int, n: int) -> list[int]:
    return list(struct.unpack_from(f"<{n}H", d, o))


def lz77(d: bytes, o: int) -> bytes:
    """LZ77（0x10 形式）を展開する。"""
    if d[o] != 0x10:
        raise ValueError(f"LZ77 ではありません: {o:#x}")
    size = d[o + 1] | (d[o + 2] << 8) | (d[o + 3] << 16)
    out = bytearray()
    i = o + 4
    while len(out) < size:
        flags = d[i]
        i += 1
        for bit in range(8):
            if len(out) >= size:
                break
            if flags & (0x80 >> bit):
                n = (d[i] >> 4) + 3
                disp = (((d[i] & 0xF) << 8) | d[i + 1]) + 1
                i += 2
                for _ in range(n):
                    out.append(out[-disp])
            else:
                out.append(d[i])
                i += 1
    return bytes(out)


class BuiltRom:
    def __init__(self, path: pathlib.Path):
        self.d = path.read_bytes()
        at = self.d.find(MAP_BANK_CODE)
        while at >= 0 and at % 2:
            at = self.d.find(MAP_BANK_CODE, at + 1)
        if at < 0:
            raise ValueError("マップバンク表が見つかりません")
        self.bank_table = u32(self.d, ((at + 8) & ~3) + 0x0C) - ROM_BASE

    def header(self, bank: int, map_: int) -> int:
        lst = u32(self.d, self.bank_table + bank * 4) - ROM_BASE
        return u32(self.d, lst + map_ * 4) - ROM_BASE

    def layout(self, bank: int, map_: int) -> dict:
        lay = u32(self.d, self.header(bank, map_)) - ROM_BASE
        w, h = u32(self.d, lay), u32(self.d, lay + 4)
        bw, bh = self.d[lay + 0x18], self.d[lay + 0x19]
        return {
            "width": w,
            "height": h,
            "cells": u16s(self.d, u32(self.d, lay + 0x0C) - ROM_BASE, w * h),
            "border": u16s(self.d, u32(self.d, lay + 0x08) - ROM_BASE, bw * bh),
            "primary": u32(self.d, lay + 0x10),
            "secondary": u32(self.d, lay + 0x14),
        }

    def tileset(self, pointer: int, block_count: int) -> dict:
        at = pointer - ROM_BASE
        tiles_at = u32(self.d, at + 4) - ROM_BASE
        return {
            "compressed": self.d[at] != 0,
            "secondary": self.d[at + 1] != 0,
            "callback": u32(self.d, at + 0x10),
            "tiles": lz77(self.d, tiles_at) if self.d[at] else None,
            "palettes": u16s(self.d, u32(self.d, at + 8) - ROM_BASE, 256),
            "blocks": u16s(self.d, u32(self.d, at + 0x0C) - ROM_BASE, block_count * 8),
            "attributes": list(struct.unpack_from(f"<{block_count}I", self.d, u32(self.d, at + 0x14) - ROM_BASE)),
        }
