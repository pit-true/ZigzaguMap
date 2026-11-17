import { encodeBase64 } from "../binary/base64.js";
import type { Command } from "../command/Command.js";
import type { CommandBus } from "../command/CommandBus.js";
import { CommandGroup } from "../command/CommandGroup.js";
import { EditError, EditErrorCode } from "../command/EditError.js";
import { PaintBlocksCommand } from "../command/commands/PaintBlocksCommand.js";
import { PaintBorderCommand } from "../command/commands/PaintBorderCommand.js";
import { PaintMovementCommand } from "../command/commands/PaintMovementCommand.js";
import { MoveEventCommand } from "../command/commands/event/MoveEventCommand.js";
import { SetEventFieldsCommand } from "../command/commands/event/SetEventFieldsCommand.js";
import { EVENT_KINDS, eventList, type EventKind } from "../command/commands/event/eventFields.js";
import { ShiftMapCommand } from "../command/commands/layout/ShiftMapCommand.js";
import { floodRegion, matchingCells, type FillSource } from "../map/fill.js";
import type { MapId, Tileset } from "../map/types.js";
import type { MapDocument } from "../model/MapDocument.js";
import { encodeRgbPng } from "../project/png/PngEncoder.js";
import { renderMap } from "../render/MapRenderer.js";
import { MCP_MAX_BLOCK, MCP_MAX_CELLS, MCP_MAX_MOVEMENT, checkMcpArguments, mcpTool, type McpToolKind } from "./tools.js";

/** 許可（ZigzaguMap の設定。画面なしの形では起動の引数）。 */
export interface McpPermissions {
  /** マップの書き換え（`write` の道具）。 */
  readonly write: boolean;
  /** `maps\` への出力（`export` の道具）。 */
  readonly export: boolean;
  /** 出力が `.s`・`eventscripts` などスクリプトのファイルも書くときの許可（`export` に加えて要る）。 */
  readonly scripts: boolean;
}

/** マップ一覧の 1 件。 */
export interface McpMapEntry {
  readonly bank: number;
  readonly map: number;
  readonly name: string;
}

/**
 * 道具が読み書きする相手。開いている ZigzaguMap（画面の App）と、画面なしの core のプロジェクトの両方がこの形で渡す。
 * 道具はここに無いこと（ファイルのパス、ROM の書き込み、外部のコマンド）はできない。
 */
export interface McpWorkspace {
  /** 道具を使えない理由（ROM を開いていないなど）。使えるなら null。 */
  notReady(): string | null;
  /** マップの一覧。 */
  maps(): readonly McpMapEntry[];
  /** 開いているマップ（無ければ null）。 */
  current(): { readonly id: MapId; readonly doc: MapDocument } | null;
  /** マップを開く（無いマップは呼ぶ前に道具が断る）。 */
  open(id: MapId): Promise<void>;
  /** 開いていないマップも読む（無ければ null）。 */
  peek(id: MapId): Promise<MapDocument | null>;
  /** 操作の履歴（書き換えはここで実行し、元に戻せるようにする）。 */
  bus(): CommandBus;
  /** マップのタイルセット（画像用）。 */
  tilesets(doc: MapDocument): Promise<{ primary: Tileset; secondary: Tileset }>;
  /** 種族名（番号の順。無ければ null）。 */
  speciesNames(): Promise<readonly (string | null)[]>;
  /** 未出力の変更があるマップ。 */
  modifiedMaps(): readonly MapId[];
  /** 出力が `.s`・`eventscripts` などスクリプトのファイルも書くか。 */
  exportTouchesScripts(): boolean;
  /** `maps\` へ出力する（プロジェクトフォルダが無ければ Error）。 */
  export(): Promise<{ readonly written: readonly string[]; readonly removed: readonly string[] }>;
  /** 今の許可。 */
  permissions(): McpPermissions;
  /** 書き換えと出力を断る理由（画面なしの形で、ZigzaguMap が同じプロジェクトを開いているときなど）。無ければ null。 */
  writeBlocked(): string | null;
  /** 書き換え・出力をしたことを知らせる（画面のステータスバー）。 */
  notify?(text: string): void;
  /** 道具を動かす前に状態を読み直す（画面なしの形が使用中の印を読む）。 */
  refresh?(): Promise<void>;
}

