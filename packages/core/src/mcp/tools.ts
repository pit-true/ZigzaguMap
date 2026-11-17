/**
 * MCP の道具の定義（Phase7 #521・#522）。開いている ZigzaguMap につなぐ形と、画面なしで core を使う形の両方がこの表を使う。
 *
 * - 名前は利用者の JavaScript のスクリプトの `zz` API（#405）の名前の `.` を `_` にしたもの（`map.setBlock` → `map_setBlock`）。
 *   MCP のクライアントによっては名前に `.` を使えないため。`zz` に無い道具（マップを開く、イベント、元に戻す、出力、画像）は
 *   同じ書き方で足した。`ui.*` と `view.setGrid`（画面の操作）は出さない。
 * - `kind` は許可の区切り。`read` は読むだけ（マップを開くのも含む。データは変えない）、`write` はマップの書き換え
 *   （ZigzaguMap の「元に戻す」に乗る）、`export` は `maps\` への出力。許可は ZigzaguMap の設定で決める。
 * - ROM・`.s` を書く道具、外部のコマンドを動かす道具、パスを受け取る道具は無い。
 */

import type { UserScriptMethod } from "../userscript/UserScriptProtocol.js";

/** 道具の許可の区切り。 */
export type McpToolKind = "read" | "write" | "export";

/** 引数 1 つの型（JSON Schema の一部だけを使う）。 */
export type McpPropertySchema =
  | { readonly type: "integer"; readonly description: string; readonly minimum?: number; readonly maximum?: number }
  | { readonly type: "boolean"; readonly description: string }
  | { readonly type: "string"; readonly description: string; readonly enum: readonly string[] }
  | {
      readonly type: "array";
      readonly description: string;
      readonly items: { readonly type: "integer"; readonly minimum: number; readonly maximum: number };
      readonly maxItems: number;
    }
  | {
      readonly type: "object";
      readonly description: string;
      readonly additionalProperties: { readonly type: readonly ["integer", "boolean"] };
    };

/** 道具の引数の型（いつもオブジェクト。知らない引数は受け付けない）。 */
export interface McpInputSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, McpPropertySchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

/** 道具 1 つ。 */
export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly kind: McpToolKind;
  readonly inputSchema: McpInputSchema;
  /** 対応する `zz` API（無ければ null）。 */
  readonly scriptMethod: UserScriptMethod | null;
}

/** ブロック番号の上限（マスに置ける番号）。 */
export const MCP_MAX_BLOCK = 0x3ff;
/** 移動許可の上限。 */
export const MCP_MAX_MOVEMENT = 0x3f;
/** 1 回で読み書きするマスの上限（FR のいちばん大きなマップが入る数）。 */
export const MCP_MAX_CELLS = 0x10000;

const int = (description: string, minimum?: number, maximum?: number): McpPropertySchema => ({
  type: "integer",
  description,
  ...(minimum !== undefined ? { minimum } : {}),
  ...(maximum !== undefined ? { maximum } : {}),
});
const bool = (description: string): McpPropertySchema => ({ type: "boolean", description });

const X = int("マスの X（左が 0）", 0);
const Y = int("マスの Y（上が 0）", 0);
const BANK = int("バンク番号", 0, 0xff);
const MAP = int("マップ番号", 0, 0xff);
const BLOCK = int(`ブロック番号（0〜${MCP_MAX_BLOCK}。0x200 からがタイルセット 2）`, 0, MCP_MAX_BLOCK);
const MOVEMENT = int(`移動許可（0〜${MCP_MAX_MOVEMENT}。AdvanceMap の移動許可の番号）`, 0, MCP_MAX_MOVEMENT);
const EVENT_KIND: McpPropertySchema = { type: "string", description: "イベントの種類（person: 人、warp: ワープ、trap: スクリプトタイル、sign: 看板）", enum: ["person", "warp", "trap", "sign"] };
const EVENT_INDEX = int("その種類の中の番号（0 から）", 0, 0xff);
const RECT = {
  x: int("矩形の左上の X（省略すると 0）", 0),
  y: int("矩形の左上の Y（省略すると 0）", 0),
  width: int("矩形の幅（省略するとマップの右端まで）", 1),
  height: int("矩形の高さ（省略するとマップの下端まで）", 1),
};

