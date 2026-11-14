import { ProjectFormatError } from "../../project/ProjectFormatError.js";
import type { ProjectFs } from "../../project/ProjectFs.js";
import { asRecord, parseJsonObject, type JsonRecord } from "../../project/jsonRead.js";
import {
  resolveScriptConfig,
  type ScriptCommandStep,
  type ScriptConfig,
  type ScriptConfigSettings,
} from "./ScriptConfig.js";
import {
  SCRIPT_DIALECT_SETTINGS,
  XSE_COMMANDS_PATH,
  detectScriptDialect,
  type ScriptDialect,
  type ScriptDialectSetting,
} from "./ScriptDialect.js";

/** 設定ファイルのパス（プロジェクトフォルダの直下）。 */
export const SCRIPT_CONFIG_FILE = "zigzagumap.json";
/** 設定ファイルの中の、スクリプトの節の名前。 */
export const SCRIPT_CONFIG_SECTION = "script";

/** `xse_commands.s` が無いか判定できないときに使う方言（1 ポインタの素の CFRU と同じ書き方）。 */
export const SCRIPT_DIALECT_FALLBACK: ScriptDialect = "chronos";

/** 読んだ設定ファイル。`root` は知らない項目も含めたファイル全体で、書き戻すときに残す。 */
export interface ScriptConfigDocument {
  root: JsonRecord;
  settings: ScriptConfigSettings;
}

/** 方言をどこから決めたか。`setting` は設定に書いてあった、`detected` は xse_commands.s から判定、`fallback` は判定できなかった。 */
export type ScriptDialectSource = "setting" | "detected" | "fallback";

/** プロジェクトから読んだスクリプトの設定。 */
export interface LoadedScriptConfig {
  /** 既定値を入れたあとの設定。 */
  config: ScriptConfig;
  /** ファイルに書いてあった分だけの設定（保存するときの元にする）。 */
  settings: ScriptConfigSettings;
  dialectSource: ScriptDialectSource;
}

/** 節の中の項目の名前（書き戻すときに、この名前だけを置き換える）。 */
const KNOWN_KEYS = [
  "dialect",
  "build",
  "outputRom",
  "widthCheck",
  "labelTemplate",
  "useGlobal",
  "lineMaxChars",
  "linesPerPage",
  "commandsCsv",
] as const satisfies readonly (keyof ScriptConfigSettings)[];

/**
 * `zigzagumap.json` のスクリプトの節の読み書き。形式はここだけで扱う。
 *
 * 形（項目はどれも省略でき、省略すると方言ごとの既定値になる。パスは `/` 区切りの相対パス）:
 * ```json
 * { "script": { "dialect": "auto", "build": [{ "command": "python", "args": ["build.py"], "cwd": ".." }],
 *   "outputRom": "../build/Chronos.gba",
 *   "widthCheck": { "command": "python", "args": ["tools/check_text_width.py", "--source"], "cwd": ".." },
 *   "labelTemplate": "EventScript_{map}_{kind}{index}", "useGlobal": true,
 *   "lineMaxChars": 18, "linesPerPage": 2, "commandsCsv": null } }
 * ```
 */
export class ScriptConfigJson {
  /** 読む。`text` が null（ファイルが無い）なら空の設定。形式が不正なら ProjectFormatError。 */
  static parse(text: string | null, path: string | null = SCRIPT_CONFIG_FILE): ScriptConfigDocument {
    if (text === null || text.trim() === "") return { root: {}, settings: {} };
    const root = parseJsonObject(text, path);
    const raw = root[SCRIPT_CONFIG_SECTION];
    if (raw === undefined || raw === null) return { root, settings: {} };
    const o = asRecord(raw, SCRIPT_CONFIG_SECTION, path);
    const settings: ScriptConfigSettings = {};
    if (o.dialect !== undefined) settings.dialect = readDialect(o.dialect, path);
    if (o.build !== undefined) settings.build = readSteps(o.build, "build", path);
    if (o.outputRom !== undefined) settings.outputRom = readPath(o.outputRom, "outputRom", path);
    if (o.widthCheck !== undefined) {
      settings.widthCheck = o.widthCheck === null ? null : readStep(o.widthCheck, "widthCheck", path);
    }
    if (o.labelTemplate !== undefined) settings.labelTemplate = readText(o.labelTemplate, "labelTemplate", path);
    if (o.useGlobal !== undefined) {
      if (typeof o.useGlobal !== "boolean") throw new ProjectFormatError("useGlobal は true か false でなければなりません", path);
      settings.useGlobal = o.useGlobal;
    }
    if (o.lineMaxChars !== undefined) settings.lineMaxChars = readPositiveInt(o.lineMaxChars, "lineMaxChars", path);
    if (o.linesPerPage !== undefined) settings.linesPerPage = readPositiveInt(o.linesPerPage, "linesPerPage", path);
    if (o.commandsCsv !== undefined) {
      settings.commandsCsv = o.commandsCsv === null ? null : readPath(o.commandsCsv, "commandsCsv", path);
    }
    return { root, settings };
  }

