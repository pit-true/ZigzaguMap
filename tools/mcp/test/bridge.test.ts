import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge.js";
import { parseArgs, serveStdio } from "../src/main.js";

const TOKEN = "0123456789abcdef0123456789abcdef";

/** ZigzaguMap の窓口の代わり（合言葉を確かめ、届いた頼みを覚えて決まった返事をする）。 */
async function fakeApp(): Promise<{ server: Server; port: number; seen: { tool: string; arguments: unknown; auth: string | undefined }[] }> {
  const seen: { tool: string; arguments: unknown; auth: string | undefined }[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      const parsed = JSON.parse(body) as { tool: string; arguments: unknown };
      seen.push({ ...parsed, auth: req.headers.authorization });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401).end('{"error":"合言葉が違います"}');
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ echo: parsed.tool }) }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  return { server, port: typeof address === "object" && address ? address.port : 0, seen };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function profileWith(info: object | null): string {
  const dir = mkdtempSync(join(tmpdir(), "zzm-mcp-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  if (info) writeFileSync(join(dir, "mcp.json"), JSON.stringify(info));
  return dir;
}

describe("開いている ZigzaguMap につなぐ", () => {
  it("mcp.json のポートへ合言葉を付けて送る", async () => {
    const app = await fakeApp();
    cleanups.push(() => app.server.close());
    const client = new BridgeClient(profileWith({ version: 1, port: app.port, token: TOKEN, pid: 1 }));
    const r = await client.call("map_setBlock", { x: 1, y: 2, block: 3 });
    expect(r?.isError).toBeUndefined();
    expect(JSON.parse((r!.content[0] as { text: string }).text)).toEqual({ echo: "map_setBlock" });
    expect(app.seen).toEqual([{ tool: "map_setBlock", arguments: { x: 1, y: 2, block: 3 }, auth: `Bearer ${TOKEN}` }]);
  });

  it("合言葉が違えば断られたと返す", async () => {
    const app = await fakeApp();
    cleanups.push(() => app.server.close());
    const client = new BridgeClient(profileWith({ port: app.port, token: "f".repeat(32) }));
    const r = await client.call("maps_list", {});
    expect(r?.isError).toBe(true);
    expect((r!.content[0] as { text: string }).text).toContain("合言葉");
  });

  it("ZigzaguMap が開いていない・窓口がオフのときはその旨を返す", async () => {
    const off = await new BridgeClient(profileWith(null)).call("maps_list", {});
    expect((off!.content[0] as { text: string }).text).toContain("MCP の窓口");
    // mcp.json が残っていても、待ち受けていなければ同じ
    const app = await fakeApp();
    const port = app.port;
    await new Promise((r) => app.server.close(r));
    const stale = await new BridgeClient(profileWith({ port, token: TOKEN })).call("maps_list", {});
    expect(stale?.isError).toBe(true);
    expect((stale!.content[0] as { text: string }).text).toContain("MCP の窓口");
  });

  it("知らない道具は送らない", async () => {
    const app = await fakeApp();
    cleanups.push(() => app.server.close());
    expect(await new BridgeClient(profileWith({ port: app.port, token: TOKEN })).call("rom_write", {})).toBeNull();
    expect(app.seen).toHaveLength(0);
  });
});

describe("stdio", () => {
  it("1 行 1 通で答え、stdin が閉じたら終わる", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (c: Buffer) => (text += c.toString("utf8")));
    const done = serveStdio(async (name) => (name === "maps_list" ? { content: [{ type: "text", text: "[]" }] } : null), input, output);
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }) + "\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "maps_list", arguments: {} } }) + "\n");
    input.end();
    await done;
    const lines = text.trim().split("\n").map((l) => JSON.parse(l) as { id: number; result: Record<string, unknown> });
    expect(lines.map((l) => l.id)).toEqual([1, 2, 3]);
    expect((lines[1]!.result["tools"] as unknown[]).length).toBeGreaterThan(20);
    expect(lines[2]!.result["content"]).toEqual([{ type: "text", text: "[]" }]);
  });

  it("引数", () => {
    const none = { profile: null, rom: null, project: null, allowWrite: false, allowExport: false };
    expect(parseArgs([])).toEqual(none);
    expect(parseArgs(["--profile", "D:\\p"])).toEqual({ ...none, profile: "D:\\p" });
    expect(parseArgs(["--rom", "a.gba", "--project", "p", "--allow-write"])).toEqual({ ...none, rom: "a.gba", project: "p", allowWrite: true });
    expect(() => parseArgs(["--rom", "a.gba"])).toThrow("両方");
    expect(() => parseArgs(["--allow-write"])).toThrow("画面なしの形");
    expect(() => parseArgs(["--port", "1"])).toThrow("知らない引数");
    expect(() => parseArgs(["--profile"])).toThrow("値を書いて");
  });
});
