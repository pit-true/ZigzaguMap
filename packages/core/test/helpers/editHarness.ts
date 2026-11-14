/** 編集コマンドのテスト用の道具（状態の指紋、do → undo → redo、JSON からの再生）。 */

import { expect } from "vitest";
import {
  CfruProject,
  CommandBus,
  EditError,
  MapSourceConverter,
  MapSourceJson,
  MemoryProjectFs,
  createDefaultRegistry,
  type Command,
  type DocumentContext,
  type EditorContext,
  type MapId,
  type TilesetRef,
} from "../../src/index.js";

/** プロジェクトの編集中の状態を文字列にする（読み込み済みのマップ・タイルセット・マップ名・バンク数）。 */
export function fingerprint(project: CfruProject): string {
  const ctx = project.editorContext();
  const parts: string[] = [];
  for (const id of project.mapIds()) {
    const doc = project.loaded(id);
    if (doc) parts.push(`${id.bank}.${id.map}:${MapSourceJson.stringify(MapSourceConverter.toSource(doc))}`);
  }
  parts.push(`counts:${JSON.stringify(project.bankCounts())}`);
  for (let r = 0x58; r <= 0xc4; r++) {
    const edit = ctx.mapNameEdit(r);
    if (edit) parts.push(`name${r}:${[...edit].join(",")}`);
  }
  return parts.join("\n");
}

/** タイルセットの状態を文字列にする。 */
export function tilesetPrint(ctx: DocumentContext, refs: readonly TilesetRef[]): string {
  return refs.map((r) => ctx.tileset(r).toJson()).join("\n");
}

/** 合成 ROM のプロジェクトを開き、全マップとタイルセットを読み込む。 */
export async function openLoaded(rom: Uint8Array, fs = new MemoryProjectFs(), tilesets: readonly TilesetRef[] = []): Promise<CfruProject> {
  const project = await CfruProject.open(rom, fs);
  for (const id of project.mapIds()) await project.load(id);
  for (const ref of tilesets) await project.loadTilesetDocument(ref);
  return project;
}

/**
 * コマンドを実行し、undo で元に戻り、redo で同じ状態になることを確かめる。
 * さらに JSON にした引数から作り直したコマンドを別のプロジェクトで実行し、同じ状態になることを確かめる。
 * 実行後のプロジェクトを返す（`check` で中身を確かめる）。`contextOf` はコマンドに渡す入口（既定は editorContext()）。
 */
export async function roundTrip(
  open: () => Promise<CfruProject>,
  make: () => Command,
  check?: (project: CfruProject) => void,
  extra: (project: CfruProject) => string = () => "",
  contextOf: (project: CfruProject) => EditorContext = (p) => p.editorContext(),
): Promise<CfruProject> {
  const project = await open();
  const bus = new CommandBus(contextOf(project));
  const print = () => fingerprint(project) + extra(project);
  const before = print();
  const command = make();
  bus.execute(command);
  const after = print();
  expect(after).not.toBe(before);
  check?.(project);
  expect(bus.undo()).toBe(true);
  expect(print()).toBe(before);
  expect(bus.redo()).toBe(true);
  expect(print()).toBe(after);

  const replay = await open();
  const record = JSON.parse(JSON.stringify({ name: command.name, args: command.args })) as { name: string; args: Record<string, unknown> };
  new CommandBus(contextOf(replay)).execute(createDefaultRegistry().create(record));
  expect(fingerprint(replay) + extra(replay)).toBe(after);
  return project;
}

/** コマンドが EditError（`code`）で失敗し、状態も履歴も変わらないことを確かめる。引数も返す。 */
export function expectEditError(project: CfruProject, command: Command, code: string, params?: Record<string, unknown>): void {
  const bus = new CommandBus(project.editorContext());
  const before = fingerprint(project);
  let error: unknown = null;
  try {
    bus.execute(command);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(EditError);
  expect((error as EditError).code).toBe(code);
  if (params) expect((error as EditError).params).toMatchObject(params);
  expect(fingerprint(project)).toBe(before);
  expect(bus.canUndo).toBe(false);
}

/** マップ番号。 */
export const M00: MapId = { bank: 0, map: 0 };
export const M01: MapId = { bank: 0, map: 1 };
