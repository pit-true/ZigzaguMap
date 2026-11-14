import type { EditorState, Line, Text } from "@codemirror/state";
import { parseAsmLine, type AnalyzedLine, type ScriptAssist } from "@zigzagumap/core";
import { BlockCommentTracker } from "./highlight";

/** 本文ごとの `/* *\/` の状態（本文は変わると別のものになるので、古いものは自然に消える）。 */
const trackers = new WeakMap<Text, BlockCommentTracker>();

/** 位置の行を解析する（ホバー・補完・定義へ移動で使う）。 */
export function analyzeAt(state: EditorState, pos: number, assist: ScriptAssist): { line: Line; column: number; analyzed: AnalyzedLine } {
  const doc = state.doc;
  const line = doc.lineAt(pos);
  let tracker = trackers.get(doc);
  if (!tracker) trackers.set(doc, (tracker = new BlockCommentTracker()));
  const analyzed = assist.analyzeParsed(parseAsmLine(line.text, tracker.before(doc, line.number)));
  return { line, column: pos - line.from, analyzed };
}
