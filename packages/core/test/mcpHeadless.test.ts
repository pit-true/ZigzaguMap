import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CfruProject, McpToolRunner, type McpToolResult } from "../src/index.js";
import { NodeProjectFs, appUsingProject, normalizeProjectPath, openHeadlessWorkspace } from "../src/node/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "zzm-headless-"));
  dirs.push(d);
  return d;
}

/** 合成 ROM と空のプロジェクトフォルダと印のフォルダ。 */
function setup() {
  const root = temp();
  const rom = join(root, "base.gba");
  writeFileSync(rom, buildSyntheticRom());
  const project = join(root, "project");
  mkdirSync(project);
  const inUse = join(root, "in-use");
  mkdirSync(inUse);
  return { rom, project, inUse };
}

function text(r: McpToolResult | null): string {
  return (r!.content[0] as { text: string }).text;
}

describe("画面なしの形（#522）", () => {
  it("開いて読む・書く・出力する。出力したものを読み直すと同じ", async () => {
    const { rom, project, inUse } = setup();
    const { workspace, openMs } = await openHeadlessWorkspace({ rom, project, permissions: { write: true, export: true, scripts: false }, inUseDir: inUse });
    expect(openMs).toBeGreaterThanOrEqual(0);
    const runner = new McpToolRunner(workspace);
    expect(JSON.parse(text(await runner.call("maps_list", {}))).maps).toHaveLength(3);
    await runner.call("map_open", { bank: 0, map: 0 });
    expect(text(await runner.call("map_setCells", { x: 0, y: 0, width: 2, height: 1, blocks: [7, 8] }))).toContain('"cells":2');
    expect((await runner.call("map_image", {}))!.content[0]!.type).toBe("image");
    const out = JSON.parse(text(await runner.call("project_export", {}))) as { written: string[] };
    expect(out.written).toContain("maps/00/00.json");
    // 出力したものを開き直すと、書いたブロックが入っている（ZigzaguMap で開くときと同じ読み方）
    const again = await CfruProject.open(buildSyntheticRom(), new NodeProjectFs(project));
    const doc = await again.load({ bank: 0, map: 0 });
    expect([doc.grid.getBlock(0, 0), doc.grid.getBlock(1, 0)]).toEqual([7, 8]);
    expect(readFileSync(join(project, "maps/00/00.json"), "utf8").length).toBeGreaterThan(10);
  });

  it("許可は起動の指定のとおり", async () => {
    const { rom, project, inUse } = setup();
    const { workspace } = await openHeadlessWorkspace({ rom, project, permissions: { write: false, export: false, scripts: false }, inUseDir: inUse });
    const runner = new McpToolRunner(workspace);
    await runner.call("map_open", { bank: 0, map: 0 });
    expect(text(await runner.call("map_setBlock", { x: 0, y: 0, block: 3 }))).toContain("許可されていません");
    expect(text(await runner.call("project_export", {}))).toContain("許可されていません");
  });

  it("ZigzaguMap が同じプロジェクトを開いている間は書き換えを断り、終われば書ける", async () => {
    const { rom, project, inUse } = setup();
    const { workspace } = await openHeadlessWorkspace({ rom, project, permissions: { write: true, export: true, scripts: false }, inUseDir: inUse });
    const runner = new McpToolRunner(workspace);
    await runner.call("map_open", { bank: 0, map: 0 });
    // 生きているほかのプロセス（このテストの親）を、同じプロジェクトを開いている ZigzaguMap に見立てる
    const mark = join(inUse, `${process.ppid}.json`);
    writeFileSync(mark, JSON.stringify({ pid: process.ppid, project: project.toUpperCase() + "\\" }));
    expect(await appUsingProject(project, inUse)).toBe(process.ppid);
    const r = await runner.call("map_setBlock", { x: 0, y: 0, block: 3 });
    expect(r?.isError).toBe(true);
    expect(text(r)).toContain("同じプロジェクトを開いている");
    expect(r && text(await runner.call("project_export", {}))).toContain("同じプロジェクトを開いている");
    expect(text(await runner.call("map_getBlock", { x: 0, y: 0 }))).toBe("1");
    // 別のプロジェクトの印や、終わったプロセスの印は数えない
    writeFileSync(mark, JSON.stringify({ pid: process.ppid, project: join(project, "..", "other") }));
    writeFileSync(join(inUse, "999999.json"), JSON.stringify({ pid: 999999, project }));
    expect(await appUsingProject(project, inUse)).toBeNull();
    expect((await runner.call("map_setBlock", { x: 0, y: 0, block: 3 }))?.isError).toBeUndefined();
  });

  it("ROM でないファイルと無いフォルダは分かる文で断る", async () => {
    const { project, inUse } = setup();
    const bad = join(temp(), "bad.gba");
    writeFileSync(bad, new Uint8Array(1024));
    await expect(openHeadlessWorkspace({ rom: bad, project, permissions: { write: false, export: false, scripts: false }, inUseDir: inUse })).rejects.toThrow("BPRJ");
    const { rom } = setup();
    await expect(openHeadlessWorkspace({ rom, project: join(project, "nothing"), permissions: { write: false, export: false, scripts: false } })).rejects.toThrow("プロジェクトフォルダがありません");
  });

  it("プロジェクトフォルダの外は読み書きしない", async () => {
    const fs = new NodeProjectFs(temp());
    await expect(fs.readText("../secret.txt")).rejects.toThrow("外は指せません");
    await expect(fs.writeText("C:/Windows/x.txt", "x")).rejects.toThrow("外は指せません");
    await expect(fs.writeText("maps\\..\\..\\x.txt", "x")).rejects.toThrow("外は指せません");
  });

  it("パスをそろえて比べる", () => {
    expect(normalizeProjectPath("\\\\?\\C:\\Foo\\Bar\\")).toBe(normalizeProjectPath("c:/foo/bar"));
  });
});
