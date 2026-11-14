import { formatHex } from "../../binary/bytes.js";
import { ROM_BASE, type Rom } from "../../rom/Rom.js";
import type { ScriptDialect } from "../config/ScriptDialect.js";
import { scriptTextLabel } from "../edit/LabelNaming.js";
import { wrapStringBody } from "../strings/StringFile.js";
import type { DisasmCommandSet } from "./DisasmCommandSet.js";
import { renderDisassembly } from "./renderDisassembly.js";
import { disassembleScripts, type DisasmRefKind, type Disassembly } from "./ScriptDisassembler.js";
import type { ScriptTextCodec } from "./scriptText.js";

/** 取り込んだまとまりの前に書く印（同じアドレスをもう取り込んだかを見つけるのに使う）。 */
const ASM_MARK = /^@ ZigzaguMap: ROM 0x([0-9A-Fa-f]{8}) から取り込み\s*$/;
const STRING_MARK = /^\/\/ ZigzaguMap: ROM 0x([0-9A-Fa-f]{8}) から取り込み\s*$/;

/** 印の文字列。 */
export function importMarkLine(kind: "asm" | "string", pointer: number): string {
  const hex = formatHex(pointer >>> 0, 8);
  return kind === "asm" ? `@ ZigzaguMap: ROM 0x${hex} から取り込み` : `// ZigzaguMap: ROM 0x${hex} から取り込み`;
}

/**
 * `.s` か `.string` の本文から、前に取り込んだアドレスとラベル（印の次のラベル）を拾う。
 * 戻り値は ROM の中の位置（ファイルの先頭から）→ ラベル。
 */
export function findImportedLabels(text: string, into: Map<number, string> = new Map()): Map<number, string> {
  const lines = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length; i++) {
    const asm = ASM_MARK.exec(lines[i]!);
    const str = asm ? null : STRING_MARK.exec(lines[i]!);
    const m = asm ?? str;
    if (!m) continue;
    for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
      const line = lines[j]!.trim();
      if (line === "" || line.startsWith(".global")) continue;
      const label = asm ? /^([A-Za-z_.$][\w.$]*):/.exec(line)?.[1] : /^#org\s+@(\S+)/.exec(line)?.[1];
      if (label) into.set(parseInt(m[1]!, 16) - ROM_BASE, label);
      break;
    }
  }
  return into;
}

/** 取り込みの指定。 */
export interface ScriptImportOptions {
  readonly commands: DisasmCommandSet;
  readonly text?: ScriptTextCodec;
  readonly dialect: ScriptDialect;
  /** 新しいスクリプトのラベルに `.global` を付けるか。 */
  readonly useGlobal: boolean;
  /** 入口のラベル（イベントのラベルの規則で付けた名前。例 `Moegi_Npc3`）。 */
  readonly label: string;
  /** 前に取り込んだもの（ROM の中の位置 → ラベル）。同じアドレスはそのラベルを使い、書き直さない。 */
  readonly existing?: ReadonlyMap<number, string>;
  /** 使えない名前（プロジェクトにあるラベル）。 */
  readonly taken?: (name: string) => boolean;
  /** 付ける名前を変える（自動で付けた名前 → 新しい名前）。 */
  readonly rename?: ReadonlyMap<string, string>;
}

/** 取り込むもの 1 つ（一覧で確かめて名前を変えられる）。 */
export interface ScriptImportItem {
  readonly kind: DisasmRefKind;
  /** ROM の中の位置。 */
  readonly offset: number;
  readonly label: string;
  /** 前に取り込んだもの（書かない）。 */
  readonly reused: boolean;
}

/** 取り込んだスクリプトのまとまり（ビルド後の ROM と比べるのに使う）。 */
export interface ScriptImportBlock {
  readonly label: string;
  readonly offset: number;
  readonly size: number;
  /** まとまりの中の、ラベルを指す 4 バイトの位置（まとまりの先頭から）。比べるときはここを除く。 */
  readonly pointers: readonly number[];
}

/** 取り込みの計画。 */
export interface ScriptImportPlan {
  /** 入口のラベル（イベントに付ける）。 */
  readonly entryLabel: string;
  /** 入口をもう取り込んであった（何も書かない）。 */
  readonly reused: boolean;
  readonly items: readonly ScriptImportItem[];
  /** `.s` に足す行。 */
  readonly asm: readonly string[];
  /** `.string` に足す行。 */
  readonly strings: readonly string[];
  readonly blocks: readonly ScriptImportBlock[];
  /** 読めなかった箇所。 */
  readonly problems: readonly string[];
}

/**
 * ROM のスクリプトを `.s` に取り込む計画を作る（#207）。
 * - 入口は `options.label`、たどった先は `<入口>_1`…、文字列は `gText_<入口>_1`…、移動データは `m_<入口>_1`…、ショップは `<入口>_Mart1`…。
 * - 前に取り込んだアドレス（印の付いたもの）はそのラベルを使い、そのまとまりは書かない。
 * - ND は 0F の漢字のポインタを省いた行（ひらがなと同じ文字列）を、同じ本文の `_k` を作って指し直す。
 * - まとまりの前に印（`@ ZigzaguMap: ROM 0x08XXXXXX から取り込み`）を書く。
 */