/** 道具の返事の中身 1 つ（MCP の TextContent・ImageContent）。 */
export type McpContent = { readonly type: "text"; readonly text: string } | { readonly type: "image"; readonly data: string; readonly mimeType: "image/png" };

/** 道具の返事（MCP の CallToolResult の中身）。 */
export interface McpToolResult {
  readonly content: readonly McpContent[];
  readonly isError?: boolean;
  readonly structuredContent?: Record<string, unknown>;
}

/** 道具の中で断るときの Error（そのまま利用者・AI に見せる文）。 */
export class McpToolError extends Error {}

/** 1 回で返す画像の大きさの上限（ピクセル数。FR のいちばん大きなマップ 1 枚分）。 */
const MAX_IMAGE_PIXELS = 1600 * 1200;

const KIND_TEXT: Record<McpToolKind, string> = { read: "読むだけ", write: "書き換え", export: "出力" };

/**
 * MCP の道具を動かすクラス。引数を確かめ、許可を見て、`McpWorkspace` を読み書きする。
 * 書き換えは 1 回の呼び出しを 1 つのコマンド（`CommandGroup`）にして履歴に積むので、1 回の「元に戻す」で戻る。
 * `edit_undo`・`edit_redo` は、この窓口で積んだコマンドだけを戻す・やり直す（利用者の操作には触れない）。
 */
export class McpToolRunner {
  /** この窓口で積んだコマンド。 */
  private readonly mine = new WeakSet<Command>();

  constructor(private readonly ws: McpWorkspace) {}

  /** 道具を呼ぶ。知らない道具なら null（呼ぶ側が JSON-RPC のエラーにする）。それ以外の失敗は `isError` の返事にする。 */
  async call(name: string, args: unknown): Promise<McpToolResult | null> {
    const tool = mcpTool(name);
    if (!tool) return null;
    try {
      const argError = checkMcpArguments(tool, args);
      if (argError) throw new McpToolError(`${name}: ${argError}`);
      await this.ws.refresh?.();
      const notReady = this.ws.notReady();
      if (notReady) throw new McpToolError(notReady);
      if (tool.kind !== "read") this.checkAllowed(tool.kind);
      const value = await this.run(name, (args ?? {}) as Record<string, unknown>);
      if (isImage(value)) return { content: [{ type: "image", data: value.png, mimeType: "image/png" }, { type: "text", text: JSON.stringify({ width: value.width, height: value.height }) }] };
      if (tool.kind !== "read") this.ws.notify?.(`MCP: ${name}`);
      const text = JSON.stringify(value === undefined ? null : value);
      const structured = value !== null && typeof value === "object" && !Array.isArray(value) ? { structuredContent: value as Record<string, unknown> } : {};
      return { content: [{ type: "text", text }], ...structured };
    } catch (e) {
      return { content: [{ type: "text", text: errorText(e) }], isError: true };
    }
  }

  private checkAllowed(kind: McpToolKind): void {
    const blocked = this.ws.writeBlocked();
    if (blocked) throw new McpToolError(blocked);
    const p = this.ws.permissions();
    if (kind === "write" && !p.write) throw new McpToolError(`${KIND_TEXT.write}は許可されていません。ZigzaguMap の 設定 > MCP の窓口 で「AI にマップの書き換えを許す」をオンにしてください。`);
    if (kind === "export" && !p.export) throw new McpToolError(`${KIND_TEXT.export}は許可されていません。ZigzaguMap の 設定 > MCP の窓口 で「AI に出力を許す」をオンにしてください。`);
  }

  private current(): { id: MapId; doc: MapDocument } {
    const m = this.ws.current();
    if (!m) throw new McpToolError("マップを開いていません。map_open で開いてください。");
    return m;
  }

  /** コマンドを実行して履歴に積む（この窓口のものとして覚える）。 */
  private execute(commands: Command[]): void {
    if (commands.length === 0) return;
    const command = commands.length === 1 ? commands[0]! : CommandGroup.of(commands);
    this.ws.bus().execute(command);
    this.mine.add(command);
  }

