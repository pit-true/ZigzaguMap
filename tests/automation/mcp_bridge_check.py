"""MCP の窓口（Phase7 #521）を、開いている ZigzaguMap と MCP サーバー（tools/mcp の dist/zigzagumap-mcp.mjs）で確かめる。

  python tests/automation/mcp_bridge_check.py --rom <素の BPRJ> --work <作業フォルダ> [--exe <zigzagumap.exe>] [--mjs <zigzagumap-mcp.mjs>]

- 窓口がオフの間は mcp.json が無く、MCP サーバーは「窓口がオフ」と返す。
- 設定 > MCP の窓口を開くで mcp.json ができ、127.0.0.1 で待ち受ける。合言葉の無い頼み・違う宛先・ブラウザからの頼みは断る。
- MCP サーバーに stdio で initialize・tools/list・tools/call を流す。許可の無い書き換えと出力は断られ、許可すると書き換え・
  元に戻す・やり直し・出力・画像ができる。書き換えはアプリの「元に戻す」の履歴に 1 つ積まれる。
- 窓口を閉じると mcp.json が消え、ポートも閉じる。
出力は作業フォルダの空のプロジェクトフォルダに書く（ND・Chronos の本体は使わない）。
"""
from __future__ import annotations

import argparse
import base64
import http.client
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from mcp_client import McpClient  # noqa: E402
from zz import REPO, Zigzagu  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("OK   " if cond else "失敗 ") + what)
    if not cond:
        failures.append(what)


def raw_post(port: int, headers: dict[str, str], body: dict) -> int:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request("POST", "/", body=json.dumps(body), headers=headers)
    status = conn.getresponse().status
    conn.close()
    return status


def wait_for(cond, timeout: float = 10) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if cond():
            return True
        time.sleep(0.1)
    return False


