import { parseStringFile } from "../strings/StringFile.js";

/**
 * Chronos の幅検査（`tools/check_text_width.py`）の、追加の登録ファイル（既定は `cfru/strings/text_width_registry.json`）の書き足し。
 *
 * Chronos は、検査するファイル（登録のあるファイル）のすべての `#org` に、窓の種類などの登録が要る。登録の無い `#org` があると
 * 検査が失敗してビルドも止まる。ZigzaguMap は `.string` を保存したとき、登録のあるファイルの新しい `#org` をこのファイルに書き足し、
 * 消えた `#org` の分を消す（自分が書いた JSON の分だけ。Python の REGISTRY には触らない）。
 *
 * 形: `{ "format": 1, "files": { "cfru/strings/x.string": { "gText_A": { "window": "field" }, "gText_B": { "unresolved": "理由" } } } }`
 */

/** `--list-registry` の出力（登録のあるファイルと、その `#org` の名前）。 */
export interface WidthRegistryListing {
  /** 追加の登録ファイルのパス（コマンドの作業フォルダからの相対）。 */
  readonly extra: string;
  /** 追加の登録ファイルの誤り。 */
  readonly errors: readonly string[];
  /** パス → 登録した名前（Python の REGISTRY と JSON を合わせたもの）。 */
  readonly files: Readonly<Record<string, readonly string[]>>;
}

/** 書き足しの計画。 */
export interface WidthRegistryPlan {
  /** 書く JSON の文字列。変えないなら null。 */
  readonly text: string | null;
  /** 足した名前（窓の種類を入れたもの）。 */
  readonly added: readonly string[];
  /** 足した名前のうち `unresolved`（`[BUFFER1]` などの値の種類が分からないもの）。 */
  readonly unresolved: readonly string[];
  /** 消した名前。 */
  readonly removed: readonly string[];
  /** ファイルに登録が無い（検査されない）ので、何もしなかった。 */
  readonly notChecked: boolean;
}

interface RegistryJson {
  format?: number;
  files: Record<string, Record<string, { window?: string; buffers?: Record<string, string>; unresolved?: string }>>;
  [key: string]: unknown;
}

/** `--list-registry` の標準出力を読む（JSON の行を探す）。読めなければ例外。 */
export function parseWidthRegistryListing(stdout: string): WidthRegistryListing {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith("{"));
  if (!line) throw new Error("--list-registry の出力に JSON がありません");
  const data = JSON.parse(line) as Partial<WidthRegistryListing>;
  if (typeof data.files !== "object" || data.files === null) throw new Error("--list-registry の出力に files がありません");
  return { extra: String(data.extra ?? ""), errors: Array.isArray(data.errors) ? data.errors.map(String) : [], files: data.files };
}

/** 本文で使っている `[BUFFER1]`〜`[BUFFER3]`。 */
function buffersIn(text: string): string[] {
  return [...new Set(text.match(/\[BUFFER[123]\]/g) ?? [])];
}

/**
 * `.string` を保存したときの書き足しを計画する。
 * - `fileKey` はその `.string` の、登録でのパス（`cfru/strings/x.string`）。登録が無いファイルは何もしない（検査されないため）。
 * - 本文のある `#org` のうち登録の無いものを足す。窓は `window`（既定 `field`）。`[BUFFER1]` などを使う本文は、
 *   値の種類が分からないので `unresolved` にする（理由は `unresolvedReason` で作る）。
 * - JSON に書いた名前のうち、ファイルから消えた `#org` の分を消す。
 */
export function planWidthRegistry(options: {
  readonly registryText: string | null;
  readonly listing: WidthRegistryListing;
  readonly fileKey: string;
  readonly stringText: string;
  readonly window?: string;
  readonly unresolvedReason: (buffers: string) => string;
}): WidthRegistryPlan {
  const registered = options.listing.files[options.fileKey];
  if (!registered) return { text: null, added: [], unresolved: [], removed: [], notChecked: true };
  const data: RegistryJson = options.registryText?.trim() ? (JSON.parse(options.registryText) as RegistryJson) : { format: 1, files: {} };
  if (typeof data.files !== "object" || data.files === null) data.files = {};
  const extra = { ...(data.files[options.fileKey] ?? {}) };
  const file = parseStringFile(options.stringText);
  const present = new Map<string, string>();
  for (const e of file.entries) if (e.bodyLines.length > 0 && !present.has(e.label)) present.set(e.label, e.text);
  const known = new Set(registered);
  const added: string[] = [];
  const unresolved: string[] = [];
  for (const [label, text] of present) {
    if (known.has(label) || label in extra) continue;
    const buffers = buffersIn(text);
    if (buffers.length > 0) {
      extra[label] = { unresolved: options.unresolvedReason(buffers.join(" ")) };
      unresolved.push(label);
    } else {
      extra[label] = { window: options.window ?? "field" };
    }
    added.push(label);
  }
  const removed = Object.keys(extra).filter((label) => !present.has(label));
  for (const label of removed) delete extra[label];
  if (added.length === 0 && removed.length === 0) return { text: null, added, unresolved, removed, notChecked: false };
  if (Object.keys(extra).length > 0) data.files[options.fileKey] = extra;
  else delete data.files[options.fileKey];
  data.format ??= 1;
  return { text: `${JSON.stringify(data, null, 2)}\n`, added, unresolved, removed, notChecked: false };
}
