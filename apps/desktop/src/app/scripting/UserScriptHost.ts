import { invoke } from "@tauri-apps/api/core";
import {
  CommandGroup,
  PaintBlocksCommand,
  PaintBorderCommand,
  PaintMovementCommand,
  SPECIES_COUNT,
  USER_SCRIPT_DIR,
  USER_SCRIPT_WRITES,
  affectedMaps,
  floodRegion,
  matchingCells,
  type FillSource,
  flattenCommandRecords,
  isUserScriptMethod,
  loadUserScriptListing,
  type Command,
  type CommandEvent,
  type HostToWorker,
  type MapId,
  type UserScriptEvent,
  type UserScriptListing,
  type UserScriptMethod,
  type WorkerToHost,
} from "@zigzagumap/core";
import { jaUserScript as t } from "../../i18n/ja.userScript";
import { inputDialog } from "../../ui/InputDialog";
import { messageBox } from "../../ui/MessageBox";
import type { EditorState } from "../EditorState";
import { scheduleIdleGc } from "../../util/idleGc";

/** スクリプトが登録した操作。 */
export interface UserScriptAction {
  readonly id: string;
  readonly label: string;
}

/** ログの 1 行。 */
export interface UserScriptLog {
  readonly level: "log" | "warn" | "error";
  readonly text: string;
}

/** 窓の外の機能（App が渡す）。 */
export interface UserScriptHostParts {
  readonly state: EditorState;
  /** グリッドの表示を切り替える（`view.setGrid`）。 */
  setGrid(show: boolean): void;
  /** Worker を作る（テストで差し替えられるように外から渡す）。 */
  createWorker(): Worker;
}

/** 1 回の呼び出しのあいだにためる書き込み（`x,y` → 値）。 */
interface Batch {
  readonly label: string;
  readonly map: MapId | null;
  readonly blocks: Map<string, number>;
  readonly movements: Map<string, number>;
  readonly border: Map<string, number>;
}

const LOG_LIMIT = 200;
const DIALOG_LIMIT = 4000;

/** ブロックの変化を知らせるコマンド（`cells` の引数があるもの）。 */
const CELL_COMMANDS = new Set(["paintBlocks", "placeBlock", "paintCells", "paintMovement", "placeMovement"]);
const RESIZE_COMMANDS = new Set(["resizeMap", "resizeMapEdge"]);
const SHIFT_COMMAND = "shiftMap";

/**
 * 利用者の JavaScript のスクリプト（Phase5 #405、Q17）の画面の側。プロジェクトフォルダの `zigzagumap-scripts\*.js` のうち、
 * `zigzagumap.json` で有効にしたものを 1 つの Web Worker で動かす。有効なスクリプトが無ければ Worker を作らない。
 * - Worker からは決めた API（`UserScriptProtocol`）だけをメッセージで受け、ここで答える。ファイルや外部コマンドの API は無い。
 * - 書き込みは 1 回の呼び出し（コールバック・登録した操作）の分をためて、終わったときに 1 つの操作（`group`）にして実行する
 *   （1 回の「元に戻す」で全部戻る）。ためている間に読むと、ためた値を返す。スクリプトが書いた操作では `blocksChanged` を呼ばない。
 * - 止める（`stop`）と Worker を終わらせる。長く止まったスクリプトもこれで止まる。
 */
export class UserScriptHost {
  private worker: Worker | null = null;
  private batch: Batch | null = null;
  private running = false;
  private listingValue: UserScriptListing = { files: [], enabled: [] };
  private readonly actionList: UserScriptAction[] = [];
  readonly logs: UserScriptLog[] = [];
  /** 読み込めなかったスクリプト（名前 → 理由）。 */
  readonly loadErrors = new Map<string, string>();
  private unsubscribeBus: (() => void) | null = null;
  private loading: Promise<void> = Promise.resolve();
  /** 動いている呼び出しの数（自動操作で終わるのを待つため）。 */
  private busy = 0;
  private idleWaiters: (() => void)[] = [];
  /** 変わったときに知らせる先（スクリプトの管理の窓）。 */
  readonly listeners = new Set<() => void>();

  constructor(private readonly parts: UserScriptHostParts) {
    const { state } = parts;
    state.on("session", () => void this.reload());
    state.on("map", () => {
      const m = state.map;
      if (m) this.emit("mapOpened", { bank: m.id.bank, map: m.id.map, width: m.doc.width, height: m.doc.height });
    });
    state.on("tab", () => this.emit("tabChanged", { tab: state.tab }));
  }

