import { TILE_BYTES, newTilesetCommand, type CfruProject, type CommandBus, type MapId } from "@zigzagumap/core";

/** 新しいタイルセットの選び方（ブロックエディタの窓から届く）。 */
export interface NewTilesetRequest {
  readonly secondary: boolean;
  readonly tileCount: number;
  readonly blockCount: number;
  /** 今のタイルセットの写しにするか（false なら空）。 */
  readonly copy: boolean;
}

/** 作った結果（ヘッダーのポインタ値と数）。 */
export interface NewTilesetResult {
  readonly pointer: number;
  readonly tileCount: number;
  readonly blockCount: number;
}

/**
 * 新しいタイルセット（#397）のメインのウィンドウ側。ToolWindowHost が、初めて頼まれたときに読み込む。
 * core の `newTilesetCommand`（`addTileset` と `setTilesets` の組）を 1 回実行し、表示中のマップの組を付け替える。
 */
export function createNewTileset(project: CfruProject, bus: CommandBus, target: MapId, req: NewTilesetRequest): NewTilesetResult {
  const r = newTilesetCommand(project.editorContext(), { target, ...req });
  bus.execute(r.command);
  return { pointer: r.pointer, tileCount: r.content.tiles.length / TILE_BYTES, blockCount: r.content.attributes.length };
}
