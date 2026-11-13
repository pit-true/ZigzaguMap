"""AdvanceMap 本体の言語ファイル（旧）と、ZigzaguMap の文言の基準（新）の対応表。

- 旧: AdvanceMap 1.92 の `Ini/Sprachen/Japanese.ini`（cp932）。AdvanceMap の画面の文言はこれ。
- 新: 改訂版 `Japanese.user.ini`（UTF-8）。ZigzaguMap の画面の文言はこれ。
両方を「セクション名.番号」のキーで対応づけ、AdvanceMap 側で読んだ文字列を新しい文言へ読み替えてから比べる。
新しいファイルの頭の注記（`(AM1.95未使用)`、`(※AM1.95使用不可)` など）は ZigzaguMap 側で取り除かれるので、ここでも取り除く。
同じ旧文言が別々の新文言へ変わる場合（キーによって違う）は、文脈が無いと決められないので読み替えない（食い違いとして残る）。
"""
from __future__ import annotations

import pathlib
import re

_NOTE = re.compile(r"^\s*[（(]\s*※?\s*AM\s*1\.95[^)）]*[)）]\s*")
_ACCEL = re.compile(r"\(&.\)|&(?=.)")


def strip_note(text: str) -> str:
    return _NOTE.sub("", text)


def menu_norm(text: str) -> str:
    """メニュー表記の正規化（アクセスキー `(&X)` と `&` を除く）。"""
    return _ACCEL.sub("", text).strip()


def parse_ini(path: pathlib.Path, encoding: str) -> dict[str, str]:
    """`[セクション]` と `番号=文言` を読み、{"セクション.番号": 文言} を返す。`/` で始まる行は注釈として読み飛ばす。"""
    out: dict[str, str] = {}
    section = ""
    raw = path.read_bytes()
    text = raw.decode(encoding, errors="replace").lstrip("﻿")
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith(("/", ";")):
            continue
        if s.startswith("[") and s.endswith("]"):
            section = s[1:-1]
            continue
        if "=" in s and section:
            k, v = s.split("=", 1)
            out[f"{section}.{k.strip()}"] = v
    return out


class LangMap:
    """旧文言 → 新文言の読み替え。"""

    def __init__(self, old: dict[str, str], new: dict[str, str]):
        self.old = old
        self.new = {k: strip_note(v) for k, v in new.items()}
        self.changed = {k for k in old if k in self.new and old[k] != self.new[k]}
        table: dict[str, set[str]] = {}
        for k in self.changed:
            table.setdefault(self.old[k], set()).add(self.new[k])
        # 旧文言が同じキーの組でも変わらない使われ方をしているなら、読み替えると壊れるので外す
        same = {self.old[k] for k in old if k in self.new and old[k] == self.new[k]}
        self.table = {o: next(iter(n)) for o, n in table.items() if len(n) == 1 and o not in same and o.strip()}
        self.menu_table = {menu_norm(o): menu_norm(n) for o, n in self.table.items()}

    @classmethod
    def load(cls, old_path: pathlib.Path | None, new_path: pathlib.Path | None) -> "LangMap | None":
        if not old_path or not new_path or not old_path.exists() or not new_path.exists():
            return None
        return cls(parse_ini(old_path, "cp932"), parse_ini(new_path, "utf-8"))

    # ------------------------------------------------------------------ キー → 文言
    def old_text(self, key: str) -> str:
        if key not in self.old:
            raise KeyError(f"旧言語ファイルにキー {key} がありません")
        return self.old[key]

    def new_text(self, key: str) -> str:
        if key in self.new:
            return self.new[key]
        return self.old_text(key)

    def key_of_old(self, text: str, section: str | None = None) -> str | None:
        """旧文言からキーを探す（メニュー表記で比べる）。"""
        t = menu_norm(text)
        for k, v in self.old.items():
            if (section is None or k.startswith(section + ".")) and menu_norm(v) == t:
                return k
        return None

    # ------------------------------------------------------------------ 読み替え
    def translate(self, value):
        """AdvanceMap 側の値（文字列・一覧・dict）を新しい文言へ読み替える。表に無い文字列はそのまま。"""
        if isinstance(value, str):
            return self._text(value)
        if isinstance(value, list):
            return [self.translate(v) for v in value]
        if isinstance(value, dict):
            return {self._key(k): self.translate(v) for k, v in value.items()}
        return value

    def _text(self, s: str) -> str:
        if s in self.table:
            return self.table[s]
        m = menu_norm(s)
        if m in self.menu_table:
            return self.menu_table[m]
        return s

    def _key(self, k: str) -> str:
        # menu.state の「ファイル/ROMを開く」のような階層のキーは段ごとに読み替える
        if "/" in k:
            return "/".join(self._text(p) for p in k.split("/"))
        return self._text(k)
