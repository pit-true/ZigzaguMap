import { requireSupportedGame, type GameInfo } from "../game/GameInfo.js";
import type { GameOffsets } from "../game/offsets.js";
import { GridStore } from "../command/GridStore.js";
import { DocumentStore, mapKey, tilesetKey } from "../command/DocumentStore.js";
import { FlyTable, cloneFlyPositions } from "../fly/FlyTable.js";
import { HEAL_LOCATION_COUNT } from "../regionmap/constants.js";
import { healOf, writeHeal } from "../regionmap/RegionMapDocument.js";
import { RegionMapJson } from "../regionmap/RegionMapJson.js";
import { REGION_MAP_PATH } from "../regionmap/RegionMapProject.js";
import type { DocumentContext } from "../command/DocumentContext.js";
import { TilesetTable } from "../map/TilesetTable.js";
import { TILESET_HEADER_SIZE } from "../map/constants.js";
import type { MapId, Tileset } from "../map/types.js";
import type { ItemBall, MapDocument } from "../model/MapDocument.js";
import { isWorkMapId } from "../model/WorkMap.js";
import { RomMapSource } from "../model/RomMapSource.js";
import { TextCodec } from "../name/TextCodec.js";
import { Rom, ROM_BASE } from "../rom/Rom.js";
import { TilesetDocument, type TilesetRef } from "../tileset/TilesetDocument.js";
import { buildHiddenItemSource } from "./HiddenItemSource.js";
import { MapSourceConverter } from "./MapSourceConverter.js";
import { MapSourceJson } from "./MapSourceJson.js";
import type { ProjectFs } from "./ProjectFs.js";
import { PROJECT_MANIFEST_FORMAT, ProjectManifestJson, type ProjectManifest } from "./ProjectManifest.js";
import { TilesetSourceJson, type TilesetSource } from "./TilesetSource.js";
import {
  CHARMAP_PATH,
  HIDDEN_ITEM_PATH,
  MAPS_DIR,
  PROJECT_MANIFEST_PATH,
  TILESETS_DIR,
  TILESET_IMAGE_FILE,
  TILESET_INFO_FILE,
  isNumericName,
  mapSourcePath,
  tilesetFolder,
} from "./paths.js";

/** マップを読んだ結果。読めなかったときは `error` に理由が入る。 */
export type MapLoadResult =
  | { readonly ok: true; readonly document: MapDocument; readonly fromJson: boolean }
  | { readonly ok: false; readonly error: Error };

/** 書き出しの結果（プロジェクトフォルダからの相対パス）。 */
export interface SaveResult {
  /** 書いたファイル。 */
  readonly written: string[];
  /** ベース ROM と同じに戻ったため（または追加を取り消したため）消したファイル。 */
  readonly removed: string[];
}

/** maps\tilesets にあるタイルセット 1 つ。 */
interface TilesetEntry {
  readonly folder: string;
  readonly source: TilesetSource;
}

/** 書くファイル 1 つ。 */
type Write = { readonly path: string; readonly text: string } | { readonly path: string; readonly bytes: Uint8Array };

/**
 * CFRU-JP のプロジェクト（ベース ROM + maps\ の JSON）。
 *
 * - マップは maps\BB\MM.json があればそれを優先し、無ければベース ROM から読む。
 * - 編集は editorContext()（DocumentContext）を CommandBus に渡して行う。
 * - 書き出しは、ベース ROM と違い、ファイルの内容とも違うものだけ（マップ、タイルセット、HiddenItem.s、project.json）。
 * - ベース ROM と同じ内容に戻ったマップ・タイルセットはファイルを消す。保存のたびに maps\ の全マップを見る。
 * - ベース ROM には書き込まない。
 */
