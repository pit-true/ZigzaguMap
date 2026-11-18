import type { ScriptIndex } from "./ScriptIndex.js";
import { SCRIPT_INDEX_ASSEMBLY_DIR } from "./buildScriptIndex.js";

/**
 * スクリプトのラベルがどこにあるか（#554）。ビルド（CFRU の make）は `assembly` の中の `.s` をすべて組み立てるので、
 * ラベルが「ある」のは、そのマップの `.s` のラベル（`.global` でなくてもよい）か、`assembly` の中のどれかの `.s` の `.global` のラベル。
 *
 * - `map`: そのマップの `.s` にある。
 * - `global`: 別の `.s`（`path`）に `.global` で書いてある。ビルドでは見つかる。
 * - `notGlobal`: 別の `.s`（`path`）にだけあり、`.global` でない。ほかのファイルからは見えない。
 * - `missing`: どこにも無い。
 */
export type ScriptLabelPlace =
  | { readonly kind: "map" }
  | { readonly kind: "global"; readonly path: string }
  | { readonly kind: "notGlobal"; readonly path: string }
  | { readonly kind: "missing" };

/** ラベルの候補（一覧に出すもの）。`path` はマップの `.s` 以外のときのファイル。 */
export interface ScriptLabelCandidate {
  readonly name: string;
  readonly path: string | null;
}

/** 区切りを `/` にしたパス（索引のパスと比べる）。 */
function normalize(path: string | null): string | null {
  return path === null ? null : path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** ビルドが組み立てる `.s` か（`assembly` の下）。 */
function assembled(path: string): boolean {
  return path.startsWith(SCRIPT_INDEX_ASSEMBLY_DIR + "/");
}

/**
 * ラベルの場所を決める。`mapScript` はそのマップの `.s`（決まらなければ null）、`mapLabels` はそのラベル
 * （エディタで開いていれば編集中の本文から読んだもの）。
 */
export function scriptLabelPlace(label: string, mapScript: string | null, mapLabels: readonly string[], index: ScriptIndex): ScriptLabelPlace {
  if (mapLabels.includes(label)) return { kind: "map" };
  const own = normalize(mapScript);
  const found = index.findLabels(label).filter((l) => assembled(l.path) && l.path !== own);
  const global = found.find((l) => l.global);
  if (global) return { kind: "global", path: global.path };
  const local = found[0];
  if (local) return { kind: "notGlobal", path: local.path };
  return { kind: "missing" };
}

/** ビルドで見つかるか（`map` か `global`）。 */
export function isScriptLabelReachable(place: ScriptLabelPlace): boolean {
  return place.kind === "map" || place.kind === "global";
}

/**
 * 一覧の候補: マップの `.s` のラベルを先に（ファイルの順）、ほかの `.s` の `.global` のラベルを後ろに（ファイルの順、名前は 1 回だけ）。
 */
export function scriptLabelCandidates(mapScript: string | null, mapLabels: readonly string[], index: ScriptIndex): ScriptLabelCandidate[] {
  const own = normalize(mapScript);
  const seen = new Set(mapLabels);
  const out: ScriptLabelCandidate[] = mapLabels.map((name) => ({ name, path: null }));
  for (const l of index.allLabels()) {
    if (!l.global || l.path === own || !assembled(l.path) || seen.has(l.name)) continue;
    seen.add(l.name);
    out.push({ name: l.name, path: l.path });
  }
  return out;
}
