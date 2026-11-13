import {
  MAP_HEADER_SIZE,
  MAP_LAYOUT_SIZE,
  MAP_NAME_COUNT,
  MAP_NAME_FIRST_ID,
  ROM_BASE,
  TILESET_HEADER_SIZE,
  mapFooterCodec,
  mapHeaderCodec,
  type CfruProject,
  type MapId,
} from "@zigzagumap/core";

/** マップ一覧に出す 1 マップ分の情報。 */
export interface MapInfo {
  readonly id: MapId;
  /** 地名番号。 */
  readonly region: number;
  /** マップ名（地名番号から引いた名前。無ければ null）。 */
  readonly name: string | null;
  /** タイルセット 1・2 の番号（AdvanceMap と同じ数え方。数えられなければ -1）。 */
  readonly primaryNumber: number;
  readonly secondaryNumber: number;
}

/**
 * プロジェクトの全マップの、一覧用の情報（名前・タイルセット番号）。
 * マップ本体は読まず、ヘッダーとフッターだけを ROM から読むので速い。
 * ベース ROM に無いマップ（maps\ の JSON だけにあるもの）は JSON を読んで調べる。
 */
export class MapCatalog {
  private constructor(
    readonly maps: readonly MapInfo[],
    /** 地名番号 0x58〜 の順のマップ名（名前表の順）。 */
    readonly regionNames: readonly (readonly [number, string])[],
  ) {}

  /** プロジェクトから作る。 */
  static async build(project: CfruProject): Promise<MapCatalog> {
    const rom = project.rom;
    const names = new Map<number, string | null>();
    const nameOf = (region: number): string | null => {
      if (!names.has(region)) {
        let name: string | null = null;
        try {
          name = project.base.nameTable.name(region);
        } catch {
          name = null;
        }
        names.set(region, name);
      }
      return names.get(region)!;
    };

    const raw: { id: MapId; region: number; primary: number; secondary: number }[] = [];
    for (const id of project.mapIds()) {
      try {
        if (project.inBase(id) && !project.hasJson(id)) {
          const header = mapHeaderCodec.decode(rom.slice(project.base.bankTable.headerOffset(id), MAP_HEADER_SIZE));
          const footer = mapFooterCodec.decode(rom.slice(header.layout - ROM_BASE, MAP_LAYOUT_SIZE));
          raw.push({ id, region: header.regionMapSectionId, primary: footer.primaryTileset, secondary: footer.secondaryTileset });
        } else {
          const doc = await project.load(id);
          raw.push({ id, region: doc.header.regionMapSectionId, primary: doc.primaryTileset, secondary: doc.secondaryTileset });
        }
      } catch {
        raw.push({ id, region: -1, primary: 0, secondary: 0 });
      }
    }

    // タイルセットの番号は、FR のタイルセットヘッダー表（24 バイトずつ並ぶ）の先頭からの番目。
    const pointers = raw.flatMap((r) => [r.primary, r.secondary]).filter((p) => rom.isPointer(p));
    const first = pointers.length > 0 ? Math.min(...pointers) : 0;
    const numberOf = (p: number): number => {
      const d = p - first;
      return rom.isPointer(p) && d >= 0 && d % TILESET_HEADER_SIZE === 0 ? d / TILESET_HEADER_SIZE : -1;
    };

    const maps = raw.map((r) => ({
      id: r.id,
      region: r.region,
      name: r.region >= 0 ? nameOf(r.region) : null,
      primaryNumber: numberOf(r.primary),
      secondaryNumber: numberOf(r.secondary),
    }));
    const regionNames: [number, string][] = [];
    for (let i = 0; i < MAP_NAME_COUNT; i++) {
      const name = nameOf(MAP_NAME_FIRST_ID + i);
      if (name !== null) regionNames.push([MAP_NAME_FIRST_ID + i, name]);
    }
    return new MapCatalog(maps, regionNames);
  }

  private index: Map<string, MapInfo> | null = null;

  /** マップの情報。無ければ undefined。 */
  get(id: MapId): MapInfo | undefined {
    this.index ??= new Map(this.maps.map((m) => [`${m.id.bank}.${m.id.map}`, m]));
    return this.index.get(`${id.bank}.${id.map}`);
  }

  /** そのマップがあるか。 */
  has(id: MapId): boolean {
    return this.get(id) !== undefined;
  }
}
