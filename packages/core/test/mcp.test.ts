import { describe, expect, it } from "vitest";
import {
  CfruProject,
  CoreMcpWorkspace,
  MCP_TOOLS,
  McpServer,
  McpToolRunner,
  MemoryProjectFs,
  USER_SCRIPT_METHODS,
  checkMcpArguments,
  mcpTool,
  mcpToolNameOf,
  type McpPermissions,
  type McpToolResult,
} from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

const ALL: McpPermissions = { write: true, export: true, scripts: true };

async function setup(permissions: McpPermissions = ALL, writeBlocked?: () => string | null) {
  const fs = new MemoryProjectFs();
  const project = await CfruProject.open(buildSyntheticRom(), fs);
  const ws = await CoreMcpWorkspace.create(project, { permissions, ...(writeBlocked ? { writeBlocked } : {}) });
  return { fs, project, ws, runner: new McpToolRunner(ws) };
}

function json(r: McpToolResult | null): unknown {
  expect(r).not.toBeNull();
  const first = r!.content[0]!;
  expect(first.type).toBe("text");
  return JSON.parse((first as { text: string }).text);
}

function errorOf(r: McpToolResult | null): string {
  expect(r?.isError).toBe(true);
  return (r!.content[0] as { text: string }).text;
}

describe("道具の定義", () => {
  it("zz API の画面の操作以外は、. を _ にした名前の道具がある", () => {
    for (const method of USER_SCRIPT_METHODS) {
      if (method.startsWith("ui.") || method.startsWith("view.")) continue;
      const tool = mcpTool(mcpToolNameOf(method));
      expect(tool, method).toBeDefined();
      expect(tool!.scriptMethod).toBe(method);
    }
  });

  it("名前は重ならず、MCP の名前の決まり（英数字と _）に合う", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[A-Za-z0-9_]{1,64}$/);
    for (const t of MCP_TOOLS) {
      expect(t.description.length).toBeGreaterThan(5);
      expect(t.inputSchema.additionalProperties).toBe(false);
      for (const r of t.inputSchema.required) expect(t.inputSchema.properties[r], `${t.name}.${r}`).toBeDefined();
    }
  });

  it("ROM・.s・パス・外部のコマンドを扱う道具は無い", () => {
    for (const t of MCP_TOOLS) {
      expect(t.name).not.toMatch(/rom|script|exec|run|file|path/i);
      for (const key of Object.keys(t.inputSchema.properties)) expect(key).not.toMatch(/path|dir|file|command/i);
    }
  });

  it("引数を確かめる", () => {
    const setBlock = mcpTool("map_setBlock")!;
    expect(checkMcpArguments(setBlock, { x: 0, y: 0, block: 1 })).toBeNull();
    expect(checkMcpArguments(setBlock, { x: 0, y: 0 })).toContain("block");
    expect(checkMcpArguments(setBlock, { x: 0, y: 0, block: 0x400 })).toContain("1023 以下");
    expect(checkMcpArguments(setBlock, { x: 0.5, y: 0, block: 1 })).toContain("整数");
    expect(checkMcpArguments(setBlock, { x: 0, y: 0, block: 1, path: "C:\\" })).toContain("知らない引数");
    expect(checkMcpArguments(setBlock, [1, 2])).toContain("オブジェクト");
    expect(checkMcpArguments(mcpTool("names_list")!, { kind: "trainers" })).toContain("maps / species");
    expect(checkMcpArguments(mcpTool("map_setCells")!, { x: 0, y: 0, width: 1, height: 1, blocks: [1, "a"] })).toContain("blocks[1]");
    expect(checkMcpArguments(mcpTool("events_set")!, { kind: "person", index: 0, fields: { flag: "x" } })).toContain("fields.flag");
  });
});

