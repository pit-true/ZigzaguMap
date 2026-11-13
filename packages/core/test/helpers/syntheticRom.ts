/** テスト用に、ROM が無くても読めるような小さな BPRJ 風 ROM を組み立てる。 */

export const SYN = {
  size: 0x100000,
  events: 0x59000,
  persons: 0x59020,
  warps: 0x59040,
  signs: 0x59050,
  connections: 0x59100,
  connectionList: 0x59110,
  scripts: 0x59200,
  scriptTable: 0x59220,
  wildTable: 0x59300,
  wildInfo: 0x59340,
  wildSlots: 0x59350,
  nameTable: 0x59400,
  name0: 0x59600,
  bankTable: 0x58000,
  bank0List: 0x57f00,
  bank1List: 0x57f10,
  headers: 0x56000,
  footer: 0x56100,
  blocks: 0x56200,
  border: 0x56300,
  primaryHeader: 0x55000,
  primaryTiles: 0x50000,
  primaryPalettes: 0x51000,
  primaryBlocks: 0x52000,
  primaryAttributes: 0x53000,
  secondaryHeader: 0x55100,
  secondaryTiles: 0x40000,
  secondaryPalettes: 0x41000,
  secondaryBlocks: 0x42000,
  secondaryAttributes: 0x43000,
} as const;

/** 色（BGR555）。 */
export const COLORS = { backdrop: 0x7c00, red: 0x001f, green: 0x03e0, white: 0x7fff } as const;

/** 2×2 マップの配置: [ブロック1, ブロック2(左右反転), ブロック640(副), ブロック1+移動許可1]。 */
export const MAP_CELLS = [1, 2, 640, (1 << 10) | 1] as const;

class Writer {
  constructor(readonly bytes: Uint8Array) {}
  u8(o: number, v: number): void {
    this.bytes[o] = v & 0xff;
  }
  u16(o: number, v: number): void {
    this.u8(o, v);
    this.u8(o + 1, v >> 8);
  }
  u32(o: number, v: number): void {
    this.u16(o, v & 0xffff);
    this.u16(o + 2, v >>> 16);
  }
  ptr(o: number, target: number): void {
    this.u32(o, 0x08000000 + target);
  }
  ascii(o: number, s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(o + i, s.charCodeAt(i));
  }
  put(o: number, data: Uint8Array): void {
    this.bytes.set(data, o);
  }
}

/** リテラルだけの LZ77（0x10 形式）圧縮。テスト用。 */
export function compressLiteralLz77(data: Uint8Array): Uint8Array {
  const out: number[] = [0x10, data.length & 0xff, (data.length >> 8) & 0xff, (data.length >> 16) & 0xff];
  for (let i = 0; i < data.length; i += 8) {
    out.push(0);
    for (let j = i; j < Math.min(i + 8, data.length); j++) out.push(data[j]!);
  }
  return Uint8Array.from(out);
}

/** 4bpp タイル（8×8）を作る。`pixel(x, y)` が色番号を返す。 */
function makeTile(pixel: (x: number, y: number) => number): Uint8Array {
  const tile = new Uint8Array(32);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x += 2) tile[y * 4 + x / 2] = (pixel(x, y) & 0xf) | ((pixel(x + 1, y) & 0xf) << 4);
  }
  return tile;
}

