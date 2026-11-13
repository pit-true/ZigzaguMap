import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { ROM_BASE, SetPaletteColorsCommand, TOTAL_PALETTE_COUNT, encodeBase64, PRIMARY_PALETTE_COUNT, type Command, type TilesetDocument } from "@zigzagumap/core";
import type { App } from "../app/App";
import { CommandGroup } from "../app/CommandGroup";
import { jaBlockEditor as t } from "../i18n/ja.blockEditor";
import {
  TOOL_MESSAGE_EVENT,
  TOOL_REQUEST_EVENT,
  TOOL_WINDOW_SIZES,
  type AutomationReply,
  type TilesetData,
  type ToolKind,
  type ToolMessage,
  type ToolRequest,
  type ToolSnapshot,
  type ToolUiState,
} from "./protocol";
import { tilesetRefsOf } from "./tilesetRefs";

/** 別ウィンドウからの自動操作の返事を待つ時間。 */
const AUTOMATION_TIMEOUT = 110_000;

/**
 * メインウィンドウ側の、別ウィンドウ（ブロックエディタ・パレットエディタ・ブロックパレット一括変更）の窓口。
 * 初めて別ウィンドウを開くときに読み込む（メインの起動では読まない）。
 *
 * - 編集の状態はメインの ProjectSession（CommandBus とタイルセット）だけが持つ。
 * - 別ウィンドウからの操作（コマンドの JSON、アンドゥ・リドゥ）をメインの CommandBus で実行する。
 * - タイルセットが変わったら（どのウィンドウの操作でも、アンドゥでも）、開いている別ウィンドウへ写しを送り直す。
 * - 一時適用した色と選んでいるパレットは、ウィンドウどうしで共有する表示の状態としてここに置く。
 */
export class ToolWindowHost {
  private static current: Promise<ToolWindowHost> | null = null;

  /** 窓口（初めて呼ばれたときに作る）。 */
  static get(app: App): Promise<ToolWindowHost> {
    return (ToolWindowHost.current ??= (async () => {
      const host = new ToolWindowHost(app);
      await host.start();
      return host;
    })());
  }

  private readonly opened = new Set<ToolKind>();
  private version = 0;
  private ui: { palette: number; preview: Record<number, number[]> } = { palette: 0, preview: {} };
  /** 写しを送ったときのタイルセットの組（変わったら一時適用を捨てる）。 */
  private tilesetKey = "";
  private unsubscribeBus: (() => void) | null = null;
  private broadcastQueued = false;
  private nextAutomation = 1;
  private readonly automationWaits = new Map<number, (reply: AutomationReply) => void>();

  private constructor(private readonly app: App) {}

  private async start(): Promise<void> {
    await listen<ToolRequest>(TOOL_REQUEST_EVENT, (e) => void this.onRequest(e.payload));
    await listen<string>("tool-closed", (e) => this.onClosed(e.payload as ToolKind));
    const state = this.app.state;
    state.on("session", () => {
      this.subscribeBus();
      this.closeAll();
    });
    state.on("map", () => {
      if (!state.map) this.closeAll();
      else this.queueBroadcast();
    });
    this.subscribeBus();
  }

  /** 別ウィンドウを開く（開いていれば前に出す）。 */
  async open(kind: ToolKind): Promise<void> {
    if (!this.app.state.map) return;
    const size = TOOL_WINDOW_SIZES[kind];
    const title = kind === "block-editor" ? this.blockEditorTitle() : kind === "palette-editor" ? t.paletteEditor : t.adjustTitle;
    this.opened.add(kind);
    try {
      await invoke<boolean>("open_tool_window", { label: kind, title, width: size.width, height: size.height, resizable: size.resizable });
    } catch (e) {
      this.opened.delete(kind);
      throw e;
    }
  }

  /** 開いている別ウィンドウ。 */
  get windows(): ToolKind[] {
    return [...this.opened];
  }

