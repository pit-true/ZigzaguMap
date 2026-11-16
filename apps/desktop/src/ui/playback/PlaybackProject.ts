import { listProjectFiles, listScriptSourcePaths, parseStringFile, romScriptPlayback, ScriptCommandTable, ScriptIndex, type PlaybackProject } from "@zigzagumap/core";
import type { App } from "../../app/App";
import { jaPlayback as t } from "../../i18n/ja.playback";
import { disasmTools } from "../script/disasmTools";
import { romTabKey, romTabText } from "../script/RomScripts";

/** 再生を開いたときだけ読む。編集途中の本文も使い、ディスクには書かない。 */
export class PlaybackProjectData {
  private constructor(readonly project: PlaybackProject, readonly messages: ReadonlyMap<string, string>, readonly romEntry: string | null = null) {}

  /**
   * 素の ROM のスクリプト（#459）。エディタの読み取り専用のタブと同じ本文を作り、そのタブの鍵をパスにする
   * （エディタで開いていれば、その行を強調する）。プロジェクトがあれば、その命令表と文字の表を使う。
   */
  static async fromRom(app: App, pointer: number): Promise<PlaybackProjectData> {
    const session = app.state.session;
    if (!session) throw new Error(t.noMap);
    const tools = await disasmTools(session);
    const rom = romScriptPlayback({ rom: session.project.rom, pointer, commands: tools.commands, codec: tools.text, table: tools.table ?? null, path: romTabKey(pointer), frame: (r, d) => romTabText(pointer, d, r) });
    if (!rom.entry) throw new Error(t.noEntry);
    return new PlaybackProjectData(rom.project, rom.messages, rom.entry);
  }

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