function schema(properties: Record<string, McpPropertySchema> = {}, required: readonly string[] = []): McpInputSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

/** 書き換えの道具の説明に足す一文。 */
const UNDO_NOTE = "1 回の呼び出しが ZigzaguMap の「元に戻す」1 回分になる。出力するまでファイルは変わらない。";

/** 道具の一覧（`tools/list` の順）。 */
export const MCP_TOOLS: readonly McpToolDefinition[] = [
  // ---- 読むだけ
  {
    name: "maps_list",
    description: "ROM のマップの一覧（バンク番号・マップ番号・名前）を返す。",
    kind: "read",
    inputSchema: schema(),
    scriptMethod: "maps.list",
  },
  {
    name: "map_open",
    description: "マップを開く（ZigzaguMap では画面に出す）。map_ で始まる道具は開いているマップを読み書きする。データは変えない。",
    kind: "read",
    inputSchema: schema({ bank: BANK, map: MAP }, ["bank", "map"]),
    scriptMethod: null,
  },
  {
    name: "map_current",
    description: "開いているマップ（バンク・マップ番号・幅・高さ・名前）を返す。開いていなければ null。",
    kind: "read",
    inputSchema: schema(),
    scriptMethod: "map.current",
  },
  {
    name: "map_getBlock",
    description: "開いているマップの 1 マスのブロック番号を返す。",
    kind: "read",
    inputSchema: schema({ x: X, y: Y }, ["x", "y"]),
    scriptMethod: "map.getBlock",
  },
  {
    name: "map_getMovement",
    description: "開いているマップの 1 マスの移動許可を返す。",
    kind: "read",
    inputSchema: schema({ x: X, y: Y }, ["x", "y"]),
    scriptMethod: "map.getMovement",
  },
  {
    name: "map_getCells",
    description: "開いているマップの矩形（省略するとマップ全体）のブロック番号と移動許可を、左上から行ごとに並べた配列で返す。",
    kind: "read",
    inputSchema: schema(RECT),
    scriptMethod: "map.getCells",
  },
  {
    name: "maps_getCells",
    description: "開いていないマップも含め、指定したマップの矩形（省略すると全体）のブロック番号と移動許可を返す（読むだけ）。",
    kind: "read",
    inputSchema: schema({ bank: BANK, map: MAP, ...RECT }, ["bank", "map"]),
    scriptMethod: "maps.getCells",
  },
  {
    name: "map_getBorder",
    description: "開いているマップのボーダー（マップの外に並べるブロック）の 1 マスのブロック番号を返す。",
    kind: "read",
    inputSchema: schema({ x: X, y: Y }, ["x", "y"]),
    scriptMethod: "map.getBorder",
  },
  {
    name: "map_getHeader",
    description: "開いているマップのヘッダー（曲・地名・天候・種類など）を返す。",
    kind: "read",
    inputSchema: schema(),
    scriptMethod: "map.getHeader",
  },
  {
    name: "map_getTilesets",
    description: "開いているマップのタイルセット 1・2 のポインタを返す。",
    kind: "read",
    inputSchema: schema(),
    scriptMethod: "map.getTilesets",
  },
  {
    name: "names_list",
    description: "名前の一覧を返す（maps: マップ名、species: ポケモンの種族名。番号の順）。",
    kind: "read",
    inputSchema: schema({ kind: { type: "string", description: "一覧の種類", enum: ["maps", "species"] } }, ["kind"]),
    scriptMethod: "names.list",
  },
  {
    name: "events_list",
    description: "開いているマップのイベント（人・ワープ・スクリプトタイル・看板）を種類ごとに返す。",
    kind: "read",
    inputSchema: schema(),
    scriptMethod: null,
  },
  {
    name: "events_get",
    description: "開いているマップのイベント 1 つの全項目を返す。",
    kind: "read",
    inputSchema: schema({ kind: EVENT_KIND, index: EVENT_INDEX }, ["kind", "index"]),
    scriptMethod: null,
  },
  {
    name: "map_image",
    description: "開いているマップの矩形（省略すると全体）を、ブロックだけで描いた PNG で返す（1 マス 16 ピクセル。イベントは描かない）。",
    kind: "read",
    inputSchema: schema(RECT),
    scriptMethod: null,
  },
  {
    name: "edit_status",
    description: "未出力の変更があるマップ、この窓口で行った書き換えを元に戻せるか、許可されている操作を返す。",
    kind: "read",
    inputSchema: schema(),
    scriptMethod: null,
  },
  // ---- 書き換え（元に戻せる）
  {
    name: "map_setBlock",
    description: `開いているマップの 1 マスにブロックを置く（移動許可は変えない）。${UNDO_NOTE}`,
    kind: "write",
    inputSchema: schema({ x: X, y: Y, block: BLOCK }, ["x", "y", "block"]),
    scriptMethod: "map.setBlock",
  },
  {
    name: "map_setMovement",
    description: `開いているマップの 1 マスの移動許可を変える。${UNDO_NOTE}`,
    kind: "write",
    inputSchema: schema({ x: X, y: Y, movement: MOVEMENT }, ["x", "y", "movement"]),
    scriptMethod: "map.setMovement",
  },
  {
    name: "map_setCells",
    description: `開いているマップの矩形に、ブロック番号と移動許可（どちらか片方でもよい）を左上から行ごとに並べた配列で書く。配列の長さは幅×高さ。${UNDO_NOTE}`,
    kind: "write",
    inputSchema: schema(
      {
        x: int("矩形の左上の X", 0),
        y: int("矩形の左上の Y", 0),
        width: int("矩形の幅", 1),
        height: int("矩形の高さ", 1),
        blocks: { type: "array", description: "ブロック番号の配列（省略するとブロックは変えない）", items: { type: "integer", minimum: 0, maximum: MCP_MAX_BLOCK }, maxItems: MCP_MAX_CELLS },
        movements: { type: "array", description: "移動許可の配列（省略すると移動許可は変えない）", items: { type: "integer", minimum: 0, maximum: MCP_MAX_MOVEMENT }, maxItems: MCP_MAX_CELLS },
      },
      ["x", "y", "width", "height"],
    ),
    scriptMethod: null,
  },
  {
    name: "map_setBorder",
    description: `開いているマップのボーダーの 1 マスのブロックを変える。${UNDO_NOTE}`,
    kind: "write",
    inputSchema: schema({ x: X, y: Y, block: BLOCK }, ["x", "y", "block"]),
    scriptMethod: "map.setBorder",
  },
  {
    name: "map_fill",
    description: `開いているマップの (x, y) とつながった同じブロック（movement が true なら同じ移動許可）のマスを value で塗る。magic が true ならつながっていない同じマスも塗る。塗ったマスの数を返す。${UNDO_NOTE}`,
    kind: "write",
    inputSchema: schema(
      { x: X, y: Y, value: int(`塗る値（ブロック番号 0〜${MCP_MAX_BLOCK}、または移動許可 0〜${MCP_MAX_MOVEMENT}）`, 0, MCP_MAX_BLOCK), movement: bool("移動許可を塗る"), magic: bool("つながっていない同じマスも塗る") },
      ["x", "y", "value"],
    ),
    scriptMethod: "map.fill",
  },
  {
    name: "map_shift",
    description: `開いているマップの配置全体（ブロックと移動許可）を dx・dy マスずらす。はみ出た分は反対側に出る。${UNDO_NOTE}`,
    kind: "write",
    inputSchema: schema({ dx: int("右へずらすマス数（左は負）"), dy: int("下へずらすマス数（上は負）") }, ["dx", "dy"]),
    scriptMethod: "map.shift",
  },
  {
    name: "events_set",
    description: `開いているマップのイベント 1 つの項目を変える（fields は項目名 → 値。項目名は events_get の返事と同じ。x・y は events_move で変える）。イベントを足す・消す道具は無い。${UNDO_NOTE}`,
    kind: "write",
    inputSchema: schema(
      { kind: EVENT_KIND, index: EVENT_INDEX, fields: { type: "object", description: "項目名 → 値（整数か真偽）", additionalProperties: { type: ["integer", "boolean"] } } },
      ["kind", "index", "fields"],
    ),
    scriptMethod: null,
  },
  {
    name: "events_move",
    description: `開いているマップのイベント 1 つを (x, y) へ動かす。${UNDO_NOTE}`,
    kind: "write",
    inputSchema: schema({ kind: EVENT_KIND, index: EVENT_INDEX, x: X, y: Y }, ["kind", "index", "x", "y"]),
    scriptMethod: null,
  },
  {
    name: "edit_undo",
    description: "この窓口で行った直前の書き換えを元に戻す。利用者が画面で行った操作は戻さない。",
    kind: "write",
    inputSchema: schema(),
    scriptMethod: null,
  },
  {
    name: "edit_redo",
    description: "edit_undo で戻した書き換えをやり直す。",
    kind: "write",
    inputSchema: schema(),
    scriptMethod: null,
  },
  // ---- 出力
  {
    name: "project_export",
    description: "未出力の変更をプロジェクトフォルダの maps\\ へ出力する（ZigzaguMap のファイル > マップを出力 と同じ）。.s などスクリプトのファイルも書き換える出力は、別の許可が要る。",
    kind: "export",
    inputSchema: schema(),
    scriptMethod: null,
  },
];

