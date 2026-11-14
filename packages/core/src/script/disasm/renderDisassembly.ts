/**
 * 逆アセンブルの結果を文字にする。スクリプト・移動データ・ショップは `.s` の書き方、文字列は `.string` の書き方。
 * 行ごとに ROM の中の位置を返すので、表示（#206）で行と ROM の位置を結べる。
 */

import { ROM_BASE } from "../../rom/Rom.js";
import type { DisasmArg, DisasmLine, Disassembly } from "./ScriptDisassembler.js";

/** 文字にした 1 行。 */
export interface RenderedLine {
  text: string;
  /** その行の元の ROM の中の位置。空行・ラベルの行などは、続く行の位置か null。 */
  offset: number | null;
}

/** 文字にした結果。 */
export interface RenderedText {
  /** 行を改行（LF）でつないだもの。最後に改行を付ける。 */
  text: string;
  lines: RenderedLine[];
}

/** 文字にした `.s` と `.string`。 */
export interface RenderedDisassembly {
  /** スクリプト・移動データ・ショップ（`.s`）。 */
  script: RenderedText;
  /** 文字列（`.string`。`#org @ラベル` と本文）。 */
  strings: RenderedText;
}

/** 文字にするときの設定。 */
export interface RenderDisassemblyOptions {
  /** 命令の字下げ。既定はタブ。 */
  indent?: string;
}

const hexValue = (v: number) => `0x${(v >>> 0).toString(16).toUpperCase()}`;

/** 命令 1 行の本文（字下げなし）。 */
export function formatDisasmLine(line: DisasmLine, labels: ReadonlyMap<number, string>): string {
  if (line.command === null) return `.byte ${[...line.bytes].map(hexValue).join(", ")}`;
  const texts = line.args.map((a) => formatArg(a, labels));
  while (texts.length > 0 && texts[texts.length - 1] === "") texts.pop();
  if (texts.length === 0) return line.command;
  // 途中の引数を省くときは、カンマで区切って空のまま書く（GNU as のマクロの書き方）。
  return texts.includes("") ? `${line.command} ${texts.join(", ")}` : `${line.command} ${texts.join(" ")}`;
}

function formatArg(arg: DisasmArg, labels: ReadonlyMap<number, string>): string {
  if (arg.value === null) return "";
  if (arg.ref !== null) {
    const label = labels.get(arg.value - ROM_BASE);
    if (label !== undefined) return label;
  }
  return hexValue(arg.value);
}

/** 結果を `.s` と `.string` の文字にする。 */
export function renderDisassembly(d: Disassembly, options: RenderDisassemblyOptions = {}): RenderedDisassembly {
  const indent = options.indent ?? "\t";
  const script: RenderedLine[] = [];
  const gap = () => {
    if (script.length > 0) script.push({ text: "", offset: null });
  };

  for (const block of d.blocks) {
    gap();
    for (const line of block.lines) {
      const label = d.labels.get(line.offset);
      if (label !== undefined) script.push({ text: `${label}:`, offset: line.offset });
      script.push({ text: indent + formatDisasmLine(line, d.labels), offset: line.offset });
    }
  }
  for (const m of d.movements) {
    gap();
    script.push({ text: `${m.label}:`, offset: m.offset });
    const values = m.steps.map((v, i) => m.names[i] ?? hexValue(v));
    script.push({ text: `${indent}.byte ${values.join(", ")}`, offset: m.offset });
  }
  for (const m of d.marts) {
    gap();
    script.push({ text: `${indent}.align 1`, offset: m.offset });
    script.push({ text: `${m.label}:`, offset: m.offset });
    script.push({ text: `${indent}.hword ${m.items.map(hexValue).join(", ")}`, offset: m.offset });
  }

  const strings: RenderedLine[] = [];
  for (const s of d.strings) {
    if (strings.length > 0) strings.push({ text: "", offset: null });
    strings.push({ text: `#org @${s.label}`, offset: s.offset });
    strings.push({ text: s.text, offset: s.offset });
  }
  return { script: toText(script), strings: toText(strings) };
}

function toText(lines: RenderedLine[]): RenderedText {
  return { text: lines.length === 0 ? "" : `${lines.map((l) => l.text).join("\n")}\n`, lines };
}
