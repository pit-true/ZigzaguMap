/**
 * ROM のスクリプトを xse_commands.s の記法の命令に戻す。
 *
 * - 入口から順に読み、`end`・`return`・`goto` などで止める。分岐先（call・goto・goto_if・ifcall、trainerbattle の続きのスクリプト）もたどる。
 * - たどった先、文字列、移動データ、ショップの一覧には仮のラベル（`ROM_08XXXXXX`）を付ける。
 * - 知らない命令（どの型にも合わないバイト）は `.byte` 1 つにして、その道は止める。
 * - ポインタの輪はたどった印で止め、ROM の外を指すポインタは数のまま書く。
 *
 * 命令の名前と並びは命令表（{@link DisasmCommandSet}）から引く。どの引数がスクリプト・文字列・移動データ・ショップかは、
 * 引数の種類（#185）と、ゲームの命令番号（0x04〜0x07・0x5C・0x86〜0x88 など。ND と Chronos で同じ）で決める。
 */

import { formatHex } from "../../binary/bytes.js";
import { ROM_BASE, type Rom } from "../../rom/Rom.js";
import type { DisasmVariant } from "./DisasmCommandSet.js";
import type {
  DisasmArg,
  DisasmBlock,
  DisasmEntry,
  DisasmLine,
  DisasmMart,
  DisasmMovement,
  DisasmProblem,
  DisasmRefKind,
  DisasmString,
  DisassembleOptions,
  Disassembly,
} from "./DisasmTypes.js";
import { ScriptTextCodec } from "./scriptText.js";

export type {
  DisasmArg,
  DisasmBlock,
  DisasmEntry,
  DisasmLine,
  DisasmMart,
  DisasmMovement,
  DisasmProblem,
  DisasmRefKind,
  DisasmString,
  DisassembleOptions,
  Disassembly,
} from "./DisasmTypes.js";

/** 命令番号（ゲームの命令。xse_commands.s の名前によらない）。 */
const OP = {
  call: 0x04,
  goto: 0x05,
  gotoIf: 0x06,
  callIf: 0x07,
  trainerbattle: 0x5c,
} as const;
/** その次の命令へ進まない命令（end・return・goto・gotostd・jumpram・killscript・gotopostbattlescript・gotobeatenscript・virtualgoto）。 */
const STOP_OPCODES: ReadonlySet<number> = new Set([0x02, 0x03, 0x05, 0x08, 0x0c, 0x0d, 0x5d, 0x5e, 0xb9]);
/** スクリプトの分岐先を持つ命令。 */
const BRANCH_OPCODES: ReadonlySet<number> = new Set([OP.call, OP.goto, OP.gotoIf, OP.callIf]);
/** ショップの一覧を持つ命令（mart・mart2・mart3）。 */
const MART_OPCODES: ReadonlySet<number> = new Set([0x86, 0x87, 0x88]);
/** trainerbattle の種類 → 4 バイトの引数のうち続きのスクリプトの番号（0 始まり）。ほかの 4 バイトは文字列。 */
const TRAINER_SCRIPT_POINTER: ReadonlyMap<number, number> = new Map([
  [1, 2],
  [2, 2],
  [6, 3],
  [8, 3],
]);
const END_MOVEMENT = 0xfe;

export const defaultDisasmLabel = (pointer: number): string => `ROM_${hex(pointer)}`;

/** ROM のスクリプトを逆アセンブルする。例外は投げず、読めない箇所は problems に出す。 */
export function disassembleScripts(rom: Rom, entries: readonly DisasmEntry[], options: DisassembleOptions): Disassembly {
  return new Disassembler(rom, options).run(entries);
}

class Disassembler {
  private readonly codec: ScriptTextCodec;
  private readonly labelName: (pointer: number, kind: DisasmRefKind) => string;
  private readonly maxCommands: number;
  private readonly maxStringBytes: number;
  private readonly maxMovementSteps: number;
  private readonly maxMartItems: number;

  /** 行の始まり → 行。 */
  private readonly lines = new Map<number, DisasmLine>();
  /** 行の中のバイト（始まりを除く） → その行の始まり。 */
  private readonly covered = new Map<number, number>();
  private readonly scriptTargets = new Set<number>();
  private readonly strings = new Map<number, DisasmString | null>();
  private readonly movements = new Map<number, DisasmMovement | null>();
  private readonly marts = new Map<number, DisasmMart | null>();
  private readonly problems: DisasmProblem[] = [];
  private readonly fixedLabels = new Map<number, string>();
  private commandCount = 0;

