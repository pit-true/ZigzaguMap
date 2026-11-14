"""実フォルダの写しのテストの設定（パス）。

優先順: 環境変数 > tests/realcopy/local.config.json > 既定値。
local.config.json は .gitignore 対象。見本は local.config.example.json。
"""
from __future__ import annotations

import json
import os
import pathlib
from dataclasses import dataclass, field

HERE = pathlib.Path(__file__).resolve().parent.parent  # tests/realcopy
REPO = HERE.parent.parent

ENV = {
    "ndCfru": "ZZM_RC_ND_CFRU",
    "ndDpe": "ZZM_RC_ND_DPE",
    "chronos": "ZZM_RC_CHRONOS",
    "copyRoot": "ZZM_RC_COPY_ROOT",
    "zigzaguExe": "ZZM_RC_EXE",
}
DEFAULT_PORTS = (47820, 47829)
DEFAULT_COPY_ROOT = r"D:\zigzagu-build\p2-fixtures"


@dataclass
class Config:
    ndCfru: pathlib.Path | None
    ndDpe: pathlib.Path | None
    chronos: pathlib.Path | None
    copyRoot: pathlib.Path
    zigzaguExe: pathlib.Path
    ports: tuple[int, int] = DEFAULT_PORTS
    buildTimeout: int = 3600  # 1 回のビルドの打ち切り（秒）。Chronos のクリーンビルドは 750 秒ほど
    raw: dict = field(default_factory=dict)

    def real_folders(self) -> list[pathlib.Path]:
        """書いてはいけない実フォルダ（設定にあるものだけ）。"""
        return [p for p in (self.ndCfru, self.ndDpe, self.chronos) if p is not None]


def load(path: str | os.PathLike | None = None, exe: str | None = None) -> Config:
    raw: dict = {}
    p = pathlib.Path(path) if path else HERE / "local.config.json"
    if p.exists():
        raw = json.loads(p.read_text(encoding="utf-8"))
    elif path:
        raise SystemExit(f"設定ファイルがありません: {p}")
    for key, env in ENV.items():
        if os.environ.get(env):
            raw[key] = os.environ[env]
    if exe:
        raw["zigzaguExe"] = exe

    def path_of(key, default=None):
        v = raw.get(key, default)
        return pathlib.Path(v).resolve() if v else None

    exe_path = path_of("zigzaguExe", str(REPO / "apps/desktop/src-tauri/target/release/zigzagumap.exe"))
    ports = tuple(raw.get("ports", DEFAULT_PORTS))
    cfg = Config(path_of("ndCfru"), path_of("ndDpe"), path_of("chronos"), path_of("copyRoot", DEFAULT_COPY_ROOT),
                 exe_path, (int(ports[0]), int(ports[1])), int(raw.get("buildTimeout", 3600)), raw)
    from .guard import assert_separate
    assert_separate(cfg.copyRoot, cfg.real_folders())
    return cfg
