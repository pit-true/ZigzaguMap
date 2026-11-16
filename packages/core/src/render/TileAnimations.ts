import { sha1 } from "../binary/sha1.js";
import { PRIMARY_TILE_COUNT, TILE_BYTES } from "../map/constants.js";
import type { Tileset } from "../map/types.js";
import type { Rom } from "../rom/Rom.js";

/**
 * タイルセットのアニメーション（花・海・噴水など。Phase6 #473）。
 *
 * 根拠は日本語版の bg_anm.c と素の BPRJ の逆アセンブル。タイルセットヘッダー +0x10 の関数（初期化）が、
 * カウンタの最大値と毎フレーム呼ぶ関数を決める。MapBGanimeMain はフレームごとにカウンタを 1 進め、最大値で 0 に戻してから
 * その関数を呼ぶ。関数は「カウンタ % 周期 == 余り」のときだけ、表の (カウンタ / 周期) % コマ数 番目の絵を決まったタイルへ転送する。
 * 主（常駐）と副（非常駐）は別々のカウンタを持つ。
 *
 * 分かっている関数だけを動かす。関数の番地だけでなく、その番地のコード（初期化・毎フレームの関数・転送の関数とリテラル）が
 * 素の BPRJ と同じかを確かめてから、ROM の表から絵を読む。CFRU・ND・Chronos はこのコードと表を変えていない。
 * 移植や自動分割で作ったタイルセット（関数が 0）は動かさない。
 */

/** 1 つのアニメ（同じ転送先へ、決まった周期で絵を差し替える）。 */
export interface TileAnimationTrack {
  /** 名前（元のソースの関数名から）。 */
  readonly name: string;
  /** 転送先のタイル番号（0〜1023。副は 640 から）。 */
  readonly tileStart: number;
  /** 転送するタイルの数。 */
  readonly tileCount: number;
  /** カウンタ % period == phase のフレームで差し替える。 */
  readonly period: number;
  readonly phase: number;
  /** コマの絵（それぞれ tileCount × 32 バイト）。コマの番号は (カウンタ / period) % frames.length。 */
  readonly frames: readonly Uint8Array[];
}

/** 1 つのタイルセットのアニメ一式。 */
export interface TileAnimationSet {
  /** タイルセットヘッダーの関数ポインタ（Thumb の 1 を含む値）。 */
  readonly callback: number;
  /** カウンタの最大値（この値で 0 に戻る）。 */
  readonly counterMax: number;
  readonly tracks: readonly TileAnimationTrack[];
}

/** 既知のアニメの 1 トラックの定義。絵は ROM の表から読む。 */
export interface KnownTileAnimationTrack {
  readonly name: string;
  readonly tileStart: number;
  readonly tileCount: number;
  readonly period: number;
  readonly phase: number;
  /** コマの数（表の先頭から使う数）。 */
  readonly frameCount: number;
  /** 絵のポインタの表の位置（ROM 先頭から）。 */
  readonly frameTable: number;
}

/** 既知のアニメ。`code` の範囲のバイトの SHA-1 が一致したときだけ使う。 */
export interface KnownTileAnimation {
  readonly callback: number;
  readonly counterMax: number;
  readonly code: readonly { readonly start: number; readonly end: number; readonly sha1: string }[];
  readonly tracks: readonly KnownTileAnimationTrack[];
}

/** 読めなかった理由。`none` は関数が無い（動かないタイルセット）。 */
export type TileAnimationReason = "none" | "unknown" | "code" | "data";

/** bg_anm.c の共通部分（転送の登録と MapBGanimeMain）。どの既知のアニメでも確かめる。 */
const COMMON_CODE = { start: 0x6f67c, end: 0x6f7d0, sha1: "814b860a1a3c566086073bd4acadaac9c1c9c612" } as const;

/**
 * 素の BPRJ の 6 つ。番号はソースのマクロと ROM のリテラルで照合した。
 * 主: DefaultBGanimeMain（640 で 0 に戻る）。副: 噴水 2 種・火山の煙・クチバジムの電線・タマムシジムの草。
 */