  constructor(
    private readonly rom: Rom,
    private readonly options: DisassembleOptions,
  ) {
    this.codec = options.text ?? ScriptTextCodec.japanese;
    this.labelName = options.labelName ?? defaultDisasmLabel;
    this.maxCommands = options.maxCommands ?? 20000;
    this.maxStringBytes = options.maxStringBytes ?? 1024;
    this.maxMovementSteps = options.maxMovementSteps ?? 256;
    this.maxMartItems = options.maxMartItems ?? 256;
  }

  run(entryList: readonly DisasmEntry[]): Disassembly {
    const entries: { offset: number; label: string | undefined }[] = entryList.map((e) =>
      typeof e === "number" ? { offset: e, label: undefined } : { offset: e.offset, label: e.label },
    );
    for (const e of entries) if (e.label !== undefined && !this.fixedLabels.has(e.offset)) this.fixedLabels.set(e.offset, e.label);

    const queue: number[] = [];
    for (const e of entries) {
      if (!this.rom.inRange(e.offset)) {
        this.problem(e.offset, `入口が ROM の外です`);
        continue;
      }
      this.scriptTargets.add(e.offset);
      queue.push(e.offset);
    }
    while (queue.length > 0) this.walk(queue.shift()!, queue);

    // ラベルを決める。スクリプトの分岐先は、行の始まりのときだけ（行の途中を指すものは数のまま）。
    const labels = new Map<number, string>();
    const name = (offset: number, kind: DisasmRefKind) => this.fixedLabels.get(offset) ?? this.labelName(offset + ROM_BASE, kind);
    for (const t of this.scriptTargets) if (this.lines.has(t)) labels.set(t, name(t, "script"));
    const strings = sortByOffset([...this.strings.values()].filter((s): s is DisasmString => s !== null));
    const movements = sortByOffset([...this.movements.values()].filter((m): m is DisasmMovement => m !== null));
    const marts = sortByOffset([...this.marts.values()].filter((m): m is DisasmMart => m !== null));
    for (const s of strings) if (!labels.has(s.offset)) labels.set(s.offset, (s.label = name(s.offset, "string")));
    for (const m of movements) if (!labels.has(m.offset)) labels.set(m.offset, (m.label = name(m.offset, "movement")));
    for (const m of marts) if (!labels.has(m.offset)) labels.set(m.offset, (m.label = name(m.offset, "mart")));
    // 同じ位置がスクリプトと文字列などを兼ねるときは、先に決めたラベルを使う。
    for (const s of strings) s.label = labels.get(s.offset)!;
    for (const m of movements) m.label = labels.get(m.offset)!;
    for (const m of marts) m.label = labels.get(m.offset)!;

    // 指す先にラベルが無い引数（行の途中を指す、読めなかった）は数のまま書く。
    for (const line of this.lines.values()) {
      for (const a of line.args) if (a.ref !== null && a.value !== null && !labels.has(a.value - ROM_BASE)) a.ref = null;
    }

    return {
      entries: entries.filter((e) => labels.has(e.offset)).map((e) => ({ offset: e.offset, label: labels.get(e.offset)! })),
      blocks: this.buildBlocks(labels),
      strings,
      movements,
      marts,
      problems: this.problems.sort((a, b) => (a.offset ?? -1) - (b.offset ?? -1)),
      labels,
    };
  }

  private problem(offset: number | null, message: string): void {
    this.problems.push({ offset, message });
  }

