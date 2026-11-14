/**
 * eventscripts の種別と、シンボルからラベル名への変換。
 * 規則は CFRU の `scripts/insert.py`（ND・Chronos で同じ）を写したもの。
 */

/** eventscripts の種別（書くときは小文字。読むときは大文字小文字を区別しない）。 */
export type EventScriptKind = "map" | "npc" | "trainer" | "item" | "tile" | "sign";

/** 種別の一覧。 */
export const EVENT_SCRIPT_KINDS: readonly EventScriptKind[] = ["map", "npc", "trainer", "item", "tile", "sign"];

/**
 * 種別が書き込むイベントの並び。番号はこの並びの中の位置（0 から）。
 * - `map`: マップヘッダーの +0x8（マップスクリプトの表）。番号を使わない。
 * - `person`: 人（`npc` / `trainer` / `item` が同じ番号を共有する）。
 * - `tile`: スクリプトタイル。
 * - `sign`: 看板。
 */
export type EventScriptTarget = "map" | "person" | "tile" | "sign";

/** 種別を表す文字列か（大文字小文字を区別しない）。合えば小文字の種別。 */
export function parseEventScriptKind(text: string): EventScriptKind | null {
  const lower = text.toLowerCase();
  return (EVENT_SCRIPT_KINDS as readonly string[]).includes(lower) ? (lower as EventScriptKind) : null;
}

/** 種別が書き込むイベントの並び。 */
export function eventScriptTargetOf(kind: EventScriptKind): EventScriptTarget {
  switch (kind) {
    case "map":
      return "map";
    case "npc":
    case "trainer":
    case "item":
      return "person";
    case "tile":
      return "tile";
    case "sign":
      return "sign";
  }
}

/** insert.py がシンボルの頭に付ける文字列（`trainer` は `EventScript_`、`item` は `ItemFindScript_`。他は無し）。 */
export function eventScriptSymbolPrefix(kind: EventScriptKind): string {
  if (kind === "trainer") return "EventScript_";
  if (kind === "item") return "ItemFindScript_";
  return "";
}

/**
 * eventscripts の行のシンボルが指すラベル名。insert.py と同じく、種別の頭の文字列を付けてから
 * `defines`（`#include` 先の `#define`）で置き換える。値の無い `#define` は置き換えない。
 * 16 進のアドレスを直接書いた行もそのまま返す（ラベルとして見つからなければ insert.py はアドレスとして読む）。
 */
export function eventScriptLabel(kind: EventScriptKind, symbol: string, defines?: ReadonlyMap<string, string | true>): string {
  const label = eventScriptSymbolPrefix(kind) + symbol;
  const replaced = defines?.get(label);
  return typeof replaced === "string" ? replaced : label;
}

/**
 * ラベル名を eventscripts に書くときのシンボル（`eventScriptLabel` の逆）。
 * `trainer` / `item` で、ラベルが頭の文字列で始まらないときは null（その種別では書けない）。
 */
export function eventScriptSymbolFor(kind: EventScriptKind, label: string): string | null {
  const prefix = eventScriptSymbolPrefix(kind);
  if (!label.startsWith(prefix)) return null;
  const symbol = label.slice(prefix.length);
  return symbol.length === 0 ? null : symbol;
}

/**
 * シンボルを 16 進のアドレスとして読む（insert.py の `int(symbol, 16)`。`0x` は付けても付けなくてもよい）。
 * ラベルの表に無いときに insert.py が使う値。読めなければ null。
 */
export function parseEventScriptAddress(symbol: string): number | null {
  const m = /^(?:0[xX])?([0-9a-fA-F]+)$/.exec(symbol);
  return m ? parseInt(m[1]!, 16) : null;
}
