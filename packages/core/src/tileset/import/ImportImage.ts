/**
 * 画像からタイルとブロックを作る（Phase6 #440〜#446）の 1 段目: 画像（RGBA）を GBA の色（BGR555）に丸め、透明を決め、
 * 16 の倍数の大きさに揃えた「レイヤーごとの色の面」にする。DOM に依存しない。
 *
 * - 色は 5 ビットへ丸める（下位 3 ビットを捨てる。ZigzaguMap の rgbToBgr555 と同じ）。
 * - 透明: アルファ値が 128 未満の画素と、透明色（既定は 1 枚目の左上の画素。Bochi と同じ）と同じ色の画素。
 * - 大きさが 16 の倍数でなければ、右と下を透明で埋める（#407 の C-10 の推奨）。上限は 1024×1024。
 * - レイヤーごとの画像は 1〜3 枚（下・上、3 枚なら下・中・上でトリプルレイヤー。C-11 の推奨）。大きさが揃わなければ誤り。
 */
import { rgbToBgr555 } from "../blockFormat.js";

/** 透明の画素（BGR555 は 0〜0x7FFF なので重ならない）。 */
export const TRANSPARENT = 0xffff;
/** 画像の 1 辺の上限。 */
export const IMPORT_MAX_SIDE = 1024;
/** レイヤーごとの画像の数の上限。 */
export const IMPORT_MAX_LAYERS = 3;
/** ブロックの 1 辺の画素数。 */
const CELL = 16;

/** 取り込みの誤り（画面は `code` と `params` で文言を選ぶ）。 */
export class ImportError extends Error {
  constructor(
    readonly code: "noImage" | "tooManyImages" | "tooLarge" | "sizeMismatch" | "emptyImage",
    readonly params: Readonly<Record<string, number>> = {},
    message: string = code,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

/** 読み込んだ画像 1 枚（RGBA、1 画素 4 バイト）。 */
export interface ImportSource {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array | Uint8ClampedArray;
}

/** 透明色の決め方。 */
export interface ImportImageOptions {
  /**
   * 透明にする色（BGR555）。省略すると 1 枚目の左上の画素（透明なら透明色なし）。null なら透明色を使わない
   * （アルファ値だけで決める）。
   */
  readonly transparent?: number | null;
}

/** 色の面に直した画像。 */
export interface ImportLayers {
  /** 16 の倍数に揃えた大きさ。 */
  readonly width: number;
  readonly height: number;
  /** 元の大きさ。 */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** 右か下を透明で埋めたか。 */
  readonly padded: boolean;
  /** 使った透明色（BGR555。無ければ null）。 */
  readonly transparentColor: number | null;
  /** レイヤーごとの色（BGR555 か TRANSPARENT。幅×高さ）。下から順。 */
  readonly layers: readonly Uint16Array[];
}

/** RGBA の 1 画素を BGR555 にする（アルファ値 128 未満は TRANSPARENT）。 */
export function rgbaToColor(rgba: ArrayLike<number>, at: number): number {
  if (rgba[at + 3]! < 128) return TRANSPARENT;
  return rgbToBgr555(rgba[at]!, rgba[at + 1]!, rgba[at + 2]!);
}

/** 画像（1〜3 枚）を色の面にする。 */
export function prepareImportLayers(sources: readonly ImportSource[], options: ImportImageOptions = {}): ImportLayers {
  if (sources.length === 0) throw new ImportError("noImage", {}, "画像がありません");
  if (sources.length > IMPORT_MAX_LAYERS) throw new ImportError("tooManyImages", { count: sources.length, max: IMPORT_MAX_LAYERS }, `画像は ${IMPORT_MAX_LAYERS} 枚までです`);
  const first = sources[0]!;
  const sw = first.width;
  const sh = first.height;
  if (sw <= 0 || sh <= 0) throw new ImportError("emptyImage", {}, "画像の大きさが 0 です");
  if (sw > IMPORT_MAX_SIDE || sh > IMPORT_MAX_SIDE) {
    throw new ImportError("tooLarge", { width: sw, height: sh, max: IMPORT_MAX_SIDE }, `画像は ${IMPORT_MAX_SIDE}×${IMPORT_MAX_SIDE} までです（${sw}×${sh}）`);
  }
  sources.forEach((s, i) => {
    if (s.width !== sw || s.height !== sh) {
      throw new ImportError("sizeMismatch", { index: i, width: s.width, height: s.height, firstWidth: sw, firstHeight: sh }, `${i + 1} 枚目の大きさ（${s.width}×${s.height}）が 1 枚目（${sw}×${sh}）と違います`);
    }
  });
  const transparentColor = options.transparent === undefined ? rgbaToColorOrNull(first.rgba, 0) : options.transparent;
  const width = Math.ceil(sw / CELL) * CELL;
  const height = Math.ceil(sh / CELL) * CELL;
  const layers = sources.map((s) => {
    const out = new Uint16Array(width * height).fill(TRANSPARENT);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const c = rgbaToColor(s.rgba, (y * sw + x) * 4);
        out[y * width + x] = c === transparentColor ? TRANSPARENT : c;
      }
    }
    return out;
  });
  return { width, height, sourceWidth: sw, sourceHeight: sh, padded: width !== sw || height !== sh, transparentColor: transparentColor ?? null, layers };
}

function rgbaToColorOrNull(rgba: ArrayLike<number>, at: number): number | null {
  const c = rgbaToColor(rgba, at);
  return c === TRANSPARENT ? null : c;
}

/** 面の (tx, ty) の 8×8 タイルの色 64 個（左上から行ごと）。 */
export function tileColors(layer: Uint16Array, width: number, tx: number, ty: number): Uint16Array {
  const out = new Uint16Array(64);
  for (let y = 0; y < 8; y++) out.set(layer.subarray((ty * 8 + y) * width + tx * 8, (ty * 8 + y) * width + tx * 8 + 8), y * 8);
  return out;
}

/** 面を 8×8 のタイルに分ける（左上から行ごと）。 */
export function splitTiles(layer: Uint16Array, width: number, height: number): Uint16Array[] {
  const out: Uint16Array[] = [];
  for (let ty = 0; ty < height / 8; ty++) for (let tx = 0; tx < width / 8; tx++) out.push(tileColors(layer, width, tx, ty));
  return out;
}

/** タイルが全部透明か。 */
export function isTransparentTile(colors: Uint16Array): boolean {
  for (const c of colors) if (c !== TRANSPARENT) return false;
  return true;
}