  /** `start` から 1 本の道を読む。 */
  private walk(start: number, queue: number[]): void {
    let at = start;
    for (;;) {
      if (this.lines.has(at)) return; // 読んだ行につながった。
      const inside = this.covered.get(at);
      if (inside !== undefined) {
        this.problem(at, `0x${hex(inside + ROM_BASE)} の命令の途中から読もうとしました`);
        return;
      }
      if (!this.rom.inRange(at)) {
        this.problem(at, `ROM の外まで読みました`);
        return;
      }
      if (this.commandCount >= this.maxCommands) {
        this.problem(at, `命令の数が上限（${this.maxCommands}）を超えたので止めました`);
        return;
      }
      this.commandCount++;
      const line = this.decodeLine(at);
      if (!line) {
        const bytes = this.rom.slice(at, 1);
        this.addLine({ offset: at, size: 1, command: null, args: [], bytes: Uint8Array.from(bytes) });
        this.problem(at, `知らない命令 0x${hex(bytes[0]!, 2)} です。ここで止めました`);
        return;
      }
      // 次の命令の位置と重なる行は入れない（既に読んだ行の途中にかかる）。
      for (let i = 1; i < line.size; i++) {
        if (this.lines.has(at + i) || this.covered.has(at + i)) {
          this.problem(at, `命令 ${line.command} が、読んだ別の命令と重なります。ここで止めました`);
          return;
        }
      }
      this.addLine(line);
      const opcode = line.bytes[0]!;
      for (const a of line.args) this.follow(a, at, queue);
      if (STOP_OPCODES.has(opcode)) return;
      at += line.size;
    }
  }

  private addLine(line: DisasmLine): void {
    this.lines.set(line.offset, line);
    for (let i = 1; i < line.size; i++) this.covered.set(line.offset + i, line.offset);
  }

  /** 引数の指す先を読む（スクリプトなら道に足す）。 */
  private follow(arg: DisasmArg, at: number, queue: number[]): void {
    if (arg.ref === null || arg.value === null) return;
    const target = arg.value - ROM_BASE;
    if (!this.rom.isPointer(arg.value)) {
      // 文字列は RAM（0x02…）を指すこともあるので、スクリプトの分岐先だけを問題にする。
      if (arg.ref === "script") this.problem(at, `${arg.name} のポインタ 0x${hex(arg.value)} が ROM の外です`);
      arg.ref = null;
      return;
    }
    switch (arg.ref) {
      case "script":
        if (!this.scriptTargets.has(target)) {
          this.scriptTargets.add(target);
          queue.push(target);
        }
        return;
      case "string":
        if (!this.strings.has(target)) this.strings.set(target, this.readString(target));
        return;
      case "movement":
        if (!this.movements.has(target)) this.movements.set(target, this.readMovement(target));
        return;
      case "mart":
        if (!this.marts.has(target)) this.marts.set(target, this.readMart(target));
        return;
    }
  }

  /** `at` の命令を読む。どの型にも合わなければ null。 */
  private decodeLine(at: number): DisasmLine | null {
    const opcode = this.rom.u8(at);
    for (const variant of this.options.commands.find(opcode)) {
      const values = this.match(variant, at);
      if (values) return this.buildLine(variant, at, values);
    }
    return null;
  }

  /** 型に合えば、引数の番号 → 値。合わなければ null。 */
  private match(variant: DisasmVariant, at: number): Map<number, number> | null {
    if (!this.rom.inRange(at, variant.size)) return null;
    const values = new Map<number, number>();
    let pos = at;
    for (const f of variant.fields) {
      const v = readLe(this.rom, pos, f.size);
      pos += f.size;
      if (f.kind === "const") {
        if (v !== f.value >>> 0) return null;
        continue;
      }
      const known = values.get(f.paramIndex);
      if (known !== undefined && known !== v) return null;
      values.set(f.paramIndex, v);
    }
    return values;
  }

  private buildLine(variant: DisasmVariant, at: number, values: Map<number, number>): DisasmLine {
    const opcode = variant.opcode;
    const sizeOf = new Map<number, number>();
    for (const f of variant.fields) if (f.kind === "arg") sizeOf.set(f.paramIndex, f.size);
    // trainerbattle の種類（2 バイト目）と、4 バイトの引数の順番。
    const trainerType = opcode === OP.trainerbattle ? this.rom.u8(at + 1) : null;
    const pointerOrder: number[] = [];
    for (const f of variant.fields) if (f.kind === "arg" && f.size === 4 && !pointerOrder.includes(f.paramIndex)) pointerOrder.push(f.paramIndex);

    // 本文で使わない必須の引数（trainerbattle1 の type など）は、命令番号の次の決まった値（無ければ 0）を書く。
    const firstConst = variant.fields.slice(1).find((f) => f.kind === "const");
    const filler = firstConst?.kind === "const" ? firstConst.value : 0;

    const args: DisasmArg[] = variant.params.map((p, index) => {
      const size = sizeOf.get(index) ?? 0;
      const unusedRequired = !sizeOf.has(index) && p.required && p.defaultValue === null && !variant.blankParams.includes(index);
      const value = values.get(index) ?? (unusedRequired ? filler : null);
      let ref: DisasmRefKind | null = null;
      if (size === 4 && value !== null) {
        if (trainerType !== null) {
          ref = TRAINER_SCRIPT_POINTER.get(trainerType) === pointerOrder.indexOf(index) ? "script" : "string";
        } else if (p.kind === "string") ref = "string";
        else if (p.kind === "movement") ref = "movement";
        else if (p.kind === "label" && BRANCH_OPCODES.has(opcode)) ref = "script";
        else if (p.kind === "label" && MART_OPCODES.has(opcode)) ref = "mart";
      }
      return { name: p.name, kind: p.kind, value, size, ref };
    });
    return {
      offset: at,
      size: variant.size,
      command: variant.name,
      args,
      bytes: Uint8Array.from(this.rom.slice(at, variant.size)),
    };
  }

