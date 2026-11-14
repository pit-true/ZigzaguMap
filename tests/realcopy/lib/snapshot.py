"""フォルダの中の全ファイル・全フォルダの更新日時と大きさを記録して比べる（実フォルダが変わっていないことの確認）。"""
from __future__ import annotations

import os
import pathlib
import time
from dataclasses import dataclass


@dataclass
class Snapshot:
    root: pathlib.Path
    entries: dict[str, tuple[int, int]]  # 相対パス → (更新日時 ns, 大きさ)。フォルダは大きさ -1
    seconds: float

    @property
    def files(self) -> int:
        return sum(1 for v in self.entries.values() if v[1] >= 0)


def take(root: str | os.PathLike) -> Snapshot:
    """root の下を何も除かずに記録する（シンボリックリンクはたどらない）。"""
    root = pathlib.Path(root)
    t0 = time.perf_counter()
    out: dict[str, tuple[int, int]] = {}
    stack = [str(root)]
    base = len(str(root)) + 1
    while stack:
        d = stack.pop()
        try:
            it = os.scandir(d)
        except OSError:
            continue
        with it:
            for e in it:
                try:
                    st = e.stat(follow_symlinks=False)
                except OSError:
                    continue
                rel = e.path[base:]
                if e.is_dir(follow_symlinks=False):
                    out[rel] = (st.st_mtime_ns, -1)
                    stack.append(e.path)
                else:
                    out[rel] = (st.st_mtime_ns, st.st_size)
    try:
        out["."] = (os.stat(root).st_mtime_ns, -1)
    except OSError:
        pass
    return Snapshot(root, out, time.perf_counter() - t0)


def diff(before: Snapshot, after: Snapshot) -> dict[str, list[str]]:
    """変わったもの（changed）・増えたもの（added）・消えたもの（removed）の相対パス。"""
    a, b = before.entries, after.entries
    return {
        "changed": sorted(k for k in a.keys() & b.keys() if a[k] != b[k]),
        "added": sorted(b.keys() - a.keys()),
        "removed": sorted(a.keys() - b.keys()),
    }


def is_same(d: dict[str, list[str]]) -> bool:
    return not (d["changed"] or d["added"] or d["removed"])


def describe(d: dict[str, list[str]], limit: int = 10) -> str:
    parts = []
    for key, label in (("changed", "変わった"), ("added", "増えた"), ("removed", "消えた")):
        if d[key]:
            shown = ", ".join(d[key][:limit]) + (f" ほか {len(d[key]) - limit} 件" if len(d[key]) > limit else "")
            parts.append(f"{label} {len(d[key])} 件（{shown}）")
    return "、".join(parts) or "変化なし"
