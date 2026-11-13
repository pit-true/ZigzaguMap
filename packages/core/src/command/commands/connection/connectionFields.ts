import type { MapConnection } from "../../../connection/types.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";

/** 接続の項目（引数での名前）。`bank`・`map` は相手のマップ。 */
export interface ConnectionFields {
  /** 方向（0 無し、1 下、2 上、3 左、4 右、5 潜る、6 出現）。 */
  direction?: number;
  /** ずれ（ブロック数、符号つき）。 */
  offset?: number;
  /** 相手のバンク番号。 */
  targetBank?: number;
  /** 相手のマップ番号。 */
  targetMap?: number;
  /** 0x0A〜0x0B（AdvanceMap の「不明」）。 */
  padding?: number;
}

/** 項目を確かめて接続に書いたものを返す（元は変えない）。 */
export function applyConnectionFields(c: MapConnection, f: ConnectionFields): MapConnection {
  return {
    direction: f.direction === undefined ? c.direction : checkRange("direction", f.direction, 0, 6),
    offset: f.offset === undefined ? c.offset : checkRange("offset", f.offset, -0x80000000, 0x7fffffff),
    bank: f.targetBank === undefined ? c.bank : checkRange("targetBank", f.targetBank, 0, 0xff),
    map: f.targetMap === undefined ? c.map : checkRange("targetMap", f.targetMap, 0, 0xff),
    padding: f.padding === undefined ? c.padding : checkRange("padding", f.padding, 0, 0xffff),
  };
}

/** 番号の接続があるか確かめる。 */
export function requireConnection(doc: MapDocument, index: number): MapConnection {
  const list = doc.connections ?? [];
  const c = Number.isInteger(index) ? list[index] : undefined;
  if (!c) throw new EditError(EditErrorCode.ConnectionIndexOutOfRange, { index, count: list.length });
  return c;
}
