"""ND と Chronos の写しの作り方（何を写し、何を開き、どこでビルドするか）。

写しの置き場（copyRoot の下）:
  <copyRoot>/nd/NeoDark-CFRU-main, <copyRoot>/nd/NeoDark-DPE-main
  <copyRoot>/chronos/Chronos
  <copyRoot>/profiles/<名前>     ZigzaguMap の --profile
  <copyRoot>/logs/<日時>/        ビルドのログ
フォルダ名は元と同じにする（ビルドのスクリプトが相対パスで隣を見ることがあるため）。
"""
from __future__ import annotations

import os
import pathlib
import shutil
import stat
import time
from dataclasses import dataclass, field

from .config import Config
from .guard import GuardError, require_inside

# どの深さでも写さないフォルダ（生成物とリポジトリの管理用）
EXCLUDE_DIRS = {"build", ".git", "__pycache__", "node_modules"}
# 写さないファイル（ベース ROM は Tree.base_roms で別に写す）。セーブも作業中のユーザーのデータなので写さない
EXCLUDE_SUFFIXES = {".gba", ".bak", ".sav", ".sa1", ".sa2"}


@dataclass
class Tree:
    """写す実フォルダ 1 つ。"""
    real: pathlib.Path
    name: str  # 写し先でのフォルダ名
    base_roms: list[str] = field(default_factory=list)  # 写すベース ROM（フォルダからの相対パス）


@dataclass
class Build:
    """写しで動かすビルド 1 つ。"""
    label: str
    cwd: str  # 写しの置き場（<copyRoot>/<名前>）からの相対パス
    args: list[str]  # 先頭の "python" は今の Python に置き換える
    output: str  # できる ROM（cwd からの相対パス）


@dataclass
class Fixture:
    name: str  # nd / chronos
    trees: list[Tree]
    rom: str  # ZigzaguMap で開く ROM（置き場からの相対パス）
    project: str  # ZigzaguMap で開くプロジェクトのフォルダ（置き場からの相対パス）
    build: Build  # 完了の条件に使うビルド
    extra_builds: dict[str, Build] = field(default_factory=dict)
    copy_root: pathlib.Path = pathlib.Path()

    @property
    def dir(self) -> pathlib.Path:
        return self.copy_root / self.name

    def path(self, rel: str) -> pathlib.Path:
        return require_inside(self.dir / rel, self.copy_root, f"{self.name} の {rel} ")

    @property
    def rom_path(self) -> pathlib.Path:
        return self.path(self.rom)

    @property
    def project_path(self) -> pathlib.Path:
        return self.path(self.project)

    def real_folders(self) -> list[pathlib.Path]:
        return [t.real for t in self.trees]


def nd(cfg: Config) -> Fixture:
    if not cfg.ndCfru:
        raise SystemExit("ndCfru（NeoDark-CFRU-main のフォルダ）を local.config.json に書いてください")
    trees = [Tree(cfg.ndCfru, cfg.ndCfru.name, ["BPRJ0.gba"])]
    extra = {}
    if cfg.ndDpe:
        # DPE の BPRJ0.gba は CFRU の test.gba の写しなので写さない（build_nd_dpe が写しの中で作る）
        trees.append(Tree(cfg.ndDpe, cfg.ndDpe.name, []))
        extra["dpe"] = Build("ND DPE", cfg.ndDpe.name, ["python", "scripts/make.py"], "test.gba")
    c = cfg.ndCfru.name
    return Fixture("nd", trees, f"{c}/BPRJ0.gba", c, Build("ND CFRU", c, ["python", "scripts/make.py"], "test.gba"),
                   extra, cfg.copyRoot)


def chronos(cfg: Config) -> Fixture:
    if not cfg.chronos:
        raise SystemExit("chronos（Chronos のフォルダ）を local.config.json に書いてください")
    c = cfg.chronos.name
    return Fixture("chronos", [Tree(cfg.chronos, c, ["base/BPRJ0.gba"])], f"{c}/base/BPRJ0.gba", f"{c}/cfru",
                   Build("Chronos", c, ["python", "build.py"], "build/Chronos.gba"), {}, cfg.copyRoot)


FIXTURES = {"nd": nd, "chronos": chronos}


def get(cfg: Config, name: str) -> Fixture:
    return FIXTURES[name](cfg)


def _on_rm_error(func, path, _exc):
    os.chmod(path, stat.S_IWRITE)
    func(path)


def remove_copy(fx: Fixture) -> None:
    """写しを消す（写し先の下で、実フォルダと重ならないことを確かめてから）。"""
    d = require_inside(fx.dir, fx.copy_root, "消す写し")
    if os.path.normcase(os.path.abspath(d)) == os.path.normcase(os.path.abspath(fx.copy_root)):
        raise GuardError("写し先そのものは消しません")
    for real in fx.real_folders():
        if os.path.normcase(os.path.abspath(real)).startswith(os.path.normcase(os.path.abspath(d))):
            raise GuardError(f"消す写しに実フォルダが入っています: {real}")
    if d.exists():
        shutil.rmtree(d, onerror=_on_rm_error)


def _copy_tree(tree: Tree, dest: pathlib.Path) -> tuple[int, int]:
    files = size = 0
    src_root = tree.real
    for cur, dirs, names in os.walk(src_root):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        rel = os.path.relpath(cur, src_root)
        out = dest / rel if rel != "." else dest
        out.mkdir(parents=True, exist_ok=True)
        for n in names:
            if os.path.splitext(n)[1].lower() in EXCLUDE_SUFFIXES:
                continue
            shutil.copy2(os.path.join(cur, n), out / n)  # 更新日時も写す（上流の差分ビルドが見る）
            files += 1
            size += os.path.getsize(out / n)
    for rom in tree.base_roms:
        src = src_root / rom
        if not src.is_file():
            raise SystemExit(f"ベース ROM がありません: {src}")
        (dest / rom).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest / rom)
        files += 1
        size += src.stat().st_size
    return files, size


def make_copy(fx: Fixture, reuse: bool = False) -> dict:
    """写しを作る。reuse=True で、前の写しがあればそのまま使う（ビルドのキャッシュが残るので速い）。"""
    fx.copy_root.mkdir(parents=True, exist_ok=True)
    complete = fx.dir / ".copy-complete"
    if reuse and complete.exists():
        return {"reused": True, "files": 0, "bytes": 0, "seconds": 0.0}
    t0 = time.perf_counter()
    remove_copy(fx)
    files = size = 0
    for tree in fx.trees:
        dest = fx.path(tree.name)
        f, s = _copy_tree(tree, dest)
        files += f
        size += s
    complete.write_text(time.strftime("%Y-%m-%d %H:%M:%S"), encoding="utf-8")
    return {"reused": False, "files": files, "bytes": size, "seconds": time.perf_counter() - t0}


def profile_dir(cfg: Config, name: str) -> pathlib.Path:
    """ZigzaguMap の --profile に渡す専用フォルダ（写し先の下）。"""
    return require_inside(cfg.copyRoot / "profiles" / name, cfg.copyRoot, "プロファイル")
