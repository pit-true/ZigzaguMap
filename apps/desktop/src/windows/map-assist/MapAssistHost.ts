import { emitTo, listen } from "@tauri-apps/api/event";
import { BLOCK_PIXELS, createImage, encodeBase64, type AutoPenPart, type PenSource } from "@zigzagumap/core";
import type { App } from "../../app/App";
import type { TilesetView } from "../../app/TilesetView";
import { readFile } from "../../app/FileDialogs";
import { jaAssist as t } from "../../i18n/ja.assist";
import type { FillCell } from "../../input/paintPlans";
import { errorText } from "../../util/errors";
import { scheduleIdleGc } from "../../util/idleGc";
import { closeToolWindow, onToolWindowClosed, openToolWindow } from "../toolWindowCommands";
import {
  MAP_ASSIST_MESSAGE_EVENT,
  MAP_ASSIST_REQUEST_EVENT,
  MAP_ASSIST_SIZE,
  MAP_ASSIST_WINDOW,
  type AssistData,
  type AssistImage,
  type AssistMessage,
  type AssistRange,
  type AssistRequest,
  type TidyOptions,
} from "./protocol";

/** パレットの 1 行のブロック数。 */
const PALETTE_WIDTH = 8;

/** パレットに並ぶブロックのうち、3 層の次の番号。 */
function tripleChildrenOf(tiles: TilesetView): number[] {
  const out: number[] = [];
  for (let b = 0; b < tiles.paletteBlockCount; b++) if (tiles.triple.isTripleChild(b)) out.push(b);
  return out;
}

/**
 * メインウィンドウ側の、マップ作成補助（#312）の窓口。ツール > マップ作成補助 を初めて選んだときに読み込む。
 * - パーツの読み書きは AutoPenService（maps\autopen）。保存はすぐファイルに書き、元に戻すの対象にしない（スタンプと同じ）。
 *   窓で編集中の一覧も AutoPenService に預け（#379）、窓へはそれを送る。窓を閉じたら捨てる。
 * - 範囲を塗る・整えるは、メインの描く道具で 1 回の操作として書く（メインの Ctrl+Z 1 回で戻る）。
 * - タイルセットの組・パーツ・選んでいる範囲が変わったら、開いているウィンドウへ送り直す。
 */
export class MapAssistHost {
  private static current: Promise<MapAssistHost> | null = null;

  /** 窓口（初めて呼ばれたときに作る）。 */
  static get(app: App): Promise<MapAssistHost> {
    return (MapAssistHost.current ??= (async () => {
      const host = new MapAssistHost(app);
      await host.start();
      return host;
    })());
  }

  private open = false;
  private queued = false;
  /** 受け取った窓の編集のいちばん新しい番号（窓を開くたびに 0 から）。 */
  private seq = 0;

  private constructor(private readonly app: App) {}

  private async start(): Promise<void> {
    await listen<AssistRequest>(MAP_ASSIST_REQUEST_EVENT, (e) => void this.onRequest(e.payload));
    await onToolWindowClosed((label) => {
      if (label !== MAP_ASSIST_WINDOW) return;
      this.open = false;
      // 保存していない編集は捨てる（今までどおり、閉じると取り消し）
      this.app.pen.autopen.discardDrafts();
      this.seq = 0;
      // 送った画像の文字列などのごみを片付け、空いた領域も OS へ返す
      scheduleIdleGc(true);
    });
    const state = this.app.state;
    state.on("session", () => this.close());
    state.on("map", () => (state.map ? this.queueData() : this.close()));
    state.on("tiles", () => this.queueData());
    state.on("stamp", () => void this.send({ type: "range", range: this.range() }));
    this.app.pen.autopen.onChange(() => this.queueData());
  }

  /** ウィンドウを開く（開いていれば前に出す）。 */
  async show(): Promise<void> {
    if (!this.app.state.map) return;
    this.open = true;
    try {
      await openToolWindow(MAP_ASSIST_WINDOW, t.title, MAP_ASSIST_SIZE, { minWidth: 760, minHeight: 420 });
    } catch (e) {
      this.open = false;
      throw e;
    }
  }

  private close(): void {
    if (this.open) void closeToolWindow(MAP_ASSIST_WINDOW);
    this.open = false;
  }

  private queueData(): void {
    if (!this.open || this.queued) return;
    this.queued = true;
    setTimeout(() => {
      this.queued = false;
      const data = this.data();
      if (data) void this.send({ type: "data", data });
    }, 0);
  }

  private async send(message: AssistMessage): Promise<void> {
    if (!this.open) return;
    await emitTo(MAP_ASSIST_WINDOW, MAP_ASSIST_MESSAGE_EVENT, message).catch(() => undefined);
  }

  private async onRequest(req: AssistRequest): Promise<void> {
    this.open = true;
    try {
      const result = await this.handle(req);
      await this.send({ type: "reply", id: req.id, ok: true, result });
      scheduleIdleGc(true);
    } catch (e) {
      await this.send({ type: "reply", id: req.id, ok: false, error: errorText(e) });
    }
  }

  private async handle(req: AssistRequest): Promise<unknown> {
    const service = this.app.pen.autopen;
    switch (req.op) {
      case "hello":
        this.seq = 0;
        await service.ready();
        return this.data();
      case "mapImage":
        return this.mapImage();
      case "draft":
        // 届く順が入れ替わっても、古い編集で上書きしない
        if (req.seq > this.seq) {
          this.seq = req.seq;
          service.setDraft(req.parts);
        }
        return null;
      case "save":
        this.seq = Math.max(this.seq, req.seq);
        return { written: await service.saveDraft(req.parts) };
      case "analyze": {
        const added = await service.addCandidates();
        return { added: added.length, data: this.data() };
      }
      case "importBochi":
        return this.importBochi();
      case "fill":
        return { count: this.fill(req.part) };
      case "tidy":
        return { count: this.tidy(req.options) };
      case "undo":
        this.app.undo();
        return null;
    }
  }

