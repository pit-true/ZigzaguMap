import { evaluateMacroExpression } from "../script/commands/macroExpression.js";

/** DPE の種族番号の定義と .string の名前表。ROM の並びとは独立に読む。 */
export class DpeSpecies {
  private constructor(private readonly names: readonly (string | null)[]) {}

  get count(): number { return this.names.length; }

  name(species: number, _codec?: unknown): string | null {
    return Number.isInteger(species) ? this.names[species] ?? null : null;
  }

  static parse(header: string, strings: string): DpeSpecies {
    const defines = new Map<string, string>();
    const clean = header.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "");
    for (const line of clean.split(/\r?\n/)) {
      const m = /^\s*#define\s+(\w+)\s+(.+?)\s*$/.exec(line);
      if (m) defines.set(m[1]!, m[2]!);
    }
    const values = new Map<string, number>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const [key, expression] of defines) {
        const value = evaluateMacroExpression(expression, (key) => values.get(key) ?? null);
        if (value === null) continue;
        values.set(key, value);
        defines.delete(key);
        changed = true;
      }
    }
    const count = values.get("NUM_SPECIES");
    if (count === undefined || !Number.isInteger(count) || count < 1 || count > 0x10000) throw new Error("DPE の NUM_SPECIES を読めません");
    const entries: { label: string; name: string }[] = [];
    let label: string | null = null;
    for (const row of strings.split(/\r?\n/)) {
      const text = row.trim();
      if (!text || text.startsWith("//")) continue;
      const org = /^#org\s+@NAME_(\S+)/.exec(text);
      if (org) { label = org[1]!; continue; }
      if (text.startsWith("#")) { label = null; continue; }
      if (label !== null) { entries.push({ label, name: text }); label = null; }
    }
    if (entries.length === 0) throw new Error("DPE の種族名を読めません");
    const names = new Array<string | null>(count).fill(null);
    // ラベルに対応する定義が無い項目は並び順で補う（Chronos の未使用番号など）。
    entries.forEach((entry, index) => { if (!values.has(`SPECIES_${entry.label}`) && index < count) names[index] = entry.name; });
    for (const entry of entries) {
      const id = values.get(`SPECIES_${entry.label}`);
      if (id !== undefined && Number.isInteger(id) && id >= 0 && id < count) names[id] = entry.name;
    }
    return new DpeSpecies(names);
  }
}
