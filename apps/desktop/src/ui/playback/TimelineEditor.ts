import {
  applyMovementEdit,
  copyLabelName,
  countMovementReferences,
  EditMovementCommand,
  movementAction,
  movementAlternatives,
  movementTextTools,
  movementWithDirection,
  planMovementCopy,
  planMovementRewrite,
  readMovementBlock,
  repeatRun,
  segmentLockReasons,
  type MovementDirection,
  type MovementEdit,
  type MovementLockReason,
  type MovementWritePlan,
  type PlaybackSegment,
  type Timeline,
} from "@zigzagumap/core";
import type { App } from "../../app/App";
import { jaPlayback as t } from "../../i18n/ja.playback";
import { ja } from "../../i18n/ja";
import { showContextMenu } from "../ContextMenu";
import { inputDialog } from "../InputDialog";
import { messageBox } from "../MessageBox";
import { createDialog, dialogButton, dialogButtonRow, handleDialogKeys, pressable } from "../Dialog";
import { errorText } from "../../util/errors";
import type { PlaybackProjectData } from "./PlaybackProject";

/** 再生画面の側（今の計算結果と、読み直して計算し直す口）。 */
export interface TimelineEditorHost {
  readonly app: App;
  data(): PlaybackProjectData | null;
  timeline(): Timeline | null;
  /** 本文を読み直して計算し直す（今のフレームは保つ）。 */
  reload(): Promise<void>;
}

/** 共用の移動データの書き方（A-8）。 */
export type SharedChoice = "rewrite" | "copy";

/** 書き戻した結果。書かなかったときは null。 */
export interface MovementEditResult {
  readonly changed: readonly string[];
  readonly newLabel: string | null;
}

const lf = (s: string): string => s.replace(/\r\n?/g, "\n");

/**
 * タイムラインの箱の編集と、`.s` の移動データへの書き戻し（#458）。
 * 1 回の編集を 1 つのコマンド（`editMovement`）にし、`.s` の前後の本文を結び付けて、メインの Ctrl+Z・Ctrl+Y で戻せるようにする。
 * エディタで開いているファイルはエディタの本文に入れ、未保存の変更があれば保存しない（`ScriptFiles.change` と同じ）。
 */
