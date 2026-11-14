import { DisasmCommandSet, ScriptCommandTable, ScriptTextCodec, movementNamesFromDefines, readTextIfExists } from "@zigzagumap/core";
import type { ProjectSession } from "../../app/ProjectSession";

/**
 * 逆アセンブルに使う命令表と文字コード表（#206 の表示、#207 の取り込み、#220 のイベントの削除）。
 * プロジェクトの xse_commands.s と charmap.tbl から作り（素の ROM だけなら同梱の表）、使うたびに作って捨てる（メインのメモリに残さない）。
 */
export async function disasmTools(session: ProjectSession | null): Promise<{ commands: DisasmCommandSet; text: ScriptTextCodec }> {
  const fs = session?.files;
  if (!session?.projectDir || !fs) return { commands: DisasmCommandSet.bundled(), text: ScriptTextCodec.japanese };
  const read = (path: string): Promise<string | null> => readTextIfExists(fs, path);
  const xse = await read("xse_commands.s");
  const defines = (await Promise.all(["xse_defines.s", "asm_defines.s"].map(read))).filter((x): x is string => x !== null);
  const charmap = await read("charmap.tbl");
  const text = charmap ? ScriptTextCodec.fromCharmap(charmap) : ScriptTextCodec.japanese;
  if (!xse) return { commands: DisasmCommandSet.bundled(), text };
  const table = ScriptCommandTable.build({ xseCommands: xse, defines });
  const xseDefines = await read("xse_defines.s");
  return { commands: DisasmCommandSet.fromCommandTable(table, xseDefines ? movementNamesFromDefines(xseDefines) : new Map()), text };
}
