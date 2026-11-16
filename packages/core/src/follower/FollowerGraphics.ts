import { preprocessC } from "../dns/cTable.js";
import type { PaletteTint } from "../dns/DnsTint.js";
import type { IndexedImage } from "../project/png/PngDecoder.js";
import { createImage, writeBgr555, type RgbaImage } from "../render/color.js";

/**
 * 連れ歩きのポケモンの絵（#476）。DPE の `scripts/follower_ow.py`（表を作る）と、CFRU の `src/follower_mon.c`（表を読んで描く）に
 * 合わせて、`graphics/ow/{32,64,pal}/owmCODE[_S|_F|_FS].png` を読む。元の画像とソースには書かない。
 *
 * - シートは 6 コマを縦に並べたもの: 0 南の立ち、1 南の歩き、2 北の立ち、3 北の歩き、4 西の立ち、5 西の歩き。東は西の左右反転。
 * - 32: 32×32（OAM 1 枚）。64: 64×64（grit の `-Mw 2 -Mh 4` で 16×32 の 8 枚に並べ替えて ROM に入れ、サブスプライトで元の
 *   並びに組み立てるので、見える絵は PNG と同じ）。
 * - 色は PNG のパレットの最初の 16 色（grit の `-pn16`）で、色 0 は透明。色違いは `pal/owmCODE_S.png` のパレット。
 * - メスの絵（`_F`）が無ければオスの絵、色違いのパレットが無ければ通常のパレット。シートの無い種族は、ゲームではフシギダネ
 *   （1）の絵で代わりに出す（`GetOwEntry`）。
 * - ヒポポタス・カバルドン・ハハコモリ（オス）…の 5 種は、DPE ではメスが別の種族番号（`SPECIES_X_F`）。メスの絵はその番号の
 *   シートを使う（`GENDER_FORM_SPECIES`）。
 */

/** フシギダネ。絵の無い種族の代わり。 */
export const FOLLOWER_FALLBACK_SPECIES = 1;
/** 1 枚のシートのコマの数。 */
export const FOLLOWER_FRAMES = 6;
const GENDER_FORM_SPECIES = ["SPECIES_HIPPOPOTAS", "SPECIES_HIPPOWDON", "SPECIES_UNFEZANT", "SPECIES_FRILLISH", "SPECIES_JELLICENT"];

/** 1 種族の絵のファイル（`graphics/` からの相対パス）。 */
export interface FollowerEntry {
  readonly species: number;
  /** 64×64 のシートか。 */
  readonly big: boolean;
  readonly sheet: string;
  readonly femaleSheet: string | null;
  readonly shinyPalette: string | null;
  readonly femaleShinyPalette: string | null;
}

/** DPE の連れ歩きの絵の一覧。 */
export interface FollowerIndex {
  readonly numSpecies: number;
  readonly entries: ReadonlyMap<number, FollowerEntry>;
  /** 名前の形が違って読まなかったファイル。 */
  readonly ignored: readonly string[];
  /** NUM_SPECIES 以上の番号のファイル（DPE のビルドが止まる）。 */
  readonly outOfRange: readonly string[];
}

/** フォルダの中の名前（`ow/32`・`ow/64`・`ow/pal`）と `include/species.h` から一覧を作る。 */
export function parseFollowerIndex(files: { readonly ow32: readonly string[]; readonly ow64: readonly string[]; readonly pal: readonly string[] }, speciesHeader: string): FollowerIndex {
  const defines = preprocessC(speciesHeader).defines;
  const value = (name: string): number | null => {
    const text = defines.get(name)?.trim();
    return text && /^(0x[0-9a-f]+|\d+)$/i.test(text) ? Number(text) : null;
  };
  const last = /^\((SPECIES_\w+)\s*\+\s*1\)$/.exec(defines.get("NUM_SPECIES")?.trim() ?? "");
  const lastValue = last ? value(last[1]!) : value("NUM_SPECIES");
  const numSpecies = last ? (lastValue ?? -1) + 1 : lastValue ?? 0;
  if (numSpecies <= 0) throw new Error("species.h の NUM_SPECIES を読めません");
  type Raw = { big?: boolean; "": string; _F: string; _S: string; _FS: string };
  const raw = new Map<number, Partial<Raw>>();
  const ignored: string[] = [], outOfRange: string[] = [];
  const add = (folder: "32" | "64" | "pal", names: readonly string[], kinds: readonly string[]): void => {
    for (const file of names) {
      if (!file.toLowerCase().endsWith(".png")) continue;
      const m = /^owm([0-9A-Fa-f]{4})(_S|_F|_FS)?\.png$/.exec(file);
      const kind = m ? m[2] ?? "" : null;
      if (!m || kind === null || !kinds.includes(kind)) { ignored.push(`ow/${folder}/${file}`); continue; }
      const code = parseInt(m[1]!, 16);
      if (code >= numSpecies) { outOfRange.push(`ow/${folder}/${file}`); continue; }
      const entry = raw.get(code) ?? {};
      entry[kind as keyof Raw] = `ow/${folder}/${file}` as never;
      if (kind === "" || kind === "_F") entry.big = folder === "64";
      raw.set(code, entry);
    }
  };
  add("32", files.ow32, ["", "_F"]);
  add("64", files.ow64, ["", "_F"]);
  add("pal", files.pal, ["_S", "_FS"]);
  for (const symbol of GENDER_FORM_SPECIES) {
    const male = value(symbol), female = value(`${symbol}_F`);
    if (male === null || female === null) continue;
    const m = raw.get(male), f = raw.get(female);
    if (m?.[""] && f?.[""]) {
      m._F = f[""];
      if (f._S) m._FS = f._S;
    }
  }
  const entries = new Map<number, FollowerEntry>();
  for (const [species, e] of [...raw].sort((a, b) => a[0] - b[0])) {
    if (!e[""]) continue;
    entries.set(species, { species, big: !!e.big, sheet: e[""], femaleSheet: e._F ?? null, shinyPalette: e._S ?? null, femaleShinyPalette: e._F ? e._FS ?? null : null });
  }
  return { numSpecies, entries, ignored, outOfRange };
}

