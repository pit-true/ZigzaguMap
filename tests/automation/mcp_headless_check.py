"""画面なしの MCP サーバー（Phase7 #522）を、素の ROM と ND の写しで確かめる。

  python tests/automation/mcp_headless_check.py --rom <素の BPRJ> --nd <NeoDark-CFRU-main の写し> --work <作業フォルダ> [--exe <zigzagumap.exe>] [--mjs <zigzagumap-mcp.mjs>]

- ZigzaguMap を閉じたまま `zigzagumap-mcp.mjs --rom … --project …` で開き、マップを読む・描く・出力する（素の ROM と空のフォルダ、ND の写し）。
- 出力したものを ZigzaguMap で開くと、同じ配置になる。画面なしで開き直したときの画像も、出力の前と同じ。
- ZigzaguMap が同じプロジェクトを開いている間は、画面なしの形は書き換えと出力を断り、読むのは使える。閉じれば書ける。
- 起動の引数で許していない書き換えは断る。
ND の写しは作業フォルダの中に作り直す（元のフォルダには書かない）。
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from mcp_client import McpClient  # noqa: E402
from zz import REPO, Zigzagu, copy_project  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


class Headless(McpClient):
    """画面なしの MCP サーバー（前の版の initialize で始める）。"""

    def __init__(self, mjs: pathlib.Path, rom: str, project: pathlib.Path, *flags: str):
        t0 = time.time()
        super().__init__(mjs, "--rom", rom, "--project", str(project), *flags)
        self.initialize("mcp_headless_check")
        self.ready_ms = round((time.time() - t0) * 1000)


def paint_and_export(h: Headless, bank: int, map_: int, label: str) -> tuple[list[int], object] | None:
    """マップの左上 3×2 にブロックを描いて出力し、描いたあとの全体の配置と画像を返す。"""
    err, m = h.call("map_open", {"bank": bank, "map": map_})
    check(not err, f"{label}: map_open {bank}.{map_}")
    if err:
        return None
    err, before = h.call("map_getCells")
    blocks = before["blocks"]
    new = [(blocks[0] + 1) % 0x200 or 1] * 3
    err, _ = h.call("map_setCells", {"x": 0, "y": 0, "width": 3, "height": 1, "blocks": new})
    check(not err, f"{label}: map_setCells")
    err, _ = h.call("map_setMovement", {"x": 0, "y": 1, "movement": 1})
    check(not err, f"{label}: map_setMovement")
    err, after = h.call("map_getCells")
    check(after["blocks"][:3] == new and after["movements"][m["width"]] == 1, f"{label}: 描いた値が読める")
    _, image = h.call("map_image")
    err, out = h.call("project_export")
    check(not err and f"maps/{bank:02d}/{map_:02d}.json" in out["written"], f"{label}: maps\\{bank:02d}\\{map_:02d}.json へ出力")
    check(not err and all(p.startswith("maps/") for p in out["written"]), f"{label}: 出力したのは maps\\ の中だけ")
    return [b | (mv << 10) for b, mv in zip(after["blocks"], after["movements"])], image


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--nd", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--exe")
    ap.add_argument("--mjs", default=str(REPO / "tools/mcp/dist/zigzagumap-mcp.mjs"))
    a = ap.parse_args()
    mjs = pathlib.Path(a.mjs)
    if not mjs.exists():
        raise SystemExit(f"MCP サーバーがありません（pnpm --filter @zigzagumap/mcp build で作る）: {mjs}")
    work = pathlib.Path(a.work).resolve()
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    plain = work / "plain"
    plain.mkdir()
    nd = copy_project(pathlib.Path(a.nd), work / "nd")

    cases = [("素の ROM", plain, 3, 0), ("ND の写し", nd, 3, 0)]
    results: dict[str, tuple[list[int], object]] = {}
    for label, project, bank, map_ in cases:
        h = Headless(mjs, a.rom, project, "--allow-write", "--allow-export")
        try:
            print(f"{label}: 画面なしで開くまで {h.ready_ms}ms")
            err, maps = h.call("maps_list")
            check(not err and len(maps["maps"]) > 100, f"{label}: maps_list（{len(maps['maps'])} 枚）")
            r = paint_and_export(h, bank, map_, label)
            if r:
                results[label] = r
        finally:
            log = h.close()
        check("画面なしで開きました" in log, f"{label}: 起動の記録 {log.strip().splitlines()[0] if log.strip() else ''}")

        # 画面なしで開き直すと、出力した配置と画像が同じ
        if label in results:
            h = Headless(mjs, a.rom, project)
            try:
                h.call("map_open", {"bank": bank, "map": map_})
                _, cells = h.call("map_getCells")
                _, image = h.call("map_image")
                again = [b | (mv << 10) for b, mv in zip(cells["blocks"], cells["movements"])]
                check(again == results[label][0], f"{label}: 開き直すと同じ配置")
                check(image == results[label][1], f"{label}: 開き直すと同じ画像")
                err, value = h.call("map_setBlock", {"x": 0, "y": 0, "block": 1})
                check(err and "許可されていません" in str(value), f"{label}: 起動の引数で許していない書き換えは断る")
            finally:
                h.close()

    # ZigzaguMap で開く。出力したものと同じ配置。開いている間は画面なしの形は書き換えない
    with Zigzagu(a.exe, profile=work / "profile") as z:
        for label, project, bank, map_ in cases:
            if label not in results:
                continue
            z.call({"cmd": "open", "rom": a.rom, "project": str(project)})
            z.call({"cmd": "selectMap", "bank": bank, "map": map_})
            cells = z.call({"cmd": "cells"})
            check(cells["cells"] == results[label][0], f"{label}: 出力したものを ZigzaguMap で開くと同じ配置")
        h = Headless(mjs, a.rom, nd, "--allow-write", "--allow-export")
        try:
            h.call("map_open", {"bank": 3, "map": 0})
            err, value = h.call("map_setBlock", {"x": 0, "y": 0, "block": 1})
            check(err and "同じプロジェクトを開いている" in str(value), "ZigzaguMap が開いている間は書き換えを断る")
            err, value = h.call("project_export")
            check(err and "同じプロジェクトを開いている" in str(value), "ZigzaguMap が開いている間は出力を断る")
            err, value = h.call("map_getBlock", {"x": 0, "y": 0})
            check(not err and isinstance(value, int), "ZigzaguMap が開いている間も読むのは使える")
            err, status = h.call("edit_status")
            check(not err and status["writeBlocked"], "edit_status にも断る理由が出る")
            z.stop()
            err, value = h.call("map_setBlock", {"x": 0, "y": 0, "block": 1})
            check(not err, "ZigzaguMap を閉じると書ける")
        finally:
            h.close()
        # 素の ROM のフォルダ（ZigzaguMap が最後に開いたのは ND）は使用中ではない
    print("失敗: " + ", ".join(failures) if failures else "すべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