export class TimelineEditor {
  /** 画面の操作で始めた書き戻し（自動操作が終わりを待つ）。 */
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly host: TimelineEditorHost) {}

  /** 画面の操作で始めた書き戻しが済むまで待つ。 */
  async idle(): Promise<void> {
    let last: Promise<unknown>;
    do { last = this.pending; await last.catch(() => undefined); } while (last !== this.pending);
  }
  private track(p: Promise<unknown>): void {
    this.pending = Promise.all([this.pending.catch(() => undefined), p.catch(error => this.host.app.state.setStatus(errorText(error), undefined, true))]);
  }

  /** 箱ごとの編集できない理由の文（編集できるなら null）。 */
  locks(timeline: Timeline): (string | null)[] {
    const data = this.host.data();
    if (!data) return timeline.segments.map(() => null);
    return segmentLockReasons(data.project, timeline.segments).map(reason => reason === null ? null : lockText(reason));
  }

  /** 箱の右クリックのメニュー。 */
  menu(index: number, x: number, y: number): void {
    const segment = this.host.timeline()?.segments[index];
    if (!segment) return;
    const reason = this.lockOf(index);
    const run = (edit: () => MovementEdit | Promise<MovementEdit | null> | null): void => {
      this.track((async () => {
        const e = await edit();
        if (e) await this.edit(index, e);
      })());
    };
    const directions: MovementDirection[] = ["down", "up", "left", "right"];
    const own = movementAction(segment.movementId).direction;
    const items = reason
      ? [{ id: "playback.locked", label: reason, enabled: false, run: () => undefined }]
      : [
          ...directions.map(direction => ({
            id: `playback.edit.${direction}`, label: t.editDirection(t.direction[direction]),
            enabled: own !== null && own !== direction && movementWithDirection(segment.movementId, direction) !== null,
            run: () => run(() => ({ type: "direction", index: segment.stepIndex, direction })),
          })),
          { id: "playback.edit.replace", label: t.editReplace, enabled: movementAlternatives(segment.movementId).length > 0, run: () => run(() => this.askReplace(segment)) },
          { id: "playback.edit.insertBefore", label: t.insertBefore, run: () => run(() => ({ type: "insert", index: segment.stepIndex, value: segment.movementId })) },
          { id: "playback.edit.insertAfter", label: t.insertAfter, run: () => run(() => ({ type: "insert", index: segment.stepIndex, value: segment.movementId, after: true })) },
          { id: "playback.edit.repeat", label: t.editRepeat, run: () => run(() => this.askRepeat(segment)) },
          { id: "playback.edit.delete", label: t.editDelete, run: () => run(() => ({ type: "delete", index: segment.stepIndex })) },
        ];
    showContextMenu(x, y, items);
  }

  /** 選んだ箱のキー（Delete で消す、Alt＋矢印でその向きに変える）。扱ったら true。 */
  key(index: number, event: KeyboardEvent): boolean {
    const segment = this.host.timeline()?.segments[index];
    if (!segment) return false;
    let edit: MovementEdit | null = null;
    if (event.key === "Delete" && !event.altKey && !event.ctrlKey) edit = { type: "delete", index: segment.stepIndex };
    else if (event.altKey && !event.ctrlKey) {
      const direction = ({ ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" } as const)[event.key as "ArrowDown"];
      if (direction) edit = { type: "direction", index: segment.stepIndex, direction };
    }
    if (!edit) return false;
    const reason = this.lockOf(index);
    if (reason) { this.host.app.state.setStatus(reason, undefined, true); return true; }
    this.track(this.edit(index, edit));
    return true;
  }

  /** 箱をドラッグして、同じ移動データの別の箱の位置へ動かす。 */
  move(from: number, to: number): void {
    const segments = this.host.timeline()?.segments;
    const a = segments?.[from], b = segments?.[to];
    if (!a || !b || a === b || !sameBlock(a, b)) return;
    this.track(this.edit(from, { type: "move", from: a.stepIndex, to: b.stepIndex }));
  }

  /**
   * 1 回の編集を書き戻す。shared は共用の移動データのときの書き方（省略で聞く）。
   * 読んだときから本文が変わっていたら書かずに知らせ、読み直して計算し直す。
   */
  async edit(index: number, edit: MovementEdit, shared?: SharedChoice): Promise<MovementEditResult | null> {
    const app = this.host.app, data = this.host.data(), segment = this.host.timeline()?.segments[index];
    if (!data || !segment) throw new Error(t.noSegment);
    const reason = this.lockOf(index);
    if (reason) throw new Error(reason);
    const path = segment.movementPath!, label = segment.movementLabel;
    const tools = movementTextTools(data.project);
    const loaded = await app.scripts.files.read(path);
    if (!loaded || lf(loaded.text) !== lf(data.project.text(path) ?? "")) return this.stale();
    const block = readMovementBlock(loaded.text, label, tools.resolve);
    if (!block || block.problem) throw new Error(lockText(block?.problem?.kind ?? "notFound"));
    const next = applyMovementEdit(block.steps.map(step => step.value), edit);
    if (!next) throw new Error(t.cannotEdit);
    const files = data.project.index.paths().flatMap(file => { const text = data.project.text(file); return text === null ? [] : [{ path: file, text }]; });
    const uses = countMovementReferences(files, label).length;
    const mode = uses > 1 ? (shared ?? await this.askShared(uses)) : "rewrite";
    if (!mode) return null;
    let plan: MovementWritePlan | null;
    if (mode === "rewrite") plan = planMovementRewrite(path, loaded.text, block, next, tools.nameOf);
    else {
      const commandText = segment.command.path === path ? loaded.text : (await app.scripts.files.read(segment.command.path))?.text ?? null;
      if (commandText === null || lf(commandText) !== lf(data.project.text(segment.command.path) ?? "")) return this.stale();
      const newLabel = copyLabelName(label, name => data.project.index.findLabel(name) !== undefined);
      plan = planMovementCopy({ movementPath: path, block, commandPath: segment.command.path, commandLine: segment.command.line, newLabel, values: next, nameOf: tools.nameOf },
        p => p === path ? loaded.text : p === segment.command.path ? commandText : null);
    }
    if (!plan) throw new Error(t.cannotEdit);
    const changes = plan.changes.filter(change => change.before !== change.after);
    if (changes.length === 0) return { changed: [], newLabel: null };
    const kept = await app.scripts.replaceTexts(changes);
    if (kept.length > 0) {
      // 書けなかった（途中で変わっていた）: 書けたものは戻す
      const written = changes.filter(change => !kept.includes(change.path));
      if (written.length) await app.scripts.replaceTexts(written.map(change => ({ path: change.path, before: change.after, after: change.before })));
      return this.stale();
    }
    const command = new EditMovementCommand({ path, label, edit: edit.type, ...(plan.newLabel ? { newLabel: plan.newLabel } : {}) });
    if (app.scripts.execute(command)) app.scripts.attachReplacements(command, changes);
    await this.host.reload();
    app.state.setStatus(plan.newLabel ? t.editedCopy(plan.newLabel) : t.edited);
    return { changed: changes.map(change => change.path), newLabel: plan.newLabel };
  }

  private lockOf(index: number): string | null {
    const data = this.host.data(), timeline = this.host.timeline();
    if (!data || !timeline) return t.noSegment;
    const segment = timeline.segments[index];
    if (!segment) return t.noSegment;
    const reason = segmentLockReasons(data.project, [segment])[0] ?? null;
    return reason === null ? null : lockText(reason);
  }

  private async stale(): Promise<null> {
    this.host.app.state.setStatus(t.staleMovement, undefined, true);
    await this.host.reload();
    return null;
  }

  private async askShared(uses: number): Promise<SharedChoice | null> {
    const answer = await messageBox(t.sharedTitle, t.sharedText(uses), "question", "yesNoCancel");
    return answer === "yes" ? "rewrite" : answer === "no" ? "copy" : null;
  }

  private async askReplace(segment: PlaybackSegment): Promise<MovementEdit | null> {
    const data = this.host.data();
    const nameOf = data ? movementTextTools(data.project).nameOf : () => null;
    const options = movementAlternatives(segment.movementId).map(value => ({ value, label: `${nameOf(value) ?? `0x${value.toString(16).toUpperCase().padStart(2, "0")}`}: ${t.movementMotion(movementAction(value))}` }));
    const value = await chooseDialog(t.editReplace, t.replacePrompt, options);
    return value === null ? null : { type: "replace", index: segment.stepIndex, value };
  }

  private async askRepeat(segment: PlaybackSegment): Promise<MovementEdit | null> {
    const data = this.host.data(), path = segment.movementPath;
    const text = data && path ? data.project.text(path) : null;
    const block = text && data ? readMovementBlock(text, segment.movementLabel, movementTextTools(data.project).resolve) : null;
    const count = block ? repeatRun(block.steps.map(step => step.value), segment.stepIndex).count : 1;
    const answer = await inputDialog(t.editRepeat, t.repeatPrompt, String(count));
    if (answer === null) return null;
    const n = Number(answer.trim());
    if (!Number.isInteger(n) || n < 1 || n > 255) throw new Error(t.repeatRange);
    return { type: "repeat", index: segment.stepIndex, count: n };
  }
}

/** 同じ applymovement で渡した、同じ移動データの箱か（ドラッグで並べ替えられる相手）。 */
export function sameBlock(a: PlaybackSegment, b: PlaybackSegment): boolean {
  return a.actor === b.actor && a.movementLabel === b.movementLabel && a.movementPath === b.movementPath
    && a.command.path === b.command.path && a.command.line === b.command.line && a.command.part === b.command.part;
}

function lockText(reason: MovementLockReason): string {
  return t.lock[reason];
}

/** 一覧から 1 つ選ぶ小さな窓（OK で値、Cancel・Esc で null）。 */
function chooseDialog(title: string, prompt: string, options: readonly { value: number; label: string }[]): Promise<number | null> {
  return new Promise(resolve => {
    const finish = (value: number | null): void => { frame.remove(); resolve(value); };
    const frame = createDialog({ title, width: 360, className: "input-dialog", onClose: () => finish(null) });
    const text = document.createElement("p"); text.textContent = prompt;
    const select = document.createElement("select"); select.dataset["autoId"] = "playback.replaceChoice"; select.style.width = "100%";
    for (const option of options) select.add(new Option(option.label, String(option.value)));
    const ok = (): void => finish(select.value === "" ? null : Number(select.value));
    frame.body.append(text, select, dialogButtonRow(dialogButton(ja.ok, ok), dialogButton(ja.cancel, () => finish(null))));
    handleDialogKeys(frame, () => finish(null), e => { if (e.key === "Enter") ok(); });
    frame.register({
      title, text: prompt,
      ...pressable([{ label: ja.ok, aliases: ["ok"], run: ok }, { label: ja.cancel, aliases: ["cancel"], run: () => finish(null) }]),
      setInput: v => { select.value = v; },
      input: () => select.value,
    });
    select.focus();
  });
}
