import { listProjectFiles, listScriptSourcePaths, parseStringFile, ScriptCommandTable, ScriptIndex, type PlaybackProject } from "@zigzagumap/core";
import type { App } from "../../app/App";
import { jaPlayback as t } from "../../i18n/ja.playback";

/** 再生を開いたときだけ読む。編集途中の本文も使い、ディスクには書かない。 */
export class PlaybackProjectData {
  private constructor(readonly project: PlaybackProject, readonly messages: ReadonlyMap<string, string>) {}

  static async load(app: App): Promise<PlaybackProjectData> {
    const session = app.state.session, map = app.state.map;
    if (!session?.projectDir) throw new Error(t.projectRequired);
    const paths = await listScriptSourcePaths(session.files);
    const texts = new Map<string, string>(), index = new ScriptIndex();
    // ScriptFilesはエディタの未保存の本文を優先する。ファイルを多数同時に読まない。
    for (const path of paths) {
      const loaded = await app.scripts.files.read(path);
      if (loaded) { texts.set(path, loaded.text); index.updateFile(path, loaded.text); }
    }
    const xse = texts.get("xse_commands.s");
    if (!xse) throw new Error(t.noCommands);
    const defines = ["xse_defines.s", "asm_defines.s"].flatMap(path => texts.has(path) ? [texts.get(path)!] : []);
    const commands = ScriptCommandTable.build({ xseCommands: xse, defines });
    const messages = new Map<string, string>();
    for (const path of await listProjectFiles(session.files, "strings", /\.string$/i)) {
      const loaded = await app.scripts.files.read(path);
      if (loaded) for (const entry of parseStringFile(loaded.text).entries) if (!messages.has(entry.label)) messages.set(entry.label, entry.text);
    }
    if (session !== app.state.session || map !== app.state.map) throw new Error(t.stale);
    return new PlaybackProjectData({ index, commands, text: path => texts.get(path) ?? null }, messages);
  }
}
