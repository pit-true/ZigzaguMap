/** スクリプトの方言。`nd` は 0F（loadpointer）が 2 ポインタ（ひらがなと漢字）、`chronos` は 1 ポインタ。 */
export type ScriptDialect = "nd" | "chronos";

/** 設定に書く方言。`auto` は `xse_commands.s` から判定する。 */
export type ScriptDialectSetting = ScriptDialect | "auto";

/** 方言の一覧（設定の値の検査用）。 */
export const SCRIPT_DIALECT_SETTINGS: readonly ScriptDialectSetting[] = ["auto", "nd", "chronos"];

/** 方言の判定に読むファイル（プロジェクトフォルダからの相対パス）。 */
export const XSE_COMMANDS_PATH = "xse_commands.s";

/**
 * `xse_commands.s` の `loadpointer` マクロの引数から方言を判定する。
 * 引数が 3 つ以上（ND は `destination:req, value:req, value_kanji`）なら `nd`、2 つ以下なら `chronos`。
 * `loadpointer` のマクロが無ければ null。
 */
export function detectScriptDialect(xseCommandsText: string): ScriptDialect | null {
  const params = findMacroParams(xseCommandsText, "loadpointer");
  if (params === null) return null;
  return params.length >= 3 ? "nd" : "chronos";
}

/**
 * `.macro 名前 引数...` の行を探し、引数の名前（`:req` や `=既定値` を除く）を返す。無ければ null。
 * 引数の区切りは GNU as と同じくカンマか空白。`@` から行末はコメント。マクロ名は大文字と小文字を区別しない。
 */
function findMacroParams(text: string, name: string): string[] | null {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    const m = /^\.macro\s+([A-Za-z_.$][\w.$]*)(.*)$/i.exec(line);
    if (!m || m[1]!.toLowerCase() !== name.toLowerCase()) continue;
    return m[2]!
      .split(/[\s,]+/)
      .filter((p) => p !== "")
      .map((p) => p.replace(/[:=].*$/, ""));
  }
  return null;
}

function stripComment(line: string): string {
  const at = line.indexOf("@");
  return at < 0 ? line : line.slice(0, at);
}
