import type { ScriptDialect, ScriptDialectSetting } from "./ScriptDialect.js";

/**
 * 外部コマンドの 1 手順（ビルドや幅検査）。`cwd` はプロジェクトフォルダからの相対パス（区切りは `/`、
 * `..` で上へも行ける）。`args` は 1 つずつ渡し、シェルは通さない。
 * `command` が `copy`（{@link SCRIPT_COPY_COMMAND}）の手順は、ZigzaguMap がファイルを写す（`args` の 1 つ目を 2 つ目へ。
 * どちらも `cwd` からの相対パス。ND の CFRU の test.gba を DPE の BPRJ0.gba にするのに使う）。
 */
export interface ScriptCommandStep {
  command: string;
  args: string[];
  cwd: string;
}

/**
 * スクリプトの設定（既定値を入れたあとの値）。パスはプロジェクトフォルダからの相対パスで、区切りは `/`。
 */
export interface ScriptConfig {
  /** 設定に書いてある方言（`auto` のまま）。 */
  dialectSetting: ScriptDialectSetting;
  /** 使う方言（`auto` を判定したあと）。 */
  dialect: ScriptDialect;
  /** ビルドの手順。上から順に動かし、失敗したらそこで止める。 */
  build: ScriptCommandStep[];
  /** ビルドで出来る ROM のパス。 */
  outputRom: string;
  /** `.string` の幅検査のコマンド。無ければ null。 */
  widthCheck: ScriptCommandStep | null;
  /** ラベルの規則。`{map}`（マップ名）、`{kind}`（種別）、`{index}`（番号）を置き換える。 */
  labelTemplate: string;
  /** 新しいラベルに `.global` を付けるか。 */
  useGlobal: boolean;
  /** 簡易の幅検査の 1 行の上限（字数）。 */
  lineMaxChars: number;
  /** 簡易の幅検査の 1 ページの行数。 */
  linesPerPage: number;
  /** commands.csv（命令の説明）のパス。無ければ null。 */
  commandsCsv: string | null;
  /** 幅検査の追加の登録ファイル（Chronos の `text_width_registry.json`）。無ければ null（書き足さない）。 */
  widthRegistry: WidthRegistrySetting | null;
}

/**
 * 幅検査の追加の登録ファイルの設定。`.string` を保存したとき、登録のあるファイルの新しい `#org` を書き足す。
 * 登録の一覧は、幅検査のコマンドの引数の最初（スクリプト）に `--list-registry` を付けて動かして得る。
 */
export interface WidthRegistrySetting {
  /** 登録ファイルのパス（プロジェクトフォルダからの相対）。 */
  path: string;
  /** 登録での `.string` のパスの頭（プロジェクトフォルダを幅検査の作業フォルダから見たもの。Chronos は `cfru/`）。 */
  prefix: string;
  /** 足すときの窓の種類（Chronos の WINDOWS の名前）。 */
  window: string;
}

/**
 * `zigzagumap.json` に書いてある分だけの設定。undefined の項目は方言ごとの既定値を使う。
 * null を書ける項目（widthCheck・commandsCsv）は、null なら「使わない」を明示したことになる。
 */
export type ScriptConfigSettings = Partial<Omit<ScriptConfig, "dialectSetting" | "dialect">> & {
  dialect?: ScriptDialectSetting;
};

/** ファイルを写す手順の `command`。 */
export const SCRIPT_COPY_COMMAND = "copy";

/** ラベルの規則の既定値（`<.s の名前>_<種別><番号>`、例 `Moegi_Npc3`）。 */
export const DEFAULT_SCRIPT_LABEL_TEMPLATE = "{map}_{kind}{index}";

/** 簡易の幅検査の既定値（Chronos の窓 208px・全角 10px に合わせる。ND も同じ）。 */
export const DEFAULT_SCRIPT_LINE_MAX_CHARS = 18;
export const DEFAULT_SCRIPT_LINES_PER_PAGE = 2;

/** ND の DPE 側のフォルダ（CFRU のフォルダの隣。AGENTS.md のビルドの手順）。 */
const ND_DPE_DIR = "../NeoDark-DPE-main";

/**
 * 方言ごとの既定値。
 * - ND: CFRU のビルド（プロジェクトフォルダで `python scripts/make.py`）→ `test.gba` を `../NeoDark-DPE-main/BPRJ0.gba` へ写す
 *   → DPE のビルド（`../NeoDark-DPE-main` で `python scripts/make.py`）。出力は `../NeoDark-DPE-main/test.gba`。
 * - Chronos: 1 つ上のフォルダで `python build.py`、出力は `../build/Chronos.gba`。幅検査は `python tools/check_text_width.py --source`。
 */
