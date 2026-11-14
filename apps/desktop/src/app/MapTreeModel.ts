import type { MapId } from "@zigzagumap/core";
import { ja } from "../i18n/ja";
import { FR_TILESET_GROUPS, tilesetGroupOf, tilesetSuffixOf } from "./data/frTilesets";
import type { MapCatalog, MapInfo } from "./MapCatalog";
import type { MapFileEntry } from "./Settings";

/** マップ一覧の 1 項目。`mapId` があればマップ、`children` があればグループ。 */
export interface TreeNode {
  /** 展開状態などを覚えるための一意な鍵。 */
  readonly key: string;
  readonly label: string;
  readonly mapId?: MapId;
  /** 「マップファイル」の項目なら `.map` のパス。 */
  readonly filePath?: string;
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
 * マップ一覧を作る。根は「ヘッダー」と「マップファイル」の 2 つ（AdvanceMap の「iniファイル」はユーザーの要望で外した）。
 * 「ヘッダー」の下は並べ替えの種類でグループを作る。
 * 「マップファイル」の下は、保存・読み込みした `.map`（AdvanceMap の MapDateien.ini と同じく、登録した順）。
 */
export function buildMapTree(catalog: MapCatalog, sortMode: number, mapFiles: readonly MapFileEntry[] = []): TreeNode[] {
  const files: TreeNode = {
    key: "f",
    label: ja.rootMapFiles,
    children: mapFiles.map((f, i): TreeNode => ({ key: `f/${i}`, label: f.name, filePath: f.path })),
  };
  return [{ key: HEADER_ROOT_KEY, label: ja.rootHeader, children: headerGroups(catalog, sortMode) }, files];
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
        group(`h/r${region}`, listText(name), byRegion.get(region) ?? [], (m) => (withSuffix ? suffixOf(m) : "")),
      );
      // 名前表の範囲外の地名番号のマップは最後の名前の無いグループにまとめる。
      // AdvanceMap はこのグループを中身が無くても出す（「タイルセットのグループで並び替え」の最後の空のグループと同じ）。
      const known = new Set(catalog.regionNames.map(([r]) => r));
      const rest = maps.filter((m) => !known.has(m.region));
      out.push(group("h/r?", "", rest, (m) => (withSuffix ? suffixOf(m) : "")));
      return out;
    }
  }
}

/**
 * コンボボックス表示のグループ。左の一覧の「ヘッダー」と同じく、ヘッダーのマップ名（地名）でまとめる
 * （AdvanceMap は ini のグループ名を使うが、ini 由来の項目はユーザーの要望で外した）。中身の無いグループは出さない。
 */
export function comboGroups(catalog: MapCatalog): TreeNode[] {
  return headerGroups(catalog, SORT_BY_NAME)
    .filter((g) => (g.children?.length ?? 0) > 0)
    .map((g) => (g.label === "" ? { ...g, label: ja.noName } : g));
}

function group(key: string, label: string, list: readonly MapInfo[], suffix: (m: MapInfo) => string): TreeNode {
  const sorted = [...list].sort((a, b) => a.id.bank - b.id.bank || a.id.map - b.id.map);
  return {
    key,
    label,
    children: sorted.map((m) => ({
      key: `${key}/${m.id.bank}.${m.id.map}`,
      label: ja.mapItem(m.name === null ? ja.noName : listText(m.name), suffix(m), m.id.bank, m.id.map),
      mapId: m.id,
    })),
  };
}

/** 「ヘッダー」の下に出るマップの項目の文字列（新規マップの名前・作成したマップの保存のファイル名の初期値に使う）。 */
export function mapLabel(m: MapInfo, sortMode: number): string {
  return ja.mapItem(m.name ?? ja.noName, sortMode === SORT_BY_NAME_AND_TILESET ? suffixOf(m) : "", m.id.bank, m.id.map);
}

/** 「マップとタイルセットで並び替え」の補足（建物/施設、ジム など。通常のマップは無し）。 */
function suffixOf(m: MapInfo): string {
  return tilesetSuffixOf(m.secondaryNumber);
}

/**
 * 一覧（と題名）に出すマップ名。AdvanceMap は名前表の空白を半角の空白、中黒を半角の「･」で出すので合わせる
 * （「19ばん すいどう」「サント･アンヌごう」）。
 */
export function listText(name: string): string {
  return name.replace(/　/g, " ").replace(/・/g, "･");
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** マップ名で探すときの名前（#237。地名に「ポケセン」「ジム」などの補足を足したもの。一覧の「マップとタイルセットで並び替え」と同じ）。 */
export function mapSearchName(m: MapInfo): string | null {
  if (m.name === null) return null;
  const suffix = suffixOf(m);
  return suffix ? `${listText(m.name)} ${suffix}` : listText(m.name);
}