def main() -> int:
    if os.name == "nt":
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
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
    profile = work / "profile"
    project = work / "project"
    profile.mkdir(parents=True)
    project.mkdir(parents=True)
    info_path = profile / "mcp.json"

    with Zigzagu(a.exe, profile=profile) as z:
        z.call({"cmd": "open", "rom": a.rom, "project": str(project)})
        check(not info_path.exists(), "窓口がオフの間は mcp.json が無い")
        mcp = McpClient(mjs, "--profile", str(profile))
        try:
            init = mcp.request("initialize", {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "mcp_bridge_check", "version": "1"}})
            check(init["result"]["serverInfo"]["name"] == "zigzagumap", "initialize に答える")
            mcp.notify("notifications/initialized")
            tools = [t["name"] for t in mcp.request("tools/list")["result"]["tools"]]
            check({"maps_list", "map_open", "map_setBlock", "edit_undo", "project_export", "map_image"} <= set(tools), f"道具の一覧（{len(tools)} 個）")
            err, value = mcp.call("maps_list")
            check(err and "窓口がオフ" in str(value), "窓口がオフのときはその旨を返す")

            # 窓口を開く
            z.call({"cmd": "action", "id": "mcp.bridge"})
            check(wait_for(info_path.exists), "設定 > MCP の窓口を開くで mcp.json ができる")
            info = json.loads(info_path.read_text(encoding="utf-8"))
            port, token = info["port"], info["token"]
            check(len(token) == 32 and port != z.port, "合言葉は 32 文字で、自動操作とは別のポート")
            body = {"tool": "maps_list", "arguments": {}}
            check(raw_post(port, {"Content-Type": "application/json"}, body) == 401, "合言葉の無い頼みは断る")
            check(raw_post(port, {"Authorization": "Bearer " + "0" * 32}, body) == 401, "違う合言葉は断る")
            check(raw_post(port, {"Authorization": f"Bearer {token}", "Origin": "http://example.com"}, body) == 403, "ブラウザからの頼みは断る")
            check(raw_post(port, {"Authorization": f"Bearer {token}", "Host": f"evil.example:{port}"}, body) == 403, "違う宛先の名前は断る")
            check(raw_post(port, {"Authorization": f"Bearer {token}"}, {"cmd": "exit"}) == 400, "自動操作の命令は通らない")

            err, value = mcp.call("maps_list")
            check(not err and len(value["maps"]) > 100, "maps_list")
            err, value = mcp.call("map_open", {"bank": 3, "map": 0})
            check(not err and value["bank"] == 3 and value["map"] == 0, "map_open 3.0")
            check(z.call({"cmd": "state"})["map"]["bank"] == 3, "画面でも 3.0 が開く")
            err, before = mcp.call("map_getBlock", {"x": 1, "y": 1})
            check(not err and isinstance(before, int), "map_getBlock")
            new_block = 1 if before != 1 else 2

            err, value = mcp.call("map_setBlock", {"x": 1, "y": 1, "block": new_block})
            check(err and "書き換えを許す" in str(value), "書き換えの許可が無ければ断る")
            err, value = mcp.call("map_setBlock", {"x": 1, "y": 1, "block": 5000})
            check(err and "1023 以下" in str(value), "範囲の外の値は分かる文で断る")
            unknown = mcp.request("tools/call", {"name": "rom_write", "arguments": {}})
            check(unknown.get("error", {}).get("code") == -32602, "知らない道具は JSON-RPC のエラー")

            z.call({"cmd": "action", "id": "mcp.allowWrite"})
            history = z.call({"cmd": "state"})["history"]
            err, value = mcp.call("map_setBlock", {"x": 1, "y": 1, "block": new_block})
            check(not err, "許可すると map_setBlock")
            cells = z.call({"cmd": "cells"})
            check(cells["cells"][cells["width"] + 1] & 0x3FF == new_block, "画面のマップに置かれる")
            state = z.call({"cmd": "state"})
            check(state["history"] == history + 1 and state["canUndo"], "アプリの元に戻すの履歴に 1 つ積まれる")
            check("3.0" in " ".join(state["dirty"]) or len(state["dirty"]) > 0, "未出力の印が付く")
            err, value = mcp.call("map_setCells", {"x": 0, "y": 0, "width": 2, "height": 1, "blocks": [new_block, new_block], "movements": [4, 4]})
            check(not err and z.call({"cmd": "state"})["history"] == history + 2, "矩形の書き換えも 1 回分")
            err, value = mcp.call("edit_undo")
            check(not err and z.call({"cmd": "state"})["history"] == history + 1, "edit_undo で直前の書き換えが戻る")
            err, value = mcp.call("edit_redo")
            check(not err and z.call({"cmd": "state"})["history"] == history + 2, "edit_redo でやり直す")
            z.call({"cmd": "undo"})
            z.call({"cmd": "undo"})
            cells = z.call({"cmd": "cells"})
            check(cells["cells"][cells["width"] + 1] & 0x3FF == before, "アプリの Ctrl+Z でも戻せる")
            err, value = mcp.call("map_setBlock", {"x": 1, "y": 1, "block": new_block})
            # 利用者の操作は MCP の edit_undo で戻さない
            z.call({"cmd": "command", "name": "placeBlock", "args": {"bank": 3, "map": 0, "x": 2, "y": 2, "block": new_block}})
            err, value = mcp.call("edit_undo")
            check(err and "利用者の操作は戻しません" in str(value), "利用者の操作は edit_undo で戻さない")
            z.call({"cmd": "undo"})

            err, value = mcp.call("project_export")
            check(err and "出力を許す" in str(value), "出力の許可が無ければ断る")
            check(not (project / "maps").exists(), "断ったときは何も書かない")
            z.call({"cmd": "action", "id": "mcp.allowExport"})
            err, value = mcp.call("project_export")
            check(not err and (project / "maps/03/00.json").exists(), "許可すると maps\\03\\00.json へ出力する")
            check(not err and all(str(p).replace("\\", "/").startswith("maps/") for p in value["written"]), "出力したのは maps\\ の中だけ")

            err, value = mcp.call("map_image", {"width": 4, "height": 3})
            ok = not err and isinstance(value, list) and value[0]["type"] == "image" and base64.b64decode(value[0]["data"])[1:4] == b"PNG"
            check(ok, "map_image は PNG を返す")
            err, value = mcp.call("events_list")
            check(not err and "person" in value, "events_list")

            # 窓口を閉じる
            z.call({"cmd": "action", "id": "mcp.bridge"})
            check(wait_for(lambda: not info_path.exists()), "窓口を閉じると mcp.json が消える")
            closed = False
            try:
                raw_post(port, {"Authorization": f"Bearer {token}"}, body)
            except OSError:
                closed = True
            check(closed, "窓口を閉じるとポートも閉じる")
            err, value = mcp.call("maps_list")
            check(err and "窓口がオフ" in str(value), "閉じたあとはその旨を返す")
        finally:
            mcp.close()
    print("失敗: " + ", ".join(failures) if failures else "すべて OK")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
