import { asmTokenText, parseAsmLine, type AsmLine } from "../asm/AsmLine.js";
import { parseStringFile, removeStringEntry, stringifyStringFile } from "../strings/StringFile.js";

/**
 * イベントを消したときに、そのイベントのスクリプトの記述を `.s` と `.string` から除く計画（#220）。
 *
 * - 入口のラベルのまとまり（ラベルの行から次のラベルの行の前まで）と、そこから同じ `.s` の中でたどれるラベル
 *   （goto・call の行き先、移動データ、ほかの下請け。終わりの命令が無く次のまとまりへ続けて実行されるときは、その次のまとまりも）を候補にする。
 * - 候補のうち、ほかから参照されているもの（候補の外の `.s` の行、ほかのイベント・eventscripts・マップスクリプトの表、
 *   C などほかのファイル）と、候補でない前のまとまりから続けて実行されるものは残す。残したまとまりから参照されるものも残す（決まるまで繰り返す）。
 * - 除くまとまりが使っている文字列のラベル（`.string` の `#org`。ND の `_k` も）のうち、ほかから参照されていないものを除く。
 * - まとまりの前の `.global ラベル` の行と、ZigzaguMap の取り込みの印（`@ ZigzaguMap: ROM 0x... から取り込み`）も一緒に除く。
 */

/** ファイル 1 つ（パスと本文）。 */
export interface RemovalFile {
  readonly path: string;
  readonly text: string;
}

export interface ScriptRemovalInput {
  /** 除くスクリプトの入口のラベル。 */
  readonly entry: string;
  /** プロジェクトのすべての `.s`（assembly の下）。 */
  readonly asm: readonly RemovalFile[];
  /** プロジェクトのすべての `.string`。 */
  readonly strings: readonly RemovalFile[];
  /** ほかのイベント・eventscripts の行・マップスクリプトの表が使っているラベル（消すイベントの分は除いて渡す）。 */
  readonly external: ReadonlySet<string>;
  /** そのほかに名前を探すファイル（C のソース、repoints など）。名前が 1 語として出てくれば参照とみなす。 */
  readonly others?: readonly RemovalFile[];
}

/** 残したものと、その理由。 */
export interface RemovalKept {
  readonly label: string;
  /** `external`（ほかのイベントなどが使う）・`reference`（ほかの行から参照）・`fallthrough`（前のまとまりから続けて実行）・`other`（ほかのファイルに名前）・`registry`（呼ぶ側が決めた理由）。 */
  readonly reason: "external" | "reference" | "fallthrough" | "other" | "registry";
  /** 参照している場所（`path:line`、行は 1 から）。 */
  readonly where?: string;
}

export interface ScriptRemovalPlan {
  /** 入口のラベルの `.s`（見つからなければ null。そのときは何も除かない）。 */
  readonly scriptPath: string | null;
  /** 除く `.s` のラベル（入口を含む。ファイルの順）。 */
  readonly removedLabels: readonly string[];
  readonly keptLabels: readonly RemovalKept[];
  /** 除く文字列のラベルとファイル。 */
  readonly removedStrings: readonly { readonly label: string; readonly path: string }[];
  readonly keptStrings: readonly RemovalKept[];
  /** 書き換えるファイル（変わるものだけ）。 */
  readonly files: readonly { readonly path: string; readonly before: string; readonly after: string }[];
}

/** 続けて次のまとまりへ進まない命令（goto などで飛ぶか、終わる）。 */
const TERMINATORS = new Set(["end", "return", "goto", "gotostd", "jumpram", "killscript", "virtualgoto", "returnram", "endram"]);
const NAME = /[A-Za-z_.$][A-Za-z0-9_.$]*/g;
const MARK = /^\s*@\s*ZigzaguMap:\s*ROM\s+0x[0-9A-Fa-f]+\s/;

interface Line {
  readonly text: string;
  readonly eol: string;
  readonly parsed: AsmLine;
}