  /**
   * 書く。`previous` は読んだときのファイル（無ければ null）。知らない項目（ファイルの最上位と節の中）は残し、
   * 知っている項目は `settings` で置き換える（undefined の項目は消して既定値に戻す）。字下げ 2、LF で終わる。
   */
  static stringify(settings: ScriptConfigSettings, previous: ScriptConfigDocument | null = null): string {
    const root: JsonRecord = { ...(previous?.root ?? {}) };
    const old = root[SCRIPT_CONFIG_SECTION];
    const section: JsonRecord =
      typeof old === "object" && old !== null && !Array.isArray(old) ? { ...(old as JsonRecord) } : {};
    for (const key of KNOWN_KEYS) {
      const value = settings[key];
      if (value === undefined) delete section[key];
      else section[key] = toJsonValue(value);
    }
    root[SCRIPT_CONFIG_SECTION] = section;
    return JSON.stringify(root, null, 2) + "\n";
  }
}

/**
 * プロジェクトのスクリプトの設定を読む。`zigzagumap.json` が無ければ既定値。
 * 方言が `auto`（か未設定）なら `xse_commands.s` から判定し、判定できなければ SCRIPT_DIALECT_FALLBACK。
 */
export async function loadScriptConfig(fs: ProjectFs): Promise<LoadedScriptConfig> {
  const text = (await fs.exists(SCRIPT_CONFIG_FILE)) ? await fs.readText(SCRIPT_CONFIG_FILE) : null;
  const { settings } = ScriptConfigJson.parse(text);
  let dialect: ScriptDialect;
  let dialectSource: ScriptDialectSource;
  if (settings.dialect !== undefined && settings.dialect !== "auto") {
    dialect = settings.dialect;
    dialectSource = "setting";
  } else {
    const detected = (await fs.exists(XSE_COMMANDS_PATH)) ? detectScriptDialect(await fs.readText(XSE_COMMANDS_PATH)) : null;
    dialect = detected ?? SCRIPT_DIALECT_FALLBACK;
    dialectSource = detected ? "detected" : "fallback";
  }
  return { config: resolveScriptConfig(settings, dialect), settings, dialectSource };
}

/** スクリプトの設定を `zigzagumap.json` に書く。今のファイルの知らない項目は残す。 */
export async function saveScriptConfig(fs: ProjectFs, settings: ScriptConfigSettings): Promise<void> {
  const text = (await fs.exists(SCRIPT_CONFIG_FILE)) ? await fs.readText(SCRIPT_CONFIG_FILE) : null;
  await fs.writeText(SCRIPT_CONFIG_FILE, ScriptConfigJson.stringify(settings, ScriptConfigJson.parse(text)));
}

function toJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((s) => stepToJson(s as ScriptCommandStep));
  if (typeof value === "object" && value !== null) return stepToJson(value as ScriptCommandStep);
  return value;
}

function stepToJson(step: ScriptCommandStep): JsonRecord {
  return { command: step.command, args: [...step.args], cwd: step.cwd };
}

function readDialect(value: unknown, path: string | null): ScriptDialectSetting {
  if (typeof value === "string" && (SCRIPT_DIALECT_SETTINGS as readonly string[]).includes(value)) {
    return value as ScriptDialectSetting;
  }
  throw new ProjectFormatError(`dialect は ${SCRIPT_DIALECT_SETTINGS.join(" / ")} のどれかでなければなりません`, path);
}

function readSteps(value: unknown, key: string, path: string | null): ScriptCommandStep[] {
  if (!Array.isArray(value)) throw new ProjectFormatError(`${key} は配列でなければなりません`, path);
  return value.map((v, i) => readStep(v, `${key}[${i}]`, path));
}

function readStep(value: unknown, key: string, path: string | null): ScriptCommandStep {
  const o = asRecord(value, key, path);
  const command = readText(o.command, `${key}.command`, path);
  if (command === "") throw new ProjectFormatError(`${key}.command が空です`, path);
  let args: string[] = [];
  if (o.args !== undefined && o.args !== null) {
    if (!Array.isArray(o.args) || o.args.some((a) => typeof a !== "string")) {
      throw new ProjectFormatError(`${key}.args は文字列の配列でなければなりません`, path);
    }
    args = [...(o.args as string[])];
  }
  const cwd = o.cwd === undefined || o.cwd === null ? "." : readPath(o.cwd, `${key}.cwd`, path);
  return { command, args, cwd };
}

function readText(value: unknown, key: string, path: string | null): string {
  if (typeof value !== "string") throw new ProjectFormatError(`${key} は文字列でなければなりません`, path);
  return value;
}

/** パスを読む。手で `\` 区切りに書いてあっても `/` にそろえる。 */
function readPath(value: unknown, key: string, path: string | null): string {
  const text = readText(value, key, path).replaceAll("\\", "/");
  if (text === "") throw new ProjectFormatError(`${key} が空です`, path);
  return text;
}

function readPositiveInt(value: unknown, key: string, path: string | null): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ProjectFormatError(`${key} は 1 以上の整数でなければなりません`, path);
  }
  return value;
}
