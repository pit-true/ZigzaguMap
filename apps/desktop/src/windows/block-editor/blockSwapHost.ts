import { SwapBlocksCommand, type CfruProject, type CommandBus, type MapId, type TilesetRef } from "@zigzagumap/core";

/**
 * ブロックの入れ替え（#394）のメインのウィンドウ側。ToolWindowHost が、初めて頼まれたときに読み込む。
 *
 * - `tilesetUsers`: そのタイルセットを使うマップ（ROM と maps\ の両方。主なら主、副なら副が同じもの）。
 *   読み込んでいないベース ROM のマップはフッターのポインタだけを読み、JSON のマップは読み取り専用で読んで捨てる。
 * - `swapBlocks`: 付け替えるマップを読み込んでから、SwapBlocksCommand を 1 回実行する（1 回の取り消しで全部戻る）。
 */
export async function tilesetUsers(project: CfruProject, ref: TilesetRef): Promise<MapId[]> {
  const pointer = ref.pointer >>> 0;
  const rom = project.base.rom;
  const out: MapId[] = [];
  for (const id of project.mapIds()) {
    try {
      const loaded = project.loaded(id);
      let used: number;
      if (loaded) used = ref.secondary ? loaded.secondaryTileset : loaded.primaryTileset;
      else if (project.inBase(id) && !project.hasJson(id)) {
        const footer = rom.pointer(project.base.bankTable.headerOffset(id));
        used = rom.u32(footer + (ref.secondary ? 20 : 16));
      } else {
        const doc = await project.peek(id);
        if (!doc) continue;
        used = ref.secondary ? doc.secondaryTileset : doc.primaryTileset;
      }
      if (used >>> 0 === pointer) out.push(id);
    } catch {
      // 読めないマップは数えない
    }
  }
  return out;
}

/** 入れ替えの結果。 */
export interface SwapResult {
  /** 付け替えたマップの数。 */
  readonly maps: number;
  /** 読み込みと実行にかかった時間（ミリ秒）。 */
  readonly ms: number;
}

/** `a` と `b`（タイルセットの中の番号）を入れ替える。`remap` なら、そのタイルセットを使う全マップの番号も付け替える。 */
export async function swapBlocks(project: CfruProject, bus: CommandBus, ref: TilesetRef, a: number, b: number, remap: boolean): Promise<SwapResult> {
  const t0 = performance.now();
  const targets = remap ? await tilesetUsers(project, ref) : [];
  for (const id of targets) await project.load(id);
  bus.execute(SwapBlocksCommand.of(ref, a, b, targets));
  return { maps: targets.length, ms: Math.round(performance.now() - t0) };
}