  private async run(name: string, a: Record<string, unknown>): Promise<unknown> {
    const n = (key: string): number => a[key] as number;
    switch (name) {
      case "maps_list":
        return { maps: this.ws.maps() };
      case "map_open": {
        const id = { bank: n("bank"), map: n("map") };
        if (!this.ws.maps().some((m) => m.bank === id.bank && m.map === id.map)) throw new McpToolError(`マップ ${id.bank}.${id.map} はありません。maps_list で番号を確かめてください。`);
        await this.ws.open(id);
        return this.describeCurrent();
      }
      case "map_current":
        return this.ws.current() ? this.describeCurrent() : null;
      case "map_getBlock": {
        const { doc } = this.current();
        const { x, y } = this.cell(doc, a);
        return doc.grid.getBlock(x, y);
      }
      case "map_getMovement": {
        const { doc } = this.current();
        const { x, y } = this.cell(doc, a);
        return doc.grid.getMovement(x, y);
      }
      case "map_getCells":
        return cellsOf(this.current().doc, a);
      case "maps_getCells": {
        const id = { bank: n("bank"), map: n("map") };
        const doc = await this.ws.peek(id);
        if (!doc) throw new McpToolError(`マップ ${id.bank}.${id.map} はありません。maps_list で番号を確かめてください。`);
        return cellsOf(doc, a);
      }
      case "map_getBorder": {
        const { doc } = this.current();
        if (!doc.border.inBounds(n("x"), n("y"))) throw new McpToolError(`(${n("x")}, ${n("y")}) はボーダー（${doc.border.width}×${doc.border.height}）の外です`);
        return doc.border.getBlock(n("x"), n("y"));
      }
      case "map_getHeader":
        return JSON.parse(JSON.stringify(this.current().doc.header)) as unknown;
      case "map_getTilesets": {
        const { doc } = this.current();
        return { primary: doc.primaryTileset >>> 0, secondary: doc.secondaryTileset >>> 0 };
      }
      case "names_list":
        return a["kind"] === "maps" ? { names: this.ws.maps().map((m) => m.name) } : { names: await this.ws.speciesNames() };
      case "events_list": {
        const { doc } = this.current();
        const out: Record<string, unknown> = {};
        for (const kind of EVENT_KINDS) out[kind] = doc.events ? JSON.parse(JSON.stringify(eventList(doc.events, kind))) : [];
        return out;
      }
      case "events_get": {
        const { doc } = this.current();
        return JSON.parse(JSON.stringify(this.event(doc, a["kind"] as EventKind, n("index")))) as unknown;
      }
      case "map_image":
        return this.image(a);
      case "edit_status": {
        const bus = this.ws.bus();
        const last = bus.last;
        const next = bus.nextRedo;
        return {
          modifiedMaps: this.ws.modifiedMaps().map((m) => ({ bank: m.bank, map: m.map })),
          canUndo: last !== null && this.mine.has(last),
          canRedo: next !== null && this.mine.has(next),
          permissions: this.ws.permissions(),
          writeBlocked: this.ws.writeBlocked(),
        };
      }
      case "map_setBlock": {
        const { id, doc } = this.current();
        const { x, y } = this.cell(doc, a);
        this.execute([new PaintBlocksCommand({ ...id, cells: [{ x, y, block: n("block") }] })]);
        return { ok: true };
      }
      case "map_setMovement": {
        const { id, doc } = this.current();
        const { x, y } = this.cell(doc, a);
        this.execute([new PaintMovementCommand({ ...id, cells: [{ x, y, movement: n("movement") }] })]);
        return { ok: true };
      }
      case "map_setCells":
        return this.setCells(a);
      case "map_setBorder": {
        const { id, doc } = this.current();
        if (!doc.border.inBounds(n("x"), n("y"))) throw new McpToolError(`(${n("x")}, ${n("y")}) はボーダー（${doc.border.width}×${doc.border.height}）の外です`);
        this.execute([new PaintBorderCommand({ ...id, cells: [{ x: n("x"), y: n("y"), block: n("block") }] })]);
        return { ok: true };
      }
      case "map_fill":
        return this.fill(a);
      case "map_shift": {
        const { id } = this.current();
        this.execute([new ShiftMapCommand({ ...id, dx: n("dx"), dy: n("dy") })]);
        return { ok: true };
      }
      case "events_set": {
        const { id, doc } = this.current();
        const kind = a["kind"] as EventKind;
        this.event(doc, kind, n("index"));
        const fields = a["fields"] as Record<string, number | boolean>;
        if (Object.keys(fields).length === 0) throw new McpToolError("fields に変える項目を書いてください");
        if ("x" in fields || "y" in fields) throw new McpToolError("x・y は events_move で変えてください");
        this.execute([new SetEventFieldsCommand({ ...id, kind, index: n("index"), fields })]);
        return JSON.parse(JSON.stringify(this.event(doc, kind, n("index")))) as unknown;
      }
      case "events_move": {
        const { id, doc } = this.current();
        const kind = a["kind"] as EventKind;
        this.event(doc, kind, n("index"));
        const { x, y } = this.cell(doc, a);
        this.execute([new MoveEventCommand({ ...id, kind, index: n("index"), x, y })]);
        return { ok: true };
      }
      case "edit_undo": {
        const bus = this.ws.bus();
        const last = bus.last;
        if (!last || !this.mine.has(last)) throw new McpToolError("元に戻せる書き換えがありません（この窓口で行った直前の書き換えだけを戻します。利用者の操作は戻しません）");
        bus.undo();
        return { ok: true };
      }
      case "edit_redo": {
        const bus = this.ws.bus();
        const next = bus.nextRedo;
        if (!next || !this.mine.has(next)) throw new McpToolError("やり直せる書き換えがありません");
        bus.redo();
        return { ok: true };
      }
      case "project_export": {
        if (this.ws.exportTouchesScripts() && !this.ws.permissions().scripts) {
          throw new McpToolError("この出力は .s・eventscripts などスクリプトのファイルも書き換えます。ZigzaguMap の 設定 > MCP の窓口 で「AI にスクリプトのファイルの書き換えを許す」をオンにするか、ZigzaguMap で出力してください。");
        }
        const result = await this.ws.export();
        return { written: [...result.written], removed: [...result.removed] };
      }
    }
    throw new McpToolError(`道具 ${name} は使えません`);
  }

