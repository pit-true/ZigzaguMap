import { ProjectFormatError } from "../project/ProjectFormatError.js";
import { readTextIfExists, type ProjectFs } from "../project/ProjectFs.js";
import { asRecord, parseJsonObject, type JsonRecord } from "../project/jsonRead.js";
import { SCRIPT_CONFIG_FILE } from "../script/config/ScriptConfigJson.js";

/** 利用者の JavaScript のスクリプトの置き場所（プロジェクトフォルダの直下。Phase5 #405、Q17）。 */
export const USER_SCRIPT_DIR = "zigzagumap-scripts";
/** `zigzagumap.json` の中の節の名前。 */
export const USER_SCRIPT_SECTION = "userScripts";

/** スクリプトの設定（有効にするファイルの名前。置き場所の中の `*.js` の名前）。 */
export interface UserScriptSettings {
  readonly enabled: readonly string[];
}

/** スクリプトのファイルの名前として使えるか（置き場所の直下の `.js`。フォルダの区切りや `..` は使えない）。 */
export function isUserScriptName(name: string): boolean {
  return /^[^\/:*?"<>|]+\.js$/i.test(name) && !name.startsWith(".");
}

/**
 * `zigzagumap.json` の `userScripts` の節を読む（`{ "userScripts": { "enabled": ["grass.js"] } }`）。
 * ファイルや節が無ければ、どれも有効にしない。形式が不正なら ProjectFormatError。
 */
export function parseUserScriptSettings(text: string | null, path: string | null = SCRIPT_CONFIG_FILE): UserScriptSettings {
  if (text === null || text.trim() === "") return { enabled: [] };
  const root = parseJsonObject(text, path);
  const raw = root[USER_SCRIPT_SECTION];
  if (raw === undefined || raw === null) return { enabled: [] };
  const o = asRecord(raw, USER_SCRIPT_SECTION, path);
  const list = o.enabled ?? [];
  if (!Array.isArray(list) || !list.every((n) => typeof n === "string" && isUserScriptName(n))) {
    throw new ProjectFormatError(`${USER_SCRIPT_SECTION}.enabled は ${USER_SCRIPT_DIR} の中の .js の名前の並びでなければなりません`, path);
  }
  return { enabled: [...new Set(list as string[])] };
}

/** 有効にするものを書き換えた `zigzagumap.json` の中身（ほかの節・項目は残す）。 */
export function stringifyUserScriptSettings(settings: UserScriptSettings, previousText: string | null): string {
  const root: JsonRecord = previousText && previousText.trim() !== "" ? parseJsonObject(previousText, SCRIPT_CONFIG_FILE) : {};
  const old = root[USER_SCRIPT_SECTION];
  const section: JsonRecord = typeof old === "object" && old !== null && !Array.isArray(old) ? { ...(old as JsonRecord) } : {};
  section.enabled = [...settings.enabled];
  root[USER_SCRIPT_SECTION] = section;
  return JSON.stringify(root, null, 2) + "\n";
}

/** 置き場所の中のスクリプト（名前の順）と、有効にするもの。 */
export interface UserScriptListing {
  readonly files: readonly string[];
  readonly enabled: readonly string[];
}

/** プロジェクトのスクリプトの一覧と設定を読む。有効の欄にあってファイルが無いものは外す。 */
export async function loadUserScriptListing(fs: ProjectFs): Promise<UserScriptListing> {
  const files = (await fs.list(USER_SCRIPT_DIR)).filter(isUserScriptName).sort((a, b) => a.localeCompare(b));
  const settings = parseUserScriptSettings(await readTextIfExists(fs, SCRIPT_CONFIG_FILE));
  return { files, enabled: settings.enabled.filter((n) => files.includes(n)) };
}

/** 有効にするものを `zigzagumap.json` に書く。 */
export async function saveUserScriptEnabled(fs: ProjectFs, enabled: readonly string[]): Promise<void> {
  const previous = await readTextIfExists(fs, SCRIPT_CONFIG_FILE);
  await fs.writeText(SCRIPT_CONFIG_FILE, stringifyUserScriptSettings({ enabled }, previous));
}
