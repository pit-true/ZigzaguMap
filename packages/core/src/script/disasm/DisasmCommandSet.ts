/**
 * 逆アセンブルに使う命令の一覧（命令番号 → 名前・バイトの並び・引数の種類）。
 * ふだんはプロジェクトの xse_commands.s から作った命令表（{@link ScriptCommandTable}）から作る。
 * プロジェクトの無い素の ROM では、同梱の表（{@link BUNDLED_DISASM_COMMANDS}）を使う。
 */

import type { CommandArgumentKind } from "../commands/argumentKinds.js";
import type { MacroDataSize } from "../commands/MacroFile.js";
import type { ScriptCommandTable } from "../commands/ScriptCommandTable.js";
import { indexAsmFile, SCRIPT_MOVEMENT_FILE } from "../index/ScriptFileIndex.js";
import { BUNDLED_DISASM_COMMANDS, BUNDLED_MOVEMENT_NAMES } from "./bundledCommands.js";

/** 並びの 1 項目。先頭は命令番号の const。 */
export type DisasmField =
  | { kind: "const"; size: MacroDataSize; value: number }
  | { kind: "arg"; size: MacroDataSize; paramIndex: number };

/** 命令の引数 1 つ。 */
export interface DisasmParam {
  name: string;
  kind: CommandArgumentKind;
  required: boolean;
  /** 既定値（書いたまま）。無ければ null。 */
  defaultValue: string | null;
}

/** 命令の型 1 つ（マクロ 1 つの、`.ifb` の分岐 1 つ分）。 */
export interface DisasmVariant {
  /** 命令の名前（マクロの名前）。 */
  name: string;
  opcode: number;
  /** バイト数。 */
  size: number;
  fields: DisasmField[];
  params: DisasmParam[];
  /** この型で省く引数の番号（`.ifb` で空の側）。 */
  blankParams: number[];
}

const KIND_CODES: Record<CommandArgumentKind, string> = {
  string: "s",
  label: "l",
  movement: "m",
  variable: "v",
  flag: "f",
  constant: "c",
};
const KIND_BY_CODE = new Map(Object.entries(KIND_CODES).map(([k, v]) => [v, k as CommandArgumentKind]));

/** 同じ命令番号の型を、試す順に並べるときの重さ（決まった値と、同じ引数を 2 回書く箇所の数）。 */
function specificity(v: DisasmVariant): number {
  let n = 0;
  const seen = new Set<number>();
  v.fields.forEach((f, i) => {
    if (i === 0) return;
    if (f.kind === "const") n++;
    else if (seen.has(f.paramIndex)) n++;
    else seen.add(f.paramIndex);
  });
  return n;
}

/** 逆アセンブルに使う命令の一覧。 */
export class DisasmCommandSet {
  /** すべての型（作った順）。 */
  readonly variants: readonly DisasmVariant[];
  /** 移動の値 → 名前（`xse_defines.s` の `look_down` から `end_m` まで）。 */
  readonly movementNames: ReadonlyMap<number, string>;
  private readonly byOpcode = new Map<number, DisasmVariant[]>();

  constructor(variants: readonly DisasmVariant[], movementNames: ReadonlyMap<number, string> = new Map()) {
    this.variants = variants;
    this.movementNames = movementNames;
    const order = new Map<string, number>();
    variants.forEach((v, i) => {
      if (!order.has(v.name.toLowerCase())) order.set(v.name.toLowerCase(), i);
      const list = this.byOpcode.get(v.opcode) ?? [];
      list.push(v);
      this.byOpcode.set(v.opcode, list);
    });
    // 試す順: 決まった値の多い型 → 先に書いたマクロ → 同じマクロなら大きい型（省ける引数を書いた方）。
    for (const list of this.byOpcode.values()) {
      const index = new Map(list.map((v, i) => [v, i]));
      list.sort(
        (a, b) =>
          specificity(b) - specificity(a) ||
          order.get(a.name.toLowerCase())! - order.get(b.name.toLowerCase())! ||
          b.size - a.size ||
          index.get(a)! - index.get(b)!,
      );
    }
  }

  /** 命令番号で始まる型（試す順）。 */
  find(opcode: number): readonly DisasmVariant[] {
    return this.byOpcode.get(opcode) ?? [];
  }

  /**
   * プロジェクトの命令表から作る。`.byte` などだけで書いたマクロ（direct）の型のうち、
   * 先頭が命令番号で、引数に戻せない式やラベルを含まないものを使う。別名と複数の命令をまとめたもの（msgbox など）は使わない。
   * movementNames は移動の名前（{@link movementNamesFromEqus} などで作る）。
   */
  static fromCommandTable(table: ScriptCommandTable, movementNames: ReadonlyMap<number, string> = new Map()): DisasmCommandSet {
    const variants: DisasmVariant[] = [];
    for (const command of table.commands) {
      const layout = command.layout;
      if (!layout || layout.composition !== "direct") continue;
      const params: DisasmParam[] = command.args.map((a) => ({
        name: a.name,
        kind: a.kind,
        required: a.required,
        defaultValue: a.defaultValue ?? null,
      }));
      for (const v of layout.variants) {
        if (v.opcode === null) continue;
        const fields: DisasmField[] = [];
        let ok = true;
        for (const f of v.fields) {
          if (f.kind === "const") fields.push({ kind: "const", size: f.size, value: f.value });
          else if (f.kind === "arg") fields.push({ kind: "arg", size: f.size, paramIndex: f.paramIndex });
          else ok = false;
        }
        if (!ok) continue;
        variants.push({
          name: command.name,
          opcode: v.opcode,
          size: v.size,
          fields,
          params,
          blankParams: v.conditions.filter((c) => c.blank).map((c) => c.paramIndex),
        });
      }
    }
    return new DisasmCommandSet(variants, movementNames);
  }