describe("道具の実行", () => {
  it("マップを開いて読む", async () => {
    const { runner } = await setup();
    const list = json(await runner.call("maps_list", {})) as { maps: { bank: number; map: number }[] };
    expect(list.maps.map((m) => `${m.bank}.${m.map}`)).toEqual(["0.0", "0.1", "1.0"]);
    expect(errorOf(await runner.call("map_getBlock", { x: 0, y: 0 }))).toContain("map_open");
    expect(json(await runner.call("map_open", { bank: 0, map: 0 }))).toMatchObject({ bank: 0, map: 0, width: 2, height: 2 });
    expect(json(await runner.call("map_getBlock", { x: 1, y: 1 }))).toBe(1);
    expect(json(await runner.call("map_getMovement", { x: 1, y: 1 }))).toBe(1);
    expect(json(await runner.call("map_getCells", {}))).toMatchObject({ width: 2, height: 2, blocks: [1, 2, 640, 1], movements: [0, 0, 0, 1] });
    expect(json(await runner.call("map_getCells", { x: 1, y: 0, height: 2 }))).toMatchObject({ width: 1, blocks: [2, 1] });
    expect(errorOf(await runner.call("map_getCells", { x: 1, width: 2 }))).toContain("収まりません");
    expect(errorOf(await runner.call("map_getBlock", { x: 5, y: 0 }))).toContain("マップ（2×2）の外");
    expect(json(await runner.call("maps_getCells", { bank: 1, map: 0 }))).toMatchObject({ width: 2, height: 2 });
    expect(errorOf(await runner.call("map_open", { bank: 9, map: 9 }))).toContain("ありません");
    expect(json(await runner.call("map_getBorder", { x: 0, y: 0 }))).toBe(1);
    expect(json(await runner.call("map_getHeader", {}))).toHaveProperty("music");
    const events = json(await runner.call("events_list", {})) as Record<string, unknown[]>;
    expect(events["person"]).toHaveLength(1);
    expect(json(await runner.call("events_get", { kind: "person", index: 0 }))).toHaveProperty("graphicsId");
    expect(errorOf(await runner.call("events_get", { kind: "person", index: 3 }))).toContain("ありません");
  });

  it("画像は PNG で返す", async () => {
    const { runner } = await setup();
    await runner.call("map_open", { bank: 0, map: 0 });
    const r = await runner.call("map_image", { width: 1 });
    const image = r!.content[0] as { type: string; data: string; mimeType: string };
    expect(image.type).toBe("image");
    expect(image.mimeType).toBe("image/png");
    const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
    expect([...bytes.subarray(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
    expect(json({ content: [r!.content[1]!] })).toEqual({ width: 16, height: 32 });
  });

  it("書き換えは 1 回の呼び出しが 1 回の元に戻すになり、窓口の分だけ戻せる", async () => {
    const { runner, ws, project } = await setup();
    await runner.call("map_open", { bank: 0, map: 0 });
    expect(json(await runner.call("map_setCells", { x: 0, y: 0, width: 2, height: 1, blocks: [5, 6], movements: [4, 4] }))).toMatchObject({ cells: 2 });
    expect(json(await runner.call("map_getCells", {}))).toMatchObject({ blocks: [5, 6, 640, 1], movements: [4, 4, 0, 1] });
    expect(ws.bus().history()).toHaveLength(1);
    expect(project.isModified({ bank: 0, map: 0 })).toBe(true);
    expect(json(await runner.call("edit_status", {}))).toMatchObject({ canUndo: true, canRedo: false, modifiedMaps: [{ bank: 0, map: 0 }] });
    await runner.call("edit_undo", {});
    expect(json(await runner.call("map_getCells", {}))).toMatchObject({ blocks: [1, 2, 640, 1], movements: [0, 0, 0, 1] });
    await runner.call("edit_redo", {});
    expect(json(await runner.call("map_getBlock", { x: 1, y: 0 }))).toBe(6);
    expect(json(await runner.call("map_fill", { x: 0, y: 0, value: 7, movement: true }))).toMatchObject({ cells: 2 });
    expect(json(await runner.call("map_getMovement", { x: 1, y: 0 }))).toBe(7);
    expect(errorOf(await runner.call("map_fill", { x: 0, y: 0, value: 100, movement: true }))).toContain("移動許可");
    await runner.call("map_shift", { dx: 1, dy: 0 });
    expect(json(await runner.call("map_getBlock", { x: 0, y: 0 }))).toBe(6);
    await runner.call("map_setBorder", { x: 1, y: 1, block: 9 });
    expect(json(await runner.call("map_getBorder", { x: 1, y: 1 }))).toBe(9);
    await runner.call("events_move", { kind: "person", index: 0, x: 1, y: 1 });
    expect(json(await runner.call("events_set", { kind: "person", index: 0, fields: { graphicsId: 5 } }))).toMatchObject({ graphicsId: 5, x: 1, y: 1 });
    expect(errorOf(await runner.call("events_set", { kind: "person", index: 0, fields: { nothing: 1 } }))).toContain("知らない項目");
    expect(errorOf(await runner.call("events_set", { kind: "person", index: 0, fields: { x: 1 } }))).toContain("events_move");

    // 利用者の操作（窓口の外で積んだもの）は戻さない
    const before = ws.bus().history().length;
    const { PlaceBlockCommand } = await import("../src/index.js");
    ws.bus().execute(new PlaceBlockCommand({ bank: 0, map: 0, x: 0, y: 1, block: 3 }));
    expect(errorOf(await runner.call("edit_undo", {}))).toContain("利用者の操作は戻しません");
    expect(ws.bus().history()).toHaveLength(before + 1);
  });

  it("許可の無い書き換えと出力を断る", async () => {
    const { runner, project, fs } = await setup({ write: false, export: false, scripts: false });
    await runner.call("map_open", { bank: 0, map: 0 });
    expect(errorOf(await runner.call("map_setBlock", { x: 0, y: 0, block: 3 }))).toContain("書き換えを許す");
    expect(errorOf(await runner.call("edit_undo", {}))).toContain("書き換えを許す");
    expect(errorOf(await runner.call("project_export", {}))).toContain("出力を許す");
    expect(project.isModified({ bank: 0, map: 0 })).toBe(false);
    expect(await fs.exists("maps/00/00.json")).toBe(false);
    // 読むだけの道具は使える
    expect(json(await runner.call("map_getBlock", { x: 0, y: 0 }))).toBe(1);
  });

  it("出力は maps\\ に書く。スクリプトのファイルも書く出力は別の許可が要る", async () => {
    const { runner, fs } = await setup();
    await runner.call("map_open", { bank: 0, map: 0 });
    await runner.call("map_setBlock", { x: 0, y: 0, block: 3 });
    const out = json(await runner.call("project_export", {})) as { written: string[] };
    expect(out.written.every((p) => p.startsWith("maps/"))).toBe(true);
    expect(await fs.exists("maps/00/00.json")).toBe(true);

    const project = await CfruProject.open(buildSyntheticRom(), new MemoryProjectFs());
    const ws = await CoreMcpWorkspace.create(project, { permissions: { write: true, export: true, scripts: false }, exportTouchesScripts: () => true });
    expect(errorOf(await new McpToolRunner(ws).call("project_export", {}))).toContain("スクリプトのファイル");
  });

  it("使用中のときは書き換えを断り、読むのは使える", async () => {
    const { runner } = await setup(ALL, () => "ZigzaguMap が開いています");
    await runner.call("map_open", { bank: 0, map: 0 });
    expect(errorOf(await runner.call("map_setBlock", { x: 0, y: 0, block: 3 }))).toBe("ZigzaguMap が開いています");
    expect(json(await runner.call("map_getBlock", { x: 0, y: 0 }))).toBe(1);
  });

  it("知らない道具は null", async () => {
    const { runner } = await setup();
    expect(await runner.call("rom_write", {})).toBeNull();
  });
});

describe("JSON-RPC の受け答え", () => {
  const modernMeta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };

  async function server() {
    const { runner } = await setup();
    return new McpServer((name, args) => runner.call(name, args));
  }

  it("前の版: initialize のあとで道具の一覧と呼び出し", async () => {
    const s = await server();
    const init = JSON.parse((await s.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } })))!);
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities).toEqual({ tools: {} });
    expect(await s.handleLine(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))).toBeNull();
    const list = JSON.parse((await s.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })))!);
    expect(list.result.tools).toHaveLength(MCP_TOOLS.length);
    expect(list.result.tools[0]).toMatchObject({ name: "maps_list", annotations: { readOnlyHint: true } });
    const call = JSON.parse((await s.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "map_open", arguments: { bank: 0, map: 1 } } })))!);
    expect(call.result.isError).toBeUndefined();
    expect(JSON.parse(call.result.content[0].text)).toMatchObject({ bank: 0, map: 1 });
    const unknown = JSON.parse((await s.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } })))!);
    expect(unknown.error.code).toBe(-32602);
  });

  it("知らない版を頼まれた initialize には、こちらの新しい版を返す", async () => {
    const s = await server();
    const init = JSON.parse((await s.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } })))!);
    expect(init.result.protocolVersion).toBe("2025-11-25");
  });

  it("新しい版: server/discover と _meta つきの頼み", async () => {
    const s = await server();
    const d = JSON.parse((await s.handleLine(JSON.stringify({ jsonrpc: "2.0", id: "d", method: "server/discover", params: { _meta: modernMeta } })))!);
    expect(d.result).toMatchObject({ resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
    const list = JSON.parse((await s.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: modernMeta } })))!);
    expect(list.result.resultType).toBe("complete");
    expect(list.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("zigzagumap");
    const bad = JSON.parse((await s.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: { ...modernMeta, "io.modelcontextprotocol/protocolVersion": "1900-01-01" } } })))!);
    expect(bad.error.code).toBe(-32022);
    expect(bad.error.data.supported).toContain("2026-07-28");
    const noMeta = JSON.parse((await s.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" })))!);
    expect(noMeta.error.code).toBe(-32602);
    const noCaps = JSON.parse((await s.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } })))!);
    expect(noCaps.error.code).toBe(-32602);
  });

  it("壊れた JSON と知らないメソッド", async () => {
    const s = await server();
    expect(JSON.parse((await s.handleLine("{"))!).error.code).toBe(-32700);
    const r = JSON.parse((await s.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/list", params: { _meta: modernMeta } })))!);
    expect(r.error.code).toBe(-32601);
  });
});