export function defaultScriptConfig(dialect: ScriptDialect): ScriptConfig {
  const common = {
    dialectSetting: "auto" as const,
    dialect,
    labelTemplate: DEFAULT_SCRIPT_LABEL_TEMPLATE,
    lineMaxChars: DEFAULT_SCRIPT_LINE_MAX_CHARS,
    linesPerPage: DEFAULT_SCRIPT_LINES_PER_PAGE,
    commandsCsv: null,
  };
  if (dialect === "nd") {
    return {
      ...common,
      build: [
        { command: "python", args: ["scripts/make.py"], cwd: "." },
        { command: SCRIPT_COPY_COMMAND, args: ["test.gba", `${ND_DPE_DIR}/BPRJ0.gba`], cwd: "." },
        { command: "python", args: ["scripts/make.py"], cwd: ND_DPE_DIR },
      ],
      outputRom: `${ND_DPE_DIR}/test.gba`,
      widthCheck: null,
      useGlobal: false,
      widthRegistry: null,
    };
  }
  return {
    ...common,
    build: [{ command: "python", args: ["build.py"], cwd: ".." }],
    outputRom: "../build/Chronos.gba",
    widthCheck: { command: "python", args: ["tools/check_text_width.py", "--source"], cwd: ".." },
    useGlobal: true,
    widthRegistry: { path: "strings/text_width_registry.json", prefix: "cfru/", window: "field" },
  };
}

/** 書いてある設定に、方言の既定値を足す。`dialect` は判定済みの方言（`auto` でないもの）。 */
export function resolveScriptConfig(settings: ScriptConfigSettings, dialect: ScriptDialect): ScriptConfig {
  const d = defaultScriptConfig(dialect);
  return {
    dialectSetting: settings.dialect ?? "auto",
    dialect,
    build: settings.build ? settings.build.map(copyStep) : d.build,
    outputRom: settings.outputRom ?? d.outputRom,
    widthCheck: settings.widthCheck !== undefined ? (settings.widthCheck && copyStep(settings.widthCheck)) : d.widthCheck,
    labelTemplate: settings.labelTemplate ?? d.labelTemplate,
    useGlobal: settings.useGlobal ?? d.useGlobal,
    lineMaxChars: settings.lineMaxChars ?? d.lineMaxChars,
    linesPerPage: settings.linesPerPage ?? d.linesPerPage,
    commandsCsv: settings.commandsCsv !== undefined ? settings.commandsCsv : d.commandsCsv,
    widthRegistry: settings.widthRegistry !== undefined ? (settings.widthRegistry && { ...settings.widthRegistry }) : d.widthRegistry,
  };
}

/** ラベルの規則を埋める（例: `EventScript_{map}_{kind}{index}` → `EventScript_03_00_Npc0`）。 */
export function expandScriptLabelTemplate(
  template: string,
  values: { map: string; kind: string; index: number | string },
): string {
  return template
    .replaceAll("{map}", values.map)
    .replaceAll("{kind}", values.kind)
    .replaceAll("{index}", String(values.index));
}

/**
 * 設定のパスをプロジェクトフォルダの絶対パスにつなぐ（`.` と `..` を畳む。区切りは `/` にする）。
 * 設定のパスがすでに絶対パス（`/`、`\`、`C:\` などで始まる）なら、それを畳んで返す。
 */
export function resolveScriptConfigPath(projectDir: string, path: string): string {
  const p = path.replaceAll("\\", "/");
  if (isAbsolutePath(p)) return normalizeSegments(p);
  const base = projectDir.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalizeSegments(`${base}/${p}`);
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:\//.test(p);
}

function normalizeSegments(p: string): string {
  const lead = /^([A-Za-z]:)?\/*/.exec(p)![0];
  const out: string[] = [];
  for (const seg of p.slice(lead.length).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else if (seg === ".." && lead !== "") continue;
    else out.push(seg);
  }
  const body = out.join("/");
  if (lead === "") return body === "" ? "." : body;
  return lead.endsWith("/") ? lead + body : `${lead}/${body}`;
}

function copyStep(step: ScriptCommandStep): ScriptCommandStep {
  return { command: step.command, args: [...step.args], cwd: step.cwd };
}
