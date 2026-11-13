import type { Rom } from "../rom/Rom.js";
import type { TextCodec } from "./TextCodec.js";

/** 道具の表の 1 件のバイト数（日本語版）。 */
export const ITEM_ENTRY_SIZE = 40;
/** 道具の名前の欄のバイト数（日本語版。終端 0xFF を含む）。 */
export const ITEM_NAME_BYTES = 10;

/** 道具の名前の表（看板の隠しアイテムの「アイテムID:」の選択肢用）。 */
export class ItemNameTable {
  private constructor(readonly names: readonly string[]) {}

  /** ROM の道具の表から、`count` 件の名前を読む。 */
  static read(rom: Rom, tablePointer: number, count: number, codec: TextCodec): ItemNameTable {
    const offset = rom.pointer(tablePointer);
    const names: string[] = [];
    for (let i = 0; i < count; i++) names.push(codec.decode(rom.slice(offset + i * ITEM_ENTRY_SIZE, ITEM_NAME_BYTES)));
    return new ItemNameTable(names);
  }

  /** 道具の数。 */
  get count(): number {
    return this.names.length;
  }
}