/** 合成 ROM を作る。 */
export function buildSyntheticRom(): Uint8Array {
  const w = new Writer(new Uint8Array(SYN.size));
  w.ascii(0xa0, "POKEMON FIRE");
  w.ascii(0xac, "BPRJ");
  w.ascii(0xb0, "01");
  w.u8(0xbc, 0);

  // バンク表: バンク0 に 2 枚、バンク1 に 1 枚。
  w.ptr(0x54b0c, SYN.bankTable);
  w.ptr(SYN.bankTable, SYN.bank0List);
  w.ptr(SYN.bankTable + 4, SYN.bank1List);
  w.ptr(SYN.bank0List, SYN.headers);
  w.ptr(SYN.bank0List + 4, SYN.headers + 28);
  w.ptr(SYN.bank1List, SYN.headers + 56);

  // マップヘッダー 3 枚（同じフッターを共有）。
  for (let i = 0; i < 3; i++) {
    const h = SYN.headers + i * 28;
    w.ptr(h, SYN.footer);
    w.u16(h + 0x10, 0x100 + i); // 曲
    w.u16(h + 0x12, 1); // レイアウト番号
    w.u8(h + 0x14, 0x58);
    w.u8(h + 0x16, 2); // 天気
    w.u8(h + 0x17, 1); // 種類
    w.u8(h + 0x1a, 0xff); // 階 -1
  }

  // フッター: 2×2、ボーダー 2×2。
  w.u32(SYN.footer, 2);
  w.u32(SYN.footer + 4, 2);
  w.ptr(SYN.footer + 8, SYN.border);
  w.ptr(SYN.footer + 12, SYN.blocks);
  w.ptr(SYN.footer + 16, SYN.primaryHeader);
  w.ptr(SYN.footer + 20, SYN.secondaryHeader);
  w.u8(SYN.footer + 24, 2);
  w.u8(SYN.footer + 25, 2);
  MAP_CELLS.forEach((c, i) => w.u16(SYN.blocks + i * 2, c));
  for (let i = 0; i < 4; i++) w.u16(SYN.border + i * 2, 1);

  // 主タイルセット（圧縮）。タイル1 = 色1、ただし左上 (0,0) だけ色2。
  w.u8(SYN.primaryHeader, 1);
  w.u8(SYN.primaryHeader + 1, 0);
  w.ptr(SYN.primaryHeader + 4, SYN.primaryTiles);
  w.ptr(SYN.primaryHeader + 8, SYN.primaryPalettes);
  w.ptr(SYN.primaryHeader + 12, SYN.primaryBlocks);
  w.ptr(SYN.primaryHeader + 20, SYN.primaryAttributes);
  const tiles = new Uint8Array(4 * 32);
  tiles.set(makeTile((x, y) => (x === 0 && y === 0 ? 2 : 1)), 32);
  w.put(SYN.primaryTiles, compressLiteralLz77(tiles));
  w.u16(SYN.primaryPalettes, COLORS.backdrop);
  w.u16(SYN.primaryPalettes + 2, COLORS.red);
  w.u16(SYN.primaryPalettes + 4, COLORS.green);
  // ブロック1: 下層 4 枚ともタイル1。ブロック2: 左上だけ左右反転。
  for (let p = 0; p < 4; p++) w.u16(SYN.primaryBlocks + 16 + p * 2, 1);
  for (let p = 0; p < 4; p++) w.u16(SYN.primaryBlocks + 32 + p * 2, p === 0 ? 0x401 : 1);
  w.u32(SYN.primaryAttributes + 4, 0x20000001);

  // 副タイルセット（非圧縮）。タイル640 = 全部色1、パレット7 の色1 = 白。
  w.u8(SYN.secondaryHeader, 0);
  w.u8(SYN.secondaryHeader + 1, 1);
  w.ptr(SYN.secondaryHeader + 4, SYN.secondaryTiles);
  w.ptr(SYN.secondaryHeader + 8, SYN.secondaryPalettes);
  w.ptr(SYN.secondaryHeader + 12, SYN.secondaryBlocks);
  w.ptr(SYN.secondaryHeader + 20, SYN.secondaryAttributes);
  w.put(SYN.secondaryTiles, makeTile(() => 1));
  w.u16(SYN.secondaryPalettes + (7 * 16 + 1) * 2, COLORS.white);
  // ブロック640: 上層だけタイル640（パレット7）。
  for (let p = 0; p < 4; p++) w.u16(SYN.secondaryBlocks + 8 + p * 2, (7 << 12) | 640);

  // マップ 0.0 のイベント: 人 1、ワープ 1、スクリプトタイル 0、看板 2（スクリプトと隠しアイテム）。
  const h0 = SYN.headers;
  w.ptr(h0 + 4, SYN.events);
  w.u8(SYN.events, 1);
  w.u8(SYN.events + 1, 1);
  w.u8(SYN.events + 2, 0);
  w.u8(SYN.events + 3, 2);
  w.ptr(SYN.events + 4, SYN.persons);
  w.ptr(SYN.events + 8, SYN.warps);
  w.u32(SYN.events + 12, 0);
  w.ptr(SYN.events + 16, SYN.signs);
  w.put(SYN.persons, Uint8Array.from(PERSON_BYTES));
  w.put(SYN.warps, Uint8Array.from(WARP_BYTES));
  w.put(SYN.signs, Uint8Array.from(SIGN_BYTES));

  // 接続 1 件（上へ、ずれ -2、相手 1.0）。
  w.ptr(h0 + 12, SYN.connections);
  w.u32(SYN.connections, 1);
  w.ptr(SYN.connections + 4, SYN.connectionList);
  w.put(SYN.connectionList, Uint8Array.from(CONNECTION_BYTES));

  // マップスクリプト: 種類 1（スクリプト直指し）と種類 2（条件表）。
  w.ptr(h0 + 8, SYN.scripts);
  w.u8(SYN.scripts, 1);
  w.u32(SYN.scripts + 1, 0x08123456);
  w.u8(SYN.scripts + 5, 2);
  w.ptr(SYN.scripts + 6, SYN.scriptTable);
  w.u8(SYN.scripts + 10, 0);
  w.u16(SYN.scriptTable, 0x4001);
  w.u16(SYN.scriptTable + 2, 3);
  w.u32(SYN.scriptTable + 4, 0x08654321);
  // 終端の後ろ 6 バイトにもごみを置き、そのまま保てるかを見る。
  w.put(SYN.scriptTable + 8, Uint8Array.from([0, 0, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]));

  // 野生: マップ 0.0 の水エリアだけ。
  w.ptr(0x8257c, SYN.wildTable);
  w.u8(SYN.wildTable, 0);
  w.u8(SYN.wildTable + 1, 0);
  w.ptr(SYN.wildTable + 8, SYN.wildInfo);
  w.u8(SYN.wildTable + 20, 0xff);
  w.u8(SYN.wildTable + 21, 0xff);
  w.u8(SYN.wildInfo, 4);
  w.ptr(SYN.wildInfo + 4, SYN.wildSlots);
  for (let i = 0; i < 5; i++) {
    w.u8(SYN.wildSlots + i * 4, 5 + i);
    w.u8(SYN.wildSlots + i * 4 + 1, 10 + i);
    w.u16(SYN.wildSlots + i * 4 + 2, 0x81 + i);
  }

  // マップ名表: 0x58 番（表の 0 番目）だけ「マサラ」。他は同じ名前を指す。
  w.ptr(0xc1e78, SYN.nameTable);
  for (let i = 0; i < 109; i++) w.ptr(SYN.nameTable + i * 4, SYN.name0);
  w.put(SYN.name0, Uint8Array.from(NAME_BYTES));

  return w.bytes;
}

/** マップ 0.0 の人（24 バイト）。 */
export const PERSON_BYTES = [
  1, 5, 0, 0, 3, 0, 4, 0, 3, 8, 0x21, 0, 1, 0, 2, 0, 0x78, 0x56, 0x34, 0x08, 0x10, 0x00, 0, 0,
];
/** マップ 0.0 のワープ（8 バイト）。 */
export const WARP_BYTES = [1, 0, 1, 0, 0, 2, 3, 4];
/** マップ 0.0 の看板 2 件（スクリプト、隠しアイテム）。 */
export const SIGN_BYTES = [
  0, 0, 1, 0, 0, 0, 0, 0, 0x11, 0x22, 0x33, 0x08, //
  1, 0, 1, 0, 0, 7, 0, 0, 0x0d, 0x00, 0x05, 0x81,
];
/** マップ 0.0 の接続（12 バイト）。 */
export const CONNECTION_BYTES = [2, 0, 0, 0, 0xfe, 0xff, 0xff, 0xff, 1, 0, 0, 0];
/** 「マサラ」 + 終端。 */
export const NAME_BYTES = [0x6f, 0x5b, 0x77, 0xff];
