import {
  AddScriptsTableEntryCommand,
  RemoveScriptsTableEntryCommand,
  SetScriptsTableEntryCommand,
  mapScriptLinkEntry,
  mapScriptLinkPath,
  mapScriptLinkState,
  type MapId,
  type MapScriptLinkState,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import type { FileDialogs } from "../../app/FileDialogs";
import { jaMapScriptFile as t } from "../../i18n/ja.mapScriptFile";

/**
 * マップと `.s` の紐づけ（#555）。場所の設定タブの「このマップの .s」と、自動操作の `scripts.mapLink` が使う。
 * 紐づけは maps\scripts.json のマップを指定した行で持ち、対応表のコマンドで変える（元に戻せる。出力で書く）。
 */

/** マップの今の紐づけ（プロジェクトフォルダが無ければ null）。 */
export function mapScriptLink(state: EditorState, id: MapId): MapScriptLinkState | null {
  const session = state.session;
  if (!session?.projectDir || session.scriptsTable.loadError) return null;
  return mapScriptLinkState(session.scriptsTable.document, id.bank, id.map);
}

/**
 * マップに `.s` を紐づける。`chosen` はファイルを選ぶ画面で選んだパス（絶対パスか、プロジェクトフォルダからの相対）。
 * 紐づけられなければ理由の Error。紐づけた `.s` の相対パスを返す。
 */
export async function linkMapScript(state: EditorState, id: MapId, chosen: string): Promise<string> {
  const session = state.session;
  if (!session?.projectDir) throw new Error(t.noProject);
  const found = mapScriptLinkPath(session.projectDir, chosen);
  if ("problem" in found) throw new Error(found.problem === "extension" ? t.extension(chosen) : t.outside(chosen));
  if (!(await session.files.exists(found.path))) throw new Error(t.missing(found.path));
  const doc = session.scriptsTable.document;
  const now = mapScriptLinkState(doc, id.bank, id.map);
  if (now.from === "map" && now.script === found.path) return found.path;
  const name = session.catalog.get(id)?.name ?? `${id.bank}.${id.map}`;
  const entry = mapScriptLinkEntry(doc, id.bank, id.map, found.path, name);
  session.bus.execute(now.row >= 0 ? new SetScriptsTableEntryCommand({ index: now.row, entry }) : new AddScriptsTableEntryCommand({ entry }));
  state.setStatus(t.linked(id.bank, id.map, found.path));
  return found.path;
}

/** マップの紐づけを外す（マップを指定した行が無ければ何もせず false）。 */
export function unlinkMapScript(state: EditorState, id: MapId): boolean {
  const session = state.session;
  if (!session?.projectDir) throw new Error(t.noProject);
  const now = mapScriptLinkState(session.scriptsTable.document, id.bank, id.map);
  if (now.row < 0) return false;
  session.bus.execute(new RemoveScriptsTableEntryCommand({ index: now.row }));
  state.setStatus(t.cleared(id.bank, id.map));
  return true;
}

/** ファイルを選ぶ画面を開いて紐づける（キャンセルなら null）。最初の場所は `assembly`。 */
export async function chooseMapScript(state: EditorState, files: FileDialogs, id: MapId): Promise<string | null> {
  const dir = state.session?.projectDir;
  if (!dir) throw new Error(t.noProject);
  const now = mapScriptLink(state, id);
  const start = now?.script ? `${dir}\\${now.script.slice(0, now.script.lastIndexOf("/")).replace(/\//g, "\\")}` : `${dir}\\assembly`;
  const path = await files.openFile({ title: t.dialogTitle, filters: [{ name: t.filter, extensions: ["s"] }], directory: start });
  if (!path) return null;
  return linkMapScript(state, id, path);
}
