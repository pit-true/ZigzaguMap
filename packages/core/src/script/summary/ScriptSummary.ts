import { ROM_BASE } from "../../rom/Rom.js";
import type { Rom } from "../../rom/Rom.js";
import { asmOpName, asmTokenText, parseAsmLine, type AsmLine } from "../asm/AsmLine.js";
import { splitAsmLines } from "../asm/lineEnding.js";
import type { DisasmCommandSet } from "../disasm/DisasmCommandSet.js";
import { disassembleScripts } from "../disasm/ScriptDisassembler.js";
import type { ScriptTextCodec } from "../disasm/scriptText.js";

/**
 * イベントのスクリプトの要約（#226。イベントタブのホバーの吹き出し）。`.s` のラベルからたどるものと、素の ROM の
 * スクリプトを逆アセンブルしてたどるものの両方を、同じ「命令の並び」（{@link SummaryOp}）にしてから要約する。
 *
 * 拾うもの: セリフ（文字列を指す引数。1 命令に 1 つ、ND の 2 ポインタの msgbox は先の方）、トレーナー（番号と戦闘前の文）、
 * ショップの品物、もらえるアイテム（giveitem・additem・copyvarifnotzero）、もらえるポケモン（givepokemon）、
 * 野生戦（setwildbattle・setwild）。絵は出さない（名前だけ）。
 */

/** 命令の引数 1 つ（たどった結果）。 */
export interface SummaryArg {
  /** 値（数で書いてあるか、定数を引けたとき）。 */
  readonly value: number | null;
  /** 名前で書いてあったときの名前（定数・ラベル）。 */
  readonly symbol: string | null;
  /** 文字列を指していればその本文。 */
  readonly text: string | null;
  /** ショップの一覧を指していれば品物の番号（最後の 0 を含まない）。 */
  readonly mart: readonly number[] | null;
}

/** 命令 1 つ。 */
export interface SummaryOp {
  /** 命令の名前（小文字）。 */
  readonly command: string;
  readonly args: readonly SummaryArg[];
}

/** 要約の 1 件。 */
export type SummaryEntry =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "trainer"; readonly id: number | null; readonly symbol: string | null; readonly intro: string | null }
  | { readonly type: "mart"; readonly items: readonly string[]; readonly more: number }
  | { readonly type: "item"; readonly item: string; readonly amount: number | null }
  | { readonly type: "pokemon"; readonly species: string; readonly level: number | null }
  | { readonly type: "wild"; readonly species: string; readonly level: number | null };

/** 要約。 */
export interface ScriptSummary {
  readonly entries: readonly SummaryEntry[];
  /** 件数の上限で打ち切ったか。 */
  readonly truncated: boolean;
  /** たどれなかったこと（ラベルが無い、ROM の外など）。 */
  readonly problems: readonly string[];
}

/** 名前の引き方（無ければ番号のまま出す）。 */
export interface SummaryNames {
  item?(id: number): string | null;
  species?(id: number): string | null;
}

/** 件数と長さの上限。 */
export interface SummaryLimits {
  /** セリフの件数。既定 5。 */
  readonly texts?: number;
  /** セリフ 1 件の字数。既定 60。 */
  readonly textLength?: number;
  /** ショップの品物の数。既定 5。 */
  readonly martItems?: number;
  /** セリフ以外も含めた件数。既定 12。 */
  readonly entries?: number;
}

const ITEM_COMMANDS = new Set(["giveitem", "additem", "giveitem_msg", "finditem", "obtainitem"]);
const MART_COMMANDS = new Set(["pokemart", "mart", "pokemartdecoration", "pokemartbp"]);
const POKEMON_COMMANDS = new Set(["givepokemon", "givemon"]);
const WILD_COMMANDS = new Set(["setwildbattle", "setwild"]);

/** セリフの記号（`\p`・`\n`・`[...]` など）を外して 1 行にし、`max` 字で切る。 */
export function summaryText(raw: string, max = 60): string {
  const flat = raw
    .replace(/\[(PLAYER|RIVAL|BUFFER[123])\]/g, (_, name: string) => PLACEHOLDERS[name] ?? "")
    .replace(/\\[pnl]/g, " ")
    .replace(/\\[a-z](?:\[[^\]]*\])?/gi, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : flat;
}

/** 文字列の中の名前の置き場（`[PLAYER]` など）を読める形にする。 */
const PLACEHOLDERS: Readonly<Record<string, string>> = {
  PLAYER: "（主人公）",
  RIVAL: "（ライバル）",
  BUFFER1: "（バッファ1）",
  BUFFER2: "（バッファ2）",
  BUFFER3: "（バッファ3）",
};

/** 変数（0x4000 以上）を指す値か。種族や道具を変数で渡す命令（givepokemon VAR_TEMP_1 など）を名前にしない。 */
function isVariable(id: number): boolean {
  return id >= 0x4000 && id <= 0x80ff;
}

