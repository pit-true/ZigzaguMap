// メッセージの窓の字の絵（FR 日本語版のフォント 2・4・5 と、ND・Chronos が当てている漢字対応パッチの漢字）。
//
// - フォント 2（元のソースの fnt_poke10x12s.c。システム用）、4（fnt_poke10x12b.c。男の人の台詞）、5（fnt_poke10x12g.c。女の人の台詞）:
//   字の絵は 512 字ぶん 0x8000 バイト、幅の表は 1 字 1 バイト。場所は字を描く関数のリテラルが指す。空白（0 番）の幅は関数の中の即値（ND は 6 に変えている）。
//   フォント 3 はフォント 2 の絵を幅 10 で描く。
// - 人物に話しかけた文は、その人物の見た目の性別でフォント 4・5、ほかは 2（FieldBitMapTalkMsgSet 0x080F7DBC、GetObjSexCode 0x0813D468）。
// - 漢字対応パッチ ver.1.00: `FC 上位 下位`（Shift-JIS）。0x587C からのフックが上位バイトの範囲ごとの表（リテラル 0x58D0・0x58D4・0x58D8）を引き、
//   0x930C60 の処理が絵を読む。幅はいつも 10。
// - どちらも 1 画素 2 ビット、1 字 16×16（8×8 を 2×2）。1 行 16 ビット（リトルエンディアン）を上位ビットから 2 ビットずつ左の画素へ。
//   値は 1 が文字の色、2 が影の色、0 と 3 が背景の色（ROM の 0x081CDF40 の表）。上の 12 行だけを描く。

/** ROM のファイル（か、開いた ROM）の一部を読む。読めなければ投げる。 */
export type RomRangeReader = (offset: number, length: number) => Promise<Uint8Array>;

/** 字の高さ（上の 12 行を描く）。 */
export const MESSAGE_GLYPH_HEIGHT = 12;
/** 漢字の幅。 */
export const KANJI_WIDTH = 10;

/** FR 日本語版（BPRJ）のフォントの場所。 */
export const BPRJ_MESSAGE_FONT = {
  /** フォント 2 の絵を指すリテラル（字を描く関数 0x08006354 の中）。 */
  glyphsPointer: 0x63ec,
  /** フォント 2 の幅の表を指すリテラル。 */
  widthsPointer: 0x63f4,
  /** フォント番号 → 絵のリテラル・幅の表のリテラル・空白の幅の即値（movs r6, #幅）の位置。 */
  fonts: new Map<number, { glyphs: number; widths: number; space: number }>([
    [2, { glyphs: 0x63ec, widths: 0x63f4, space: 0x6374 }],
    [4, { glyphs: 0x6550, widths: 0x6558, space: 0x64d8 }],
    [5, { glyphs: 0x6614, widths: 0x661c, space: 0x659c }],
  ]),
  /** 見た目の番号 → 性別の表（4 ビットずつ）を指すリテラルと、表の大きさ（バイト）。 */
  sexTablePointer: 0x13d488,
  sexTableBytes: 0x4c,
  /** GetObjSexCode の命令（0x0813D468〜）。違えば表を使わない。 */
  sexCode: 0x13d468,
  glyphCount: 0x200,
  /** 漢字対応パッチのフック（上位バイトの振り分け）の位置と、表と処理を指すリテラル 4 つの位置。 */
  kanjiHook: 0x587c,
  kanjiLiterals: 0x58d0,
} as const;

const SEX_CODE = "00b50004010c420c0120014089004b2a";

/** 漢字対応パッチのフック（0x587C〜0x58CF）。違えばパッチは無いものとして扱う。 */
const KANJI_HOOK =
  "581e172800d907e0800002494018006887460000000c93088038012803d880000c4941180ce0c01f172803d880000a49411805e058380a2814d880000749411820680007000f022802d0001f012809d803488746";