  private describeCurrent(): unknown {
    const { id, doc } = this.current();
    const name = this.ws.maps().find((m) => m.bank === id.bank && m.map === id.map)?.name ?? null;
    return { bank: id.bank, map: id.map, name, width: doc.width, height: doc.height };
  }

  private cell(doc: MapDocument, a: Record<string, unknown>): { x: number; y: number } {
    const x = a["x"] as number;
    const y = a["y"] as number;
    if (!doc.grid.inBounds(x, y)) throw new McpToolError(`(${x}, ${y}) はマップ（${doc.width}×${doc.height}）の外です`);
    return { x, y };
  }

  private event(doc: MapDocument, kind: EventKind, index: number): object {
    const list = doc.events ? eventList(doc.events, kind) : [];
    const event = list[index];
    if (!event) throw new McpToolError(`${kind} の ${index} 番はありません（${list.length} 個）`);
    return event;
  }

  private setCells(a: Record<string, unknown>): unknown {
    const { id, doc } = this.current();
    const rect = rectOf(doc, a, false);
    const count = rect.width * rect.height;
    const blocks = a["blocks"] as number[] | undefined;
    const movements = a["movements"] as number[] | undefined;
    if (!blocks && !movements) throw new McpToolError("blocks か movements を渡してください");
    for (const [key, list] of [["blocks", blocks], ["movements", movements]] as const) {
      if (list && list.length !== count) throw new McpToolError(`${key} の長さ（${list.length}）が幅×高さ（${count}）と合いません`);
    }
    const at = (i: number) => ({ x: rect.x + (i % rect.width), y: rect.y + Math.floor(i / rect.width) });
    const commands: Command[] = [];
    if (blocks) commands.push(new PaintBlocksCommand({ ...id, cells: blocks.map((block, i) => ({ ...at(i), block })) }));
    if (movements) commands.push(new PaintMovementCommand({ ...id, cells: movements.map((movement, i) => ({ ...at(i), movement })) }));
    this.execute(commands);
    return { ok: true, cells: count };
  }

