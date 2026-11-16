import { movementNamesFromEqus } from "../disasm/DisasmCommandSet.js";
import { readMovementBlock, type MovementBlock, type MovementBlockProblemKind, type MovementNameResolver, type MovementValueFormatter } from "../movement/MovementBlock.js";
import type { PlaybackProject } from "./PlaybackSimulator.js";
import type { PlaybackSegment } from "./PlaybackState.js";
import { ScriptWalker } from "./ScriptWalker.js";

/**
 * タイムラインの箱から `.s` の移動データへ書き戻すための読み書きの道具（#458）。値の名前はプロジェクトの `.equ`
 * （`xse_defines.s` の `walk_up` など）で読み書きし、名前の無い値は 16 進で書く。
 */
export interface MovementTextTools {
  /** 名前 → 値（`walk_up` → 0x11）。 */
  readonly resolve: MovementNameResolver;
  /** 値 → 名前（無ければ null。書くときは 16 進になる）。 */
  readonly nameOf: MovementValueFormatter;
}

export function movementTextTools(project: PlaybackProject): MovementTextTools {
  const walker = new ScriptWalker({ index: project.index, commands: project.commands, text: project.text });
  const names = movementNamesFromEqus(project.index.movementNames(), (name) => project.index.findEqu(name)?.value);
  return { resolve: (name) => walker.evaluate(name), nameOf: (value) => names.get(value) ?? null };
}

/** 箱を編集できない理由。編集できるなら null。 */
export type MovementLockReason = MovementBlockProblemKind;

/** 箱の移動データを今の本文から読む。ROM のもの（`.s` に無い）は problem が `rom` の空の移動データ。 */
export function segmentMovementBlock(project: PlaybackProject, tools: MovementTextTools, segment: PlaybackSegment): MovementBlock {
  const rom: MovementBlock = { label: segment.movementLabel, labelLine: -1, steps: [], endStep: null, problem: { kind: "rom", line: null, detail: null } };
  if (!segment.movementPath || !segment.step) return rom;
  const text = project.text(segment.movementPath);
  const block = text === null ? null : readMovementBlock(text, segment.movementLabel, tools.resolve);
  return block ?? { label: segment.movementLabel, labelLine: -1, steps: [], endStep: null, problem: { kind: "notFound", line: null, detail: null } };
}

/**
 * 箱ごとの編集できない理由（同じ移動データは 1 度だけ読む）。返す配列は `segments` と同じ並び。
 * 移動データの何番目かが本文と合わない（計算の後に本文が変わった）ときも `notFound` にする。
 */
export function segmentLockReasons(project: PlaybackProject, segments: readonly PlaybackSegment[], tools: MovementTextTools = movementTextTools(project)): (MovementLockReason | null)[] {
  const cache = new Map<string, MovementBlock>();
  return segments.map((segment) => {
    const key = `${segment.movementPath ?? ""}\n${segment.movementLabel}`;
    let block = cache.get(key);
    if (!block) cache.set(key, (block = segmentMovementBlock(project, tools, segment)));
    if (block.problem) return block.problem.kind;
    const step = block.steps[segment.stepIndex];
    return step && segment.step && step.line === segment.step.line && step.start === segment.step.start ? null : "notFound";
  });
}