/** 名前から道具を引く。 */
export function mcpTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}

/** `zz` API の名前を MCP の道具の名前にする（`.` → `_`）。 */
export function mcpToolNameOf(method: UserScriptMethod): string {
  return method.replace(/\./g, "_");
}

/**
 * 引数を道具の型で確かめる。合っていれば null、違えば分かる文（日本語）を返す。
 * 型・必須・知らない引数・範囲・配列の長さを見る（値の意味の確かめは道具の中で行う）。
 */
export function checkMcpArguments(tool: McpToolDefinition, args: unknown): string | null {
  if (args === undefined || args === null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) return "引数はオブジェクトで渡してください";
  const record = args as Record<string, unknown>;
  const { properties, required } = tool.inputSchema;
  for (const key of Object.keys(record)) {
    if (!(key in properties)) return `知らない引数です: ${key}（使える引数: ${Object.keys(properties).join(", ") || "なし"}）`;
  }
  for (const key of required) {
    if (record[key] === undefined) return `引数 ${key} がありません`;
  }
  for (const [key, prop] of Object.entries(properties)) {
    const value = record[key];
    if (value === undefined) continue;
    const error = checkValue(key, prop, value);
    if (error) return error;
  }
  return null;
}

function checkInteger(name: string, value: unknown, minimum?: number, maximum?: number): string | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return `${name} は整数で指定してください`;
  if (minimum !== undefined && value < minimum) return `${name} は ${minimum} 以上にしてください（${value}）`;
  if (maximum !== undefined && value > maximum) return `${name} は ${maximum} 以下にしてください（${value}）`;
  return null;
}

function checkValue(key: string, prop: McpPropertySchema, value: unknown): string | null {
  switch (prop.type) {
    case "integer":
      return checkInteger(key, value, prop.minimum, prop.maximum);
    case "boolean":
      return typeof value === "boolean" ? null : `${key} は true か false で指定してください`;
    case "string":
      return typeof value === "string" && prop.enum.includes(value) ? null : `${key} は ${prop.enum.join(" / ")} のどれかにしてください`;
    case "array": {
      if (!Array.isArray(value)) return `${key} は整数の配列で指定してください`;
      if (value.length > prop.maxItems) return `${key} が長すぎます（${value.length} 個。${prop.maxItems} 個まで）`;
      for (let i = 0; i < value.length; i++) {
        const error = checkInteger(`${key}[${i}]`, value[i], prop.items.minimum, prop.items.maximum);
        if (error) return error;
      }
      return null;
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return `${key} はオブジェクトで指定してください`;
      for (const [k, v] of Object.entries(value)) {
        if (typeof v !== "boolean" && (typeof v !== "number" || !Number.isInteger(v))) return `${key}.${k} は整数か true / false で指定してください`;
      }
      return null;
    }
  }
}