function nameOr(id: number | null, symbol: string | null, find: ((id: number) => string | null) | undefined): string {
  if (id !== null && isVariable(id)) return `変数 0x${id.toString(16).toUpperCase()}`;
  if (id !== null) {
    const n = find?.(id) ?? null;
    return n ? n : `#${id}`;
  }
  return symbol ?? "?";
}

/** 命令の並びを要約する。 */
export function summarizeOps(ops: readonly SummaryOp[], names: SummaryNames = {}, limits: SummaryLimits = {}, problems: readonly string[] = []): ScriptSummary {
  const maxTexts = limits.texts ?? 5;
  const textLength = limits.textLength ?? 60;
  const martItems = limits.martItems ?? 5;
  const maxEntries = limits.entries ?? 12;
  const entries: SummaryEntry[] = [];
  let texts = 0;
  let truncated = false;
  const seen = new Set<string>();
  const push = (e: SummaryEntry): void => {
    // 分岐の先で同じものを何度も出すスクリプト（はい・いいえの両方で同じ道具をくれるなど）は 1 回だけ出す。
    const key = JSON.stringify(e);
    if (seen.has(key)) return;
    seen.add(key);
    if (entries.length >= maxEntries) {
      truncated = true;
      return;
    }
    entries.push(e);
  };
  for (const op of ops) {
    const c = op.command;
    const firstText = op.args.find((a) => a.text !== null)?.text ?? null;
    if (c === "trainer" || c.startsWith("trainerbattle")) {
      const idArg = op.args[1] ?? null;
      push({ type: "trainer", id: idArg?.value ?? null, symbol: idArg?.symbol ?? null, intro: firstText === null ? null : summaryText(firstText, textLength) });
      continue;
    }
    if (MART_COMMANDS.has(c)) {
      const items = op.args.find((a) => a.mart !== null)?.mart ?? [];
      push({ type: "mart", items: items.slice(0, martItems).map((i) => nameOr(i, null, names.item)), more: Math.max(0, items.length - martItems) });
      continue;
    }
    if (ITEM_COMMANDS.has(c) || c === "copyvarifnotzero" || c === "setvarifnotzero") {
      // copyvarifnotzero は 2 つ目が道具（`copyvarifnotzero 0x8000 ITEM_POTION`）。変数どうしのときは拾わない。
      const arg = ITEM_COMMANDS.has(c) ? op.args[0] : op.args[1];
      if (arg && !(c !== "giveitem" && !ITEM_COMMANDS.has(c) && arg.value !== null && arg.value >= 0x4000)) {
        const amount = ITEM_COMMANDS.has(c) ? (op.args[1]?.value ?? null) : null;
        push({ type: "item", item: nameOr(arg.value, arg.symbol, names.item), amount });
      }
      if (firstText !== null && texts < maxTexts) {
        texts++;
        push({ type: "text", text: summaryText(firstText, textLength) });
      }
      continue;
    }
    if (POKEMON_COMMANDS.has(c) || WILD_COMMANDS.has(c)) {
      const s = op.args[0];
      const level = op.args[1]?.value ?? null;
      push({ type: POKEMON_COMMANDS.has(c) ? "pokemon" : "wild", species: nameOr(s?.value ?? null, s?.symbol ?? null, names.species), level });
      continue;
    }
    if (firstText !== null) {
      if (texts >= maxTexts) {
        truncated = true;
        continue;
      }
      texts++;
      push({ type: "text", text: summaryText(firstText, textLength) });
    }
  }
  return { entries, truncated, problems };
}

// ---- 素の ROM ----

/** 素の ROM のスクリプト（`pointer` は 0x08 で始まる値）を逆アセンブルして要約する。 */
export function summarizeRomScript(
  rom: Rom,
  pointer: number,
  tools: { commands: DisasmCommandSet; text?: ScriptTextCodec },
  names: SummaryNames = {},
  limits: SummaryLimits = {},
): ScriptSummary {
  const offset = (pointer >>> 0) - ROM_BASE;
  if (!rom.isPointer(pointer >>> 0)) return { entries: [], truncated: false, problems: [`ROM の外を指しています（0x${(pointer >>> 0).toString(16).toUpperCase()}）`] };
  const d = disassembleScripts(rom, [{ offset }], { commands: tools.commands, ...(tools.text ? { text: tools.text } : {}), maxCommands: 2000 });
  const strings = new Map(d.strings.map((s) => [s.offset, s.text]));
  const marts = new Map(d.marts.map((m) => [m.offset, m.items.filter((i) => i !== 0)]));
  // 入口のまとまりを先に、残りは位置の順（ROM のスクリプトは分岐の先が前にあることもある）。
  const blocks = [...d.blocks].sort((a, b) => (a.offset === offset ? -1 : b.offset === offset ? 1 : a.offset - b.offset));
  const ops: SummaryOp[] = [];
  for (const block of blocks) {
    for (const line of block.lines) {
      if (!line.command) continue;
      ops.push({
        command: line.command.toLowerCase(),
        args: line.args.map((a) => {
          const target = a.value === null ? -1 : (a.value >>> 0) - ROM_BASE;
          return {
            value: a.value,
            symbol: null,
            text: a.ref === "string" ? (strings.get(target) ?? null) : null,
            mart: a.ref === "mart" ? (marts.get(target) ?? null) : null,
          };
        }),
      });
    }
  }
  return summarizeOps(ops, names, limits, d.problems.slice(0, 3).map((p) => p.message));
}

