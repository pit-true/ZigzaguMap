import type { CommandArgumentKind } from "../commands/argumentKinds.js";
import type { DisasmCommandSet } from "./DisasmCommandSet.js";
import type { ScriptTextCodec } from "./scriptText.js";

// 逆アセンブル（ScriptDisassembler）の結果と設定の型。

/** 引数の指す先の種類。 */
export type DisasmRefKind = "script" | "string" | "movement" | "mart";

/** 命令の引数 1 つ（読んだ値）。 */
export interface DisasmArg {
  /** マクロの引数の名前。 */
  name: string;
  kind: CommandArgumentKind;
  /** 値。省いた引数は null。 */
  value: number | null;
  /** 本文で書いた大きさ（バイト）。本文で使わない引数は 0。 */
  size: number;
  /** 指す先（ラベルを付けたもの）。数のまま書くなら null。 */
  ref: DisasmRefKind | null;
}

/** 1 行（命令か `.byte`）。 */
export interface DisasmLine {
  /** ROM の中の位置（ファイルの先頭から）。 */
  offset: number;
  size: number;
  /** 命令の名前。知らない命令（`.byte`）なら null。 */
  command: string | null;
  args: DisasmArg[];
  /** 元のバイト列。 */
  bytes: Uint8Array;
}

/** 続けて並んだ行のまとまり。先頭には必ずラベルがある。 */
export interface DisasmBlock {
  offset: number;
  /** 最後の行の次の位置。 */
  end: number;
  lines: DisasmLine[];
}

/** 文字列。 */
export interface DisasmString {
  label: string;
  offset: number;
  /** 本文のバイト列（終端を含まない）。 */
  bytes: Uint8Array;
  /** `.string` の本文。 */
  text: string;
}

/** 移動データ。 */
export interface DisasmMovement {
  label: string;
  offset: number;
  /** 値（最後の end_m 0xFE を含む）。 */
  steps: number[];
  /** 値ごとの名前（`xse_defines.s`）。名前が無ければ null。 */
  names: (string | null)[];
}

/** ショップの一覧。 */
export interface DisasmMart {
  label: string;
  offset: number;
  /** 道具の番号（最後の 0 を含む）。 */
  items: number[];
}

/** 読めなかった箇所。 */
export interface DisasmProblem {
  /** ROM の中の位置。分からなければ null。 */
  offset: number | null;
  message: string;
}

/** 逆アセンブルの結果。 */
export interface Disassembly {
  /** 入口（渡した順）。 */
  entries: { offset: number; label: string }[];
  /** スクリプトのまとまり（位置の順）。 */
  blocks: DisasmBlock[];
  strings: DisasmString[];
  movements: DisasmMovement[];
  marts: DisasmMart[];
  problems: DisasmProblem[];
  /** 位置 → ラベル（スクリプト・文字列・移動データ・ショップのすべて）。 */
  labels: ReadonlyMap<number, string>;
}

/** 入口 1 つ。数だけなら ROM の中の位置（ファイルの先頭から）。 */
export type DisasmEntry = number | { offset: number; label?: string };

/** 逆アセンブルの設定。 */
export interface DisassembleOptions {
  /** 命令の一覧（プロジェクトの命令表から作ったものか、同梱の表）。 */
  commands: DisasmCommandSet;
  /** 文字列の変換（プロジェクトの charmap.tbl から作る）。省けば同梱の charmap（{@link ScriptTextCodec.japanese}）。 */
  text?: ScriptTextCodec;
  /** 仮のラベルの名前。省けば `ROM_08XXXXXX`（ポインタの値を 8 桁の大文字の 16 進）。 */
  labelName?: (pointer: number, kind: DisasmRefKind) => string;
  /** 読む命令の数の上限（全体で）。既定 20000。 */
  maxCommands?: number;
  /** 文字列のバイト数の上限（終端を含まない）。既定 1024。 */
  maxStringBytes?: number;
  /** 移動データの数の上限（end_m を含む）。既定 256。 */
  maxMovementSteps?: number;
  /** ショップの道具の数の上限（最後の 0 を含む）。既定 256。 */
  maxMartItems?: number;
}