export const BPRJ_TILE_ANIMATIONS: readonly KnownTileAnimation[] = [
  {
    callback: 0x0806f8f9,
    counterMax: 640,
    code: [COMMON_CODE, { start: 0x6f848, end: 0x6f920, sha1: "38506600d1c7bf71484c6578ad4c4ef981d722b8" }],
    tracks: [
      { name: "bg_sea2_anime", tileStart: 0x1d0, tileCount: 18, period: 8, phase: 0, frameCount: 8, frameTable: 0x36f8a4 },
      { name: "bg_sea_anime", tileStart: 0x1a0, tileCount: 48, period: 16, phase: 1, frameCount: 8, frameTable: 0x36e684 },
      { name: "bg_hana_anime", tileStart: 0x1fc, tileCount: 4, period: 16, phase: 2, frameCount: 5, frameTable: 0x36b690 },
    ],
  },
  {
    callback: 0x0806f97d,
    counterMax: 120,
    code: [COMMON_CODE, { start: 0x6f920, end: 0x6f9a0, sha1: "7364117eb9a12fff8dff1045cfe2eabd7441e750" }],
    tracks: [{ name: "bg_field7_funsui_anime", tileStart: PRIMARY_TILE_COUNT + 0x68, tileCount: 8, period: 12, phase: 0, frameCount: 5, frameTable: 0x36fde4 }],
  },
  {
    callback: 0x0806f9f5,
    counterMax: 160,
    code: [COMMON_CODE, { start: 0x6f9a0, end: 0x6fa18, sha1: "c453158954c78de385e675ba809e3cc5621e7f67" }],
    tracks: [{ name: "bg_silf_funsui_anime", tileStart: PRIMARY_TILE_COUNT + 0x150, tileCount: 8, period: 10, phase: 0, frameCount: 4, frameTable: 0x370218 }],
  },
  {
    callback: 0x0806fa59,
    counterMax: 256,
    code: [COMMON_CODE, { start: 0x6fa18, end: 0x6fa80, sha1: "680a564502fcc20125575585e06af41efe136a3e" }],
    tracks: [{ name: "bg_rn001_kemuri_anime", tileStart: PRIMARY_TILE_COUNT + 0x100, tileCount: 8, period: 16, phase: 0, frameCount: 4, frameTable: 0x370628 }],
  },
  {
    callback: 0x0806fac1,
    counterMax: 240,
    code: [COMMON_CODE, { start: 0x6fa80, end: 0x6fae4, sha1: "f2c29fd76bc403fe7abcd6160e0cebb49356224c" }],
    tracks: [{ name: "bg_gym03_volt_anime", tileStart: PRIMARY_TILE_COUNT + 0xf0, tileCount: 7, period: 2, phase: 0, frameCount: 2, frameTable: 0x3707f8 }],
  },
  {
    callback: 0x0806fb25,
    counterMax: 256,
    code: [COMMON_CODE, { start: 0x6fae4, end: 0x6fb4c, sha1: "e5cbe929736fa18451100dccc74258284e0ba51a" }],
    // 表は 0,1,2,1 の順に絵を指す（gym04_kusa_data）。
    tracks: [{ name: "bg_gym04_kusa_anime", tileStart: PRIMARY_TILE_COUNT + 0x63, tileCount: 4, period: 16, phase: 0, frameCount: 4, frameTable: 0x370980 }],
  },
];

/**
 * タイルセットの関数ポインタから、アニメを ROM から読む。
 * 関数が 0 なら `none`、表に無い関数なら `unknown`、コードが違えば `code`、絵の表が ROM の外を指せば `data`。
 */
