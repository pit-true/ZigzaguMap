import {
  MAP_HEADER_SIZE,
  MAP_LAYOUT_SIZE,
  ROM_BASE,
  TILESET_HEADER_SIZE,
  mapFooterCodec,
  mapHeaderCodec,
  type CfruProject,
  type MapDocument,
  type MapId,
  type TilesetDocument,
} from "@zigzagumap/core";

/** 高度なヘッダーのオフセット欄（ROM 先頭からの位置。ROM 上に無いものは null）。 */
export interface MapLocations {
  /** マップバンク表。 */
  readonly bankTable: number | null;
  /** そのバンクのマップ一覧。 */
  readonly bankList: number | null;
  /** マップヘッダー。 */
  readonly header: number | null;
  /** フッター（マップオフセット）。 */
  readonly layout: number | null;
  readonly events: number | null;
  readonly scripts: number | null;
  readonly connections: number | null;
  /** 境界ブロック。 */
  readonly border: number | null;
  /** ブロック配置。 */
  readonly blocks: number | null;
}

/** ポインタ部分を含むマップヘッダー・フッターの生のバイト列（高度なヘッダーの 16 進欄）。 */
export interface RawMapBytes {
  readonly header: Uint8Array;
  readonly footer: Uint8Array;
}

/**
 * ベース ROM 上の位置を求める。ZigzaguMap は ROM へ書かないので、ROM の位置が意味を持つのは
 * 「ベース ROM から読み、maps\ の JSON が無いマップ」だけ。それ以外（JSON から読んだマップ、新しく作ったマップ）は
 * ヘッダー・フッターとその先のデータを null（画面では AdvanceMap の未設定の書式 `$000000`）にする。
 * バンク表とバンクの一覧は、ROM にあるバンクなら出す。
 */
export class RomLocations {
  constructor(private readonly project: CfruProject) {}

  /** ROM 上の位置を読むマップか（ベース ROM にあり、JSON から読んでいない）。 */
  placed(id: MapId): boolean {
    return this.project.inBase(id) && !this.project.hasJson(id);
  }

  locations(id: MapId): MapLocations {
    const rom = this.project.rom;
    const table = this.project.base.bankTable;
    const bankList = id.bank < table.bankCount ? safe(() => rom.pointer(table.offset + id.bank * 4)) : null;
    const none = { header: null, layout: null, events: null, scripts: null, connections: null, border: null, blocks: null };
    if (!this.placed(id)) return { bankTable: table.offset, bankList, ...none };
    const headerAt = table.headerOffset(id);
    const h = mapHeaderCodec.decode(rom.slice(headerAt, MAP_HEADER_SIZE));
    const layout = toOffset(h.layout);
    const f = layout === null ? null : mapFooterCodec.decode(rom.slice(layout, MAP_LAYOUT_SIZE));
    return {
      bankTable: table.offset,
      bankList,
      header: headerAt,
      layout,
      events: toOffset(h.events),
      scripts: toOffset(h.scripts),
      connections: toOffset(h.connections),
      border: f ? toOffset(f.border) : null,
      blocks: f ? toOffset(f.blocks) : null,
    };
  }

  /**
   * ヘッダーとフッターのバイト列。設定（0x10 以降、幅・高さ・タイルセット・境界の大きさ）は編集中の値、
   * ポインタ（ヘッダーの 0x00〜0x0F、フッターの境界と配置）は ROM 上の位置を読むマップなら ROM の値、それ以外は 0。
   */
  rawBytes(doc: MapDocument): RawMapBytes {
    const loc = this.locations(doc.id);
    const ptr = (offset: number | null): number => (offset === null ? 0 : offset + ROM_BASE);
    const header = mapHeaderCodec.encode({
      ...doc.header,
      layout: ptr(loc.layout),
      events: ptr(loc.events),
      scripts: ptr(loc.scripts),
      connections: ptr(loc.connections),
    });
    const footer = mapFooterCodec.encode({
      width: doc.width,
      height: doc.height,
      border: ptr(loc.border),
      blocks: ptr(loc.blocks),
      primaryTileset: doc.primaryTileset,
      secondaryTileset: doc.secondaryTileset,
      borderWidth: doc.border.width,
      borderHeight: doc.border.height,
      padding: doc.footerPadding,
    });
    return { header, footer };
  }

  /**
   * タイルセットのヘッダー 24 バイト。編集中の値に、ROM にあるタイルセットならポインタ部分（画像・パレット・ブロック・属性）を ROM の値で埋める。
   */
  tilesetHeader(t: TilesetDocument): Uint8Array {
    const out = t.header.slice();
    const rom = this.project.rom;
    if (!t.isNew && rom.inRange(t.headerAddress, TILESET_HEADER_SIZE)) {
      for (const field of [0x04, 0x08, 0x0c, 0x14]) out.set(rom.slice(t.headerAddress + field, 4), field);
    }
    return out;
  }
}

/** ポインタ値を ROM 先頭からの位置にする（ROM 外・0 なら null）。 */
export function toOffset(pointer: number): number | null {
  return pointer >= ROM_BASE && pointer < ROM_BASE + 0x2000000 ? pointer - ROM_BASE : null;
}

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}
