import type { MapHeaderFields } from "../../../map/MapHeaderCodec.js";
import type { MapId } from "../../../map/types.js";
import { MapDocument } from "../../../model/MapDocument.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { EditError, EditErrorCode } from "../../EditError.js";

/** 写す部分（番号・野生・落とし物以外の全部）。 */
export interface MapContent {
  header: MapHeaderFields;
  grid: MapDocument["grid"];
  border: MapDocument["border"];
  footerPadding: number;
  primaryTileset: number;
  secondaryTileset: number;
  mapName: Uint8Array | null;
  events: MapDocument["events"];
  connections: MapDocument["connections"];
  mapScripts: MapDocument["mapScripts"];
}

/**
 * マップの中身の写し（AdvanceMap のマップの追加/挿入が写すもの: ヘッダー、配置、ボーダー、タイルセット、イベント、接続、マップスクリプト）。
 * 野生は写さない（AdvanceMap の野生の表はバンク・マップの番号で引くので、写し先の野生がそのまま残る）。
 * 落とし物（Bochi の ItemBalls）は HiddenItem.s のラベルが重なるので写さない。
 */
export function mapContent(doc: MapDocument): MapContent {
  const copy = doc.clone();
  return {
    header: copy.header,
    grid: copy.grid,
    border: copy.border,
    footerPadding: copy.footerPadding,
    primaryTileset: copy.primaryTileset,
    secondaryTileset: copy.secondaryTileset,
    mapName: copy.mapName,
    events: copy.events,
    connections: copy.connections,
    mapScripts: copy.mapScripts,
  };
}

/** 写し元のマップ（読み込み済みであること）。無ければ EditError（mapNotFound）。 */
export function sourceDocument(ctx: DocumentContext, id: MapId): MapDocument {
  if (!ctx.hasMap(id)) throw new EditError(EditErrorCode.MapNotFound, { bank: id.bank, map: id.map });
  return ctx.document(id);
}

/** 新規マップ・作業用のマップのヘッダーの元（指定が無ければ全部 0）。 */
export function templateHeader(ctx: DocumentContext, bank: number | undefined, map: number | undefined): MapHeaderFields {
  if (bank !== undefined && map !== undefined) return { ...sourceDocument(ctx, { bank, map }).header };
  return { music: 0, layoutId: 0, regionMapSectionId: 0, cave: 0, weather: 0, mapType: 0, bikingAllowed: 0, flags: 0, floorNum: 0, battleType: 0 };
}