interface Block {
  readonly label: string;
  /** 除くときの始まり（`.global` と印の行を含む）。 */
  readonly from: number;
  /** ラベルの行。 */
  readonly labelLine: number;
  /** 次のまとまりのラベルの行（無ければ行の数）。 */
  readonly next: number;
  /** 終わりの命令が無く、次のまとまりへ続けて実行されるか。 */
  readonly fallsThrough: boolean;
}

function splitLines(text: string): { text: string; eol: string }[] {
  const out: { text: string; eol: string }[] = [];
  const re = /\r\n|\n|\r/g;
  let start = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ text: text.slice(start, m.index), eol: m[0] });
    start = m.index + m[0].length;
  }
  if (start < text.length) out.push({ text: text.slice(start), eol: "" });
  return out;
}

function parseLines(text: string): Line[] {
  let inComment = false;
  return splitLines(text).map((l) => {
    const parsed = parseAsmLine(l.text, inComment);
    inComment = parsed.endsInBlockComment;
    return { ...l, parsed };
  });
}

function opName(line: AsmLine): string | null {
  return line.op ? asmTokenText(line, line.op) : null;
}

/** 行の引数に出てくる名前（`.global` などの宣言は数えない）。 */
function namesIn(line: AsmLine): string[] {
  const op = opName(line);
  if (op === null || /^\.(global|globl|extern|type|size|equ|set|equiv|eqv)$/i.test(op)) return [];
  const out: string[] = [];
  for (const a of line.args) {
    if (a.kind !== "symbol" && a.kind !== "expression") continue;
    for (const m of asmTokenText(line, a).matchAll(NAME)) out.push(m[0]);
  }
  return out;
}

function isGlobalOf(line: AsmLine, label: string): boolean {
  const op = opName(line);
  return op !== null && /^\.(global|globl)$/i.test(op) && line.args.length === 1 && asmTokenText(line, line.args[0]!) === label;
}

function isCommentOnly(line: Line): boolean {
  return line.parsed.op === null && line.parsed.labels.length === 0 && line.text.trim() !== "";
}

function blocksOf(lines: readonly Line[]): Block[] {
  const starts: { label: string; line: number }[] = [];
  for (const [i, l] of lines.entries()) {
    const label = l.parsed.labels.map((t) => asmTokenText(l.parsed, t)).find((n) => !/^[0-9]+$/.test(n));
    if (label) starts.push({ label, line: i });
  }
  return starts.map((s, k) => {
    const next = starts[k + 1]?.line ?? lines.length;
    let from = s.line;
    while (from > 0 && (isGlobalOf(lines[from - 1]!.parsed, s.label) || MARK.test(lines[from - 1]!.text))) from--;
    let last: string | null = null;
    for (let i = s.line; i < next; i++) {
      const op = opName(lines[i]!.parsed);
      if (op !== null) last = op;
    }
    const fallsThrough = last !== null && !last.startsWith(".") && !TERMINATORS.has(last.toLowerCase());
    return { label: s.label, from, labelLine: s.line, next, fallsThrough };
  });
}

