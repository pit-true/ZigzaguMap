import type { Rom } from "../rom/Rom.js";
import { ROM_BASE } from "../rom/Rom.js";
import type { WeatherOffsets } from "../game/offsets.js";
import type { AnimationReader } from "../sprite/SpriteAnimation.js";

/** 天候の絵の種類（wea_*.c の actHeader ごと）。 */
export type WeatherObjectKind = "cloud" | "rain" | "snow" | "fog" | "ash" | "fogDiagonal" | "sandstorm" | "bubble";

/** OAM の形と大きさ（[shape][size]）。 */
const DIMENSIONS = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],
  [[16, 8], [32, 8], [32, 16], [64, 32]],
  [[8, 16], [8, 32], [16, 32], [32, 64]],
] as const;

/**
 * 1 種類の天候の絵。タイルは 1 画素 1 バイトの色番号で持ち（RGBA にしない）、描くときに今の色で引く。
 * 64×64 の絵でも 4KB で、雷で色が変わっても作り直さない。
 */
export interface WeatherObjectGraphics {
  readonly kind: WeatherObjectKind;
  /** 色番号（タイルごとに 64 バイト、1D の並び）。 */
  readonly tiles: Uint8Array;
  readonly tileCount: number;
  /** OAM の大きさ・BG に対する優先度・半透明か。 */
  readonly width: number;
  readonly height: number;
  readonly priority: number;
  readonly semiTransparent: boolean;
  /** アニメの表（コマの番号はタイルの番号。雪は転送の表の番号）。 */
  readonly animation: AnimationReader;
  /** 転送の表で絵を替える（雪）なら true。コマの番号の絵は tiles の (番号 × width×height/64) から。 */
  readonly transfer: boolean;
}

/** ROM から読んだ天候の絵と表。読めなかったものは null（その天候は「プレビューできません」）。 */
export class WeatherGraphics {
  private readonly objects = new Map<WeatherObjectKind, WeatherObjectGraphics | null>();

  private constructor(
    private readonly rom: Rom,
    private readonly offsets: WeatherOffsets,
    /** sin_cos_table（320 個の s16）。 */
    readonly sine: Int16Array,
    /** パレット 32 本の暗くする表の種類（0 変えない・1 BG 用・2 OBJ 用）。 */
    readonly fadeTypes: Uint8Array,
    readonly commonPalette: Uint16Array,
    /** 火山灰（7）が砂嵐の関数に置き換わっているか（CFRU の REPLACE_ASH_WEATHER_WITH_WHITE_SANDSTORM）。 */
    readonly ashIsSandstorm: boolean,
    /** 7 番の砂嵐の色（CFRU の HailstormWeatherPal）。分からなければ null。 */
    readonly whiteSandstormPalette: Uint16Array | null,
  ) {}

  /** 表を読む。`projectWhiteSandstorm` はプロジェクトの白い砂嵐の色（ROM のフックから引けないときに使う）。 */
  static read(rom: Rom, offsets: WeatherOffsets, options: { readonly projectWhiteSandstorm?: Uint16Array | null; readonly projectAshIsSandstorm?: boolean } = {}): WeatherGraphics {
    const sineAt = rom.pointer(offsets.sineTable);
    const sine = new Int16Array(rom.u16Array(sineAt, 320).buffer);
    const fadeTypes = Uint8Array.from(rom.slice(rom.pointer(offsets.fadeTypeTable), 32));
    const commonPalette = rom.u16Array(rom.pointer(offsets.commonPalette), 16);
    const table = rom.pointer(offsets.functionTable);
    let ashIsSandstorm = true;
    for (let i = 0; i < 4; i++) if (rom.u32(table + 7 * 16 + i * 4) !== rom.u32(table + 8 * 16 + i * 4)) ashIsSandstorm = false;
    const hooked = sandstormHookPalette(rom, offsets);
    if (!ashIsSandstorm && options.projectAshIsSandstorm) ashIsSandstorm = true;
    const white = ashIsSandstorm ? hooked ?? options.projectWhiteSandstorm ?? null : null;
    return new WeatherGraphics(rom, offsets, sine, fadeTypes, commonPalette, ashIsSandstorm, white);
  }

  /** 絵の色（雲と砂嵐は自分のパレットを共通の番号へ読み込む。7 番の白い砂嵐は CFRU の色）。 */
  palette(kind: WeatherObjectKind, weather: number): Uint16Array | null {
    try {
      if (kind === "cloud") return this.rom.u16Array(this.rom.pointer(this.offsets.cloudPalette), 16);
      if (kind === "sandstorm") {
        if (weather === 7) return this.whiteSandstormPalette;
        return this.rom.u16Array(this.sandstormPaletteOffset(), 16);
      }
      return this.commonPalette;
    } catch { return null; }
  }

  /** 1 種類の絵（初めて使うときに読む）。 */
  object(kind: WeatherObjectKind): WeatherObjectGraphics | null {
    if (!this.objects.has(kind)) {
      let value: WeatherObjectGraphics | null = null;
      try { value = this.readObject(kind); } catch { value = null; }
      this.objects.set(kind, value);
    }
    return this.objects.get(kind)!;
  }

  /** 読んだ絵の大きさ（自動操作の確かめ用）。 */
  get loadedBytes(): number {
    let total = 0;
    for (const value of this.objects.values()) total += value?.tiles.length ?? 0;
    return total + this.sine.byteLength + 32 + 32;
  }