/** 漢字を描く処理（0x930C60〜0x930CCF）。絵の場所の計算と幅 10・高さ 12 を確かめる。 */
const KANJI_ROUTINE =
  "32681078521c32600968f0b4061c0004c20c520207203040400140181418144d201c291c134a00f022f8201c1030291c2031104a00f01bf8802149006018291c40310c4a00f013f8882149006018291c6031084a00f00bf8281c80300a210170291c81310c200870f0bc034800471047";
/** 上位バイトの範囲（表のリテラルの順）。 */
const KANJI_RANGES: readonly (readonly [number, number])[] = [[0x81, 0x82], [0x88, 0x9f], [0xe0, 0xea]];
/** 漢字として描くフォント（フックが 2・4・5 のときだけ処理へ進む）。 */
export const KANJI_FONTS: ReadonlySet<number> = new Set([2, 4, 5]);

/** 1 字の絵。`pixels` は 16×12 の 2 ビットの値（0〜3）、行の順。 */
export interface MessageGlyph {
  readonly width: number;
  readonly pixels: Uint8Array;
  /** 背景の画素だけの字（空白は除く）。ROM に絵が無いものとして扱う。 */
  readonly blank: boolean;
}

/** フォントの出どころ（画面と自動操作で見せる）。 */
export interface MessageFontSource {
  /** かな・英数・記号を読んだ所（開いた ROM なら null）。 */
  readonly kana: string | null;
  /** 漢字を読んだ所（開いた ROM なら null）。漢字が無ければ undefined。 */
  readonly kanji?: string | null;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const u32 = (bytes: Uint8Array, at: number) => (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;
const romOffset = (address: number): number | null => (address >= 0x08000000 && address < 0x0a000000 ? address - 0x08000000 : null);

/** 16×16 の字の 4 タイル（64 バイト、並びは画像のまま）から上の 12 行を取り出す。 */
function decodeCell(read: (offset: number) => number, base: number): Uint8Array {
  const pixels = new Uint8Array(16 * MESSAGE_GLYPH_HEIGHT);
  for (let y = 0; y < MESSAGE_GLYPH_HEIGHT; y++) {
    for (let half = 0; half < 2; half++) {
      const tile = base + half * 0x10 + (y >= 8 ? 0x100 : 0) + (y & 7) * 2;
      const row = read(tile) | (read(tile + 1) << 8);
      for (let x = 0; x < 8; x++) pixels[y * 16 + half * 8 + x] = (row >> (14 - x * 2)) & 3;
    }
  }
  return pixels;
}

const isBlank = (pixels: Uint8Array, width: number) => {
  for (let y = 0; y < MESSAGE_GLYPH_HEIGHT; y++) for (let x = 0; x < width; x++) {
    const v = pixels[y * 16 + x]!;
    if (v === 1 || v === 2) return false;
  }
  return true;
};

/** 読んだフォント。字の絵は使うときに作って覚える。 */
/** 1 つのフォントの絵と幅。 */
export interface MessageFontFace {
  readonly glyphs: Uint8Array;
  readonly widths: Uint8Array;
  readonly space: number;
}

export class MessageFont {
  private readonly cache = new Map<number, MessageGlyph>();

  private constructor(
    /** フォント番号（2・4・5）→ 絵と幅。 */
    private readonly faces: ReadonlyMap<number, MessageFontFace>,
    /** 見た目の番号の性別の表（読めなければ null）。 */
    private readonly sexTable: Uint8Array | null,
    /** 漢字の絵（読んだ範囲）と、その先頭の ROM のオフセット。 */
    private readonly kanjiData: Uint8Array | null,
    private readonly kanjiStart: number,
    /** 上位バイト → 絵の先頭（ROM のオフセット）。 */
    private readonly kanjiBases: ReadonlyMap<number, number>,
    readonly source: MessageFontSource,
  ) {}

  /** 漢字の絵があるか。 */
  get hasKanji(): boolean {
    return this.kanjiData !== null;
  }

  /** 持っているバイト数（測定用）。 */
  get byteLength(): number {
    let n = (this.kanjiData?.length ?? 0) + (this.sexTable?.length ?? 0);
    for (const face of this.faces.values()) n += face.glyphs.length + face.widths.length;
    return n;
  }

  /** 描けるフォントか（2・3・4・5 のうち読めたもの）。 */
  hasFace(fontId: number): boolean {
    return this.faces.has(fontId === 3 ? 2 : fontId);
  }

  /**
   * 人物（見た目の番号）に話しかけたときの文のフォント。男 4、女 5、ほか（看板・ラベルからの再生・表の外）は 2。
   * 0xF0 以上（変数で決まる見た目）は分からないので 2。
   */
  speakerFont(graphicsId: number | null): number {
    if (graphicsId === null || !this.sexTable || graphicsId >= 0xf0) return 2;
    const index = graphicsId >> 1;
    if (index >= this.sexTable.length) return 2;
    const sex = (this.sexTable[index]! >> ((graphicsId & 1) * 4)) & 15;
    return sex === 0 && this.faces.has(4) ? 4 : sex === 1 && this.faces.has(5) ? 5 : 2;
  }

  /** 読んだバイト列から作る（テスト用）。 */
  static fromData(
    glyphs: Uint8Array,
    widths: Uint8Array,
    kanji: { data: Uint8Array; start: number; bases: ReadonlyMap<number, number> } | null = null,
    source: MessageFontSource = { kana: null },
    extra: { faces?: ReadonlyMap<number, MessageFontFace>; sexTable?: Uint8Array; space?: number } = {},
  ): MessageFont {
    const faces = new Map(extra.faces ?? []);
    faces.set(2, { glyphs, widths, space: extra.space ?? 10 });
    return new MessageFont(faces, extra.sexTable ?? null, kanji?.data ?? null, kanji?.start ?? 0, kanji?.bases ?? new Map(), source);
  }

  /**
   * ROM からフォント 2 を読む。`kanji` を付けると漢字対応パッチの絵も読む（パッチが無ければ漢字無し）。
   * 読めないときは null。
   */
  static async read(read: RomRangeReader, options: { kanji?: boolean; source?: MessageFontSource } = {}): Promise<MessageFont | null> {
    const f = BPRJ_MESSAGE_FONT;
    try {
      const faces = new Map<number, MessageFontFace>();
      for (const [id, at] of f.fonts) {
        const face = await readFace(read, at).catch(() => null);
        if (face) faces.set(id, face);
        else if (id === 2) return null;
      }
      let sexTable: Uint8Array | null = null;
      try {
        if (hex(await read(f.sexCode, SEX_CODE.length / 2)) === SEX_CODE) {
          const table = romOffset(u32(await read(f.sexTablePointer, 4), 0));
          if (table !== null) sexTable = (await read(table, f.sexTableBytes)).slice();
          if (sexTable?.length !== f.sexTableBytes) sexTable = null;
        }
      } catch {
        sexTable = null;
      }
      const kanji = options.kanji ? await readKanji(read) : null;
      return new MessageFont(faces, sexTable, kanji?.data ?? null, kanji?.start ?? 0, kanji?.bases ?? new Map(), options.source ?? { kana: null, ...(kanji ? { kanji: null } : {}) });
    } catch {
      return null;
    }
  }

  /** フォント `fontId`（2〜5）の字（0〜0x1FF）。フォント 3 はフォント 2 の絵を幅 10 で。読めないフォントなら null。 */
  glyph(code: number, fontId = 2): MessageGlyph | null {
    if (code < 0 || code >= BPRJ_MESSAGE_FONT.glyphCount) return null;
    const fixed = fontId === 3, face = this.faces.get(fixed ? 2 : fontId);
    if (!face) return null;
    const key = code | (fontId << 12);
    let glyph = this.cache.get(key);
    if (!glyph) {
      if (code === 0) {
        glyph = { width: fixed ? 10 : face.space, pixels: new Uint8Array(16 * MESSAGE_GLYPH_HEIGHT).fill(3), blank: false };
      } else {
        const pixels = decodeCell((o) => face.glyphs[o]!, 0x200 * (code >> 3) + 0x20 * (code & 7));
        const width = fixed ? 10 : face.widths[code]!;
        glyph = { width, pixels, blank: width === 0 || isBlank(pixels, width) };
      }
      this.cache.set(key, glyph);
    }
    return glyph;
  }

  /** 漢字（`FC lead trail`）。上位バイトが範囲の外か、漢字の絵が無ければ null。 */
  kanji(lead: number, trail: number): MessageGlyph | null {
    const base = this.kanjiBases.get(lead);
    if (base === undefined || !this.kanjiData) return null;
    const key = 0x20000 | (lead << 8) | trail;
    let glyph = this.cache.get(key);
    if (!glyph) {
      const start = base + 0x200 * (trail >> 3) + 0x20 * (trail & 7) - this.kanjiStart;
      if (start < 0 || start + 0x120 > this.kanjiData.length) return null;
      const pixels = decodeCell((o) => this.kanjiData![o]!, start);
      glyph = { width: KANJI_WIDTH, pixels, blank: !(lead === 0x81 && trail === 0x40) && isBlank(pixels, KANJI_WIDTH) };
      this.cache.set(key, glyph);
    }
    return glyph;
  }

  /** 漢字の上位バイトか（パッチの振り分けの範囲）。 */
  static isKanjiLead(lead: number): boolean {
    return KANJI_RANGES.some(([lo, hi]) => lead >= lo && lead <= hi);
  }
}

/** 字を描く関数のリテラルから、1 つのフォントの絵・幅の表・空白の幅を読む。 */
async function readFace(read: RomRangeReader, at: { glyphs: number; widths: number; space: number }): Promise<MessageFontFace | null> {
  const f = BPRJ_MESSAGE_FONT;
  const glyphsAt = romOffset(u32(await read(at.glyphs, 4), 0)), widthsAt = romOffset(u32(await read(at.widths, 4), 0));
  if (glyphsAt === null || widthsAt === null) return null;
  const glyphs = await read(glyphsAt, f.glyphCount * 0x40), widths = await read(widthsAt, f.glyphCount);
  if (glyphs.length !== f.glyphCount * 0x40 || widths.length !== f.glyphCount) return null;
  const space = await read(at.space, 2);
  return { glyphs, widths, space: space[1] === 0x26 ? space[0]! : 10 };
}

/** 漢字対応パッチを確かめて、表と絵を読む。パッチが無ければ null。 */
export async function readKanji(read: RomRangeReader): Promise<{ data: Uint8Array; start: number; bases: Map<number, number> } | null> {
  const f = BPRJ_MESSAGE_FONT;
  const hook = await read(f.kanjiHook, KANJI_HOOK.length / 2);
  if (hex(hook) !== KANJI_HOOK) return null;
  const literals = await read(f.kanjiLiterals, 16);
  const routine = romOffset(u32(literals, 12) & ~1);
  if (routine === null || hex(await read(routine, KANJI_ROUTINE.length / 2)) !== KANJI_ROUTINE) return null;
  const bases = new Map<number, number>();
  for (const [i, [lo, hi]] of KANJI_RANGES.entries()) {
    const table = romOffset(u32(literals, i * 4));
    if (table === null) return null;
    const entries = await read(table, (hi - lo + 1) * 4);
    for (let lead = lo; lead <= hi; lead++) {
      const base = romOffset(u32(entries, (lead - lo) * 4));
      if (base === null) return null;
      bases.set(lead, base);
    }
  }
  // 下位バイトは 0x40〜0xFC。その範囲の絵をまとめて読む。
  const values = [...bases.values()];
  const start = Math.min(...values) + 0x200 * (0x40 >> 3);
  const end = Math.max(...values) + 0x200 * (0xfc >> 3) + 0x200;
  if (end - start > 0x100000) return null;
  const data = await read(start, end - start);
  if (data.length !== end - start) return null;
  return { data, start, bases };
}