export class CfruProject {
  readonly rom: Rom;
  readonly game: GameInfo & { readonly offsets: GameOffsets };
  /** 文字列の変換器（プロジェクトの charmap.tbl。無ければ同梱の ND の表）。 */
  readonly textCodec: TextCodec;
  /** ベース ROM からの読み取り。 */
  readonly base: RomMapSource;
  /** ベース ROM のタイルセット表（AdvanceMap のタイルセット番号）。 */
  readonly tilesetTable: TilesetTable;
  /** ベース ROM のフライトポジションの表（読めなければ null）。編集中の値は editorContext().flyPositions。 */
  readonly flyTable: FlyTable | null;
  private manifestValue: ProjectManifest | null;
  private readonly jsonMaps: Set<string>;
  private readonly tilesetSources: Map<string, TilesetEntry>;
  /** 編集中のマップとタイルセット。 */
  private readonly store: DocumentStore;
  /** 読み込み・書き出しの時点の JSON（変更の有無の判定用）。 */
  private readonly snapshots = new Map<string, string>();
  private readonly tilesetSnapshots = new Map<string, string>();
  private readonly baseJson = new Map<string, string | null>();
  private readonly baseTilesetJson = new Map<string, string | null>();
  /** maps\ の JSON に書かれている落とし物（識別子 → 落とし物。HiddenItem.s の作り直しの判定用）。 */
  private readonly fileItemBalls = new Map<string, ItemBall>();
  private tilesetDataStarts: number[] | null = null;
  /** 読み込み・出力の時点のフライトポジション（JSON。変更の有無の判定用）。 */
  private flySaved = "";

  private constructor(
    private readonly fs: ProjectFs,
    rom: Rom,
    manifest: ProjectManifest | null,
    jsonMaps: Set<string>,
    tilesets: Map<string, TilesetEntry>,
    textCodec: TextCodec,
  ) {
    this.rom = rom;
    this.textCodec = textCodec;
    this.game = requireSupportedGame(rom);
    this.manifestValue = manifest;
    this.base = new RomMapSource(rom, this.game.offsets, manifest?.baseBankCounts);
    this.tilesetTable = TilesetTable.read(rom, this.game.offsets);
    this.jsonMaps = jsonMaps;
    this.tilesetSources = tilesets;
    this.store = new DocumentStore({
      textCodec,
      baseMapName: (regionId) => this.base.nameTable.rawName(regionId),
      mapExists: (id) => this.base.has(id) || (this.jsonMaps.has(mapKey(id)) && !this.store.removedMaps.has(mapKey(id))),
      baseBankCounts: () => this.existingBankCounts(),
      tilesetExists: (pointer) => this.tilesetExists(pointer),
      tilesetPointer: (index) => this.tilesetTable.pointerOf(index),
      tilesetIndex: (pointer) => this.tilesetTable.indexOf(pointer),
    });
    this.flyTable = readFlyTable(rom, this.game.offsets);
    if (this.flyTable) this.store.flyPositions.push(...cloneFlyPositions(this.flyTable.entries));
  }

  /** ベース ROM のバイト列とプロジェクトフォルダを開く。対応していない ROM や不正な project.json なら例外。 */
  static async open(baseRom: Uint8Array, fs: ProjectFs): Promise<CfruProject> {
    const rom = new Rom(baseRom);
    const manifest = (await fs.exists(PROJECT_MANIFEST_PATH))
      ? ProjectManifestJson.parse(await fs.readText(PROJECT_MANIFEST_PATH), PROJECT_MANIFEST_PATH)
      : null;
    const jsonMaps = new Set<string>();
    for (const bank of await fs.list(MAPS_DIR)) {
      if (!isNumericName(bank)) continue;
      for (const file of await fs.list(`${MAPS_DIR}/${bank}`)) {
        const m = /^([0-9]+)\.json$/i.exec(file);
        if (m) jsonMaps.add(mapKey({ bank: Number(bank), map: Number(m[1]) }));
      }
    }
    const tilesets = new Map<string, TilesetEntry>();
    for (const name of await fs.list(TILESETS_DIR)) {
      const folder = `${TILESETS_DIR}/${name}`;
      const info = `${folder}/${TILESET_INFO_FILE}`;
      if (!(await fs.exists(info))) continue;
      const source = TilesetSourceJson.parse(await fs.readText(info), info);
      tilesets.set(tilesetKey({ pointer: ROM_BASE + source.headerAddress, secondary: source.secondary }), { folder, source });
    }
    const codec = (await fs.exists(CHARMAP_PATH)) ? TextCodec.fromCharmap(await fs.readText(CHARMAP_PATH)) : TextCodec.japanese;
    const project = new CfruProject(fs, rom, manifest, jsonMaps, tilesets, codec);
    if (await fs.exists(REGION_MAP_PATH)) project.applyRegionMapFlyPositions(await fs.readText(REGION_MAP_PATH));
    project.markFlyPositionsSaved();
    return project;
  }