function wordIn(text: string, name: string): boolean {
  const escaped = name.replace(/[.$]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_.$])${escaped}($|[^A-Za-z0-9_.$])`).test(text);
}

/** 計画を作る。入口のラベルが `.s` に無ければ、何も除かない計画を返す。 */
export function planScriptRemoval(input: ScriptRemovalInput): ScriptRemovalPlan {
  const parsed = new Map(input.asm.map((f) => [f.path, parseLines(f.text)]));
  const file = input.asm.find((f) => blocksOf(parsed.get(f.path)!).some((b) => b.label === input.entry));
  const empty: ScriptRemovalPlan = { scriptPath: null, removedLabels: [], keptLabels: [], removedStrings: [], keptStrings: [], files: [] };
  if (!file) return empty;
  const lines = parsed.get(file.path)!;
  const blocks = blocksOf(lines);
  const byLabel = new Map(blocks.map((b, i) => [b.label, i]));

  // 参照の場所: 名前 → (ファイル, 行)
  const refs = new Map<string, { path: string; line: number }[]>();
  for (const [path, ls] of parsed) {
    for (const [i, l] of ls.entries()) {
      for (const n of namesIn(l.parsed)) {
        const list = refs.get(n) ?? [];
        list.push({ path, line: i });
        refs.set(n, list);
      }
    }
  }
  const blockAt = (line: number): number => {
    let k = -1;
    for (const [i, b] of blocks.entries()) if (b.labelLine <= line) k = i;
    return k;
  };

  // 候補: 入口からたどれる同じファイルのまとまり
  const candidates = new Set<number>();
  const queue = [byLabel.get(input.entry)!];
  while (queue.length > 0) {
    const k = queue.pop()!;
    if (candidates.has(k)) continue;
    candidates.add(k);
    const b = blocks[k]!;
    for (let i = b.labelLine; i < b.next; i++) {
      for (const n of namesIn(lines[i]!.parsed)) {
        const t = byLabel.get(n);
        if (t !== undefined && !candidates.has(t)) queue.push(t);
      }
    }
    if (b.fallsThrough && k + 1 < blocks.length) queue.push(k + 1);
  }

  const removable = new Set(candidates);
  const inRemovable = (path: string, line: number): boolean => {
    if (path !== file.path) return false;
    const k = blockAt(line);
    return k >= 0 && removable.has(k) && line < blocks[k]!.next;
  };
  const where = (loc: { path: string; line: number }) => `${loc.path}:${loc.line + 1}`;
  const keptLabels: RemovalKept[] = [];
  const reasonFor = (name: string, k: number | null): RemovalKept | null => {
    if (input.external.has(name)) return { label: name, reason: "external" };
    const outside = (refs.get(name) ?? []).find((loc) => !inRemovable(loc.path, loc.line));
    if (outside) return { label: name, reason: "reference", where: where(outside) };
    if (k !== null && k > 0 && !removable.has(k - 1) && blocks[k - 1]!.fallsThrough) {
      return { label: name, reason: "fallthrough", where: `${file.path}:${blocks[k - 1]!.labelLine + 1}` };
    }
    const other = input.others?.find((f) => wordIn(f.text, name));
    if (other) return { label: name, reason: "other", where: other.path };
    return null;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const k of [...removable].sort((a, b) => a - b)) {
      const kept = reasonFor(blocks[k]!.label, k);
      if (kept) {
        removable.delete(k);
        keptLabels.push(kept);
        changed = true;
      }
    }
  }

  // 文字列
  const stringDefs = new Map<string, string[]>();
  for (const f of input.strings) {
    for (const e of parseStringFile(f.text).entries) {
      const list = stringDefs.get(e.label) ?? [];
      if (!list.includes(f.path)) list.push(f.path);
      stringDefs.set(e.label, list);
    }
  }
  const used = new Set<string>();
  for (const k of removable) {
    const b = blocks[k]!;
    for (let i = b.labelLine; i < b.next; i++) for (const n of namesIn(lines[i]!.parsed)) if (stringDefs.has(n)) used.add(n);
  }
  const removedStrings: { label: string; path: string }[] = [];
  const keptStrings: RemovalKept[] = [];
  for (const name of [...used].sort()) {
    const kept = reasonFor(name, null);
    if (kept) keptStrings.push(kept);
    else for (const path of stringDefs.get(name)!) removedStrings.push({ label: name, path });
  }

  return finish(input, file, lines, blocks, removable, keptLabels, removedStrings, keptStrings);
}

/** 文字列の一部を、呼ぶ側の理由で残す（Chronos の check_text_width.py の REGISTRY に登録があるものなど）。 */
export function keepStringsInPlan(
  input: ScriptRemovalInput,
  plan: ScriptRemovalPlan,
  keep: ReadonlyMap<string, string>,
): ScriptRemovalPlan {
  if (![...keep.keys()].some((k) => plan.removedStrings.some((s) => s.label === k))) return plan;
  const removedStrings = plan.removedStrings.filter((s) => !keep.has(s.label));
  const keptStrings = [
    ...plan.keptStrings,
    ...[...new Set(plan.removedStrings.filter((s) => keep.has(s.label)).map((s) => s.label))].map(
      (label): RemovalKept => ({ label, reason: "registry", where: keep.get(label)! }),
    ),
  ];
  const files = plan.files.filter((f) => !input.strings.some((s) => s.path === f.path));
  return { ...plan, removedStrings, keptStrings, files: [...files, ...stringEdits(input, removedStrings)] };
}

function stringEdits(input: ScriptRemovalInput, removed: readonly { label: string; path: string }[]): { path: string; before: string; after: string }[] {
  const out: { path: string; before: string; after: string }[] = [];
  for (const f of input.strings) {
    const labels = removed.filter((s) => s.path === f.path).map((s) => s.label);
    if (labels.length === 0) continue;
    let sf = parseStringFile(f.text);
    for (const label of labels) {
      // 同じラベルが 2 つあるときは全部除く
      while (sf.entries.some((e) => e.label === label)) sf = removeStringEntry(sf, label);
    }
    const after = stringifyStringFile(sf);
    if (after !== f.text) out.push({ path: f.path, before: f.text, after });
  }
  return out;
}

function finish(
  input: ScriptRemovalInput,
  file: RemovalFile,
  lines: readonly Line[],
  blocks: readonly Block[],
  removable: ReadonlySet<number>,
  keptLabels: RemovalKept[],
  removedStrings: { label: string; path: string }[],
  keptStrings: RemovalKept[],
): ScriptRemovalPlan {
  const drop = new Set<number>();
  const removedNames = new Set<string>();
  for (const k of [...removable].sort((a, b) => a - b)) {
    const b = blocks[k]!;
    removedNames.add(b.label);
    // 次のまとまりの見出しのコメントは残す（後ろから見て、コメントだけの行と .align は次のまとまりのもの）
    let end = blocks[k + 1]?.from ?? lines.length;
    while (end > b.labelLine + 1) {
      const l = lines[end - 1]!;
      const op = opName(l.parsed);
      if (isCommentOnly(l) || (op !== null && /^\.(align|balign)$/i.test(op) && l.parsed.labels.length === 0)) end--;
      else break;
    }
    for (let i = b.from; i < end; i++) drop.add(i);
  }
  // ほかの場所の `.global 名前` の行
  for (const [i, l] of lines.entries()) for (const n of removedNames) if (isGlobalOf(l.parsed, n)) drop.add(i);
  // 除いたところで空行が 2 つ続くなら 1 つにする（ほかの場所の空行は変えない）
  const blank = (l: { text: string }) => l.text.trim() === "";
  const out: { text: string; eol: string }[] = [];
  let joint = false;
  for (const [i, l] of lines.entries()) {
    if (drop.has(i)) {
      joint = true;
      continue;
    }
    if (joint && blank(l) && (out.length === 0 || blank(out[out.length - 1]!))) continue;
    if (!blank(l)) joint = false;
    out.push({ text: l.text, eol: l.eol });
  }
  // 最後のまとまりを除いたら、残った最後の空行も除き、最後の改行の有無を元にそろえる
  if (drop.has(lines.length - 1)) {
    while (out.length > 1 && blank(out[out.length - 1]!)) out.pop();
    if (out.length > 0 && (lines[lines.length - 1]?.eol ?? "") === "") out[out.length - 1]!.eol = "";
  }
  const after = out.map((l) => l.text + l.eol).join("");
  const files: { path: string; before: string; after: string }[] = [];
  if (drop.size > 0 && after !== file.text) files.push({ path: file.path, before: file.text, after });
  files.push(...stringEdits(input, removedStrings));
  return {
    scriptPath: file.path,
    removedLabels: blocks.filter((_, k) => removable.has(k)).map((b) => b.label),
    keptLabels,
    removedStrings,
    keptStrings,
    files,
  };
}
