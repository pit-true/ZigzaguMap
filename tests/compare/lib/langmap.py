"""AdvanceMap 本体の言語ファイル（旧）と、ZigzaguMap の文言の基準（新）の対応表。

- 旧: AdvanceMap 1.92 の `Ini/Sprachen/Japanese.ini`（cp932）。AdvanceMap の画面の文言はこれ。
- 新: 改訂版 `Japanese.ini`（UTF-8）に補正用の `overrides.ini` を重ねたもの（scripts/gen-i18n.mjs と同じ規則）。ZigzaguMap の画面の文言はこれ。
両方を「セクション名.番号」のキーで対応づけ、AdvanceMap 側で読んだ文字列を新しい文言へ読み替えてから比べる。
新しいファイルの注記（`(AM1.95未使用)`、`(※AM1.95使用不可)` など）と行末の空白は ZigzaguMap 側で取り除かれるので、ここでも取り除く。
同じ旧文言が別々の新文言へ変わる場合（キーによって違う）は、文脈が無いと決められないので読み替えない（食い違いとして残る）。
"""
from __future__ import annotations

import pathlib
import re

from .normalize import norm_text

_NOTE = re.compile(r"[(（]※?AM\d+(?:\.\d+)*(?:未使用|使用不可)[)）]")
_ACCEL = re.compile(r"\(&.\)|&(?=.)")


def strip_note(text: str) -> str:
    """画面に出す値（gen-i18n.mjs の displayValue と同じ。注記を全部外し、行末の空白を外す）。"""
    return _NOTE.sub("", text).rstrip(" \t")


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
        if not s or s.startswith(";"):
            continue
        if s.startswith("[") and s.endswith("]"):
            section = s[1:-1]
            continue
        if "=" in s and section:
            k, v = s.split("=", 1)
            out[f"{section}.{k.strip()}"] = v
    return out


# 改訂版でキーが変わった文言（旧キー → 新キー）。フォームの題名は、改訂版で各節の `Title` に移った。
ALIASES = {
    "NewMapForm.21": "NewMapForm.Title",
    "MapEinfuegenForm.15": "MapEinfuegenForm.Title",
    "PalettenForm.Titel": "PalettenForm.Title",
    "WorldMapEditor.Titel": "WorldMapEditor.Title",
}


# 旧版では複数のキーの文言をつないで作り、改訂版では 1 つのキーの書式（%d）にした文言。{キー} は旧版の文言、%d は値
COMPOSED = [
    ("{AnbindungsForm.13680} %d{AnbindungsForm.13681}", "AnbindungsForm.13680"),
    ("{Header.9333} %d {Header.9334} %d", "Header.9333"),
    ("{MapEinfuegenForm.54} %d.%d {MapEinfuegenForm.55}", "MapEinfuegenForm.54"),
]