/** 選んだ見た目で使うファイル（`GetOwEntry`・`GetCurrentAssets`）。絵が無ければ null。 */
export function followerAssets(index: FollowerIndex, species: number, options: { readonly female: boolean; readonly shiny: boolean }): { readonly entry: FollowerEntry; readonly sheet: string; readonly palette: string; readonly fallback: boolean } | null {
  let target = species >= index.numSpecies ? FOLLOWER_FALLBACK_SPECIES : species;
  let entry = index.entries.get(target);
  const fallback = !entry;
  if (!entry) { target = FOLLOWER_FALLBACK_SPECIES; entry = index.entries.get(target); }
  if (!entry) return null;
  const female = options.female && entry.femaleSheet !== null;
  const sheet = female ? entry.femaleSheet! : entry.sheet;
  const shiny = options.shiny ? (female ? entry.femaleShinyPalette : entry.shinyPalette) : null;
  // follower_ow.py: 色違いのパレットが無ければ、そのシートのパレット（maleShinyPal = malePal、femaleShinyPal = femalePal）。
  return { entry, sheet, palette: shiny ?? sheet, fallback };
}

/** プロジェクトで連れ歩きを出せるか。 */
export type FollowerStatus =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: "noProject" | "noSource" | "disabled" | "noDpe" | "noSheets" };

/**
 * 有効かの判定（#476）。`follower_mon.c` が無ければ無効。`#ifdef POKEMON_FOLLOWERS` で囲んだ作り（Chronos）なら、`config.h` で
 * 定義されているときだけ有効。囲んでいない作り（ND）は、定義が無くても有効。どちらも DPE の絵が 1 枚も無ければ出さない。
 */
export function followerStatus(input: { readonly project: boolean; readonly followerSource: string | null; readonly configH: string | null; readonly dpe: boolean; readonly sheets: number }): FollowerStatus {
  if (!input.project) return { enabled: false, reason: "noProject" };
  if (input.followerSource === null) return { enabled: false, reason: "noSource" };
  if (/^\s*#\s*if(def\s+|\s+defined\s*\(?\s*)POKEMON_FOLLOWERS\b/m.test(input.followerSource) && !(input.configH !== null && preprocessC(input.configH).defines.has("POKEMON_FOLLOWERS"))) {
    return { enabled: false, reason: "disabled" };
  }
  if (!input.dpe) return { enabled: false, reason: "noDpe" };
  if (input.sheets === 0) return { enabled: false, reason: "noSheets" };
  return { enabled: true };
}

/** PNG のパレットの最初の 16 色を BGR555 にする（grit と同じく下位 3 ビットを捨てる）。 */
export function followerPalette(image: IndexedImage): Uint16Array {
  const out = new Uint16Array(16);
  for (let i = 0; i < 16 && i * 3 + 2 < image.palette.length; i++) {
    const r = image.palette[i * 3]! >> 3, g = image.palette[i * 3 + 1]! >> 3, b = image.palette[i * 3 + 2]! >> 3;
    out[i] = r | (g << 5) | (b << 10);
  }
  return out;
}

/** 読んだシート。 */
export class FollowerSheet {
  private constructor(readonly image: IndexedImage, readonly size: 32 | 64) {}

  /** 大きさを確かめて作る。合わなければ理由のエラー。 */
  static from(image: IndexedImage, big: boolean): FollowerSheet {
    const size: 32 | 64 = big ? 64 : 32;
    if (image.width !== size || image.height < FOLLOWER_FRAMES * size) {
      throw new Error(`連れ歩きの絵の大きさが ${size}×${size * FOLLOWER_FRAMES} ではありません（${image.width}×${image.height}）`);
    }
    return new FollowerSheet(image, size);
  }

  /** コマ（0〜5）を RGBA にする。色 0 は透明。`tint` は時間帯の色（null で元の色）。 */
  frame(index: number, hFlip: boolean, palette: ArrayLike<number>, tint: PaletteTint | null = null): RgbaImage {
    const size = this.size, colors = tint ? tint(palette, 1) : palette;
    const out = createImage(size, size);
    const base = Math.max(0, Math.min(FOLLOWER_FRAMES - 1, index)) * size * size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = this.image.pixels[base + y * size + (hFlip ? size - 1 - x : x)]! & 15;
        if (c) writeBgr555(out.data, y * size + x, colors[c] ?? 0);
      }
    }
    return out;
  }

  /** 横向きのコマ（4・5）が、マスの前の端（左）からはみ出す画素（`SideOverhang`）。 */
  sideOffset(): number {
    const size = this.size, tileLeft = (size - 16) / 2;
    let minX: number = size;
    for (let y = 4 * size; y < 6 * size; y++) {
      for (let x = 0; x < minX; x++) if (this.image.pixels[y * size + x]! & 15) { minX = x; break; }
    }
    return Math.min(255, Math.max(0, tileLeft - minX));
  }
}
