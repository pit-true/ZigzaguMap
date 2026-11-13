import { DataError } from "../binary/DataError.js";
import type { MapDocument } from "../model/MapDocument.js";
import { encodeAmEvents } from "./AmEventFile.js";
import { encodeAmMap } from "./AmMapFile.js";

/** `.map` と `.evt` の中身。 */
export interface AmMapFiles {
  readonly map: Uint8Array;
  readonly events: Uint8Array;
}

/**
 * マップを AdvanceMap の `.map` と `.evt` にする（名前をつけて作成したマップを保存）。
 * タイルセットは AdvanceMap の番号で書くので、`tilesetIndex` でポインタ値を番号に直す。
 * 表に無いタイルセット（maps\tilesets で新しく作ったものなど）は番号で表せないので DataError。
 */
export function toAmMapFiles(doc: MapDocument, tilesetIndex: (pointer: number) => number | null): AmMapFiles {
  const index = (pointer: number): number => {
    const n = tilesetIndex(pointer);
    if (n === null) throw new DataError(`タイルセット 0x${(pointer >>> 0).toString(16).toUpperCase()} は AdvanceMap のタイルセット番号で表せません`);
    return n;
  };
  return {
    map: encodeAmMap({
      width: doc.width,
      height: doc.height,
      primaryTileset: index(doc.primaryTileset),
      secondaryTileset: index(doc.secondaryTileset),
      borderWidth: doc.border.width,
      borderHeight: doc.border.height,
      border: doc.border.cells,
      cells: doc.grid.cells,
    }),
    events: encodeAmEvents(doc.events),
  };
}
