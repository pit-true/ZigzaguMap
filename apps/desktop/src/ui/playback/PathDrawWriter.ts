import {
  copyLabelName,
  countMovementReferences,
  EditMovementCommand,
  movementTextTools,
  newMovementLabel,
  planMovementAppend,
  planMovementCopy,
  planMovementRewrite,
  readMovementBlock,
  scriptLabelMapName,
  type MovementWritePlan,
} from "@zigzagumap/core";
import type { App } from "../../app/App";
import { jaPathDraw as t } from "../../i18n/ja.pathDraw";
import { jaPlayback } from "../../i18n/ja.playback";
import { messageBox } from "../MessageBox";
import { PlaybackProjectData } from "./PlaybackProject";
import { ScriptLocator } from "../script/ScriptLocator";
import type { ScriptTarget } from "../script/ScriptEntry";

/** 置き換える先（開いたもとの `applymovement`）。 */
export interface PathDrawTarget {
  /** `applymovement` の行のファイルと行（0 始まり）。 */
  readonly commandPath: string;
  readonly commandLine: number;
  /** 移動データのラベル。 */
  readonly label: string;
}

/** 書き方。replace は置き換える先の移動データを書き換え、new は新しいラベルでマップの `.s` に足す。 */
export type PathDrawMode = "replace" | "new";

/** 書いた結果。 */
export interface PathDrawResult {
  readonly changed: readonly string[];
  /** 書いた移動データのラベル（写したときは写した先）。 */
  readonly label: string;
  readonly newLabel: string | null;
}

const lf = (s: string): string => s.replace(/\r\n?/g, "\n");

/** 新しいラベルの名前の案（`Move_<マップ名>_<番号>`）。マップの `.s` が無ければバンクとマップの番号。 */
export async function suggestPathLabel(app: App, actor: number | null = null): Promise<string> {
  const session = app.state.session, map = app.state.map;
  if (!session || !map) return "Move_1";
  const script = session.projectDir ? await mapScriptPath(app, actor).catch(() => null) : null;
  const data = session.projectDir ? await PlaybackProjectData.load(app).catch(() => null) : null;
  return newMovementLabel(scriptLabelMapName(script, map.id.bank, map.id.map), name => data?.project.index.findLabel(name) !== undefined);
}

/**
 * 新しいラベルを足す `.s`。maps\scripts.json のこのマップの行が無ければ（ND・Chronos はふつう無い）、このマップのイベントの
 * ラベルがある `.s`（マップスクリプト、動かす人物、ほかの人物・看板・踏むスクリプトの順）。どれも無ければ null。
 */
export async function mapScriptPath(app: App, actor: number | null): Promise<string | null> {
  const session = app.state.session, map = app.state.map;
  if (!session || !map) return null;
  const listed = (await app.scripts.files.mapScriptOf(map.id.bank, map.id.map))?.script;
  if (listed) return listed;
  const events = map.doc.events;
  const persons = events?.persons ?? [];
  const own = persons.findIndex(p => p.localId === actor);
  const targets: ScriptTarget[] = [
    { map: map.id, kind: "map" },
    ...(own >= 0 ? [{ map: map.id, kind: "person" as const, index: own }] : []),
    ...persons.map((_, index) => ({ map: map.id, kind: "person" as const, index })),
    ...(events?.signs ?? []).map((_, index) => ({ map: map.id, kind: "sign" as const, index })),
    ...(events?.traps ?? []).map((_, index) => ({ map: map.id, kind: "trap" as const, index })),
  ];
  const locator = new ScriptLocator(app, session.files);
  for (const target of targets) {
    const found = await locator.resolve(target).catch(() => null);
    if (found?.label && /\.s$/i.test(found.path)) return found.path;
  }
  return null;
}

/**
 * なぞった道を `.s` に書く（#518）。タイムラインの編集（#458）と同じく `ScriptLink.replaceTexts` で書き、`EditMovementCommand` に
 * 前後の本文を結び付けてメインの Ctrl+Z で戻せるようにする。エディタで開いているファイルはエディタの本文に入れ、
 * 未保存の変更があれば保存しない。共用の移動データは使っている数を出して、そのまま書き換えるか写すかを聞く。
 */