  /** 別ウィンドウへ自動操作の要求を渡し、返事を待つ。 */
  async automation(kind: string, request: Record<string, unknown>): Promise<unknown> {
    if (!this.opened.has(kind as ToolKind)) throw new Error(`ウィンドウが開いていません: ${kind}`);
    const requestId = this.nextAutomation++;
    const reply = await new Promise<AutomationReply>((resolve) => {
      const timer = setTimeout(() => {
        this.automationWaits.delete(requestId);
        resolve({ ok: false, error: "別ウィンドウからの返事がありません" });
      }, AUTOMATION_TIMEOUT);
      this.automationWaits.set(requestId, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      void this.send(kind as ToolKind, { type: "automation", requestId, request });
    });
    if (!reply.ok) throw new Error(reply.error);
    return reply.result;
  }

  // ---- 内部 ----

  private subscribeBus(): void {
    this.unsubscribeBus?.();
    this.unsubscribeBus = null;
    const session = this.app.state.session;
    if (!session) return;
    this.unsubscribeBus = session.bus.subscribe((e) => {
      if (e.type === "clear" || tilesetRefsOf(e.command).length > 0) this.queueBroadcast();
    });
  }

  private async onRequest(req: ToolRequest): Promise<void> {
    let result: unknown = null;
    try {
      result = await this.handle(req);
    } catch (e) {
      await this.send(req.from, { type: "reply", id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    await this.send(req.from, { type: "reply", id: req.id, ok: true, result });
  }

  private async handle(req: ToolRequest): Promise<unknown> {
    switch (req.op) {
      case "hello":
        this.opened.add(req.from);
        return { snapshot: this.snapshot(), ui: this.uiState() };
      case "execute": {
        const session = this.requireSession();
        session.bus.execute(session.registry.create({ name: req.name, args: req.args as never }));
        return null;
      }
      case "undo":
        this.app.undo();
        return null;
      case "redo":
        this.app.redo();
        return null;
      case "export":
        this.app.actions.run("file.export");
        return null;
      case "commitPreview":
        return this.commitPreview();
      case "setUi":
        if (req.palette !== undefined) this.ui.palette = Math.max(0, Math.min(TOTAL_PALETTE_COUNT - 1, req.palette));
        if (req.preview !== undefined) this.ui.preview = { ...this.ui.preview, ...cloneColors(req.preview) };
        await this.broadcast({ type: "ui", ui: this.uiState() });
        return null;
      case "open":
        await this.open(req.kind);
        return null;
      case "automationReply":
        this.automationWaits.get(req.requestId)?.(req.reply);
        this.automationWaits.delete(req.requestId);
        return null;
    }
  }

  /** 一時適用した色を、パレットの色を変えるコマンドにして実行する（パレットの変更を反映する）。反映した本数。 */
  private commitPreview(): number {
    const session = this.requireSession();
    const map = this.app.state.map;
    if (!map) throw new Error(t.notOpen);
    const commands: Command[] = [];
    for (const [key, colors] of Object.entries(this.ui.preview)) {
      const palette = Number(key);
      const secondary = palette >= PRIMARY_PALETTE_COUNT;
      const pointer = (secondary ? map.doc.secondaryTileset : map.doc.primaryTileset) >>> 0;
      const doc = session.project.editorContext().tileset({ pointer, secondary });
      const current = [...doc.palettes.subarray(palette * 16, palette * 16 + 16)];
      if (current.every((c, i) => c === colors[i])) continue;
      commands.push(new SetPaletteColorsCommand({ tileset: pointer, secondary, palette, colors: [...colors] }));
    }
    this.ui.preview = {};
    if (commands.length === 1) session.bus.execute(commands[0]!);
    else if (commands.length > 1) session.bus.execute(new CommandGroup(commands));
    void this.broadcast({ type: "ui", ui: this.uiState() });
    return commands.length;
  }

  private onClosed(kind: ToolKind): void {
    this.opened.delete(kind);
    // パレットを編集する窓が全部閉じたら、一時適用した色は捨てる（AdvanceMap でも開き直すと元の色）。
    if (!this.opened.has("block-editor") && !this.opened.has("palette-editor")) this.ui.preview = {};
  }

  private closeAll(): void {
    for (const kind of [...this.opened]) void invoke("close_tool_window", { label: kind });
    this.opened.clear();
    this.ui = { palette: 0, preview: {} };
  }

  /** 写しをまとめて送る（同じフレームの中の変更は 1 回にまとめる）。 */
  private queueBroadcast(): void {
    if (this.broadcastQueued || this.opened.size === 0) return;
    this.broadcastQueued = true;
    setTimeout(() => {
      this.broadcastQueued = false;
      const snapshot = this.snapshot();
      const key = `${snapshot.primary?.pointer}:${snapshot.secondary?.pointer}`;
      if (key !== this.tilesetKey) this.ui.preview = {};
      this.tilesetKey = key;
      void this.broadcast({ type: "snapshot", snapshot, ui: this.uiState() });
    }, 0);
  }

  private async broadcast(message: ToolMessage): Promise<void> {
    await Promise.all([...this.opened].map((kind) => this.send(kind, message)));
  }

  private async send(kind: ToolKind, message: ToolMessage): Promise<void> {
    await emitTo(kind, TOOL_MESSAGE_EVENT, message).catch(() => undefined);
  }

  private uiState(): ToolUiState {
    return { palette: this.ui.palette, preview: cloneColors(this.ui.preview) };
  }

  /** 表示中のマップのタイルセットの写し。 */
  private snapshot(): ToolSnapshot {
    const state = this.app.state;
    const map = state.map;
    const session = state.session;
    this.version++;
    if (!map || !session) return { version: this.version, map: null, primary: null, secondary: null };
    const context = session.project.editorContext();
    const primary = context.tileset({ pointer: map.doc.primaryTileset >>> 0, secondary: false });
    const secondary = context.tileset({ pointer: map.doc.secondaryTileset >>> 0, secondary: true });
    this.tilesetKey = `${primary.pointer}:${secondary.pointer}`;
    return { version: this.version, map: { ...map.id }, primary: this.tilesetData(primary), secondary: this.tilesetData(secondary) };
  }

  private tilesetData(doc: TilesetDocument): TilesetData {
    const project = this.requireSession().project;
    const index = project.tilesetTable.indexOf(doc.pointer);
    let romBlocksOffset: number | null = null;
    const at = doc.pointer - ROM_BASE;
    if (index !== null && project.rom.inRange(at + 0x0c, 4)) {
      const value = project.rom.u32(at + 0x0c);
      if (project.rom.isPointer(value)) romBlocksOffset = value - ROM_BASE;
    }
    const blocks = new Uint8Array(doc.blocks.length * 2);
    doc.blocks.forEach((v, i) => {
      blocks[i * 2] = v & 0xff;
      blocks[i * 2 + 1] = v >> 8;
    });
    return {
      pointer: doc.pointer,
      secondary: doc.secondary,
      index,
      tiles: encodeBase64(doc.tiles),
      palettes: [...doc.palettes],
      blocks: encodeBase64(blocks),
      attributes: [...doc.attributes],
      blockCapacity: doc.blockCapacity,
      tileCapacity: doc.tileCapacity,
      romBlocksOffset,
    };
  }

  private blockEditorTitle(): string {
    const map = this.app.state.map;
    const table = this.app.state.session?.project.tilesetTable;
    if (!map || !table) return t.title;
    return t.windowTitle(table.indexOf(map.doc.primaryTileset >>> 0), table.indexOf(map.doc.secondaryTileset >>> 0));
  }

  private requireSession(): NonNullable<App["state"]["session"]> {
    const s = this.app.state.session;
    if (!s) throw new Error(t.notOpen);
    return s;
  }
}

function cloneColors(preview: Readonly<Record<number, readonly number[]>>): Record<number, number[]> {
  const out: Record<number, number[]> = {};
  for (const [k, v] of Object.entries(preview)) out[Number(k)] = [...v];
  return out;
}
