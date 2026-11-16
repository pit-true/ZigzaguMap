import { ScriptCommandTable } from "../commands/ScriptCommandTable.js";
import type { DisasmCommandSet } from "../disasm/DisasmCommandSet.js";
import type { Disassembly } from "../disasm/DisasmTypes.js";
import { disassembleScripts } from "../disasm/ScriptDisassembler.js";
import { renderDisassembly, type RenderedDisassembly } from "../disasm/renderDisassembly.js";
import type { ScriptTextCodec } from "../disasm/scriptText.js";
import { ScriptIndex } from "../index/ScriptIndex.js";
import { ROM_BASE, type Rom } from "../../rom/Rom.js";
import type { PlaybackProject } from "./PlaybackSimulator.js";

/**
 * 素の ROM のスクリプトの再生（#459）。ROM のスクリプトを逆アセンブルして `.s` と同じ形の本文にし（Phase2 の読み取り専用の
 * 表示と同じ本文）、その本文をいつもの {@link ScriptWalker} でたどる。`.s` に取り込んだ後と同じ命令の並びになり、
 * タイムラインの箱とエディタの強調も、その読み取り専用の表示の行を指す。
 */
export interface RomScriptPlayback {
  /** たどる本文（`path` の 1 ファイルだけ）。 */
  readonly project: PlaybackProject;
  /** 入口のラベル。 */
  readonly entry: string;
  /** 本文のパス（エディタの読み取り専用のタブの鍵と同じにする）。 */
  readonly path: string;
  /** 文字列のラベル → 本文（メッセージの表示）。 */
  readonly messages: ReadonlyMap<string, string>;
}

export interface RomScriptPlaybackOptions {
  readonly rom: Rom;
  /** スクリプトの位置（0x08 から始まるアドレス）。 */
  readonly pointer: number;
  /** 逆アセンブルの命令の一覧（プロジェクトの表か同梱の表）。 */
  readonly commands: DisasmCommandSet;
  readonly codec?: ScriptTextCodec;
  /** たどるときの命令表。プロジェクトの表があればそれ、無ければ同梱の表から作る。 */
  readonly table?: ScriptCommandTable | null;
  readonly path: string;
  /** 本文の形（読み取り専用の表示の見出しなど）。省けば逆アセンブルのスクリプトの部分だけ。 */
  readonly frame?: (rendered: RenderedDisassembly, disassembly: Disassembly) => string;
}

export function romScriptPlayback(options: RomScriptPlaybackOptions): RomScriptPlayback {
  const d = disassembleScripts(options.rom, [{ offset: (options.pointer >>> 0) - ROM_BASE }], { commands: options.commands, ...(options.codec ? { text: options.codec } : {}) });
  const rendered = renderDisassembly(d);
  const text = options.frame ? options.frame(rendered, d) : rendered.script.text;
  const index = new ScriptIndex();
  index.updateFile(options.path, text);
  const table = options.table ?? bundledPlaybackTable(options.commands);
  const path = options.path;
  return {
    project: { index, commands: table, text: (p) => (p === path ? text : null), readOnly: true },
    entry: d.entries[0]?.label ?? "",
    path,
    messages: new Map(d.strings.map((s) => [s.label, s.text])),
  };
}

/** 同梱の命令の一覧から、たどるときの命令表を作る（移動の名前も `.equ` で入れる。プロジェクトの無い素の ROM のとき）。 */
export function bundledPlaybackTable(commands: DisasmCommandSet): ScriptCommandTable {
  const equs = [...commands.movementNames].map(([value, name]) => `.equ ${name}, 0x${value.toString(16)}`).join("\n");
  return ScriptCommandTable.build({ xseCommands: commands.toMacroText(), defines: [equs] });
}