  /**
   * maps\regionmap.json の HealLocations（タウンマップの飛び先。フライトポジションと同じ表）を、編集中のフライトポジションへ重ねる。
   * タウンマップの絵は読まない（起動を軽くするため）。
   */
  private applyRegionMapFlyPositions(text: string): void {
    const list = this.store.flyPositions;
    if (list.length !== HEAL_LOCATION_COUNT) return;
    const heal = list.map(healOf);
    if (RegionMapJson.applyHealLocations(text, heal, REGION_MAP_PATH)) heal.forEach((h, i) => writeHeal(list[i]!, h));
  }

  /** フライトポジションに未出力の変更があるか（出力先は maps\regionmap.json の HealLocations）。 */
  isFlyPositionsModified(): boolean {
    return JSON.stringify(this.store.flyPositions) !== this.flySaved;
  }

  /** フライトポジションを出力した（maps\regionmap.json を書いた）ことを記録する。 */
  markFlyPositionsSaved(): void {
    this.flySaved = JSON.stringify(this.store.flyPositions);
  }

  /** maps\project.json の中身。無ければ null。 */
  get manifest(): ProjectManifest | null {
    return this.manifestValue;
  }

  /** ベース ROM のバンクごとのマップ数（project.json があればその値、無ければ ROM からの推定）。 */
  get baseBankCounts(): number[] {
    return this.manifestValue?.baseBankCounts.slice() ?? this.base.bankTable.counts();
  }

  /** いまのバンクごとのマップ数（ベース ROM・maps\ の JSON・追加したマップ）。 */
  bankCounts(): number[] {
    return this.store.bankCounts();
  }

  /** ベース ROM・maps\ の JSON・追加したマップの全番号（バンク・マップの順。作業用のマップは含まない）。 */
  mapIds(): MapId[] {
    const keys = new Set<string>([...this.jsonMaps].filter((k) => !this.store.removedMaps.has(k)));
    for (const id of this.base.bankTable.ids()) keys.add(mapKey(id));
    for (const [k, doc] of this.store.documents) if (!isWorkMapId(doc.id)) keys.add(k);
    return [...keys].map(parseKey).sort((a, b) => a.bank - b.bank || a.map - b.map);
  }

  /** そのマップの JSON が maps\ にあるか。 */
  hasJson(id: MapId): boolean {
    return this.jsonMaps.has(mapKey(id));
  }

  /** そのマップがベース ROM にあるか。 */
  inBase(id: MapId): boolean {
    return this.base.has(id);
  }

  /** マップを読む（JSON を優先）。読み込んだマップは保持し、2 回目以降は同じものを返す。 */
  async load(id: MapId): Promise<MapDocument> {
    const k = mapKey(id);
    const cached = this.store.find(id);
    if (cached) return cached;
    if (this.store.removedMaps.has(k)) throw new Error(`マップ ${k} はありません`);
    let doc: MapDocument;
    if (this.jsonMaps.has(k)) {
      const path = mapSourcePath(id);
      doc = MapSourceConverter.fromSource(MapSourceJson.parse(await this.fs.readText(path), path), path);
      for (const item of doc.itemBalls) this.fileItemBalls.set(item.id, { ...item });
    } else {
      doc = this.base.read(id);
    }
    this.snapshots.set(k, toJson(doc));
    this.store.put(doc);
    return doc;
  }