// ---- .s ----

/** `.s` をたどるときに引くもの。 */
export interface AsmSummarySource {
  /** 文字列のラベルの本文（`.string` の `#org`）。無ければ null。 */
  stringText(label: string): string | null;
  /** 定数（`.equ` など）の値。無ければ null。 */
  constant?(name: string): number | null;
}

/** たどる深さとまとまりの数の上限。 */
const MAX_DEPTH = 4;
const MAX_LABELS = 16;
const MAX_LINES = 400;
const STOP_COMMANDS = new Set(["end", "return", "goto", "jump", "killscript", "gotostd", "releaseall_end"]);

/** 数の書き方（`12`・`0x1F`・`-1`・`0b101`）を読む。読めなければ null。 */
export function parseAsmNumber(text: string): number | null {
  const t = text.trim();
  if (/^-?0x[0-9a-f]+$/i.test(t)) return Number.parseInt(t, 16);
  if (/^-?0b[01]+$/i.test(t)) return (t.startsWith("-") ? -1 : 1) * Number.parseInt(t.replace(/^-?0b/i, ""), 2);
  if (/^-?[0-9]+$/.test(t)) return Number.parseInt(t, 10);
  return null;
}

interface ParsedFile {
  readonly lines: readonly AsmLine[];
  /** ラベル → 行の番号（0 から）。 */
  readonly labels: ReadonlyMap<string, number>;
}

function parseFile(text: string): ParsedFile {
  const lines: AsmLine[] = [];
  const labels = new Map<string, number>();
  let inComment = false;
  splitAsmLines(text).forEach((raw, i) => {
    const line = parseAsmLine(raw, inComment);
    inComment = line.endsInBlockComment;
    lines.push(line);
    for (const l of line.labels) {
      const name = asmTokenText(line, l);
      if (!labels.has(name)) labels.set(name, i);
    }
  });
  return { lines, labels };
}

/**
 * `.s` の本文 `text` の `label` からたどって要約する（`call`・`goto` などの行き先も、同じファイルの中だけ、深さに上限）。
 * ラベルが無ければ problems に書く。
 */
export function summarizeAsmScript(text: string, label: string, source: AsmSummarySource, names: SummaryNames = {}, limits: SummaryLimits = {}): ScriptSummary {
  const file = parseFile(text);
  if (!file.labels.has(label)) return { entries: [], truncated: false, problems: [`ラベル ${label} が見つかりません`] };
  const ops: SummaryOp[] = [];
  const visited = new Set<string>();
  const queue: { label: string; depth: number }[] = [{ label, depth: 0 }];
  let lineBudget = MAX_LINES;
  const valueOf = (name: string): number | null => parseAsmNumber(name) ?? source.constant?.(name) ?? null;
  const martItems = (start: number): number[] => {
    const out: number[] = [];
    for (let i = start; i < file.lines.length && out.length < 256; i++) {
      const line = file.lines[i]!;
      if (i > start && line.labels.length > 0) break;
      const op = asmOpName(line);
      if (op === null) continue;
      if (op !== ".hword" && op !== ".2byte" && op !== ".short") break;
      for (const a of line.args) {
        const v = valueOf(asmTokenText(line, a));
        if (v === 0) return out;
        if (v !== null) out.push(v);
      }
    }
    return out;
  };
  while (queue.length > 0 && visited.size < MAX_LABELS && lineBudget > 0) {
    const { label: current, depth } = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const start = file.labels.get(current);
    if (start === undefined) continue;
    for (let i = start; i < file.lines.length && lineBudget > 0; i++, lineBudget--) {
      const line = file.lines[i]!;
      const op = asmOpName(line);
      if (op === null || op.startsWith(".")) {
        // データ（.byte など）に入ったら、そのまとまりは終わり。
        if (op !== null && i > start) break;
        continue;
      }
      const command = op.toLowerCase();
      const args: SummaryArg[] = line.args.map((tok) => {
        const raw = asmTokenText(line, tok);
        const num = parseAsmNumber(raw);
        const isName = num === null && /^[A-Za-z_.$][\w.$]*$/.test(raw);
        const text = isName ? source.stringText(raw) : null;
        const martAt = isName && MART_COMMANDS.has(command) ? file.labels.get(raw) : undefined;
        return {
          value: num ?? (isName ? (source.constant?.(raw) ?? null) : null),
          symbol: isName ? raw : null,
          text,
          mart: martAt === undefined ? null : martItems(martAt),
        };
      });
      ops.push({ command, args });
      if (depth < MAX_DEPTH) {
        for (const a of args) if (a.symbol && a.text === null && file.labels.has(a.symbol) && !MART_COMMANDS.has(command)) queue.push({ label: a.symbol, depth: depth + 1 });
      }
      if (STOP_COMMANDS.has(command)) break;
    }
  }
  return summarizeOps(ops, names, limits);
}