export function readTileAnimation(
  rom: Rom,
  callback: number,
  known: readonly KnownTileAnimation[] = BPRJ_TILE_ANIMATIONS,
): { readonly set: TileAnimationSet | null; readonly reason: TileAnimationReason | null } {
  if (!callback) return { set: null, reason: "none" };
  const entry = known.find((k) => k.callback === callback >>> 0);
  if (!entry) return { set: null, reason: "unknown" };
  for (const range of entry.code) {
    if (!rom.inRange(range.start, range.end - range.start)) return { set: null, reason: "code" };
    if (hex(sha1(rom.slice(range.start, range.end - range.start))) !== range.sha1) return { set: null, reason: "code" };
  }
  const tracks: TileAnimationTrack[] = [];
  for (const def of entry.tracks) {
    const bytes = def.tileCount * TILE_BYTES;
    if (!rom.inRange(def.frameTable, def.frameCount * 4)) return { set: null, reason: "data" };
    const frames: Uint8Array[] = [];
    for (let i = 0; i < def.frameCount; i++) {
      const pointer = rom.pointerOrNull(def.frameTable + i * 4);
      if (pointer === null || !rom.inRange(pointer, bytes)) return { set: null, reason: "data" };
      frames.push(rom.slice(pointer, bytes));
    }
    tracks.push({ name: def.name, tileStart: def.tileStart, tileCount: def.tileCount, period: def.period, phase: def.phase, frames });
  }
  return { set: { callback: entry.callback, counterMax: entry.counterMax, tracks }, reason: null };
}

/**
 * MapBGanimeMain を `elapsed` 回呼んだ後に、そのトラックが表示しているコマの番号。まだ一度も差し替えていなければ null
 * （タイルセットの元の絵のまま）。カウンタは初期化で 0、呼ぶたびに 1 進めて counterMax で 0 に戻る。
 * 転送は次の VBlank なので、画面に出るのはこの次のフレーム（ここではずらさない）。
 */
export function tileAnimationFrame(counterMax: number, track: Pick<TileAnimationTrack, "period" | "phase"> & { readonly frames: { readonly length: number } }, elapsed: number): number | null {
  if (!Number.isFinite(elapsed) || elapsed < 1 || counterMax < 1 || track.period < 1 || track.frames.length < 1) return null;
  // カウンタ % 周期 は周期より小さいので、余りが周期以上なら一度も差し替えない。
  if (track.phase < 0 || track.phase >= track.period) return null;
  const n = Math.floor(elapsed);
  const cycle = Math.floor(n / counterMax);
  const counter = n - cycle * counterMax;
  // 今の周回で counter 以下の、最後に差し替えたカウンタ（0 は 2 周目以降だけ通る）。
  let fired: number | null = null;
  if (counter >= track.phase) {
    const c = counter - ((counter - track.phase) % track.period);
    if (c >= 1 || cycle >= 1) fired = c;
  }
  if (fired === null) {
    if (cycle < 1) return null;
    // 前の周回の最後の差し替え。
    if (track.phase >= counterMax) return null;
    fired = track.phase + track.period * Math.floor((counterMax - 1 - track.phase) / track.period);
  }
  return Math.floor(fired / track.period) % track.frames.length;
}

