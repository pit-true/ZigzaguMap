import { MAPSEC_NONE, type RegionMapDocument, type TownLinkRect, type TownLinks } from "@zigzagumap/core";

/** 枠をどこから出したか（`map` = マップ単位の紐づけ、`section` = 地名の紐づけ、`rom` = ROM のデータ）。 */
export type TownFrameSource = "map" | "section" | "rom";

/** 今のマップの位置（面とマス）と、どこから出したか。 */
export interface TownFrame {
  readonly rect: TownLinkRect;
  readonly source: TownFrameSource;
}

/**
 * マップのタウンマップの上の位置（面は問わない）。マップ単位の紐づけ → 地名の紐づけ → ROM のデータ の順に引き、
 * どれにも無ければ null（#386）。タウンマップの小窓とミニマップ（#511）が使う。
 * `mapKey` は townMapKey(バンク, マップ)、`region` はマップの地名（無い・「無し」なら null として扱う）。
 */
export function findTownFrame(links: TownLinks, mapKey: string | null, region: number | null, doc: RegionMapDocument | null): TownFrame | null {
  const byMap = mapKey !== null ? links.maps.get(mapKey) : undefined;
  if (byMap) return { rect: byMap, source: "map" };
  if (region === null || region === MAPSEC_NONE) return null;
  const bySection = links.sections.get(region);
  if (bySection) return { rect: bySection, source: "section" };
  const at = doc?.find(region);
  if (!doc || !at) return null;
  const s = doc.section(region);
  const size = s && s.width > 0 && s.height > 0 ? { x: s.x, y: s.y, width: s.width, height: s.height } : { x: at.x, y: at.y, width: 1, height: 1 };
  return { rect: { page: at.page, ...size }, source: "rom" };
}