export function planScriptImport(rom: Rom, entry: number, options: ScriptImportOptions): ScriptImportPlan {
  const existing = options.existing ?? new Map<number, string>();
  const known = existing.get(entry);
  if (known !== undefined) return { entryLabel: known, reused: true, items: [], asm: [], strings: [], blocks: [], problems: [] };
  const used = new Set<string>([options.label]);
  const taken = (name: string): boolean => used.has(name) || (options.taken?.(name) ?? false);
  const counters: Record<DisasmRefKind, number> = { script: 0, string: 0, movement: 0, mart: 0 };
  const nameOf = (kind: DisasmRefKind): string => {
    for (;;) {
      const n = ++counters[kind];
      const base = options.label;
      const name = kind === "script" ? `${base}_${n}` : kind === "string" ? scriptTextLabel(`${base}_${n}`) : kind === "movement" ? `m_${base}_${n}` : `${base}_Mart${n}`;
      if (!taken(name)) {
        used.add(name);
        return name;
      }
    }
  };
  const d = disassembleScripts(rom, [{ offset: entry, label: options.label }], {
    commands: options.commands,
    ...(options.text ? { text: options.text } : {}),
    labelName: (pointer, kind) => existing.get(pointer - ROM_BASE) ?? nameOf(kind),
  });
  const renamed = applyRenames(d, options.rename ?? new Map(), existing);
  const items: ScriptImportItem[] = [];
  const kindOf = new Map<number, DisasmRefKind>();
  for (const b of renamed.blocks) kindOf.set(b.offset, "script");
  for (const s of renamed.strings) kindOf.set(s.offset, "string");
  for (const m of renamed.movements) kindOf.set(m.offset, "movement");
  for (const m of renamed.marts) kindOf.set(m.offset, "mart");
  for (const [offset, label] of renamed.labels) {
    const kind = kindOf.get(offset) ?? "script";
    items.push({ kind, offset, label, reused: existing.has(offset) });
  }
  items.sort((a, b) => (a.offset === entry ? -1 : b.offset === entry ? 1 : a.offset - b.offset));

  // 前に取り込んだものを除いて文字にする
  const fresh: Disassembly = {
    ...renamed,
    blocks: renamed.blocks.filter((b) => !existing.has(b.offset)),
    strings: renamed.strings.filter((s) => !existing.has(s.offset)),
    movements: renamed.movements.filter((m) => !existing.has(m.offset)),
    marts: renamed.marts.filter((m) => !existing.has(m.offset)),
  };
  const text = renderDisassembly(fresh);
  const nd = options.dialect === "nd";
  const stringLabels = new Set(fresh.strings.map((s) => s.label));
  const asm: string[] = [];
  const marked = new Set<number>();
  for (const line of text.script.lines) {
    const isLabel = /^[A-Za-z_.$][\w.$]*:$/.test(line.text);
    if (isLabel && line.offset !== null && !marked.has(line.offset) && fresh.blocks.some((b) => b.offset === line.offset)) {
      marked.add(line.offset);
      asm.push(importMarkLine("asm", line.offset + ROM_BASE));
      if (options.useGlobal) asm.push(`.global ${line.text.slice(0, -1)}`);
    }
    // ND: 漢字を省いた 0F（ひらがなと同じ文字列）は、同じ本文の _k を指し直す
    const lp = nd ? /^(\s*loadpointer\s+\S+\s+)(\S+)$/.exec(line.text) : null;
    asm.push(lp && stringLabels.has(lp[2]!) ? `${lp[1]}${lp[2]} ${lp[2]}_k` : line.text);
  }
  while (asm.length > 0 && asm[asm.length - 1] === "") asm.pop();
  const strings: string[] = [];
  for (const s of fresh.strings) {
    if (strings.length > 0) strings.push("");
    // 長い文は、制御記号（\n・\p・\l）のあとで .string の行を分けて書く（#221。string.py がつなぎ直す）
    const body = wrapStringBody(s.text).split("\n");
    strings.push(importMarkLine("string", s.offset + ROM_BASE), `#org @${s.label}`, ...body);
    if (nd) strings.push("", `#org @${s.label}_k`, ...body);
  }
  const blocks: ScriptImportBlock[] = fresh.blocks.map((b) => ({
    label: renamed.labels.get(b.offset) ?? "",
    offset: b.offset,
    size: b.end - b.offset,
    pointers: b.lines.flatMap((l) => {
      let at = l.offset - b.offset + 1;
      const out: number[] = [];
      for (const a of l.args) {
        if (a.ref !== null && a.size === 4) out.push(at);
        at += a.size;
      }
      return out;
    }),
  }));
  return {
    entryLabel: renamed.labels.get(entry) ?? options.label,
    reused: false,
    items,
    asm,
    strings,
    blocks,
    problems: d.problems.map((p) => (p.offset === null ? p.message : `0x${(p.offset + ROM_BASE).toString(16).toUpperCase()}: ${p.message}`)),
  };
}

/** 名前の付け替えを結果に入れる（前に取り込んだものは変えない）。 */
function applyRenames(d: Disassembly, rename: ReadonlyMap<string, string>, existing: ReadonlyMap<number, string>): Disassembly {
  if (rename.size === 0) return d;
  const swap = (offset: number, label: string): string => (existing.has(offset) ? label : (rename.get(label) ?? label));
  const labels = new Map<number, string>();
  for (const [offset, label] of d.labels) labels.set(offset, swap(offset, label));
  return {
    ...d,
    labels,
    entries: d.entries.map((e) => ({ ...e, label: swap(e.offset, e.label) })),
    strings: d.strings.map((s) => ({ ...s, label: swap(s.offset, s.label) })),
    movements: d.movements.map((m) => ({ ...m, label: swap(m.offset, m.label) })),
    marts: d.marts.map((m) => ({ ...m, label: swap(m.offset, m.label) })),
  };
}