  /** 同梱の表（素の ROM 用。1 ポインタの 0F）。 */
  static bundled(): DisasmCommandSet {
    return (bundledCache ??= DisasmCommandSet.parse(BUNDLED_DISASM_COMMANDS, BUNDLED_MOVEMENT_NAMES));
  }

  /**
   * 短い文字列の形に書き出す（同梱の表を作る scripts/gen-disasm-commands.ts が使う）。
   * 1 行が 1 つの型で `命令番号 名前 項目… | 引数…`。項目は `c大きさ=値`（16 進）か `a大きさ:引数の番号`。
   * 引数は `名前:種類:印`。種類は s/l/m/v/f/c、印は r（必須）・o（省略可）・d=既定値（URI の形にした文字列）、空なら `-b` を足す。
   */
  serialize(): string {
    return this.variants
      .map((v) => {
        const fields = v.fields
          .slice(1)
          .map((f) => (f.kind === "const" ? `c${f.size}=${f.value.toString(16)}` : `a${f.size}:${f.paramIndex}`));
        const params = v.params.map((p, i) => {
          const mark = p.defaultValue !== null ? `d=${encodeURIComponent(p.defaultValue)}` : p.required ? "r" : "o";
          return `${p.name}:${KIND_CODES[p.kind]}:${mark}${v.blankParams.includes(i) ? "-b" : ""}`;
        });
        return [v.opcode.toString(16).padStart(2, "0"), v.name, ...fields, "|", ...params].join(" ");
      })
      .join("\n");
  }

  /** {@link serialize} の形を読む。 */
  static parse(text: string, movementNames: Readonly<Record<string, string>> = {}): DisasmCommandSet {
    const variants: DisasmVariant[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const bar = line.indexOf(" |");
      const head = bar < 0 ? line : line.slice(0, bar);
      const tail = bar < 0 ? "" : line.slice(bar + 2);
      const [op, name, ...fieldTokens] = head.split(" ").filter((t) => t !== "");
      const opcode = parseInt(op!, 16);
      const fields: DisasmField[] = [{ kind: "const", size: 1, value: opcode }];
      for (const t of fieldTokens) {
        const size = Number(t[1]) as MacroDataSize;
        if (t[0] === "c") fields.push({ kind: "const", size, value: parseInt(t.slice(3), 16) });
        else fields.push({ kind: "arg", size, paramIndex: Number(t.slice(3)) });
      }
      const blankParams: number[] = [];
      const params: DisasmParam[] = tail
        .split(" ")
        .filter((t) => t !== "")
        .map((t, i) => {
          const [pname, kind, ...rest] = t.split(":");
          let mark = rest.join(":");
          if (mark.endsWith("-b")) {
            blankParams.push(i);
            mark = mark.slice(0, -2);
          }
          return {
            name: pname!,
            kind: KIND_BY_CODE.get(kind!) ?? "constant",
            required: mark === "r",
            defaultValue: mark.startsWith("d=") ? decodeURIComponent(mark.slice(2)) : null,
          };
        });
      const size = fields.reduce((n, f) => n + f.size, 0);
      variants.push({ name: name!, opcode, size, fields, params, blankParams });
    }
    const moves = new Map<number, string>();
    for (const [k, v] of Object.entries(movementNames)) moves.set(parseInt(k, 16), v);
    return new DisasmCommandSet(variants, moves);
  }
}

let bundledCache: DisasmCommandSet | undefined;

/**
 * `.equ` の一覧から移動の値 → 名前を作る（同じ値が複数あれば最初の名前）。
 * names は移動の名前（`ScriptIndex.movementNames()`）、valueOf は名前から値の文字列（`ScriptIndex.findEqu(name)?.value`）。
 */
export function movementNamesFromEqus(
  names: readonly string[],
  valueOf: (name: string) => string | undefined,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const name of names) {
    const text = valueOf(name)?.trim();
    if (text === undefined) continue;
    const value = /^0x[0-9a-f]+$/i.test(text) ? parseInt(text, 16) : /^\d+$/.test(text) ? Number(text) : NaN;
    if (Number.isInteger(value) && value >= 0 && value <= 0xff && !out.has(value)) out.set(value, name);
  }
  return out;
}

/** xse_defines.s の中身から移動の値 → 名前を作る。 */
export function movementNamesFromDefines(xseDefines: string): Map<number, string> {
  const file = indexAsmFile(SCRIPT_MOVEMENT_FILE, xseDefines);
  const values = new Map<string, string>();
  for (const e of file.equs) if (!values.has(e.name)) values.set(e.name, e.value);
  return movementNamesFromEqus(file.movements, (n) => values.get(n));
}
