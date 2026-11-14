"""写しの中でプロジェクトのビルドを動かし、ログと終了コードを取る。

上流のスクリプトは失敗しても 0 で終わることがあるので、ログのエラー行（Chronos の build.py と同じ形）と、
できる ROM が今回書かれたかも見る。
"""
from __future__ import annotations

import os
import pathlib
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass

from .fixtures import Build, Fixture
from .guard import require_inside

ERROR_PATTERNS = [
    re.compile(r"Symbol missing"),
    re.compile(r"\berror:", re.IGNORECASE),
    re.compile(r"^Error", re.MULTILINE),
    re.compile(r"There was an error"),
    re.compile(r"Not enough free space"),
    re.compile(r"Traceback \(most recent call last\)"),
    re.compile(r"Devkit not found|devkitARM not found"),
    re.compile(r"Could not find source rom"),
    re.compile(r"TEXT WIDTH ERROR"),
]


@dataclass
class BuildResult:
    label: str
    ok: bool
    returncode: int | None
    seconds: float
    log: pathlib.Path
    output: pathlib.Path
    output_written: bool
    errors: list[str]

    def summary(self) -> str:
        if self.ok:
            return f"{self.label}: 成功 {self.seconds:.1f} 秒"
        why = []
        if self.returncode != 0:
            why.append(f"終了コード {self.returncode}")
        if not self.output_written:
            why.append(f"{self.output.name} が書かれていない")
        if self.errors:
            why.append("ログのエラー: " + " / ".join(self.errors[:5]))
        return f"{self.label}: 失敗 {self.seconds:.1f} 秒（{'、'.join(why)}）ログ {self.log}"


def _env() -> dict:
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    # WindowsApps の python3 スタブを避け、今の Python を先頭に置く（Chronos の build.py と同じ）
    parts = [p for p in env.get("PATH", "").split(os.pathsep) if "WindowsApps" not in p]
    env["PATH"] = os.pathsep.join([os.path.dirname(sys.executable)] + parts)
    return env


def run_build(fx: Fixture, build: Build, log_dir: pathlib.Path, timeout: int = 3600) -> BuildResult:
    cwd = fx.path(build.cwd)
    log_dir = require_inside(log_dir, fx.copy_root, "ログの置き場")
    log_dir.mkdir(parents=True, exist_ok=True)
    log = log_dir / (re.sub(r"\W+", "_", build.label).strip("_").lower() + ".log")
    output = require_inside(cwd / build.output, fx.copy_root, "ビルドの出力")
    args = [sys.executable if a == "python" else a for a in build.args]
    t0 = time.time()
    rc: int | None = None
    with open(log, "w", encoding="utf-8", errors="replace") as f:
        f.write(f"# cwd: {cwd}\n# args: {args}\n")
        f.flush()
        proc = subprocess.Popen(args, cwd=cwd, stdout=f, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=_env(),
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            rc = proc.wait(timeout)
        except subprocess.TimeoutExpired:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
            proc.wait(30)
            f.write(f"\n# {timeout} 秒で打ち切り\n")
    seconds = time.time() - t0
    text = log.read_text(encoding="utf-8", errors="replace")
    errors = []
    for line in text.splitlines():
        if line.startswith("# "):
            continue
        if any(p.search(line) for p in ERROR_PATTERNS):
            errors.append(line.strip()[:200])
    written = output.is_file() and output.stat().st_mtime >= t0 - 1
    return BuildResult(build.label, rc == 0 and written and not errors, rc, seconds, log, output, written, errors)


def build_fixture(fx: Fixture, log_dir: pathlib.Path, timeout: int = 3600) -> BuildResult:
    """完了の条件のビルド（ND は CFRU、Chronos はルートの build.py）。"""
    return run_build(fx, fx.build, log_dir, timeout)


def build_nd_dpe(fx: Fixture, log_dir: pathlib.Path, timeout: int = 3600) -> BuildResult:
    """ND の 2 段目。写しの CFRU の test.gba を写しの DPE の BPRJ0.gba に写してから DPE をビルドする。"""
    dpe = fx.extra_builds.get("dpe")
    if dpe is None:
        raise SystemExit("ndDpe が設定にありません")
    src = fx.path(f"{fx.build.cwd}/{fx.build.output}")
    if not src.is_file():
        raise SystemExit(f"CFRU の出力がありません（先に build_fixture を動かす）: {src}")
    shutil.copyfile(src, fx.path(f"{dpe.cwd}/BPRJ0.gba"))
    return run_build(fx, dpe, log_dir, timeout)
