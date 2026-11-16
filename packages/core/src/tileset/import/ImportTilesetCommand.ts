/**
 * 画像からタイルとブロックを作る（Phase6 #443）: 計画をタイルセットへ書くコマンド。DOM に依存しない。
 *
 * - 今あるタイルセットへ: `setTiles`（書き換えた範囲）・`setPaletteColors`（色を書いた本ごと）・`setBlockData`（ブロックと属性）を
 *   1 つの `group` にまとめる。1 回の「元に戻す」で戻る。
 * - 新しいタイルセットへ: 計画で作った中身で `addTileset` と `setTilesets`（表示中のマップの組だけを付け替える。Phase5 Q9）の組。
 * - 出力は今の `tileset.json`・`tiles.png` の形のまま（タイル数は 16 の倍数、PNG は 16 色）。
 */
import type { Command } from "../../command/Command.js";
import { CommandGroup } from "../../command/CommandGroup.js";
import type { DocumentContext } from "../../command/DocumentContext.js";
import { SetTilesetsCommand } from "../../command/commands/layout/SetTilesetsCommand.js";
import { AddTilesetCommand, addTilesetArgs } from "../../command/commands/tileset/AddTilesetCommand.js";
import { SetBlockDataCommand } from "../../command/commands/tileset/SetBlockDataCommand.js";
import { SetPaletteColorsCommand } from "../../command/commands/tileset/SetPaletteColorsCommand.js";
import { SetTilesCommand } from "../../command/commands/tileset/SetTilesCommand.js";
import { encodeBase64 } from "../../binary/base64.js";
import { BLOCK_ID_MASK, TILE_BYTES } from "../../map/constants.js";
import type { MapId } from "../../map/types.js";
import { createStamp, type Stamp } from "../../project/StampJson.js";
import { ROM_BASE } from "../../rom/Rom.js";
import { newTilesetContent } from "../NewTileset.js";
import type { TilesetDocument } from "../TilesetDocument.js";
import { planImport, type ImportOptions, type ImportPlan, type ImportTable, type ImportTarget } from "./ImportPlan.js";
import type { ImportLayers } from "./ImportImage.js";

/** 取り込みの組（表示中のマップと、その組のタイルセット）。 */
export interface ImportContext {
  readonly map: MapId;
  readonly primary: TilesetDocument;
  readonly secondary: TilesetDocument;
}

/** 書いた結果。 */
export interface ImportCommandResult {
  readonly command: Command;
  /** 書いたタイルセットのポインタ値（新しいタイルセットなら新しい値）。 */
  readonly pointer: number;
  /** 書いた後の組のポインタ。 */
  readonly primaryPointer: number;
  readonly secondaryPointer: number;
}

/** TilesetDocument を計画の材料にする（配列は共有する。計画は書き換えない）。 */
export function importTable(doc: TilesetDocument): ImportTable {
  return { tiles: doc.tiles, palettes: doc.palettes, blocks: doc.blocks, attributes: doc.attributes };
}

/**
 * 計画からコマンドを作る（実行はしない）。計画が書き込めない（`result` が無い）なら Error。
 * 新しいタイルセットの位置は `context.newTilesetAddress()`。
 */
export function importTilesetCommand(context: DocumentContext, ctx: ImportContext, target: ImportTarget, plan: ImportPlan): ImportCommandResult {
  const r = plan.result;
  if (!plan.ok || !r) throw new Error("取り込みの計画に問題があるため書き込めません");
  const own = target.secondary ? ctx.secondary : ctx.primary;
  if (target.isNew) {
    const content = newTilesetContent({ secondary: target.secondary, tileCount: 1, blockCount: 1, copyFrom: null, compressed: own.compressed });
    const at = context.newTilesetAddress(0);
    const pointer = (ROM_BASE + at) >>> 0;
    const command = CommandGroup.of([
      new AddTilesetCommand(addTilesetArgs(at, { ...content, tiles: r.tiles, palettes: r.palettes, blocks: r.blocks, attributes: r.attributes })),
      new SetTilesetsCommand({ bank: ctx.map.bank, map: ctx.map.map, ...(target.secondary ? { secondary: pointer } : { primary: pointer }) }),
    ]);
    return {
      command,
      pointer,
      primaryPointer: target.secondary ? ctx.primary.pointer : pointer,
      secondaryPointer: target.secondary ? pointer : ctx.secondary.pointer,
    };
  }
  const ref = { tileset: own.pointer >>> 0, secondary: target.secondary };
  const commands: Command[] = [];
  if (r.tileRange) {
    const [start, end] = r.tileRange;
    commands.push(new SetTilesCommand({ ...ref, start, data: encodeBase64(r.tiles.subarray(start * TILE_BYTES, end * TILE_BYTES)) }));
  }
  for (const p of r.changedPalettes) commands.push(new SetPaletteColorsCommand({ ...ref, palette: p, colors: [...r.palettes.subarray(p * 16, p * 16 + 16)] }));
  commands.push(new SetBlockDataCommand({ ...ref, blocks: [...r.blocks], attributes: [...r.attributes] }));
  return { command: CommandGroup.of(commands), pointer: own.pointer >>> 0, primaryPointer: ctx.primary.pointer >>> 0, secondaryPointer: ctx.secondary.pointer >>> 0 };
}

/** 計画と書き込みをまとめて行うときの材料（自動操作と、ウィザードの「取り込む」）。 */
export interface RunImportInput {
  readonly layers: ImportLayers;
  readonly target: ImportTarget;
  readonly options?: ImportOptions;
  readonly blockUsed?: (block: number) => number;
  readonly otherSecondaryBlocks?: readonly Uint16Array[];
}

/** 表示中の組のタイルセットで計画を作り、書けるならコマンドも作る。 */
export function prepareImport(context: DocumentContext, ctx: ImportContext, input: RunImportInput): { plan: ImportPlan; result: ImportCommandResult | null } {
  const plan = planImport({
    layers: input.layers,
    target: input.target,
    primary: importTable(ctx.primary),
    secondary: importTable(ctx.secondary),
    ...(input.blockUsed ? { blockUsed: input.blockUsed } : {}),
    ...(input.otherSecondaryBlocks ? { otherSecondaryBlocks: input.otherSecondaryBlocks } : {}),
    ...(input.options ? { options: input.options } : {}),
  });
  return { plan, result: plan.ok ? importTilesetCommand(context, ctx, input.target, plan) : null };
}

/**
 * 画像の並びのままのスタンプ（#407 の C-12）。ブロックにしなかったマスは貼らないマス。移動許可は持たない。
 * 3 層のブロックは N の番号を置く（N+1 は 3 枚目に使われる）。
 */
export function importStamp(name: string, plan: ImportPlan, tilesets: { primary: number; secondary: number }, created?: string): Stamp | null {
  const values = [...plan.stampCells].map((b) => (b < 0 ? null : b & BLOCK_ID_MASK));
  if (values.every((v) => v === null)) return null;
  return createStamp(name, plan.cellsWide, plan.cellsHigh, values, tilesets, created, false);
}