  /** 今のマップの組のこと（マップが無ければ null）。 */
  private data(): AssistData | null {
    const map = this.app.state.map;
    const set = this.app.pen.autopen.set;
    if (!map) return null;
    const lib = this.app.pen.autopen.lib;
    const tiles = map.tiles;
    const image = tiles.paletteImage(PALETTE_WIDTH);
    return {
      key: tiles.key,
      mapName: map.doc.mapNameText() ?? `${map.id.bank}.${map.id.map}`,
      palette: { width: image.width, height: image.height, rgba: encodeBase64(new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength)) },
      secondaryCount: tiles.secondaryCount,
      tripleChildren: tripleChildrenOf(tiles),
      map: { width: map.doc.width, height: map.doc.height, cells: [...map.doc.grid.cells] },
      parts: this.app.pen.autopen.editing,
      unsaved: set ? this.app.pen.autopen.draft !== null || set.candidates || (lib?.usesDefaults(set.primary) ?? false) : false,
      seq: this.seq,
      range: this.range(),
    };
  }

  /** マップの画像（ブロックだけ）。 */
  private mapImage(): AssistImage {
    const map = this.app.state.map;
    if (!map) throw new Error(t.noMap);
    const { width, height } = map.doc;
    const image = createImage(width * BLOCK_PIXELS, height * BLOCK_PIXELS);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) map.tiles.renderer.blit(map.doc.grid.getBlock(x, y), image.data, image.width, x * BLOCK_PIXELS, y * BLOCK_PIXELS);
    }
    return { width: image.width, height: image.height, rgba: encodeBase64(new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength)) };
  }

  /** メインで選んでいる範囲（今のマップのものだけ）。 */
  private range(): AssistRange | null {
    const pick = this.app.pen.mapTab.painter.lastPick;
    const map = this.app.state.map;
    if (!pick || !map || pick.id.bank !== map.id.bank || pick.id.map !== map.id.map) return null;
    return { x: pick.x, y: pick.y, width: pick.width, height: pick.height };
  }

  private rangeCells(): [number, number][] {
    const r = this.range();
    if (!r) throw new Error(t.noRange);
    const out: [number, number][] = [];
    for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) out.push([x, y]);
    return out;
  }

  private source(): PenSource {
    const painter = this.app.pen.mapTab.painter;
    return { get: (x, y) => painter.writer.cellValue({ x, y }) };
  }

  /** 選んだパーツで範囲を塗る（自動ペンと同じ処理。1 回の操作）。書いたマスの数。 */
  private fill(part: AutoPenPart): number {
    const set = this.app.pen.autopen.set;
    if (!set) throw new Error(t.noMap);
    const writes = set.planner.fillWith(this.source(), part, this.rangeCells());
    return this.write(this.app.pen.tool.withMovements(writes));
  }

  /** 範囲を整える（1 回の操作）。書いたマスの数。 */
  private tidy(options: TidyOptions): number {
    const set = this.app.pen.autopen.set;
    if (!set) throw new Error(t.noMap);
    const cells = this.rangeCells();
    const src = this.source();
    const writes = new Map<string, FillCell>();
    const planned = set.planner.tidy(src, cells, options);
    // 移動許可は窓の「移動エリアを付ける」で決める（外していればブロックだけ書き、移動許可は今のまま。#336）
    const blocks = options.movement ? this.app.pen.tool.withMovements(planned) : planned.map((w): FillCell => ({ x: w.x, y: w.y, block: w.block }));
    for (const w of blocks) writes.set(`${w.x},${w.y}`, w);
    if (options.movement) {
      // 移動エリアを付ける: パーツのブロックのマスに、パーツの値か使用回数でいちばん多い移動許可を書く
      const usage = this.app.extras.blockUsage.ready;
      const map = this.app.state.map!;
      for (const [x, y] of cells) {
        const k = `${x},${y}`;
        const cur = src.get(x, y);
        if (cur === null) continue;
        const block = writes.get(k)?.block ?? cur & 0x3ff;
        const place = set.index.get(block);
        if (!place) continue;
        const g = place.part.slots[place.slot];
        let m = g?.cells[place.y * g.width + place.x]?.movement ?? null;
        if (m === null && usage) m = usage.mostMovement(block, map.doc.primaryTileset, map.doc.secondaryTileset);
        if (m === null || (writes.get(k)?.movement ?? cur >> 10) === m) continue;
        writes.set(k, { x, y, block, movement: m });
      }
    }
    // 移動許可を書くマスと書かないマスが混ざるときは、書かないマスに今の値を入れて 1 回にまとめる
    const list = [...writes.values()].map((w) => (w.movement === undefined ? { ...w, movement: (src.get(w.x, w.y) ?? 0) >> 10 } : w));
    return this.write(list);
  }

  private write(list: readonly FillCell[]): number {
    if (list.length === 0) return 0;
    this.app.pen.mapTab.painter.writer.writeCells(list, false, true);
    return list.length;
  }

  /** Bochi の mapassist\*.txt を選んで取り込む。 */
  private async importBochi(): Promise<unknown> {
    const path = await this.app.files.openFile({ title: t.importTitle, filters: [{ name: t.importFilter, extensions: ["txt"] }] });
    if (!path) return null;
    const text = new TextDecoder("utf-8").decode(await readFile(path));
    const r = await this.app.pen.autopen.importBochi([text]);
    // 返事に今の一覧も入れる（窓で編集中なら、読み込んだものを足した一覧。#379）
    return { parts: r.parts, matched: r.matched, data: this.data() };
  }
}