export async function writePath(
  app: App,
  values: readonly number[],
  request: { readonly mode: PathDrawMode; readonly target: PathDrawTarget | null; readonly label?: string; readonly shared?: "rewrite" | "copy"; readonly actor?: number },
): Promise<PathDrawResult | null> {
  const session = app.state.session, map = app.state.map;
  if (!session || !map) throw new Error(t.noMap);
  if (!session.projectDir) throw new Error(jaPlayback.projectRequired);
  if (values.length === 0) throw new Error(t.noCommands);
  const data = await PlaybackProjectData.load(app);
  const tools = movementTextTools(data.project);
  let plan: MovementWritePlan | null;
  let label: string;
  if (request.mode === "replace") {
    const target = request.target;
    if (!target) throw new Error(t.noTarget);
    label = target.label;
    const def = data.project.index.findLabel(label);
    if (!def) throw new Error(jaPlayback.lock.notFound);
    const path = def.path;
    const loaded = await app.scripts.files.read(path);
    if (!loaded) throw new Error(jaPlayback.lock.notFound);
    const block = readMovementBlock(loaded.text, label, tools.resolve);
    if (!block || block.problem) throw new Error(jaPlayback.lock[block?.problem?.kind ?? "notFound"]);
    const files = data.project.index.paths().flatMap(file => { const text = data.project.text(file); return text === null ? [] : [{ path: file, text }]; });
    const uses = countMovementReferences(files, label).length;
    const mode = uses > 1 ? (request.shared ?? await askShared(uses)) : "rewrite";
    if (!mode) return null;
    if (mode === "rewrite") plan = planMovementRewrite(path, loaded.text, block, values, tools.nameOf);
    else {
      const commandText = target.commandPath === path ? loaded.text : (await app.scripts.files.read(target.commandPath))?.text ?? null;
      if (commandText === null) throw new Error(jaPlayback.lock.notFound);
      const newLabel = copyLabelName(label, name => data.project.index.findLabel(name) !== undefined);
      plan = planMovementCopy({ movementPath: path, block, commandPath: target.commandPath, commandLine: target.commandLine, newLabel, values, nameOf: tools.nameOf },
        p => p === path ? loaded.text : p === target.commandPath ? commandText : null);
    }
  } else {
    label = (request.label ?? "").trim();
    if (!/^[A-Za-z_.$][\w.$]*$/.test(label)) throw new Error(t.badLabel(label));
    if (data.project.index.findLabel(label)) throw new Error(t.labelTaken(label));
    const path = await mapScriptPath(app, request.actor ?? null);
    if (!path) throw new Error(t.noMapScript(map.id.bank, map.id.map));
    const loaded = await app.scripts.files.read(path);
    if (!loaded) throw new Error(t.noMapScript(map.id.bank, map.id.map));
    if (lf(loaded.text) !== lf(data.project.text(path) ?? loaded.text)) throw new Error(jaPlayback.staleMovement);
    const config = (await app.scripts.scriptConfig())?.config;
    plan = planMovementAppend({ path, text: loaded.text, label, values, nameOf: tools.nameOf, useGlobal: config?.useGlobal ?? false });
  }
  if (!plan) throw new Error(jaPlayback.cannotEdit);
  const changes = plan.changes.filter(change => change.before !== change.after);
  if (changes.length === 0) return { changed: [], label: plan.newLabel ?? label, newLabel: plan.newLabel };
  const kept = await app.scripts.replaceTexts(changes);
  if (kept.length > 0) {
    // 書けなかった（途中で変わっていた）: 書けたものは戻す
    const written = changes.filter(change => !kept.includes(change.path));
    if (written.length) await app.scripts.replaceTexts(written.map(change => ({ path: change.path, before: change.after, after: change.before })));
    throw new Error(jaPlayback.staleMovement);
  }
  const written = plan.newLabel ?? label;
  const command = new EditMovementCommand({ path: changes[0]!.path, label, edit: "path", ...(plan.newLabel ? { newLabel: plan.newLabel } : {}) });
  if (app.scripts.execute(command)) app.scripts.attachReplacements(command, changes);
  if (request.mode === "new") {
    await navigator.clipboard?.writeText(written).catch(() => undefined);
    app.state.setStatus(t.wroteNew(written));
  } else app.state.setStatus(plan.newLabel ? jaPlayback.editedCopy(plan.newLabel) : t.wroteReplace(written));
  return { changed: changes.map(change => change.path), label: written, newLabel: plan.newLabel };
}

async function askShared(uses: number): Promise<"rewrite" | "copy" | null> {
  const answer = await messageBox(jaPlayback.sharedTitle, jaPlayback.sharedText(uses), "question", "yesNoCancel");
  return answer === "yes" ? "rewrite" : answer === "no" ? "copy" : null;
}