  private readString(offset: number): DisasmString | null {
    let end = offset;
    while (end < this.rom.size && end - offset <= this.maxStringBytes && this.rom.u8(end) !== this.codec.terminator) end++;
    if (end >= this.rom.size || end - offset > this.maxStringBytes) {
      this.problem(offset, `文字列の終端が ${this.maxStringBytes} バイトの中にありません`);
      return null;
    }
    const bytes = Uint8Array.from(this.rom.slice(offset, end - offset));
    if (bytes.length === 0) this.problem(offset, `空の文字列です（.string では書けません）`);
    return { label: "", offset, bytes, text: this.codec.decode(bytes) };
  }

  private readMovement(offset: number): DisasmMovement | null {
    const steps: number[] = [];
    for (let at = offset; ; at++) {
      if (!this.rom.inRange(at) || steps.length >= this.maxMovementSteps) {
        this.problem(offset, `移動データの終わり（end_m）が ${this.maxMovementSteps} 個の中にありません`);
        return null;
      }
      const v = this.rom.u8(at);
      steps.push(v);
      if (v === END_MOVEMENT) break;
    }
    const names = steps.map((v) => this.options.commands.movementNames.get(v) ?? null);
    return { label: "", offset, steps, names };
  }

  private readMart(offset: number): DisasmMart | null {
    const items: number[] = [];
    for (let at = offset; ; at += 2) {
      if (!this.rom.inRange(at, 2) || items.length >= this.maxMartItems) {
        this.problem(offset, `ショップの一覧の終わり（0）が ${this.maxMartItems} 個の中にありません`);
        return null;
      }
      const v = this.rom.u16(at);
      items.push(v);
      if (v === 0) break;
    }
    return { label: "", offset, items };
  }

  /** 行を位置の順に並べ、続けて並ぶもの（止める命令の後ろで切る）をまとめる。 */
  private buildBlocks(labels: Map<number, string>): DisasmBlock[] {
    const sorted = sortByOffset([...this.lines.values()]);
    const blocks: DisasmBlock[] = [];
    let current: DisasmBlock | null = null;
    for (const line of sorted) {
      const prev = current?.lines[current.lines.length - 1];
      const continues =
        current !== null &&
        prev !== undefined &&
        current.end === line.offset &&
        prev.command !== null &&
        !STOP_OPCODES.has(prev.bytes[0]!);
      if (!continues || current === null) {
        current = { offset: line.offset, end: line.offset, lines: [] };
        blocks.push(current);
        // 先頭にラベルの無いまとまり（読んだ道の続きでないもの）は無いはずだが、念のためラベルを付ける。
        if (!labels.has(line.offset)) labels.set(line.offset, this.labelName(line.offset + ROM_BASE, "script"));
      }
      current.lines.push(line);
      current.end = line.offset + line.size;
    }
    return blocks;
  }
}

function readLe(rom: Rom, at: number, size: number): number {
  if (size === 1) return rom.u8(at);
  if (size === 2) return rom.u16(at);
  return rom.u32(at);
}

function sortByOffset<T extends { offset: number }>(list: T[]): T[] {
  return list.sort((a, b) => a.offset - b.offset);
}

function hex(value: number, digits = 8): string {
  return formatHex(value >>> 0, digits);
}
