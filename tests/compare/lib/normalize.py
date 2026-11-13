"""入力欄・一覧の値の正規化（比べる前に両方へ通す）。

- 全角英数・全角空白は半角へ（NFKC）。空白の連続は 1 つにし、前後の空白は外す。
- 16 進らしい語（先頭の `$` か `0x`、または A〜F を含む英数字だけの語）は、接頭辞を外して大文字にする。
- 一覧は要素ごとに正規化する。
"""
from __future__ import annotations

import re
import unicodedata

_HEX_PREFIXED = re.compile(r"^(?:\$|0[xX])([0-9A-Fa-f]+)$")
_HEX_PLAIN = re.compile(r"^[0-9A-Fa-f]*[A-Fa-f][0-9A-Fa-f]*$")


def norm_token(tok: str) -> str:
    m = _HEX_PREFIXED.match(tok)
    if m:
        return m.group(1).upper()
    if _HEX_PLAIN.match(tok) and any(c.isdigit() for c in tok):
        return tok.upper()
    return tok


def norm_text(s) -> str:
    if s is None:
        return ""
    if not isinstance(s, str):
        s = str(s)
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"\s+", " ", s).strip()
    return " ".join(norm_token(t) for t in s.split(" ")) if s else ""


def norm_value(v):
    if isinstance(v, (list, tuple)):
        return [norm_value(x) for x in v]
    if isinstance(v, dict):
        return {k: norm_value(x) for k, x in v.items()}
    if isinstance(v, bool):
        return v
    return norm_text(v)
