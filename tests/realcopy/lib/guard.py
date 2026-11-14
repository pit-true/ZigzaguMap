"""書く場所の確認。写し先と実フォルダが重ならないこと、テストが写し先の外へ書かないことを確かめる。"""
from __future__ import annotations

import os
import pathlib


class GuardError(SystemExit):
    pass


def _norm(p: str | os.PathLike) -> pathlib.Path:
    return pathlib.Path(os.path.normcase(os.path.abspath(p)))


def is_inside(path: str | os.PathLike, root: str | os.PathLike) -> bool:
    """path が root そのものか、その下にあるか（大文字小文字は区別しない）。"""
    a, b = _norm(path), _norm(root)
    return a == b or b in a.parents


def assert_separate(copy_root: pathlib.Path, reals: list[pathlib.Path]) -> None:
    """写し先が実フォルダの下でなく、実フォルダも写し先の下でないこと（写しを消すときに実フォルダを巻き込まない）。"""
    root = _norm(copy_root)
    if root == pathlib.Path(root.anchor) or len(root.parts) < 3:
        raise GuardError(f"写し先が浅すぎます（ドライブの直下などは使えません）: {copy_root}")
    for real in reals:
        if is_inside(copy_root, real):
            raise GuardError(f"写し先が実フォルダの下にあります: {copy_root}（実フォルダ {real}）")
        if is_inside(real, copy_root):
            raise GuardError(f"実フォルダが写し先の下にあります: {real}（写し先 {copy_root}）")


def require_inside(path: str | os.PathLike, root: str | os.PathLike, what: str = "パス") -> pathlib.Path:
    """写し先の外を指していたら止める。テストが書く・開く・ビルドする場所はすべてここを通す。"""
    if not is_inside(path, root):
        raise GuardError(f"{what}が写し先 {root} の外を指しています: {path}")
    return pathlib.Path(path)
