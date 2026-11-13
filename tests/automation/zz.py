"""確認用に ZigzaguMap を自動操作の入口つきで起動し、命令を送る小さな道具（tests/automation の各スクリプトが使う）。

- 起動したプロセスだけを終わらせる（プロセス ID で区別。ほかの作業者の exe には触れない）。
- ポートは 17990〜17999 の空き（比較テストの 17930〜17939 と分ける）。
"""
from __future__ import annotations

import json
import os
import pathlib
import socket
import subprocess
import time
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
PORTS = (17990, 17999)


def default_exe() -> pathlib.Path:
    env = os.environ.get("ZZM_EXE")
    if env:
        return pathlib.Path(env)
    target = os.environ.get("CARGO_TARGET_DIR")
    if target:
        return pathlib.Path(target) / "release" / "zigzagumap.exe"
    return REPO / "apps/desktop/src-tauri/target/release/zigzagumap.exe"


def free_port(lo: int = PORTS[0], hi: int = PORTS[1]) -> int:
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


class AppError(Exception):
    pass


class Zigzagu:
    """1 つの起動。`with Zigzagu(exe, profile=...) as z: z.call({...})`。profile=None なら --profile を付けない。"""

    def __init__(self, exe: pathlib.Path | None = None, profile: str | os.PathLike | None = None, extra: list[str] | None = None):
        self.exe = pathlib.Path(exe) if exe else default_exe()
        self.profile = profile
        self.extra = extra or []
        self.port = 0
        self.proc: subprocess.Popen | None = None

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.stop()

    def start(self, timeout: float = 60) -> None:
        if not self.exe.exists():
            raise SystemExit(f"exe がありません: {self.exe}")
        self.port = free_port()
        args = [str(self.exe), "--automation", str(self.port)]
        if self.profile is not None:
            args += ["--profile", str(self.profile)]
        self.proc = subprocess.Popen(args + self.extra, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        t0 = time.time()
        last = None
        while time.time() - t0 < timeout:
            if self.proc.poll() is not None:
                raise RuntimeError(f"すぐに終了しました（終了コード {self.proc.returncode}）")
            try:
                self.call({"cmd": "state"}, timeout=5)
                return
            except Exception as e:  # noqa: BLE001
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