  /** Worker を作っているか。 */
  get active(): boolean {
    return this.worker !== null;
  }

  /** 置き場所のスクリプトと、有効にしているもの。 */
  get listing(): UserScriptListing {
    return this.listingValue;
  }

  /** スクリプトが登録した操作。 */
  get actions(): readonly UserScriptAction[] {
    return this.actionList;
  }

  /** 読み込みを待つ（自動操作用）。 */
  settle(): Promise<void> {
    return this.loading;
  }

  /** 動いている呼び出しが無くなるまで待つ（自動操作用）。 */
  idle(): Promise<void> {
    if (this.busy === 0 && !this.running && !this.batch) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** スクリプトを読み直す（設定 > スクリプトの管理 の「読み直し」と、プロジェクトを開いたとき）。 */
  reload(): Promise<void> {
    this.loading = this.loading.then(() => this.load());
    return this.loading;
  }

  /** Worker を終わらせる（動いているスクリプトも止まる）。 */
  stop(): void {
    const had = this.worker !== null;
    this.worker?.terminate();
    this.worker = null;
    this.unsubscribeBus?.();
    this.unsubscribeBus = null;
    this.batch = null;
    this.running = false;
    this.busy = 0;
    this.actionList.length = 0;
    this.flushIdle();
    if (had) {
      this.parts.state.setStatus(t.stopped);
      // Worker との受け渡しの残り（全マップの配置など）を、落ち着いたら GC で OS へ返す（#429）
      scheduleIdleGc(true);
    }
    this.changed();
  }

  /** マップの上のマウスのマス（タブの絵の上。マスが変わったときだけ知らせる）。 */
  private lastHover = "";
  hover(tab: string, cell: { x: number; y: number } | null): void {
    if (!this.worker) return;
    const key = cell ? `${tab}:${cell.x},${cell.y}` : "";
    if (key === this.lastHover) return;
    this.lastHover = key;
    this.emit("hoverChanged", cell ? { tab, x: cell.x, y: cell.y } : { tab, x: null, y: null });
  }

  /** ツール > スクリプト に並べる項目（`scripts.run.N`。N は 1 から）。 */
  menuItems(): { id: string; label: string; enable: "map" }[] {
    return this.actionList.map((a, i) => ({ id: `scripts.run.${i + 1}`, label: a.label, enable: "map" as const }));
  }

  /** ツール > スクリプト の N 番目（1 から）を動かす。 */
  runNth(n: number): void {
    const a = this.actionList[n - 1];
    if (a) this.runAction(a.id);
  }

  /** 登録した操作を動かす。 */
  runAction(id: string): void {
    if (!this.actionList.some((a) => a.id === id)) return;
    this.send({ type: "action", id });
  }

  private async load(): Promise<void> {
    // 前のプロジェクトのスクリプトに閉じたことを知らせ、少しだけ（1 秒まで）待ってから止める
    if (this.worker) {
      this.emit("projectClosed", {});
      await new Promise((r) => setTimeout(r, 50));
      await Promise.race([this.idle(), new Promise((r) => setTimeout(r, 1000))]);
    }
    this.stop();
    this.loadErrors.clear();
    const session = this.parts.state.session;
    const fs = session?.projectFs();
    if (!session || !fs) {
      this.listingValue = { files: [], enabled: [] };
      this.changed();
      return;
    }
    try {
      this.listingValue = await loadUserScriptListing(fs);
    } catch (e) {
      this.listingValue = { files: [], enabled: [] };
      this.log("error", t.configFailed(errorText(e)));
      this.changed();
      return;
    }
    // 有効なスクリプトが無ければ Worker を作らない（起動の時間とメモリを変えない）
    if (this.listingValue.enabled.length === 0 || this.parts.state.session !== session) {
      this.changed();
      return;
    }
    const worker = this.parts.createWorker();
    worker.onmessage = (e: MessageEvent<WorkerToHost>) => {
      void this.receive(e.data);
      // 頼まれて渡した配置（全マップの getCells など）の写しを、落ち着いたら集める（#429）
      scheduleIdleGc();
    };
    worker.onerror = (e) => this.log("error", e.message);
    this.worker = worker;
    this.unsubscribeBus = session.bus.subscribe((e) => this.onCommand(e));
    for (const name of this.listingValue.enabled) {
      try {
        const code = await invoke<string>("fs_read_text", { path: `${USER_SCRIPT_DIR}/${name}` });
        this.busy++;
        this.send({ type: "load", name, code });
      } catch (e) {
        this.loadErrors.set(name, errorText(e));
      }
    }
    this.emit("projectOpened", { projectDir: session.projectDir });
    if (this.parts.state.map) {
      const m = this.parts.state.map;
      this.emit("mapOpened", { bank: m.id.bank, map: m.id.map, width: m.doc.width, height: m.doc.height });
    }
    this.changed();
  }

  private send(message: HostToWorker): void {
    this.worker?.postMessage(message);
  }

  private emit(event: UserScriptEvent, payload: unknown): void {
    if (!this.worker) return;
    this.send({ type: "event", event, payload });
  }

  /** 操作が実行・取り消し・やり直しされたとき（スクリプトが書いた操作は知らせない）。 */
  private onCommand(e: CommandEvent): void {
    if (this.running || !e.command) return;
    const records = flattenCommandRecords({ name: e.command.name, args: e.command.args });
    for (const r of records) {
      const maps = affectedMaps(r);
      const map = maps[0];
      if (!map) continue;
      if (CELL_COMMANDS.has(r.name)) {
        const cells = Array.isArray(r.args["cells"]) ? (r.args["cells"] as { x: number; y: number }[]).map((c) => ({ x: c.x, y: c.y })) : [];
        if (r.name === "placeBlock" || r.name === "placeMovement") cells.push({ x: Number(r.args["x"]), y: Number(r.args["y"]) });
        this.emit("blocksChanged", { bank: map.bank, map: map.map, cells, kind: e.type });
      } else if (r.name === SHIFT_COMMAND) {
        const sign = e.type === "undo" ? -1 : 1;
        this.emit("mapShifted", { bank: map.bank, map: map.map, dx: sign * Number(r.args["dx"]), dy: sign * Number(r.args["dy"]), kind: e.type });
      } else if (RESIZE_COMMANDS.has(r.name)) {
        const doc = this.parts.state.session?.project.loaded(map);
        this.emit("mapResized", { bank: map.bank, map: map.map, width: doc?.width ?? null, height: doc?.height ?? null, kind: e.type });
      }
    }
  }

  private async receive(m: WorkerToHost): Promise<void> {
    switch (m.type) {
      case "begin": {
        const id = this.parts.state.map?.id ?? null;
        this.batch = { label: m.label, map: id, blocks: new Map(), movements: new Map(), border: new Map() };
        return;
      }
      case "end":
        this.commit();
        this.flushIdleSoon();
        return;
      case "loaded":
        this.busy = Math.max(0, this.busy - 1);
        if (m.error) {
          this.loadErrors.set(m.name, m.error);
          this.log("error", t.loadFailed(m.name, m.error));
        }
        this.changed();
        return;
      case "log":
        this.log(m.level, m.text);
        return;
      case "call": {
        if (!isUserScriptMethod(m.method)) return this.reply(m.id, false, undefined, t.unknownMethod(String(m.method)));
        try {
          const value = await this.call(m.method, Array.isArray(m.args) ? m.args : []);
          this.reply(m.id, true, value);
        } catch (e) {
          this.reply(m.id, false, undefined, errorText(e));
        }
      }
    }
  }

  private reply(id: number, ok: boolean, value?: unknown, error?: string): void {
    this.send(ok ? { type: "reply", id, ok, value } : { type: "reply", id, ok, error: error ?? "" });
  }

  /** ためた書き込みを 1 つの操作にして実行する。 */
  private commit(): void {
    const b = this.batch;
    this.batch = null;
    const session = this.parts.state.session;
    if (!b || !b.map || !session) return;
    const cells = (m: Map<string, number>) =>
      [...m].map(([k, value]) => {
        const [x, y] = k.split(",").map(Number) as [number, number];
        return { x, y, value };
      });
    const commands: Command[] = [];
    const { bank, map } = b.map;
    if (b.blocks.size > 0) commands.push(new PaintBlocksCommand({ bank, map, cells: cells(b.blocks).map((c) => ({ x: c.x, y: c.y, block: c.value })) }));
    if (b.movements.size > 0) commands.push(new PaintMovementCommand({ bank, map, cells: cells(b.movements).map((c) => ({ x: c.x, y: c.y, movement: c.value })) }));
    if (b.border.size > 0) commands.push(new PaintBorderCommand({ bank, map, cells: cells(b.border).map((c) => ({ x: c.x, y: c.y, block: c.value })) }));
    if (commands.length === 0) return;
    this.running = true;
    try {
      session.bus.execute(CommandGroup.of(commands));
      this.parts.state.setStatus(t.applied(b.label));
    } catch (e) {
      this.log("error", t.applyFailed(b.label, errorText(e)));
    } finally {
      this.running = false;
    }
  }

  /** API の答え。 */
  private async call(method: UserScriptMethod, args: readonly unknown[]): Promise<unknown> {
    const state = this.parts.state;
    const session = state.session;
    const batch = this.batch;
    const open = state.map;
    const int = (i: number, name: string): number => {
      const v = args[i];
      if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(t.badArg(method, name));
      return v;
    };
    const mapOf = () => {
      if (!open) throw new Error(t.noMap);
      if (USER_SCRIPT_WRITES.has(method) && batch?.map && (batch.map.bank !== open.id.bank || batch.map.map !== open.id.map)) throw new Error(t.mapChanged);
      return open;
    };
    const cell = () => {
      const m = mapOf();
      const x = int(0, "x");
      const y = int(1, "y");
      if (!m.doc.grid.inBounds(x, y)) throw new Error(t.outOfMap(x, y));
      return { m, x, y, key: `${x},${y}` };
    };
    const needBatch = (): Batch => {
      if (!batch) throw new Error(t.noBatch);
      return batch;
    };
    switch (method) {
      case "map.current":
        return open ? { bank: open.id.bank, map: open.id.map, width: open.doc.width, height: open.doc.height } : null;
      case "map.getBlock": {
        const { m, x, y, key } = cell();
        return batch?.blocks.get(key) ?? m.doc.grid.getBlock(x, y);
      }
      case "map.getMovement": {
        const { m, x, y, key } = cell();
        return batch?.movements.get(key) ?? m.doc.grid.getMovement(x, y);
      }
      case "map.setBlock": {
        const { key } = cell();
        const v = int(2, "block");
        if (v < 0 || v > 0x3ff) throw new Error(t.badArg(method, "block"));
        needBatch().blocks.set(key, v);
        return null;
      }
      case "map.setMovement": {
        const { key } = cell();
        const v = int(2, "movement");
        if (v < 0 || v > 0x3f) throw new Error(t.badArg(method, "movement"));
        needBatch().movements.set(key, v);
        return null;
      }
      case "map.getCells": {
        const m = mapOf();
        const g = m.doc.grid;
        const blocks: number[] = [];
        const movements: number[] = [];
        for (let y = 0; y < g.height; y++)
          for (let x = 0; x < g.width; x++) {
            const k = `${x},${y}`;
            blocks.push(batch?.blocks.get(k) ?? g.getBlock(x, y));
            movements.push(batch?.movements.get(k) ?? g.getMovement(x, y));
          }
        return { width: g.width, height: g.height, blocks, movements };
      }
      case "map.getBorder": {
        const m = mapOf();
        const x = int(0, "x");
        const y = int(1, "y");
        if (!m.doc.border.inBounds(x, y)) throw new Error(t.outOfMap(x, y));
        return batch?.border.get(`${x},${y}`) ?? m.doc.border.getBlock(x, y);
      }
      case "map.setBorder": {
        const m = mapOf();
        const x = int(0, "x");
        const y = int(1, "y");
        const v = int(2, "block");
        if (!m.doc.border.inBounds(x, y) || v < 0 || v > 0x3ff) throw new Error(t.badArg(method, "x, y, block"));
        needBatch().border.set(`${x},${y}`, v);
        return null;
      }
      case "map.getHeader": {
        const h = mapOf().doc.header;
        return JSON.parse(JSON.stringify(h)) as unknown;
      }
      case "map.getTilesets": {
        const d = mapOf().doc;
        return { primary: d.primaryTileset >>> 0, secondary: d.secondaryTileset >>> 0 };
      }
      case "map.fill": {
        const { m, x, y } = cell();
        const b = needBatch();
        const value = int(2, "value");
        const o = (typeof args[3] === "object" && args[3] !== null ? args[3] : {}) as { magic?: unknown; movement?: unknown };
        const movement = o.movement === true;
        if (value < 0 || value > (movement ? 0x3f : 0x3ff)) throw new Error(t.badArg(method, "value"));
        const g = m.doc.grid;
        const source: FillSource = {
          width: g.width,
          height: g.height,
          getBlock: (cx, cy) => b.blocks.get(`${cx},${cy}`) ?? g.getBlock(cx, cy),
          getMovement: (cx, cy) => b.movements.get(`${cx},${cy}`) ?? g.getMovement(cx, cy),
        };
        const match = movement ? "movement" : "block";
        const cells = o.magic === true ? matchingCells(source, x, y, match) : floodRegion(source, x, y, match);
        const target = movement ? b.movements : b.blocks;
        for (const c of cells) target.set(`${c.x},${c.y}`, value);
        return cells.length;
      }
      case "map.shift": {
        const m = mapOf();
        const b = needBatch();
        const dx = int(0, "dx");
        const dy = int(1, "dy");
        const g = m.doc.grid;
        const w = g.width;
        const h = g.height;
        const blocks: number[] = [];
        const movements: number[] = [];
        for (let cy = 0; cy < h; cy++)
          for (let cx = 0; cx < w; cx++) {
            const k = `${cx},${cy}`;
            blocks.push(b.blocks.get(k) ?? g.getBlock(cx, cy));
            movements.push(b.movements.get(k) ?? g.getMovement(cx, cy));
          }
        const sx = ((dx % w) + w) % w;
        const sy = ((dy % h) + h) % h;
        for (let cy = 0; cy < h; cy++)
          for (let cx = 0; cx < w; cx++) {
            const k = `${(cx + sx) % w},${(cy + sy) % h}`;
            b.blocks.set(k, blocks[cy * w + cx]!);
            b.movements.set(k, movements[cy * w + cx]!);
          }
        return null;
      }
      case "maps.list":
        return (session?.catalog.maps ?? []).map((m) => ({ bank: m.id.bank, map: m.id.map, name: m.name }));
      case "maps.getCells": {
        if (!session) throw new Error(t.noMap);
        const doc = await session.project.peek({ bank: int(0, "bank"), map: int(1, "map") });
        if (!doc) throw new Error(t.noSuchMap(Number(args[0]), Number(args[1])));
        const g = doc.grid;
        const blocks: number[] = [];
        const movements: number[] = [];
        for (let y = 0; y < g.height; y++)
          for (let x = 0; x < g.width; x++) {
            blocks.push(g.getBlock(x, y));
            movements.push(g.getMovement(x, y));
          }
        return { width: g.width, height: g.height, blocks, movements };
      }
      case "names.list": {
        const kind = args[0];
        if (kind === "maps") return (session?.catalog.maps ?? []).map((m) => m.name);
        if (kind === "species") {
          const names = session?.speciesNames;
          return Array.from({ length: SPECIES_COUNT }, (_, i) => names?.name(i, session!.project.textCodec) ?? null);
        }
        throw new Error(t.badArg(method, "kind"));
      }
      case "ui.message":
        await messageBox(t.messageTitle, String(args[0] ?? "").slice(0, DIALOG_LIMIT));
        return null;
      case "ui.input":
        return inputDialog(t.messageTitle, String(args[0] ?? "").slice(0, DIALOG_LIMIT), String(args[1] ?? ""));
      case "ui.status":
        state.setStatus(String(args[0] ?? "").slice(0, DIALOG_LIMIT));
        return null;
      case "ui.registerAction": {
        const id = String(args[0]);
        const label = String(args[1] ?? id);
        const at = this.actionList.findIndex((a) => a.id === id);
        if (at >= 0) this.actionList[at] = { id, label };
        else this.actionList.push({ id, label });
        this.changed();
        return null;
      }
      case "view.setGrid":
        this.parts.setGrid(args[0] === true);
        return null;
    }
  }

  private log(level: UserScriptLog["level"], text: string): void {
    this.logs.push({ level, text });
    if (this.logs.length > LOG_LIMIT) this.logs.splice(0, this.logs.length - LOG_LIMIT);
    if (level === "error") this.parts.state.setStatus(t.statusError(text), undefined, true);
    this.changed();
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }

  private flushIdleSoon(): void {
    // 次の呼び出しの begin が来る前に待ちを返さないよう、少しだけ遅らせる
    setTimeout(() => {
      if (!this.batch && this.busy === 0) this.flushIdle();
    }, 30);
  }

  private flushIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
