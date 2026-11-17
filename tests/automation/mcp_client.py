"""MCP サーバー（tools/mcp の dist/zigzagumap-mcp.mjs）を子プロセスで動かし、stdio で 1 行 1 通のやり取りをする小さなクライアント。

tests/automation の mcp_bridge_check.py・mcp_headless_check.py と、tests/realcopy の --phase7 が使う。
"""
from __future__ import annotations

import json
import pathlib
import subprocess

MJS = pathlib.Path(__file__).resolve().parents[2] / "tools/mcp/dist/zigzagumap-mcp.mjs"


class McpClient:
    """`McpClient(mjs, "--profile", dir)` のように、MCP サーバーの引数を渡して起動する。"""

    def __init__(self, mjs: pathlib.Path, *args: str):
        self.proc = subprocess.Popen(["node", str(mjs), *args], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, encoding="utf-8")
        self.next = 0

    def send(self, msg: dict) -> None:
        self.proc.stdin.write(json.dumps(msg, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def request(self, method: str, params: dict | None = None) -> dict:
        self.next += 1
        self.send({"jsonrpc": "2.0", "id": self.next, "method": method, **({"params": params} if params is not None else {})})
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("MCP サーバーが終わりました: " + self.proc.stderr.read())
        reply = json.loads(line)
        assert reply.get("id") == self.next, reply
        return reply

    def notify(self, method: str) -> None:
        self.send({"jsonrpc": "2.0", "method": method})

    def initialize(self, client: str, version: str = "2025-11-25") -> dict:
        """前の版の initialize で始め、initialized を知らせる。返事の result を返す。"""
        reply = self.request("initialize", {"protocolVersion": version, "capabilities": {}, "clientInfo": {"name": client, "version": "1"}})
        self.notify("notifications/initialized")
        return reply["result"]

    def call(self, name: str, args: dict | None = None) -> tuple[bool, object]:
        """道具を呼ぶ。(失敗したか, 中身) を返す。中身は JSON の文字なら読んだ値、画像なら content のまま。"""
        result = self.request("tools/call", {"name": name, "arguments": args or {}})["result"]
        content = result["content"]
        if not content or content[0]["type"] != "text":
            return bool(result.get("isError")), content
        try:
            return bool(result.get("isError")), json.loads(content[0]["text"])
        except json.JSONDecodeError:
            return bool(result.get("isError")), content[0]["text"]

    def close(self, timeout: float = 15) -> str:
        """標準入力を閉じて終わるのを待つ。標準エラーに出た文を返す。"""
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        return self.proc.stderr.read()