  private fill(a: Record<string, unknown>): unknown {
    const { id, doc } = this.current();
    const { x, y } = this.cell(doc, a);
    const movement = a["movement"] === true;
    const value = a["value"] as number;
    if (movement && value > MCP_MAX_MOVEMENT) throw new McpToolError(`移動許可は 0〜${MCP_MAX_MOVEMENT} にしてください（${value}）`);
    if (!movement && value > MCP_MAX_BLOCK) throw new McpToolError(`ブロック番号は 0〜${MCP_MAX_BLOCK} にしてください（${value}）`);
    const g = doc.grid;
    const source: FillSource = { width: g.width, height: g.height, getBlock: (cx, cy) => g.getBlock(cx, cy), getMovement: (cx, cy) => g.getMovement(cx, cy) };
    const match = movement ? "movement" : "block";
    const cells = a["magic"] === true ? matchingCells(source, x, y, match) : floodRegion(source, x, y, match);
    this.execute([
      movement
        ? new PaintMovementCommand({ ...id, cells: cells.map((c) => ({ x: c.x, y: c.y, movement: value })) })
        : new PaintBlocksCommand({ ...id, cells: cells.map((c) => ({ x: c.x, y: c.y, block: value })) }),
    ]);
    return { ok: true, cells: cells.length };
  }

  private async image(a: Record<string, unknown>): Promise<ImageValue> {
    const { doc } = this.current();
    const rect = rectOf(doc, a, true);
    const { primary, secondary } = await this.ws.tilesets(doc);
    const whole = renderMap(doc.toRenderable(primary, secondary));
    const width = rect.width * 16;
    const height = rect.height * 16;
    if (width * height > MAX_IMAGE_PIXELS) throw new McpToolError("画像が大きすぎます。x・y・width・height で範囲を狭めてください");
    const rgba = new Uint8Array(width * height * 4);
    for (let row = 0; row < height; row++) {
      const from = ((rect.y * 16 + row) * whole.width + rect.x * 16) * 4;
      rgba.set(whole.data.subarray(from, from + width * 4), row * width * 4);
    }
    return { image: true, width, height, png: encodeBase64(encodeRgbPng(width, height, rgba)) };
  }
}

interface ImageValue {
  readonly image: true;
  readonly width: number;
  readonly height: number;
  readonly png: string;
}

function isImage(v: unknown): v is ImageValue {
  return typeof v === "object" && v !== null && (v as { image?: unknown }).image === true;
}

/** 引数の矩形（省略した辺はマップの端まで。`optional` が false なら全部要る）。マップの外にはみ出せば Error。 */
function rectOf(doc: MapDocument, a: Record<string, unknown>, optional: boolean): { x: number; y: number; width: number; height: number } {
  const x = (a["x"] as number | undefined) ?? 0;
  const y = (a["y"] as number | undefined) ?? 0;
  const width = (a["width"] as number | undefined) ?? (optional ? doc.width - x : 0);
  const height = (a["height"] as number | undefined) ?? (optional ? doc.height - y : 0);
  if (width < 1 || height < 1 || x + width > doc.width || y + height > doc.height) {
    throw new McpToolError(`矩形 (${x}, ${y}) 幅 ${width} 高さ ${height} がマップ（${doc.width}×${doc.height}）に収まりません`);
  }
  if (width * height > MCP_MAX_CELLS) throw new McpToolError("矩形が大きすぎます");
  return { x, y, width, height };
}

/** 矩形のブロック番号と移動許可。 */
function cellsOf(doc: MapDocument, a: Record<string, unknown>): unknown {
  const r = rectOf(doc, a, true);
  const blocks: number[] = [];
  const movements: number[] = [];
  for (let y = r.y; y < r.y + r.height; y++)
    for (let x = r.x; x < r.x + r.width; x++) {
      blocks.push(doc.grid.getBlock(x, y));
      movements.push(doc.grid.getMovement(x, y));
    }
  return { ...r, mapWidth: doc.width, mapHeight: doc.height, blocks, movements };
}

/** 失敗の文（コマンドの入力エラーは日本語の文にする）。 */
function errorText(e: unknown): string {
  if (e instanceof EditError) {
    const p = e.params;
    switch (e.code) {
      case EditErrorCode.ValueOutOfRange:
        return `${String(p["field"])} の値 ${String(p["value"])} は範囲（${String(p["min"])}〜${String(p["max"])}）の外です`;
      case EditErrorCode.UnknownField:
        return `知らない項目です: ${String(p["field"])}（events_get の返事の項目名を使ってください）`;
      case EditErrorCode.FieldNotApplicable:
        return `この種類のイベントでは使えない項目です: ${String(p["field"])}`;
      case EditErrorCode.EventIndexOutOfRange:
        return `${String(p["kind"])} の ${String(p["index"])} 番はありません（${String(p["count"])} 個）`;
      default:
        return `入力が正しくありません: ${e.message}`;
    }
  }
  return e instanceof Error ? e.message : String(e);
}
