import { SCRIPT_INDEX_ASSEMBLY_DIR } from "../index/buildScriptIndex.js";
import { normalizeScriptPath, type ScriptsTableEntryArgs } from "./ScriptsTableCommands.js";
import type { ScriptsTableDocument } from "./ScriptsTableDocument.js";

/**
 * マップと `.s` の紐づけ（#555。場所の設定タブで選ぶ）。紐づけは maps\scripts.json の、マップを指定した行
 * （`Bank`・`Map`・`Script`）にする。バンク全体の行より優先されるので、そのマップだけが選んだ `.s` を使う。
 * maps\scripts.json はビルド（`map_project.py`）が読まないので、ZigzaguMap だけの設定。
 */

/** 選んだファイルを紐づけられない理由。 */
export type MapScriptLinkProblem = "outside" | "extension";

/** マップの今の紐づけ。 */
export interface MapScriptLinkState {
  /** そのマップが使う `.s`（無ければ null）。 */
  readonly script: string | null;
  /** どの行から決まったか（`map`: マップを指定した行、`bank`: バンク全体の行、`none`: 決まらない）。 */
  readonly from: "map" | "bank" | "none";
  /** マップを指定した行の位置（無ければ -1。「外す」で消す行）。 */
  readonly row: number;
}

/** パスを比べる形（区切りを `/`、末尾の `/` を除き、大文字・小文字をそろえる）。 */
function key(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * ファイルを選ぶ画面で選んだ絶対パスを、プロジェクトフォルダからの相対パスにする。選べるのはプロジェクトの `assembly` の中の `.s` だけ。
 * 相対パスを渡したら、プロジェクトフォルダからの相対とみなす。
 */
export function mapScriptLinkPath(projectDir: string, chosen: string): { readonly path: string } | { readonly problem: MapScriptLinkProblem } {
  const file = normalizeScriptPath(chosen);
  if (!/\.s$/i.test(file)) return { problem: "extension" };
  const absolute = file.startsWith("/") || /^[A-Za-z]:/.test(file);
  let relative = file;
  if (absolute) {
    const root = key(projectDir) + "/";
    if (!key(file).startsWith(root)) return { problem: "outside" };
    relative = file.slice(root.length);
  }
  const parts = relative.split("/");
  if (parts.some((p) => p === ".." || p === "." || p === "") || parts.length < 2) return { problem: "outside" };
  if (parts[0]!.toLowerCase() !== SCRIPT_INDEX_ASSEMBLY_DIR) return { problem: "outside" };
  // 対応表には `assembly` を小文字で書く（索引のパスと同じ）
  return { path: [SCRIPT_INDEX_ASSEMBLY_DIR, ...parts.slice(1)].join("/") };
}

/** マップの今の紐づけ。 */
export function mapScriptLinkState(doc: ScriptsTableDocument, bank: number, map: number): MapScriptLinkState {
  const resolved = doc.resolve(bank, map);
  const row = doc.rows.findIndex((r) => r.entry.bank === bank && r.entry.map === map);
  if (!resolved) return { script: null, from: "none", row };
  return { script: resolved.script, from: resolved.entry.map === null ? "bank" : "map", row };
}

/**
 * マップを `.s` に紐づける行（`row` が -1 なら足す行、そうでなければその行を書き換えた行）。
 * `.string` は、書き換えのときは `.s` が同じなら前のまま、違えば既定の名前（null）にする。
 */
export function mapScriptLinkEntry(doc: ScriptsTableDocument, bank: number, map: number, script: string, name: string): ScriptsTableEntryArgs {
  const row = doc.rows.find((r) => r.entry.bank === bank && r.entry.map === map)?.entry;
  const strings = row && row.script === script ? row.strings : null;
  return { bank, map, name: row?.name ?? name, script, strings };
}
