import type { AnalyzedLine } from "./ScriptAssist.js";

/**
 * 色を分ける種類（拡張の semantic token と同じ分け方に、ラベル定義などの字句の種類を足したもの）。
 * - `command`: 命令表の命令と、同じファイルの `.macro` の命令
 * - `instruction`: ARM / Thumb の命令
 * - `unknownCommand`: どれでもない命令（波線も出る）
 * - `textRef`: 文字列の参照（`.string` のラベル）
 * - `labelRef`: ラベルの参照（移動データのラベルも）
 * - `variable`: イベント変数
 * - `constant`: 定数・数・フラグ
 */
export type AsmSemanticKind = "command" | "instruction" | "unknownCommand" | "textRef" | "labelRef" | "variable" | "constant";

/** 色を付ける区間（桁は行の中の位置。0 始まり、end は含まない）。 */
export interface AsmSemanticToken {
  readonly start: number;
  readonly end: number;
  readonly kind: AsmSemanticKind;
}

/** 解析した 1 行の、色を分ける区間（桁の順）。ディレクティブの名前・コメント・ラベル定義・数・文字列は字句の色に任せる。 */
export function asmSemanticTokens(a: AnalyzedLine): AsmSemanticToken[] {
  const out: AsmSemanticToken[] = [];
  const op = a.line.op;
  if (op && a.opKind && a.opKind !== "directive") {
    const kind: AsmSemanticKind = a.opKind === "command" || a.opKind === "localMacro" ? "command" : a.opKind === "instruction" ? "instruction" : "unknownCommand";
    out.push({ start: op.start, end: op.end, kind });
  }
  for (const arg of a.args) {
    if (arg.kind === null) continue;
    const t = arg.token;
    // 字句で色の付く数・文字列（`"..."`）は、文字列の参照のときだけ上書きする
    if (t.kind === "string") continue;
    let kind: AsmSemanticKind;
    switch (arg.kind) {
      case "string":
        kind = "textRef";
        break;
      case "label":
      case "movement":
        kind = t.kind === "number" ? "constant" : "labelRef";
        break;
      case "variable":
        kind = "variable";
        break;
      default:
        kind = "constant";
    }
    out.push({ start: t.start, end: t.end, kind });
  }
  return out;
}
