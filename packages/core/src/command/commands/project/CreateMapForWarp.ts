import { NEW_CONNECTED_MAP_CELL } from "../../../connection/ConnectionSlots.js";
import { BLOCK_ID_MASK, MOVEMENT_SHIFT } from "../../../map/constants.js";
import type { MapId } from "../../../map/types.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import type { CfruProject } from "../../../project/CfruProject.js";
import type { Command } from "../../Command.js";
import { CommandGroup } from "../../CommandGroup.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { FillLayoutCommand } from "../connection/createConnectedMap.js";
import { AddEventCommand } from "../event/AddEventCommand.js";
import { SetEventFieldsCommand } from "../event/SetEventFieldsCommand.js";
import { SetBorderCommand } from "../layout/SetBorderCommand.js";
import { PaintCellValuesCommand } from "../PaintCellValuesCommand.js";
import { CreateMapCommand } from "./CreateMapCommand.js";

/** 見本が無いときの新しいマップの大きさ（9×9。HexManiacAdvance と同じ）。 */
export const WARP_MAP_SIZE = 9;

/** 見本（同じタイルセットの組で、同じブロックに乗っているほかのワープの行き先）。 */
export interface WarpSample {
  /** 見本のワープがあるマップと番号。 */
  readonly source: MapId;
  readonly sourceWarp: number;
  /** 行き先のマップ（新しいマップの写し元）。 */
  readonly map: MapId;
  readonly width: number;
  readonly height: number;
  readonly primaryTileset: number;
  readonly secondaryTileset: number;
  /** 行き先のワープの位置（新しいマップの戻りのワープを置く場所）。 */
  readonly entry: { readonly x: number; readonly y: number };
}

/**
 * ワープ `warpIndex`（マップ `from`）の行き先の見本を探す（#241）。全マップのうち、`from` と主・副のタイルセットが同じで、
 * 同じブロックの上にあるワープの行き先（マップがあり、行き先のワープもあるもの）。行き先のマップごとに 1 つ、最大 `limit` 件。
 * マップは読み取り専用で読む（開いたマップの一覧に入れない）。
 */
export async function findWarpSamples(project: CfruProject, from: MapId, warpIndex: number, limit = 8): Promise<WarpSample[]> {
  const doc = project.loaded(from) ?? (await project.peek(from));
  const warp = doc?.events?.warps[warpIndex];
  if (!doc || !warp || warp.x >= doc.width || warp.y >= doc.height) return [];
  const block = doc.grid.getBlock(warp.x, warp.y);
  const p = doc.primaryTileset >>> 0;
  const s = doc.secondaryTileset >>> 0;
  const out: WarpSample[] = [];
  const seen = new Set<string>();
  for (const id of project.mapIds()) {
    if (out.length >= limit) break;
    const other: MapDocument | null = id.bank === from.bank && id.map === from.map ? doc : await project.peek(id).catch(() => null);
    if (!other || other.primaryTileset >>> 0 !== p || other.secondaryTileset >>> 0 !== s) continue;
    const warps = other.events?.warps ?? [];
    for (let i = 0; i < warps.length && out.length < limit; i++) {
      const w = warps[i]!;
      if (other === doc && i === warpIndex) continue;
      if (w.x >= other.width || w.y >= other.height || other.grid.getBlock(w.x, w.y) !== block) continue;
      const key = `${w.bank}.${w.map}`;
      if (seen.has(key)) continue;
      const dest = await project.peek({ bank: w.bank, map: w.map }).catch(() => null);
      const entry = dest?.events?.warps[w.warpId];
      if (!dest || !entry) continue;
      seen.add(key);
      out.push({
        source: id,
        sourceWarp: i,
        map: { bank: w.bank, map: w.map },
        width: dest.width,
        height: dest.height,
        primaryTileset: dest.primaryTileset >>> 0,
        secondaryTileset: dest.secondaryTileset >>> 0,
        entry: { x: entry.x, y: entry.y },
      });
    }
  }
  return out;
}

/** 行き先のマップを作る指定。 */
export interface WarpMapPlan {
  /** 元のワープ。 */
  readonly from: MapId;
  readonly warpIndex: number;
  /** 新しいマップの番号（バンクの末尾か、新しいバンクのマップ 0）。 */
  readonly target: MapId;
  /** 見本（無ければ今のマップのタイルセットで 9×9）。 */
  readonly sample: WarpSample | null;
  /** 見本の配置をそのまま写すか（false ならブロック 0 で埋める。大きさは見本に合わせる）。 */
  readonly copyLayout: boolean;
}

/**
 * 「行き先のマップを作る」（ワープの右クリック。#241）を、既存のコマンドの組み合わせで作る（1 回の操作）。
 * - 新しいマップ: 見本があれば見本の大きさ・タイルセット・ヘッダー・境界（`copyLayout` なら配置も）、無ければ 9×9 で、
 *   今のマップのタイルセット・ヘッダー・境界、配置はブロック 0（移動許可 0x0C）。
 * - 新しいマップのワープ 0 を、元のワープの番号へ向けて置く（見本があれば見本の行き先のワープの位置、無ければ下の辺の中央）。
 * - 元のワープを、新しいマップのワープ 0 へ向ける。
 * 見本のマップと今のマップは読み込んでおくこと（見本は写すときだけ）。
 */
export function createMapForWarp(context: DocumentContext, plan: WarpMapPlan, sampleDoc: MapDocument | null = null): Command {
  const from = context.document(plan.from);
  const sample = plan.sample;
  const template = sample && sampleDoc ? sampleDoc : from;
  const width = sample ? sample.width : WARP_MAP_SIZE;
  const height = sample ? sample.height : WARP_MAP_SIZE;
  const entry = sample ? sample.entry : { x: Math.floor(width / 2), y: height - 1 };
  const t = plan.target;
  const commands: Command[] = [
    new CreateMapCommand({
      bank: t.bank,
      map: t.map,
      width,
      height,
      primaryTileset: (sample ? sample.primaryTileset : from.primaryTileset) >>> 0,
      secondaryTileset: (sample ? sample.secondaryTileset : from.secondaryTileset) >>> 0,
      templateBank: sample ? sample.map.bank : plan.from.bank,
      templateMap: sample ? sample.map.map : plan.from.map,
    }),
    new SetBorderCommand({ bank: t.bank, map: t.map, width: template.border.width, height: template.border.height, cells: [...template.border.cells] }),
  ];
  if (sample && sampleDoc && plan.copyLayout) {
    const cells: { x: number; y: number; block: number; movement: number }[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = sampleDoc.grid.getCell(x, y);
        cells.push({ x, y, block: v & BLOCK_ID_MASK, movement: v >> MOVEMENT_SHIFT });
      }
    }
    commands.push(new PaintCellValuesCommand({ bank: t.bank, map: t.map, cells }));
  } else {
    commands.push(new FillLayoutCommand({ bank: t.bank, map: t.map, cell: NEW_CONNECTED_MAP_CELL }));
  }
  commands.push(
    new AddEventCommand({ bank: t.bank, map: t.map, kind: "warp", x: entry.x, y: entry.y }),
    new SetEventFieldsCommand({ bank: t.bank, map: t.map, kind: "warp", index: 0, fields: { bank: plan.from.bank, map: plan.from.map, warpId: plan.warpIndex } }),
    new SetEventFieldsCommand({ bank: plan.from.bank, map: plan.from.map, kind: "warp", index: plan.warpIndex, fields: { bank: t.bank, map: t.map, warpId: 0 } }),
  );
  return CommandGroup.of(commands);
}
