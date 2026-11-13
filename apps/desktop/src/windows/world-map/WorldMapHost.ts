import { emitTo, listen } from "@tauri-apps/api/event";
import { EditError, EditErrorCode, MAPSEC_FIRST, MAPSEC_NAMED_COUNT, type MapId } from "@zigzagumap/core";
import { jaWorldMap } from "../../i18n/ja.worldMap";
import type { ProjectSession } from "../../app/ProjectSession";
import {
  WORLD_MAP_WINDOW,
  WorldMapEvents,
  type WorldMapCurrent,
  type WorldMapEnvelope,
  type WorldMapInit,
  type WorldMapReply,
  type WorldMapRequest,
  type WorldMapState,
} from "./protocol";

/** ホストが使うメインウィンドウの操作。 */
export interface WorldMapHostTarget {
  /** 開いている ROM（無ければ null）。 */
  session(): ProjectSession | null;
  /** 開いているマップ（無ければ null）。 */
  currentMap(): { readonly id: MapId; readonly section: number } | null;
  /** マップを開く。 */
  openMap(id: MapId): Promise<void>;
  /** 出力（Ctrl+S）。 */
  exportMaps(): Promise<unknown>;
}

/**
 * メインウィンドウ側のワールドマップエディターの受け手。タウンマップの読み込み・コマンドの実行・アンドゥ・出力を
 * メインの ProjectSession で行い、変わったらエディターのウィンドウへ知らせる。
 */
export class WorldMapHost {
  private unsubscribeBus: (() => void) | null = null;

  constructor(private readonly target: WorldMapHostTarget) {}

  /** 要求の購読を始める。 */
  async start(): Promise<void> {
    await listen<WorldMapEnvelope>(WorldMapEvents.request, (e) => void this.handle(e.payload));
  }

  /** ROM を開き直したとき（エディターに読み直させる）。 */
  sessionChanged(): void {
    this.unsubscribeBus?.();
    this.unsubscribeBus = null;
    void emitTo(WORLD_MAP_WINDOW, WorldMapEvents.reset, null).catch(() => undefined);
  }

  /** メインで開いているマップが変わったとき。 */
  mapChanged(): void {
    void emitTo(WORLD_MAP_WINDOW, WorldMapEvents.current, this.current()).catch(() => undefined);
  }

  private async handle(envelope: WorldMapEnvelope): Promise<void> {
    let reply: WorldMapReply;
    try {
      reply = { id: envelope.id, ok: true, result: (await this.run(envelope.request)) ?? null };
    } catch (e) {
      reply = { id: envelope.id, ok: false, error: errorText(e) };
    }
    await emitTo(WORLD_MAP_WINDOW, WorldMapEvents.reply, reply).catch(() => undefined);
  }

  private async run(request: WorldMapRequest): Promise<unknown> {
    const session = this.target.session();
    if (!session) throw new Error(jaWorldMap.noRom);
    switch (request.type) {
      case "load":
        return this.load(session);
      case "command":
        session.bus.execute(session.registry.create(request.record));
        return null;
      case "undo":
        return session.bus.undo();
      case "redo":
        return session.bus.redo();
      case "export":
        return this.target.exportMaps();
      case "openMap": {
        const id = { bank: request.bank, map: request.map };
        if (!session.catalog.has(id)) throw new Error(jaWorldMap.mapNotFound(id.bank, id.map));
        await this.target.openMap(id);
        return null;
      }
    }
  }

  private async load(session: ProjectSession): Promise<WorldMapInit> {
    let region;
    try {
      region = await session.openRegionMap();
    } catch (e) {
      throw new Error(jaWorldMap.loadFailed(e instanceof Error ? e.message : String(e)));
    }
    if (!this.unsubscribeBus) {
      // 操作のたびに状態を送る（表は数 KB なので全部送る）。
      this.unsubscribeBus = session.bus.subscribe(() => void emitTo(WORLD_MAP_WINDOW, WorldMapEvents.state, this.state(session)).catch(() => undefined));
    }
    return {
      ...this.state(session),
      graphics: region.graphics.data,
      nameOffsets: [...region.addresses.nameStrings],
      current: this.current(),
    };
  }

  private state(session: ProjectSession): WorldMapState {
    const region = session.regionMap!;
    const ctx = session.project.editorContext();
    const names: (string | null)[] = [];
    for (let i = 0; i < MAPSEC_NAMED_COUNT; i++) {
      const raw = ctx.mapName(MAPSEC_FIRST + i);
      names.push(raw ? session.project.textCodec.decode(raw) : null);
    }
    return { snapshot: region.document.snapshot(), names, canUndo: session.bus.canUndo, canRedo: session.bus.canRedo };
  }

  private current(): WorldMapCurrent | null {
    const c = this.target.currentMap();
    return c ? { bank: c.id.bank, map: c.id.map, section: c.section } : null;
  }
}

/** エラーを文言にする（EditError は種類ごとの文言）。 */
function errorText(e: unknown): string {
  if (e instanceof EditError) {
    const p = e.params;
    switch (e.code) {
      case EditErrorCode.InvalidInteger:
        return jaWorldMap.invalidInteger(String(p["text"]));
      case EditErrorCode.ValueOutOfRange:
        return jaWorldMap.outOfRange(String(p["field"]), Number(p["value"]), Number(p["min"]), Number(p["max"]));
      case EditErrorCode.MapNameInvalidChar:
        return jaWorldMap.mapNameInvalidChar(String(p["char"]));
      case EditErrorCode.MapNameTooLong:
        return jaWorldMap.mapNameTooLong(Number(p["length"]), Number(p["max"]));
      case EditErrorCode.NoMapName:
        return jaWorldMap.cannotSaveTopPosition;
    }
  }
  return e instanceof Error ? e.message : String(e);
}