  private sandstormPaletteOffset(): number {
    // CFRU は 0x0807CD50 からの命令を差し替えるが、素の砂嵐の色は同じ 0x08389AA4 を使う（dynamic_ow_pals.c）。
    const literal = this.rom.u32(this.offsets.sandstormPalette);
    return this.rom.isPointer(literal) ? literal - ROM_BASE : 0x389aa4;
  }

  private readObject(kind: WeatherObjectKind): WeatherObjectGraphics {
    const rom = this.rom, o = this.offsets;
    const headerLiteral = { cloud: o.cloudHeader, rain: o.rainHeader, snow: o.snowHeader, fog: o.fogHeader, ash: o.ashHeader, fogDiagonal: o.fogDiagonalHeader, sandstorm: o.sandstormHeader, bubble: o.bubbleHeader }[kind];
    const cellLiteral = { cloud: o.cloudCell, rain: o.rainCell, snow: null, fog: o.fogCell, ash: o.ashCell, fogDiagonal: o.fogDiagonalCell, sandstorm: o.sandstormCell, bubble: o.bubbleCell }[kind];
    const header = rom.pointer(headerLiteral);
    const oam = rom.pointer(header + 4);
    const attr0 = rom.u16(oam), attr1 = rom.u16(oam + 2), attr2 = rom.u16(oam + 4);
    const dimensions = DIMENSIONS[attr0 >>> 14]?.[attr1 >>> 14];
    if (!dimensions) throw new Error("bad OAM");
    const [width, height] = dimensions;
    const animations = rom.pointer(header + 8);
    let tiles: Uint8Array;
    let transfer = false;
    if (cellLiteral === null) {
      // 雪: 転送の表（actAnmData {絵, 大きさ}）の絵を、コマの番号の順に並べる。
      const trans = rom.pointer(header + 12);
      const frameTiles = width * height / 64;
      const parts: Uint8Array[] = [];
      for (let i = 0; i < 2; i++) {
        const size = rom.u16(trans + i * 8 + 4);
        if (size !== frameTiles * 32) throw new Error("bad transfer");
        parts.push(rom.slice(rom.pointer(trans + i * 8), size));
      }
      tiles = decodeTiles(concat(parts));
      transfer = true;
    } else {
      const cell = rom.pointer(cellLiteral);
      const size = rom.u16(cell + 4);
      if (size === 0 || size % 32 || size > 0x2000) throw new Error("bad cell");
      tiles = decodeTiles(rom.slice(rom.pointer(cell), size));
    }
    const tileCount = tiles.length / 64;
    const animation: AnimationReader = (anim, command) => {
      if (anim < 0 || anim >= 8 || command < 0 || command >= 32) return null;
      try {
        const at = rom.pointer(animations + anim * 4) + command * 4;
        const index = rom.u16(at), arg = rom.u16(at + 2);
        if (index === 0xffff) return { kind: "end" };
        if (index === 0xfffe) return { kind: "jump", target: arg & 63 };
        if (index === 0xfffd) return { kind: "loop", count: arg & 63 };
        const need = transfer ? (index + 1) * width * height / 64 : index + width * height / 64;
        if (need > tileCount) return null;
        return { kind: "frame", frame: { index, hFlip: !!(arg & 64), vFlip: !!(arg & 128) }, duration: arg & 63 };
      } catch { return null; }
    };
    return { kind, tiles, tileCount, width, height, priority: (attr2 >> 10) & 3, semiTransparent: ((attr0 >> 10) & 3) === 1, animation, transfer };
  }
}

/** 4bpp のタイルを 1 画素 1 バイトにする。 */
function decodeTiles(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) { out[i * 2] = bytes[i]! & 15; out[i * 2 + 1] = bytes[i]! >> 4; }
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * CFRU の ReplaceOWSandstormPaletteHook（`ldr r0,[pc]; bx r0; .word 先`）から LoadPaletteForOverworldSandstorm をたどり、
 * そのリテラルのうち素の砂嵐の色でない 16 色を白い砂嵐の色とする。フックが無ければ null。
 */
function sandstormHookPalette(rom: Rom, offsets: WeatherOffsets): Uint16Array | null {
  try {
    const at = offsets.sandstormPaletteHook;
    if (rom.u16(at) !== 0x4800 || rom.u16(at + 2) !== 0x4700) return null;
    let fn = (rom.u32(at + 4) & ~1) - ROM_BASE;
    // 差し込みの最初の命令が BL なら、その先が LoadPaletteForOverworldSandstorm。
    const hi = rom.u16(fn), lo = rom.u16(fn + 2);
    if ((hi & 0xf800) === 0xf000 && (lo & 0xf800) === 0xf800) {
      const offset = (((hi & 0x7ff) << 12) | ((lo & 0x7ff) << 1)) << 9 >> 9;
      fn = fn + 4 + offset;
    }
    for (let i = fn; i < fn + 0x60; i += 2) {
      const h = rom.u16(i);
      if (h >> 11 !== 0b01001) continue;
      const value = rom.u32(((i + 4) & ~3) + (h & 0xff) * 4);
      if (value === 0x08389aa4 || !rom.isPointer(value) || value & 1) continue;
      const colors = rom.u16Array(value - ROM_BASE, 16);
      if (colors.every(c => c < 0x8000)) return colors;
    }
  } catch { /* 読めなければ素の色 */ }
  return null;
}
