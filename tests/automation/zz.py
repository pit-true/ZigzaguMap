"""確認用に ZigzaguMap を自動操作の入口つきで起動し、命令を送る小さな道具（tests/automation の各スクリプトが使う）。

- 起動したプロセスだけを終わらせる（プロセス ID で区別。ほかの作業者の exe には触れない）。
- ポートは 17990〜17999 の空き（比較テストの 17930〜17939 と分ける）。環境変数 `ZZM_PORTS`（`47810-47819` の形）で変えられる。
"""
from __future__ import annotations

import base64
import json
import os
import pathlib
import shutil
import socket
import subprocess
import time
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
PORTS = tuple(int(p) for p in os.environ.get("ZZM_PORTS", "17990-17999").split("-", 1))


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


# ---- 作業者ごとのテストで同じだった部品（Phase6 の仕上げ #493 でまとめた） ----

# 再生のテストでプロジェクトの写しに写すもの（スクリプトの確認に足りる分だけ）
PROJECT_DIRS = ["assembly", "strings", "maps"]
PROJECT_FILES = ["xse_commands.s", "xse_defines.s", "asm_defines.s", "eventscripts", "charmap.tbl", "zigzagumap.json", "BPRJ.ld"]


def copy_project(src: pathlib.Path, work: pathlib.Path) -> pathlib.Path:
    """プロジェクトの写しを work/project に作り直す（元のフォルダには書かない）。前のテストが残した zz_*.s は消す。"""
    src, work = pathlib.Path(src).resolve(), pathlib.Path(work).resolve()
    if work == src or src in work.parents:
        raise SystemExit(f"作業フォルダが元のフォルダの中です: {work}")
    dst = work / "project"
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    for d in PROJECT_DIRS:
        if (src / d).is_dir():
            shutil.copytree(src / d, dst / d)
    for f in PROJECT_FILES:
        if (src / f).is_file():
            shutil.copy2(src / f, dst / f)
    for f in (dst / "assembly/overworld_scripts").glob("zz_*.s"):
        f.unlink()
    return dst


def wait_window(z: Zigzagu, label: str, present: bool = True, timeout: float = 20) -> bool:
    """別ウィンドウ label が開いて使えるようになる（present=False なら閉じる）まで待つ。"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        wins = {w["label"]: w for w in z.call({"cmd": "windows"})}
        if present and wins.get(label, {}).get("ready"):
            return True
        if not present and label not in wins:
            return True
        time.sleep(0.2)
    return False


def wait_editor(z: Zigzagu, timeout: float = 30) -> None:
    """スクリプトエディタの窓が命令に答えるまで待つ（答えなければ最後のエラーを投げる）。"""
    deadline = time.monotonic() + timeout
    while True:
        try:
            z.call({"cmd": "editor.state", "window": "script-editor"})
            return
        except AppError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.2)


def shot(z: Zigzagu, shots: pathlib.Path | None, name: str) -> None:
    """メインのウィンドウの画面を撮って shots に置く（shots が None なら撮らない）。"""
    if not shots:
        return
    png = z.call({"cmd": "screenshot"})
    (shots / name).write_bytes(base64.b64decode(png if isinstance(png, str) else png["png"]))
