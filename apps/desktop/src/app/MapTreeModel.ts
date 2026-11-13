import type { MapId } from "@zigzagumap/core";
import { ja } from "../i18n/ja";
import { FR_INI_GROUPS, FR_INI_NAMES } from "./data/frIni";
import { FR_TILESET_GROUPS, FR_TILESET_PLAIN_GROUP, tilesetGroupOf } from "./data/frTilesets";
import type { MapCatalog, MapInfo } from "./MapCatalog";
import type { MapListSource } from "./Settings";

/** マップ一覧の 1 項目。`mapId` があればマップ、`children` があればグループ。 */
export interface TreeNode {
  /** 展開状態などを覚えるための一意な鍵。 */
  readonly key: string;
  readonly label: string;
  readonly mapId?: MapId;
  readonly children?: readonly TreeNode[];
}

/** 並べ替えの種類（設定 > マップの表示設定 > ヘッダーのソート の順）。 */
export const SORT_BY_BANK = 0;
export const SORT_BY_NAME = 1;
export const SORT_BY_TILESET = 2;
export const SORT_BY_TILESET_GROUP = 3;
export const SORT_BY_NAME_AND_TILESET = 4;

/** 根の鍵。マップを開いたときは「ヘッダー」の下を展開する。 */
export const HEADER_ROOT_KEY = "h";

/**
 * マップ一覧を作る。根は AdvanceMap と同じく「ヘッダー」「iniファイル」「マップファイル」の 3 つ。
 * 「ヘッダー」の下は並べ替えの種類でグループを作る。
 * 設定 > マップの表示設定 で「マップヘッダー」なら「ヘッダー」だけ、「INIの表示」なら「iniファイル」だけを出す。
 */
export function buildMapTree(catalog: MapCatalog, sortMode: number, source: MapListSource = "both"): TreeNode[] {
  const header: TreeNode = { key: HEADER_ROOT_KEY, label: ja.rootHeader, children: headerGroups(catalog, sortMode) };
  if (source === "header") return [header];
  const ini: TreeNode = { key: "i", label: ja.rootIni, children: iniGroups(catalog) };
  if (source === "ini") return [ini];
  return [header, ini, { key: "f", label: ja.rootMapFiles, children: [] }];
}

function headerGroups(catalog: MapCatalog, sortMode: number): TreeNode[] {
  const maps = catalog.maps;
  switch (sortMode) {
    case SORT_BY_BANK: {
      const banks = new Map<number, MapInfo[]>();
      for (const m of maps) push(banks, m.id.bank, m);
      return [...banks.entries()]
        .sort(([a], [b]) => a - b)
        .map(([bank, list]) => group(`h/b${bank}`, String(bank), list, () => ""));
    }
    case SORT_BY_TILESET: {
      const byNumber = new Map<number, MapInfo[]>();
      let max = 0;
      for (const m of maps) {
        push(byNumber, m.secondaryNumber, m);
        max = Math.max(max, m.secondaryNumber);
      }
      const out: TreeNode[] = [];
      for (let n = 0; n <= max; n++) out.push(group(`h/t${n}`, ja.tilesetGroup(n), byNumber.get(n) ?? [], () => ""));
      const unknown = byNumber.get(-1);
      if (unknown) out.push(group("h/t?", ja.tilesetGroup(-1), unknown, () => ""));
      return out;
    }
    case SORT_BY_TILESET_GROUP: {
      const byGroup = new Map<string, MapInfo[]>();
      for (const m of maps) push(byGroup, tilesetGroupOf(m.primaryNumber, m.secondaryNumber) ?? "", m);
      const names = [...FR_TILESET_GROUPS.map(([name]) => name), ""];
      return names.map((name, i) => group(`h/g${i}`, name, byGroup.get(name) ?? [], () => ""));
    }
    case SORT_BY_NAME:
    case SORT_BY_NAME_AND_TILESET:
    default: {
      const withSuffix = sortMode !== SORT_BY_NAME;
      const byRegion = new Map<number, MapInfo[]>();
      for (const m of maps) push(byRegion, m.region, m);
      const out = catalog.regionNames.map(([region, name]) =>
        group(`h/r${region}`, name, byRegion.get(region) ?? [], (m) => (withSuffix ? suffixOf(m) : "")),
      );
      // 名前表の範囲外の地名番号のマップは最後にまとめる。
      const known = new Set(catalog.regionNames.map(([r]) => r));
      const rest = maps.filter((m) => !known.has(m.region));
      if (rest.length > 0) out.push(group("h/r?", ja.noName, rest, (m) => (withSuffix ? suffixOf(m) : "")));
      return out;
    }
  }
}

/**
 * コンボボックス表示のグループ（AdvanceMap と同じく ini のグループ名。ini に無いマップは最後の「名称なし」にまとめる）。
 * 各マップの文字列はヘッダーのマップ名。
 */
export function comboGroups(catalog: MapCatalog): TreeNode[] {
  const listed = new Set<string>();
  const out = FR_INI_GROUPS.flatMap(([name, ids], i): TreeNode[] => {
    const children = ids.flatMap((text): TreeNode[] => {
      const info = catalog.get(parseId(text));
      if (!info) return [];
      listed.add(text);
      return [{ key: `c/${i}/${text}`, label: ja.mapItem(info.name ?? ja.noName, "", info.id.bank, info.id.map), mapId: info.id }];
    });
    return children.length > 0 ? [{ key: `c/${i}`, label: name, children }] : [];
  });
  const rest = catalog.maps.filter((m) => !listed.has(`${m.id.bank}.${m.id.map}`));
  if (rest.length > 0) out.push(group("c/rest", ja.noName, rest, () => ""));
  return out;
}

function parseId(text: string): MapId {
  const [bank, map] = text.split(".").map(Number) as [number, number];
  return { bank, map };
}

function iniGroups(catalog: MapCatalog): TreeNode[] {
  return FR_INI_GROUPS.map(([name, ids], i) => ({
    key: `i/${i}`,
    label: name,
    children: ids.flatMap((text) => {
      const [bank, map] = text.split(".").map(Number) as [number, number];
      const id = { bank, map };
      if (!catalog.has(id)) return [];
      return [{ key: `i/${i}/${text}`, label: ja.mapItem(FR_INI_NAMES[text] ?? ja.noName, "", bank, map), mapId: id }];
    }),
  }));
}

function group(key: string, label: string, list: readonly MapInfo[], suffix: (m: MapInfo) => string): TreeNode {
  const sorted = [...list].sort((a, b) => a.id.bank - b.id.bank || a.id.map - b.id.map);
  return {
    key,
    label,
    children: sorted.map((m) => ({
      key: `${key}/${m.id.bank}.${m.id.map}`,
      label: ja.mapItem(m.name ?? ja.noName, suffix(m), m.id.bank, m.id.map),
      mapId: m.id,
    })),
  };
}

/** 「マップとタイルセットで並び替え」の補足（建物/施設、ジム など。通常のマップは無し）。 */
function suffixOf(m: MapInfo): string {
  const g = tilesetGroupOf(m.primaryNumber, m.secondaryNumber);
  return g === null || g === FR_TILESET_PLAIN_GROUP ? "" : g;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
