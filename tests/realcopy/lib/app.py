"""写しを開く ZigzaguMap の起動と操作。

- `--automation <ポート> --profile <写し先の下のフォルダ> --mute-audio` で起動する（画面外・非アクティブ・音なし）。
- ポートは設定の範囲（既定 47820〜47829）の空き。
- 終わらせるのは自分が起動したプロセスだけ（プロセス ID で区別する）。
- 開く ROM・プロジェクト・出力先は写し先の下だけ（ファイルを選ぶダイアログは使わない）。
"""
from __future__ import annotations

import json
import pathlib
import socket
import subprocess
import time
import urllib.request

from .config import Config
from .fixtures import Fixture, profile_dir
from .guard import is_inside, require_inside


class AppError(Exception):
    pass


def free_port(lo: int, hi: int) -> int:
    for p in range(lo, hi + 1):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", p))
            return p
        except OSError:
            continue
        finally:
            s.close()
    raise RuntimeError(f"ポート {lo}〜{hi} がすべて使用中です")


class Zigzagu:
    """1 つの起動。`with Zigzagu(cfg, "nd") as z: z.open_fixture(fx); z.export()`。"""

    def __init__(self, cfg: Config, profile: str, exe: pathlib.Path | None = None):
        self.cfg = cfg
        self.exe = pathlib.Path(exe or cfg.zigzaguExe)
        self.profile = profile_dir(cfg, profile)
        self.port = 0
        self.proc: subprocess.Popen | None = None
        self.fixture: Fixture | None = None

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.stop()

    def start(self, timeout: float = 60) -> None:
        if not self.exe.exists():
            raise SystemExit(f"exe がありません: {self.exe}")
        self.profile.mkdir(parents=True, exist_ok=True)
        self.port = free_port(*self.cfg.ports)
        args = [str(self.exe), "--automation", str(self.port), "--profile", str(self.profile), "--mute-audio"]
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
        t0 = time.time()
        last = None
        while time.time() - t0 < timeout:
            if self.proc.poll() is not None:
                raise RuntimeError(f"ZigzaguMap がすぐに終了しました（終了コード {self.proc.returncode}）")
            try:
                st = self.call({"cmd": "state"}, timeout=5)
                if st.get("profile") and not is_inside(st["profile"], self.cfg.copyRoot):
                    raise RuntimeError(f"プロファイルが写し先の外です: {st['profile']}")
                return
            except (OSError, AppError, ValueError) as e:
                last = e
                time.sleep(0.2)
        raise RuntimeError(f"自動操作の入口が応答しません: {last}")

    def call(self, obj: dict, timeout: float = 120):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/", data=json.dumps(obj).encode("utf-8"), method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            reply = json.loads(r.read().decode("utf-8"))
        if not reply.get("ok"):
            raise AppError(reply.get("error", "不明なエラー"))
        return reply.get("result")

    def open(self, rom: pathlib.Path, project: pathlib.Path | None) -> dict:
        req = {"cmd": "open", "rom": str(require_inside(rom, self.cfg.copyRoot, "開く ROM "))}
        if project is not None:
            req["project"] = str(require_inside(project, self.cfg.copyRoot, "開くプロジェクト"))
        return self.call(req, timeout=180)

    def open_fixture(self, fx: Fixture) -> dict:
        """写しの ROM とプロジェクトを開く。"""
        self.fixture = fx
        return self.open(fx.rom_path, fx.project_path)

    def export(self, dir: pathlib.Path | None = None) -> dict:
        """出力する（dir を省くと開いているプロジェクトへ）。返事の書いたファイルが写し先の外なら止める。"""
        req: dict = {"cmd": "export"}
        if dir is not None:
            req["dir"] = str(require_inside(dir, self.cfg.copyRoot, "出力先"))
        result = self.call(req, timeout=300) or {}
        for p in _paths_in(result):
            require_inside(p, self.cfg.copyRoot, "出力したファイル")
        return result

    def stop(self) -> None:
        if not self.proc:
            return
        try:
            if self.proc.poll() is None:
                try:
                    self.call({"cmd": "exit"}, timeout=5)
                except Exception:  # noqa: BLE001
                    pass
                try:
                    self.proc.wait(15)
                except subprocess.TimeoutExpired:
                    subprocess.run(["taskkill", "/T", "/F", "/PID", str(self.proc.pid)],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    self.proc.wait(10)
        finally:
            self.proc = None


def _paths_in(result) -> list[str]:
    """出力の返事に入っている絶対パス（相対パスは project からなので確かめない）。"""
    out = []

    def walk(v):
        if isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, str) and len(v) > 2 and (v[1] == ":" or v.startswith("\\\\")):
            out.append(v)

    walk(result)
    return out