  /** マップを読む。例外を投げず、読めなかった理由を結果で返す。 */
  async tryLoad(id: MapId): Promise<MapLoadResult> {
    try {
      const document = await this.load(id);
      return { ok: true, document, fromJson: this.hasJson(id) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  /** 読み込み済みのマップ。無ければ undefined。 */
  loaded(id: MapId): MapDocument | undefined {
    return this.store.find(id);
  }

  /** 新しいマップを加える（バンクの末尾か新しいバンク。番号の確認は CreateMapCommand が行う）。既にあれば Error。 */
  add(doc: MapDocument): void {
    this.store.addMap(doc);
  }

  /** 作業用のマップの名前とパス（作業用のマップでなければ null）。 */
  workMapInfo(id: MapId): { readonly name: string; readonly path: string | null } | null {
    return this.store.workMapInfo(id);
  }

  /** 読み込み・書き出しの時点から変わったか（未出力の印用。作業用のマップは出力しないので常に false）。 */
  isModified(id: MapId): boolean {
    if (isWorkMapId(id)) return false;
    const doc = this.store.find(id);
    if (!doc) return this.store.removedMaps.has(mapKey(id)) && this.jsonMaps.has(mapKey(id));
    return this.snapshots.get(mapKey(id)) !== toJson(doc);
  }

  /** 保存していない変更があるか（マップ・タイルセット・マップ名・追加の取り消し）。 */
  hasUnsavedChanges(): boolean {
    for (const doc of this.store.documents.values()) if (!isWorkMapId(doc.id) && this.isModified(doc.id)) return true;
    for (const t of this.store.tilesets.values()) if (this.tilesetSnapshots.get(tilesetKey(t.ref)) !== t.toJson()) return true;
    for (const k of this.store.removedMaps) if (this.jsonMaps.has(k)) return true;
    return false;
  }

  /** ベース ROM の内容と違うか（JSON を書くべきか）。 */
  differsFromBase(doc: MapDocument): boolean {
    const base = this.baseJsonOf(doc.id);
    return base === null || base !== toJson(doc);
  }

  /** コマンドに渡す入口（マップ・タイルセット・マップ名・マップの追加）。マップとタイルセットは先に読み込んでおく。 */
  editorContext(): DocumentContext {
    return this.store;
  }

  /**
   * 読み込み済みのマップの配置を直接編集する GridStore（配置だけのコマンド用）。
   * 大きさを変えるコマンドも使うときは editorContext() を使う（GridStore は配置を覚えるため、差し替えに追従しない）。
   */
  gridStore(): GridStore {
    return GridStore.forDocuments((id) => this.store.document(id));
  }

  /**
   * タイルセットを読む。maps\tilesets にあればそれを、無ければベース ROM から読む。
   * 読み込んだタイルセットは保持し、編集もそこに対して行う。
   */
  async loadTilesetDocument(ref: TilesetRef): Promise<TilesetDocument> {
    const cached = this.store.findTileset(ref);
    if (cached) return cached;
    const entry = this.tilesetSources.get(tilesetKey(ref));
    const doc = entry
      ? TilesetDocument.fromSource(entry.source, await this.fs.readBytes(`${entry.folder}/${TILESET_IMAGE_FILE}`), this.fs.inflate)
      : TilesetDocument.fromRom(this.rom, ref, this.dataStarts());
    this.store.putTileset(doc);
    this.tilesetSnapshots.set(tilesetKey(ref), doc.toJson());
    return doc;
  }

  /**
   * タイルセットを読んで描画用の形にする（配列は編集中のものを共有する）。
   * `pointer` はマップの PrimaryTileset / SecondaryTileset の値。
   */
  async loadTileset(pointer: number, asSecondary: boolean): Promise<Tileset> {
    return (await this.loadTilesetDocument({ pointer, secondary: asSecondary })).toTileset();
  }

  /** マップの主・副タイルセットを読む。 */
  async loadTilesets(doc: MapDocument): Promise<{ primary: Tileset; secondary: Tileset }> {
    return {
      primary: await this.loadTileset(doc.primaryTileset, false),
      secondary: await this.loadTileset(doc.secondaryTileset, true),
    };
  }

  /**
   * 変更を書き出す。
   * - マップ: ベース ROM と違い、ファイルの内容とも違うものだけ書く。ベース ROM と同じになったものは JSON を消す。
   *   maps\ の全 JSON を読み直して確かめる（Bochi と同じ）。マップ名を変えたときは、同じ地名番号の全マップを書く。
   * - 追加して取り消したマップの JSON は消す。
   * - タイルセット: 読み込んだもののうち、ベース ROM と違うものを tileset.json と tiles.png に書く。同じなら消す。
   * - HiddenItem.s: 落とし物の生成範囲を作り直す（手書き部分は残す）。
   * - 何か書くときに project.json が無ければ作る。
   */
  async save(): Promise<SaveResult> {
    if (this.store.mapNameEdits.size > 0) {
      for (const id of this.mapIds()) await this.tryLoad(id);
    }
    for (const k of this.jsonMaps) if (!this.store.removedMaps.has(k)) await this.tryLoad(parseKey(k));

    const writes: Write[] = [];
    const removals: string[] = [];
    const ordered = [...this.store.documents.entries()].filter(([, d]) => !isWorkMapId(d.id)).sort(([a], [b]) => compareKeys(a, b));
    for (const [k, doc] of ordered) {
      const path = mapSourcePath(doc.id);
      const json = toJson(doc);
      const exists = this.jsonMaps.has(k) && (await this.fs.exists(path));
      if (!this.differsFromBase(doc)) {
        if (exists) removals.push(path);
      } else if (!exists || (await this.fs.readText(path)) !== json) {
        writes.push({ path, text: json });
      }
    }
    for (const k of this.store.removedMaps) {
      const path = mapSourcePath(parseKey(k));
      if (this.jsonMaps.has(k) && (await this.fs.exists(path))) removals.push(path);
    }

    for (const t of [...this.store.tilesets.values()].sort((a, b) => a.pointer - b.pointer || Number(a.secondary) - Number(b.secondary))) {
      const folder = tilesetFolder(t.headerAddress, t.secondary);
      const info = `${folder}/${TILESET_INFO_FILE}`;
      const image = `${folder}/${TILESET_IMAGE_FILE}`;
      const json = t.toJson();
      if (this.baseTilesetJsonOf(t) === json) {
        if (await this.fs.exists(info)) removals.push(info);
        if (await this.fs.exists(image)) removals.push(image);
      } else if (!(await this.fs.exists(info)) || !(await this.fs.exists(image)) || (await this.fs.readText(info)) !== json) {
        writes.push({ path: info, text: json }, { path: image, bytes: t.toPng() });
      }
    }

    const items = [...this.store.documents.values()].filter((d) => !isWorkMapId(d.id)).flatMap((d) => d.itemBalls);
    const hiddenExists = await this.fs.exists(HIDDEN_ITEM_PATH);
    const hiddenOld = hiddenExists ? await this.fs.readText(HIDDEN_ITEM_PATH) : "";
    const hiddenNew = buildHiddenItemSource(hiddenOld, items, this.fileItemBalls);
    if (hiddenNew !== null && (!hiddenExists || hiddenNew !== hiddenOld)) writes.push({ path: HIDDEN_ITEM_PATH, text: hiddenNew });

    if (writes.length > 0 && !this.manifestValue && !(await this.fs.exists(PROJECT_MANIFEST_PATH))) {
      const manifest = { format: PROJECT_MANIFEST_FORMAT, baseBankCounts: this.base.bankTable.counts() };
      writes.unshift({ path: PROJECT_MANIFEST_PATH, text: ProjectManifestJson.stringify(manifest) });
      this.manifestValue = manifest;
    }
    for (const w of writes) {
      if ("text" in w) await this.fs.writeText(w.path, w.text);
      else if (this.fs.writeBytes) await this.fs.writeBytes(w.path, w.bytes);
      else throw new Error("この ProjectFs はバイナリファイルを書けません（writeBytes がありません）");
    }
    for (const path of removals) await this.fs.remove(path);

    for (const [k, doc] of this.store.documents) {
      if (isWorkMapId(doc.id)) continue;
      const path = mapSourcePath(doc.id);
      if (writes.some((w) => w.path === path)) this.jsonMaps.add(k);
      if (removals.includes(path)) this.jsonMaps.delete(k);
      this.snapshots.set(k, toJson(doc));
    }
    for (const k of this.store.removedMaps) {
      this.jsonMaps.delete(k);
      this.snapshots.delete(k);
    }
    this.store.removedMaps.clear();
    for (const t of this.store.tilesets.values()) {
      this.tilesetSnapshots.set(tilesetKey(t.ref), t.toJson());
      const folder = tilesetFolder(t.headerAddress, t.secondary);
      if (writes.some((w) => w.path === `${folder}/${TILESET_INFO_FILE}`)) this.tilesetSources.set(tilesetKey(t.ref), { folder, source: t.toSource() });
      if (removals.includes(`${folder}/${TILESET_INFO_FILE}`)) this.tilesetSources.delete(tilesetKey(t.ref));
    }
    this.fileItemBalls.clear();
    for (const [k, doc] of this.store.documents) {
      if (!isWorkMapId(doc.id) && this.jsonMaps.has(k)) for (const item of doc.itemBalls) this.fileItemBalls.set(item.id, { ...item });
    }
    return { written: writes.map((w) => w.path), removed: removals };
  }

  /** 既にある（ベース ROM と maps\ の JSON の）マップのバンクごとの数。 */
  private existingBankCounts(): number[] {
    const counts = this.base.bankTable.counts();
    for (const k of this.jsonMaps) {
      if (this.store.removedMaps.has(k)) continue;
      const { bank, map } = parseKey(k);
      while (counts.length <= bank) counts.push(0);
      counts[bank] = Math.max(counts[bank]!, map + 1);
    }
    return counts;
  }

  /** タイルセットとして指せるポインタ値か（maps\tilesets にあるか、ROM のヘッダーの各ポインタが ROM 内を指す）。 */
  private tilesetExists(pointer: number): boolean {
    if (this.tilesetSources.has(tilesetKey({ pointer, secondary: false })) || this.tilesetSources.has(tilesetKey({ pointer, secondary: true }))) {
      return true;
    }
    if (!this.rom.isPointer(pointer)) return false;
    const at = pointer - ROM_BASE;
    if (!this.rom.inRange(at, TILESET_HEADER_SIZE)) return false;
    return [0x04, 0x08, 0x0c].every((f) => this.rom.isPointer(this.rom.u32(at + f)));
  }

  private dataStarts(): number[] {
    return (this.tilesetDataStarts ??= this.tilesetTable.dataStarts(this.rom));
  }

  private baseJsonOf(id: MapId): string | null {
    const k = mapKey(id);
    if (!this.baseJson.has(k)) this.baseJson.set(k, this.base.has(id) ? toJson(this.base.read(id)) : null);
    return this.baseJson.get(k)!;
  }

  private baseTilesetJsonOf(t: TilesetDocument): string | null {
    const k = tilesetKey(t.ref);
    if (!this.baseTilesetJson.has(k)) {
      let json: string | null = null;
      if (!t.isNew && this.tilesetExistsInRom(t.pointer)) {
        try {
          json = TilesetDocument.fromRom(this.rom, t.ref, this.dataStarts()).toJson();
        } catch {
          json = null;
        }
      }
      this.baseTilesetJson.set(k, json);
    }
    return this.baseTilesetJson.get(k)!;
  }

  private tilesetExistsInRom(pointer: number): boolean {
    return this.rom.isPointer(pointer) && this.rom.inRange(pointer - ROM_BASE, TILESET_HEADER_SIZE);
  }
}

function toJson(doc: MapDocument): string {
  return MapSourceJson.stringify(MapSourceConverter.toSource(doc));
}

function parseKey(k: string): MapId {
  const [bank, map] = k.split(".").map(Number);
  return { bank: bank!, map: map! };
}

function compareKeys(a: string, b: string): number {
  const x = parseKey(a);
  const y = parseKey(b);
  return x.bank - y.bank || x.map - y.map;
}

/** フライトポジションの表を読む（表が壊れていても、マップの編集は続けられるよう null にする）。 */
function readFlyTable(rom: Rom, offsets: GameOffsets): FlyTable | null {
  try {
    return FlyTable.read(rom, offsets);
  } catch {
    return null;
  }
}
