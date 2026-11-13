"""比較テストの設定（パス）。

優先順: 環境変数 > tests/compare/local.config.json > 既定値。
local.config.json は .gitignore 対象。見本は local.config.example.json。
"""
from __future__ import annotations

import json
import os
import pathlib
from dataclasses import dataclass

HERE = pathlib.Path(__file__).resolve().parent.parent  # tests/compare
REPO = HERE.parent.parent
HARNESS = REPO / "tools" / "am-harness"

# 開かない・変更しない場所（元の ROM と元の AdvanceMap）。パスにこの部分が入っていたら止める。
FORBIDDEN_PARTS = (("pokehack", "ROM"), ("pokehack", "tool"))

ENV = {
    "amSourceDir": "ZZM_CMP_AM_SRC",
    "amWorkDir": "ZZM_CMP_AM_DIR",
    "romOriginal": "ZZM_CMP_ROM",
    "zigzaguExe": "ZZM_CMP_EXE",
    "resultsDir": "ZZM_CMP_RESULTS",
    "scriptEditorStub": "ZZM_CMP_STUB",
    "langOld": "ZZM_CMP_LANG_OLD",
    "langNew": "ZZM_CMP_LANG_NEW",
}


@dataclass
class Config:
    amSourceDir: pathlib.Path | None
    amWorkDir: pathlib.Path | None
    romOriginal: pathlib.Path
    zigzaguExe: pathlib.Path
    resultsDir: pathlib.Path
    scriptEditorStub: pathlib.Path | None
    ports: tuple[int, int] = (17930, 17939)
    keepRuns: int = 5  # 残す結果の数（これより古いものは summary に「削除候補」として書く。自動では消さない）
    langOld: pathlib.Path | None = None  # AdvanceMap 本体の言語ファイル（cp932）
    langNew: pathlib.Path | None = None  # ZigzaguMap の文言の基準（Japanese.user.ini、UTF-8）

    def lang(self):
        """旧文言 → 新文言の対応表（どちらかのファイルが無ければ None = 読み替えない）。"""
        if not hasattr(self, "_lang"):
            from .langmap import LangMap
            self._lang = LangMap.load(self.langOld, self.langNew)
        return self._lang


def _forbidden(p: pathlib.Path) -> bool:
    parts = [x.lower() for x in p.resolve().parts]
    for a, b in FORBIDDEN_PARTS:
        for i in range(len(parts) - 1):
            if parts[i] == a.lower() and parts[i + 1] == b.lower():
                return True
    return False


def load(path: str | os.PathLike | None = None) -> Config:
    raw: dict = {}
    p = pathlib.Path(path) if path else HERE / "local.config.json"
    if p.exists():
        raw = json.loads(p.read_text(encoding="utf-8"))
    for key, env in ENV.items():
        if os.environ.get(env):
            raw[key] = os.environ[env]

    def path_of(key, default=None):
        v = raw.get(key, default)
        return pathlib.Path(v) if v else None

    exe = path_of("zigzaguExe", REPO / "apps/desktop/src-tauri/target/release/zigzagumap.exe")
    rom = path_of("romOriginal")
    results = path_of("resultsDir", REPO.parent / "compare-results")
    if rom is None:
        raise SystemExit("romOriginal（素の BPRJ のコピー）を local.config.json か環境変数 ZZM_CMP_ROM で指定してください")
    ports = tuple(raw.get("zigzaguPorts", (17930, 17939)))
    if not exe.is_absolute():
        exe = REPO / exe
    am_dir = path_of("amWorkDir") or path_of("amSourceDir")
    lang_old = path_of("langOld") or (am_dir / "Ini" / "Sprachen" / "Japanese.ini" if am_dir else None)
    if lang_old and not lang_old.exists() and path_of("amSourceDir"):
        lang_old = path_of("amSourceDir") / "Ini" / "Sprachen" / "Japanese.ini"
    lang_new = path_of("langNew")
    if lang_new is None:
        lang_new = next((p for p in (REPO / "apps/desktop/src/i18n/source/Japanese.ini", REPO.parent / "lang" / "Japanese.user.ini")
                         if p.exists()), None)
    cfg = Config(path_of("amSourceDir"), path_of("amWorkDir"), rom, exe, results, path_of("scriptEditorStub"), ports,
                 int(raw.get("keepRuns", 5)), lang_old, lang_new)
    for key in ("amSourceDir", "amWorkDir", "romOriginal"):
        v = getattr(cfg, key)
        if v is not None and _forbidden(v):
            raise SystemExit(f"{key} が元の ROM / 元の AdvanceMap の場所を指しています。作業用のコピーを指定してください: {v}")
    return cfg