class LangMap:
    """旧文言 → 新文言の読み替え。"""

    def __init__(self, old: dict[str, str], new: dict[str, str]):
        self.old = old
        self.new = {k: strip_note(v) for k, v in new.items()}
        for o, n in ALIASES.items():
            if n in self.new:
                self.new[o] = self.new[n]
        # 同じ旧文言が複数のキーで使われていても、ZigzaguMap 側の文言と組で一致するキーがあれば同じ文言とみなす（pair_ok）
        self.pairs: dict[str, set[str]] = {}
        for k, v in old.items():
            if k in self.new:
                self.pairs.setdefault(menu_norm(v).strip(), set()).add(menu_norm(self.new[k]).strip())
            # 一覧の節（[Bewegung]・[Wetter]・[MapScripts] など）: 旧版は「2=02歩き回る」「00=00-無し」「03=マップ切替時…」、
            # 改訂版は番号を付けない文言で、画面にはどちらも「番号-文言」か「番号 文言」の形で出す
            sec, _, num = k.rpartition(".")
            if num.isdigit() or (len(num) == 2 and all(c in "0123456789ABCDEFabcdef" for c in num)):
                cands = ([f"{int(num, 10):02X}"] if num.isdigit() else []) + [f"{int(num, 16):02X}"] if len(num) <= 2 else []
                cands = [c for c in cands if c] or [num]
                # 旧版の値の頭の番号と合う読み方（[Bewegung] は 10 進のキー、[Wetter] などは 16 進 2 桁のキー）
                hx = next((c for c in cands if v.upper().startswith(c)), cands[-1])
                n = self.new.get(f"{sec}.{hx}", self.new.get(k))
                if n is None:
                    continue
                olds = {v} | {f"{hx}{sep}{v}" for sep in ("-", " ")}
                for o in olds:
                    for sep in ("-", " "):
                        self.pairs.setdefault(menu_norm(o).strip(), set()).add(f"{hx}{sep}{n}".strip())
        self.changed = {k for k in old if k in self.new and old[k] != self.new[k]}
        table: dict[str, set[str]] = {}
        for k in self.changed:
            table.setdefault(self.old[k], set()).add(self.new[k])
        # 旧文言が同じキーの組でも変わらない使われ方をしているなら、読み替えると壊れるので外す
        same = {self.old[k] for k in old if k in self.new and old[k] == self.new[k]}
        self.table = {o: next(iter(n)) for o, n in table.items() if len(n) == 1 and o not in same and o.strip()}
        self.menu_table = {menu_norm(o): menu_norm(n) for o, n in self.table.items()}
        # 組み立てた文字列（「ブロックエディタ     タイルセット1: 0 …」など）の中の部分を読み替えるための表（長いものから。3 文字以上）
        self.known_old = set(old.values())
        self.parts = sorted(((o, n) for o, n in self.table.items() if len(o.strip()) >= 3), key=lambda x: -len(x[0]))

    @classmethod
    def load(cls, old_path: pathlib.Path | None, new_path: pathlib.Path | None,
             overrides_path: pathlib.Path | None = None) -> "LangMap | None":
        """`overrides_path`（省略時は new_path と同じフォルダの overrides.ini）を、改訂版の後に重ねる（gen-i18n.mjs と同じ順）。"""
        if not old_path or not new_path or not old_path.exists() or not new_path.exists():
            return None
        new = parse_ini(new_path, "utf-8")
        ov = overrides_path or new_path.with_name("overrides.ini")
        if ov.exists():
            new.update(parse_ini(ov, "utf-8"))
        return cls(parse_ini(old_path, "cp932"), new)

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

    _FMT = re.compile(r"%[ds]")

    def _templates(self):
        """「%d」「%s」を含む文言の組（旧の正規表現, 新の書式）。値を入れて組み立てた文字列（「コネクションNo 3を削除しますか？」）用。"""
        if not hasattr(self, "_tpl"):
            self._tpl = []
            for k, o in self.old.items():
                n = self.new.get(k)
                if n is None or not self._FMT.search(o) or len(self._FMT.findall(o)) != len(self._FMT.findall(n)):
                    continue
                parts = self._FMT.split(o.strip())
                rx = "(.*?)".join(re.escape(x) for x in parts)
                self._tpl.append((re.compile(f"^{rx}$"), n.strip()))
            for fmt, nk in COMPOSED:
                try:
                    o = re.sub(r"\{([^}]+)\}", lambda m: self.old[m.group(1)].strip(), fmt)
                except KeyError:
                    continue
                if nk in self.new:
                    rx = "(.*?)".join(re.escape(x) for x in o.split("%d"))
                    self._tpl.append((re.compile(f"^{rx}$"), self.new[nk].strip()))
        return self._tpl

    def pair_ok(self, old_text, new_text) -> bool:
        """旧文言 old_text と新文言 new_text が、同じキーの旧・新の組になっているか（文脈で読み替えが決まらない文言用）。
        「%d」などに値を入れて組み立てた文言は、同じ値を新しい書式へ入れたものと比べる。"""
        if not isinstance(old_text, str) or not isinstance(new_text, str):
            return False
        if menu_norm(new_text).strip() in self.pairs.get(menu_norm(old_text).strip(), ()):
            return True
        o, n = old_text.strip(), new_text.strip()
        for rx, fmt in self._templates():
            m = rx.match(o)
            if m:
                vals = iter(m.groups())
                if norm_text(self._FMT.sub(lambda _: next(vals), fmt)) == norm_text(n):
                    return True
        return False

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
        if s in self.known_old:
            return s  # 言語ファイルの文言そのもので、変わっていないもの
        for o, n in self.parts:
            if o in s:
                s = s.replace(o, n)
        return s

    def _key(self, k: str) -> str:
        # menu.state の「ファイル/ROMを開く」のような階層のキーは段ごとに読み替える
        if "/" in k:
            return "/".join(self._text(p) for p in k.split("/"))
        return self._text(k)