/** アニメのコマの絵が持つバイト数（メモリの見積もり）。 */
export function tileAnimationBytes(set: TileAnimationSet | null): number {
  if (!set) return 0;
  let total = 0;
  for (const track of set.tracks) for (const frame of track.frames) total += frame.length;
  return total;
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** 表示用のタイルの写し。アニメのコマと、ドアの一時タイル（1016〜1023）をここに当てる。元のタイルセットは変えない。 */
export class AnimatedTiles {
  private primaryTiles: Uint8Array | null = null;
  private secondaryTiles: Uint8Array | null = null;
  private readonly applied = new Map<string, number | null>();
  private overlay: { readonly tileStart: number; readonly data: Uint8Array } | null = null;
  private appliedOverlay: { readonly tileStart: number; readonly data: Uint8Array } | null = null;
  private version = 0;
  private key = "";

  constructor(
    readonly primary: Tileset,
    readonly secondary: Tileset,
    readonly primaryAnimation: TileAnimationSet | null,
    readonly secondaryAnimation: TileAnimationSet | null,
  ) {}

  /** 動くものがあるか（アニメもドアの一時タイルも無ければ、元の絵のまま描けばよい）。 */
  get animated(): boolean {
    return !!(this.primaryAnimation?.tracks.length || this.secondaryAnimation?.tracks.length);
  }

  /** ドアの一時タイル（null で外す）。外しても、すでに当てた写しは次の `at` で元の絵へ戻す。 */
  setOverlay(tileStart: number, data: Uint8Array | null): void {
    if (this.overlay?.data === data && (!data || this.overlay?.tileStart === tileStart)) return;
    this.overlay = data ? { tileStart, data } : null;
  }

  /**
   * MapBGanimeMain を主・副それぞれ `elapsed` 回呼んだ後の絵。`key` はコマの組が変わったときだけ変わる（描き手を作り直す目安）。
   * 返すタイルセットは、タイルだけを写しに替えたもの（パレットとブロックは元と同じ配列）。写しは 1 つを使い回すので、次の `at` で上書きされる。
   */
  at(elapsed: number): { readonly primary: Tileset; readonly secondary: Tileset; readonly key: string; readonly frames: readonly { readonly name: string; readonly frame: number | null }[] } {
    const frames: { name: string; frame: number | null }[] = [];
    let changed = false;
    if (this.overlay !== this.appliedOverlay) {
      const previous = this.appliedOverlay;
      this.appliedOverlay = this.overlay;
      if (previous) {
        this.write(previous.tileStart, null, Math.ceil(previous.data.length / TILE_BYTES));
        // ドアの一時タイルに重なるアニメ（素の ROM には無い）は、下でもう一度当てる。
        this.applied.clear();
      }
      if (this.overlay) this.write(this.overlay.tileStart, this.overlay.data, Math.ceil(this.overlay.data.length / TILE_BYTES));
      changed = true;
    }
    for (const [set, secondary] of [[this.primaryAnimation, false], [this.secondaryAnimation, true]] as const) {
      if (!set) continue;
      for (const track of set.tracks) {
        const frame = tileAnimationFrame(set.counterMax, track, elapsed);
        frames.push({ name: track.name, frame });
        const id = `${+secondary}:${track.name}`;
        if (this.applied.has(id) && this.applied.get(id) === frame) continue;
        this.applied.set(id, frame);
        this.write(track.tileStart, frame === null ? null : track.frames[frame]!, track.tileCount);
        changed = true;
      }
    }
    if (changed) this.key = `${++this.version}`;
    return {
      primary: this.primaryTiles ? { ...this.primary, tiles: this.primaryTiles } : this.primary,
      secondary: this.secondaryTiles ? { ...this.secondary, tiles: this.secondaryTiles } : this.secondary,
      key: this.key,
      frames,
    };
  }

  /** 写しが持つバイト数。 */
  get copyBytes(): number {
    return (this.primaryTiles?.length ?? 0) + (this.secondaryTiles?.length ?? 0);
  }

  /** タイル番号 `start` から `count` 枚を、`data`（null なら元のタイル）で上書きする。 */
  private write(start: number, data: Uint8Array | null, count: number): void {
    for (let i = 0; i < count; i++) {
      const tile = start + i;
      if (tile < 0 || tile >= 1024) continue;
      const secondary = tile >= PRIMARY_TILE_COUNT;
      const local = secondary ? tile - PRIMARY_TILE_COUNT : tile;
      const target = this.copy(secondary, local + 1);
      const at = local * TILE_BYTES;
      if (data) {
        const from = i * TILE_BYTES;
        if (from + TILE_BYTES <= data.length) target.set(data.subarray(from, from + TILE_BYTES), at);
        else target.fill(0, at, at + TILE_BYTES);
      } else {
        const source = (secondary ? this.secondary : this.primary).tiles;
        if (at + TILE_BYTES <= source.length) target.set(source.subarray(at, at + TILE_BYTES), at);
        else target.fill(0, at, at + TILE_BYTES);
      }
    }
  }

  /** 写しを用意する（元のタイル数より先へ書くときは伸ばす。伸ばした所は色 0）。 */
  private copy(secondary: boolean, tiles: number): Uint8Array {
    const source = (secondary ? this.secondary : this.primary).tiles;
    let current = secondary ? this.secondaryTiles : this.primaryTiles;
    const need = Math.max(source.length, tiles * TILE_BYTES);
    if (!current || current.length < need) {
      const next = new Uint8Array(need);
      next.set(current ?? source);
      current = next;
      if (secondary) this.secondaryTiles = current;
      else this.primaryTiles = current;
    }
    return current;
  }
}
