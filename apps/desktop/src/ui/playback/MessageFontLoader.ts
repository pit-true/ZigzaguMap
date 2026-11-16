import { loadScriptConfig, MessageFont, ScriptTextCodec, readTextIfExists, type RomRangeReader } from "@zigzagumap/core";
import type { ProjectSession } from "../../app/ProjectSession";
import { ProcessRunner } from "../../util/processRunner";

/** プロジェクトのベースの ROM（ND は CFRU のフォルダの BPRJ0.gba、Chronos は 1 つ上の base/BPRJ0.gba）。 */
const BASE_ROMS = ["BPRJ0.gba", "../base/BPRJ0.gba"];

const split = (path: string): { cwd: string; name: string } => {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash < 0 ? { cwd: ".", name: path } : { cwd: path.slice(0, slash) || "/", name: path.slice(slash + 1) };
};

/** プロジェクトのフォルダからの相対パス（か絶対パス）の ROM のファイルを、必要な所だけ読む。 */
function fileReader(path: string): RomRangeReader {
  const { cwd, name } = split(path);
  return (offset, length) => ProcessRunner.readRange(name, cwd, offset, length);
}

/**
 * 再生のメッセージのフォントを読む（#497）。漢字対応パッチのある ROM を、ビルドの出力（設定の outputRom）→ 開いた ROM →
 * プロジェクトのベースの ROM の順に探して、かなも漢字もそこから読む（実機にいちばん近いもの）。どれにも無ければ、かなだけを開いた ROM から読む。
 */
export async function loadMessageFont(session: ProjectSession): Promise<MessageFont | null> {
  const rom = session.project.rom.bytes;
  const opened: RomRangeReader = async (offset, length) => rom.subarray(offset, offset + length);
  const candidates: { path: string | null; read: RomRangeReader }[] = [];
  if (session.projectDir) {
    const output = await loadScriptConfig(session.files).then(result => result.config.outputRom, () => null);
    if (output) candidates.push({ path: output, read: fileReader(output) });
  }
  candidates.push({ path: null, read: opened });
  if (session.projectDir) for (const path of BASE_ROMS) candidates.push({ path, read: fileReader(path) });
  for (const candidate of candidates) {
    const font = await MessageFont.read(candidate.read, { kanji: true, source: { kana: candidate.path, kanji: candidate.path } }).catch(() => null);
    if (font?.hasKanji) return font;
  }
  return MessageFont.read(opened, { source: { kana: null } });
}

/** 本文をバイト列にする変換（プロジェクトの charmap.tbl、無ければ同梱のもの）。 */
export async function loadMessageCodec(session: ProjectSession): Promise<ScriptTextCodec> {
  if (!session.projectDir) return ScriptTextCodec.japanese;
  const charmap = await readTextIfExists(session.files, "charmap.tbl").catch(() => null);
  return charmap ? ScriptTextCodec.fromCharmap(charmap) : ScriptTextCodec.japanese;
}
