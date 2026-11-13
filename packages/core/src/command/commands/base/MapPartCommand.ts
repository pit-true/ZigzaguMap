import type { MapConnection } from "../../../connection/types.js";
import type { MapEvents } from "../../../event/types.js";
import type { BlockGrid } from "../../../map/BlockGrid.js";
import type { MapHeaderFields } from "../../../map/MapHeaderCodec.js";
import type { MapId } from "../../../map/types.js";
import type { MapScriptEntry } from "../../../mapscript/types.js";
import type { ItemBall, MapDocument } from "../../../model/MapDocument.js";
import { cloneConnections, cloneEvents, cloneItemBalls, cloneMapScripts, cloneWild } from "../../../model/clone.js";
import type { WildEncounters } from "../../../wild/types.js";
import type { JsonObject } from "../../Command.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { SnapshotCommand } from "./SnapshotCommand.js";

/** マップ 1 枚を対象にするコマンドの引数（bank と map を必ず持つ）。 */
export type MapArgs = JsonObject & { bank: number; map: number };

/**
 * マップの一部分を控えて戻すコマンドの土台。派生クラスは `apply(doc, context)` だけを書く。
 * `S` は控えの型、`part` でどの部分を控えるかを決める。
 */
abstract class MapPartCommand<A extends MapArgs, S> extends SnapshotCommand<A, S> {
  /** 対象のマップ。 */
  get mapId(): MapId {
    return { bank: this.args.bank, map: this.args.map };
  }

  protected capture(context: DocumentContext): S {
    return this.take(context.document(this.mapId));
  }

  protected apply(context: DocumentContext): void {
    this.edit(context.document(this.mapId), context);
  }

  protected restore(context: DocumentContext, saved: S): void {
    this.put(context.document(this.mapId), saved);
  }

  /** 控えを取る。 */
  protected abstract take(doc: MapDocument): S;
  /** 控えを書き戻す。 */
  protected abstract put(doc: MapDocument, saved: S): void;
  /** 変える（入力の確認を先に行う）。 */
  protected abstract edit(doc: MapDocument, context: DocumentContext): void;
}

/** イベントの控え（落とし物は人の番号を持つので一緒に控える）。 */
export interface EventsSnapshot {
  events: MapEvents | null;
  itemBalls: ItemBall[];
}

/** イベント（と落とし物）を変えるコマンドの土台。 */
export abstract class EventsCommand<A extends MapArgs> extends MapPartCommand<A, EventsSnapshot> {
  protected take(doc: MapDocument): EventsSnapshot {
    return { events: cloneEvents(doc.events), itemBalls: cloneItemBalls(doc.itemBalls) };
  }

  protected put(doc: MapDocument, saved: EventsSnapshot): void {
    doc.events = cloneEvents(saved.events);
    doc.itemBalls = cloneItemBalls(saved.itemBalls);
  }
}

/** ヘッダーの控え（地名番号を変えると名前も変わるので一緒に控える）。 */
export interface HeaderSnapshot {
  header: MapHeaderFields;
  mapName: Uint8Array | null;
}

/** ヘッダーを変えるコマンドの土台。 */
export abstract class HeaderCommand<A extends MapArgs> extends MapPartCommand<A, HeaderSnapshot> {
  protected take(doc: MapDocument): HeaderSnapshot {
    return { header: { ...doc.header }, mapName: doc.mapName ? doc.mapName.slice() : null };
  }

  protected put(doc: MapDocument, saved: HeaderSnapshot): void {
    doc.header = { ...saved.header };
    doc.mapName = saved.mapName ? saved.mapName.slice() : null;
  }
}

/** マップスクリプトを変えるコマンドの土台。 */
export abstract class MapScriptsCommand<A extends MapArgs> extends MapPartCommand<A, MapScriptEntry[] | null> {
  protected take(doc: MapDocument): MapScriptEntry[] | null {
    return cloneMapScripts(doc.mapScripts);
  }

  protected put(doc: MapDocument, saved: MapScriptEntry[] | null): void {
    doc.mapScripts = cloneMapScripts(saved);
  }
}

/** 接続を変えるコマンドの土台。 */
export abstract class ConnectionsCommand<A extends MapArgs> extends MapPartCommand<A, MapConnection[] | null> {
  protected take(doc: MapDocument): MapConnection[] | null {
    return cloneConnections(doc.connections);
  }

  protected put(doc: MapDocument, saved: MapConnection[] | null): void {
    doc.connections = cloneConnections(saved);
  }
}

/** 野生を変えるコマンドの土台。 */
export abstract class WildCommand<A extends MapArgs> extends MapPartCommand<A, WildEncounters[]> {
  protected take(doc: MapDocument): WildEncounters[] {
    return cloneWild(doc.wild);
  }

  protected put(doc: MapDocument, saved: WildEncounters[]): void {
    doc.wild = cloneWild(saved);
  }
}

/** 配置・ボーダー・タイルセットの参照の控え（配置は差し替えるので元の物をそのまま持つ）。 */
export interface LayoutSnapshot {
  grid: BlockGrid;
  border: BlockGrid;
  footerPadding: number;
  primaryTileset: number;
  secondaryTileset: number;
}

/** 配置の大きさ・ボーダー・タイルセットの参照を変えるコマンドの土台。配置は新しい BlockGrid に差し替えること。 */
export abstract class LayoutCommand<A extends MapArgs> extends MapPartCommand<A, LayoutSnapshot> {
  protected take(doc: MapDocument): LayoutSnapshot {
    const { grid, border, footerPadding, primaryTileset, secondaryTileset } = doc;
    return { grid, border, footerPadding, primaryTileset, secondaryTileset };
  }

  protected put(doc: MapDocument, saved: LayoutSnapshot): void {
    Object.assign(doc, saved);
  }
}
