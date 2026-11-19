import type { ScriptIndex } from "./ScriptIndex.js";
import { SCRIPT_INDEX_ASSEMBLY_DIR } from "./buildScriptIndex.js";

/**
 * 「このマップの .s」を、マップのラベルから自動で決める（#562。maps\scripts.json に紐づけが無いとき）。
 *
 * - そのマップが使うラベル（イベント・マップスクリプトの表）が定義されている `assembly` の中の `.s` を数え、いちばん多いファイルにする。
 * - 共用のファイルは選ばない: ほかのマップが使うラベルのほうが多いファイルと、ファイルの `.global` のラベルのうち、
 *   このマップのものが 4 分の 1 に満たないファイル（`system_scripts.s` のように、ほかの用途の入口がたくさんあるファイル）。
 * - いちばん多いファイルが 2 つ以上あれば、決めない（null）。
 */
export interface AutoMapScript {
  readonly path: string;
  /** そのファイルにある、このマップのラベル。 */
  readonly labels: readonly string[];
}

/** 自動で決めなかった（決められなかった）ファイルと、その理由（調べる用）。 */
export interface AutoMapScriptCandidate {
  readonly path: string;
  readonly own: number;
  readonly others: number;
  readonly globals: number;
  readonly shared: boolean;
}

/** ファイルごとの数（自動で決める前の候補）。 */
export function autoMapScriptCandidates(ownLabels: readonly string[], index: ScriptIndex, otherLabels: ReadonlySet<string>): AutoMapScriptCandidate[] {
  const own = new Set(ownLabels);
  const byFile = new Map<string, Set<string>>();
  for (const name of own) {
    for (const l of index.findLabels(name)) {
      if (!l.path.startsWith(SCRIPT_INDEX_ASSEMBLY_DIR + "/")) continue;
      let set = byFile.get(l.path);
      if (!set) byFile.set(l.path, (set = new Set()));
      set.add(name);
    }
  }
  const out: AutoMapScriptCandidate[] = [];
  for (const [path, names] of byFile) {
    const labels = index.file(path)?.labels ?? [];
    const globals = new Set(labels.filter((l) => l.global).map((l) => l.name));
    const others = new Set(labels.filter((l) => otherLabels.has(l.name) && !own.has(l.name)).map((l) => l.name)).size;
    const ownGlobals = [...globals].filter((n) => own.has(n)).length;
    const shared = others > names.size || ownGlobals * 4 < globals.size;
    out.push({ path, own: names.size, others, globals: globals.size, shared });
  }
  return out.sort((a, b) => b.own - a.own || a.path.localeCompare(b.path));
}

/** 自動で決めた `.s`（決まらなければ null）。 */
export function autoMapScript(ownLabels: readonly string[], index: ScriptIndex, otherLabels: ReadonlySet<string>): AutoMapScript | null {
  const list = autoMapScriptCandidates(ownLabels, index, otherLabels).filter((c) => !c.shared);
  const best = list[0];
  if (!best || list[1]?.own === best.own) return null;
  const own = new Set(ownLabels);
  const labels = [...new Set((index.file(best.path)?.labels ?? []).map((l) => l.name))].filter((n) => own.has(n));
  return { path: best.path, labels };
}
