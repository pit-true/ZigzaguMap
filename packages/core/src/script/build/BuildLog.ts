/**
 * ビルドのログからエラーの行を拾う（#198）。ND の `python scripts/make.py`・DPE・Chronos の `python build.py` の出力を読む。
 * - GNU as: `ファイル:行: Error: 本文`（Warning も拾う）
 * - `.string`（scripts/string.py）: `Error parsing string on line N at character "X".`（ファイル名は出ないので、前の行に出た `.string` を使う）
 * - insert.py: `Symbol missing: X`
 * - Chronos の幅検査: `TEXT WIDTH ERROR: cfru/strings/x.string:21 ...`
 * - Python の `Traceback`、ほかの `Error:` / `error:` の行
 */

/** 拾ったエラー 1 つ。 */
export interface BuildProblem {
  readonly kind: "asm" | "string" | "symbol" | "width" | "python" | "other";
  readonly severity: "error" | "warning";
  /** 本文（ログの行のまま）。 */
  readonly message: string;
  /** ファイル（プロジェクトフォルダからの相対パス。区切りは `/`）。分からなければ null。 */
  readonly path: string | null;
  /** 行（1 から）。分からなければ null。 */
  readonly line: number | null;
  /** `Symbol missing` のシンボル。 */
  readonly symbol?: string;
  /** ログの中の行の番号（0 から）。 */
  readonly logLine: number;
}

/** パスをプロジェクトフォルダからの相対パスにするための情報。 */
export interface BuildLogContext {
  /** その手順の作業フォルダ（プロジェクトフォルダからの相対パス。`..` も可）。 */
  readonly cwd: string;
  /** プロジェクトフォルダの名前（`..` で上へ出て戻ってきたときに消すため。例 Chronos の `cfru`）。 */
  readonly projectName: string;
}

const AS_LINE = /^(.+?):(\d+): (Error|Warning|error|warning): ?(.*)$/;
/** gcc の形（`ファイル:行:桁: error: 本文`）。 */
const GCC_LINE = /^(.+?):(\d+):\d+: (error|warning|fatal error): ?(.*)$/;
const STRING_ERROR = /Error parsing string on line (\d+)/;
const WIDTH_ERROR = /TEXT WIDTH ERROR:?\s*(\S+?):(\d+)\b/;
const SYMBOL_MISSING = /Symbol missing:\s*(\S+)/;
const STRING_PATH = /([\w./\\-]+\.string)\b/;

/** ログの行から、エラー（と警告）を拾う。 */
export function parseBuildLog(lines: readonly string[], context: BuildLogContext): BuildProblem[] {
  const out: BuildProblem[] = [];
  let lastString: string | null = null;
  lines.forEach((raw, logLine) => {
    const text = raw.replace(/\s+$/, "");
    const width = WIDTH_ERROR.exec(text);
    if (width) {
      out.push({ kind: "width", severity: "error", message: text, path: projectPath(width[1]!, context), line: Number(width[2]), logLine });
      return;
    }
    const gcc = GCC_LINE.exec(text);
    if (gcc && /\.(c|h|s|inc)$/i.test(gcc[1]!.trim())) {
      // 警告は多い（DPE は数百行）ので、エラーだけを拾う
      if (gcc[3] !== "warning") out.push({ kind: "asm", severity: "error", message: text, path: projectPath(gcc[1]!.trim(), context), line: Number(gcc[2]), logLine });
      return;
    }
    const as = AS_LINE.exec(text);
    if (as && !/^\s*(Warning|Error)/.test(text) && /\.(s|string|c|h|inc)$/i.test(as[1]!.trim())) {
      out.push({
        kind: "asm",
        severity: as[3]!.toLowerCase() === "warning" ? "warning" : "error",
        message: text,
        path: projectPath(as[1]!.trim(), context),
        line: Number(as[2]),
        logLine,
      });
      return;
    }
    const str = STRING_ERROR.exec(text);
    if (str) {
      out.push({ kind: "string", severity: "error", message: text, path: lastString, line: Number(str[1]), logLine });
      return;
    }
    const sym = SYMBOL_MISSING.exec(text);
    if (sym) {
      out.push({ kind: "symbol", severity: "error", message: text, path: null, line: null, symbol: sym[1]!, logLine });
      return;
    }
    if (/^Traceback \(most recent call last\)/.test(text)) {
      out.push({ kind: "python", severity: "error", message: text, path: null, line: null, logLine });
      return;
    }
    if (/(^|\s)(Error|error):/.test(text) || /^Error\b/.test(text)) {
      out.push({ kind: "other", severity: "error", message: text, path: null, line: null, logLine });
      return;
    }
    const mention = STRING_PATH.exec(text);
    if (mention) lastString = projectPath(mention[1]!, context);
  });
  return out;
}

/** ログのパス（作業フォルダからの相対パスか絶対パス）を、プロジェクトフォルダからの相対パスにする。 */
export function projectPath(logPath: string, context: BuildLogContext): string {
  const p = logPath.replace(/\\/g, "/");
  if (/^([A-Za-z]:)?\//.test(p)) {
    // 絶対パス: プロジェクトフォルダの名前のところから後ろを使う
    const parts = p.split("/");
    const at = parts.lastIndexOf(context.projectName);
    return at >= 0 ? parts.slice(at + 1).join("/") : p;
  }
  const out: string[] = [];
  for (const seg of [...context.cwd.replace(/\\/g, "/").split("/"), ...p.split("/")]) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(seg);
  }
  // `..` で上へ出てプロジェクトフォルダへ戻ってきた分を消す（Chronos: `../cfru/strings/x.string` → `strings/x.string`）
  while (out[0] === ".." && out[1] === context.projectName) out.splice(0, 2);
  return out.join("/");
}
