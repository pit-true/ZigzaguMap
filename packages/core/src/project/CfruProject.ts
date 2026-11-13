import { requireSupportedGame, type GameInfo } from "../game/GameInfo.js";
import type { GameOffsets } from "../game/offsets.js";
import { GridStore } from "../command/GridStore.js";
import type { MapId, Tileset } from "../map/types.js";
import { MapDocument } from "../model/MapDocument.js";
import { RomMapSource } from "../model/RomMapSource.js";
import { Rom, ROM_BASE } from "../rom/Rom.js";
import { MapSourceConverter } from "./MapSourceConverter.js";
import { MapSourceJson } from "./MapSourceJson.js";
import type { ProjectFs } from "./ProjectFs.js";
import { PROJECT_MANIFEST_FORMAT, ProjectManifestJson, type ProjectManifest } from "./ProjectManifest.js";
import { TilesetSourceJson, type TilesetSource } from "./TilesetSource.js";
import { TextCodec } from "../name/TextCodec.js";
import {
  CHARMAP_PATH,
  MAPS_DIR,
  PROJECT_MANIFEST_PATH,
  TILESETS_DIR,
  TILESET_IMAGE_FILE,
  TILESET_INFO_FILE,
  isNumericName,
  mapSourcePath,
} from "./paths.js";

/** マップを読んだ結果。読めなかったときは `error` に理由が入る。 */
export type MapLoadResult =
  | { readonly ok: true; readonly document: MapDocument; readonly fromJson: boolean }
  | { readonly ok: false; readonly error: Error };

/** 書き出しの結果（プロジェクトフォルダからの相対パス）。 */
export interface SaveResult {
  /** 書いたファイル。 */
  readonly written: string[];
  /** ベース ROM と同じに戻ったため消したファイル。 */
  readonly removed: string[];
}

/** maps\tilesets にあるタイルセット 1 つ。 */
interface TilesetEntry {
  readonly folder: string;
  readonly source: TilesetSource;
}

/**
 * CFRU-JP のプロジェクト（ベース ROM + maps\ の JSON）。
 *
 * - マップは maps\BB\MM.json があればそれを優先し、無ければベース ROM から読む。
 * - 書き出しは、読み込んだマップのうち、ベース ROM と違うものだけ（内容が同じファイルは書かない）。
 * - ベース ROM と同じ内容に戻ったマップは JSON を消す。
 * - ベース ROM には書き込まない。
 */
export class CfruProject {
  readonly rom: Rom;
  readonly game: GameInfo & { readonly offsets: GameOffsets };
  /** 文字列の変換器（プロジェクトの charmap.tbl。無ければ同梱の ND の表）。 */
  readonly textCodec: TextCodec;
  /** ベース ROM からの読み取り。 */
  readonly base: RomMapSource;
  private manifestValue: ProjectManifest | null;
  private readonly jsonMaps: Set<string>;
  private readonly tilesetSources: Map<string, TilesetEntry>;
  private readonly documents = new Map<string, MapDocument>();
  /** 読み込み・書き出しの時点の JSON（変更の有無の判定用）。 */
  private readonly snapshots = new Map<string, string>();
  private readonly baseJson = new Map<string, string | null>();
  private readonly tilesetCache = new Map<string, Tileset>();

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
    this.jsonMaps = jsonMaps;
    this.tilesetSources = tilesets;
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
        if (m) jsonMaps.add(key({ bank: Number(bank), map: Number(m[1]) }));
      }
    }
    const tilesets = new Map<string, TilesetEntry>();
    for (const name of await fs.list(TILESETS_DIR)) {
      const folder = `${TILESETS_DIR}/${name}`;
      const info = `${folder}/${TILESET_INFO_FILE}`;
      if (!(await fs.exists(info))) continue;
      const source = TilesetSourceJson.parse(await fs.readText(info), info);
      tilesets.set(tilesetKey(ROM_BASE + source.headerAddress, source.secondary), { folder, source });
    }
    const codec = (await fs.exists(CHARMAP_PATH)) ? TextCodec.fromCharmap(await fs.readText(CHARMAP_PATH)) : TextCodec.japanese;
    return new CfruProject(fs, rom, manifest, jsonMaps, tilesets, codec);
  }

  /** maps\project.json の中身。無ければ null。 */
  get manifest(): ProjectManifest | null {
    return this.manifestValue;
  }

  /** ベース ROM のバンクごとのマップ数（project.json があればその値、無ければ ROM からの推定）。 */
  get baseBankCounts(): number[] {
    return this.manifestValue?.baseBankCounts.slice() ?? this.base.bankTable.counts();
  }

  /** ベース ROM と maps\ の JSON にある全マップの番号（バンク・マップの順）。 */
  mapIds(): MapId[] {
    const keys = new Set<string>(this.jsonMaps);
    for (const id of this.base.bankTable.ids()) keys.add(key(id));
    return [...keys].map(parseKey).sort((a, b) => a.bank - b.bank || a.map - b.map);
  }

  /** そのマップの JSON が maps\ にあるか。 */
  hasJson(id: MapId): boolean {
    return this.jsonMaps.has(key(id));
  }

  /** そのマップがベース ROM にあるか。 */
  inBase(id: MapId): boolean {
    return this.base.has(id);
  }

  /** マップを読む（JSON を優先）。読み込んだマップは保持し、2 回目以降は同じものを返す。 */
  async load(id: MapId): Promise<MapDocument> {
    const k = key(id);
    const cached = this.documents.get(k);
    if (cached) return cached;
    let doc: MapDocument;
    if (this.jsonMaps.has(k)) {
      const path = mapSourcePath(id);
      doc = MapSourceConverter.fromSource(MapSourceJson.parse(await this.fs.readText(path), path), path);
    } else {
      doc = this.base.read(id);
    }
    this.documents.set(k, doc);
    this.snapshots.set(k, toJson(doc));
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
    return this.documents.get(key(id));
  }

  /** 新しいマップを加える（ベース ROM に無い番号）。既にあれば Error。 */
  add(doc: MapDocument): void {
    const k = key(doc.id);
    if (this.documents.has(k) || this.jsonMaps.has(k) || this.base.has(doc.id)) throw new Error(`マップ ${k} は既にあります`);
    this.documents.set(k, doc);
  }

  /** 読み込み・書き出しの時点から変わったか（未出力の印用）。 */
  isModified(id: MapId): boolean {
    const doc = this.documents.get(key(id));
    if (!doc) return false;
    return this.snapshots.get(key(id)) !== toJson(doc);
  }

  /** ベース ROM の内容と違うか（JSON を書くべきか）。 */
  differsFromBase(doc: MapDocument): boolean {
    const base = this.baseJsonOf(doc.id);
    return base === null || base !== toJson(doc);
  }

  /** 読み込み済みのマップの配置を直接編集する GridStore。 */
  gridStore(): GridStore {
    return GridStore.forDocuments((id) => {
      const doc = this.documents.get(key(id));
      if (!doc) throw new Error(`マップ ${key(id)} は読み込まれていません`);
      return doc;
    });
  }

  /**
   * 変更のあったマップを書き出す。
   * - ベース ROM と違い、ファイルの内容とも違うマップだけ書く。
   * - ベース ROM と同じになったマップは、JSON があれば消す。
   * - 何か書くときに project.json が無ければ作る。
   */
  async save(): Promise<SaveResult> {
    const writes: { path: string; text: string }[] = [];
    const removals: string[] = [];
    const ordered = [...this.documents.entries()].sort(([a], [b]) => compareKeys(a, b));
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
    if (writes.length > 0 && !this.manifestValue && !(await this.fs.exists(PROJECT_MANIFEST_PATH))) {
      const manifest = { format: PROJECT_MANIFEST_FORMAT, baseBankCounts: this.base.bankTable.counts() };
      writes.unshift({ path: PROJECT_MANIFEST_PATH, text: ProjectManifestJson.stringify(manifest) });
      this.manifestValue = manifest;
    }
    for (const w of writes) await this.fs.writeText(w.path, w.text);
    for (const path of removals) await this.fs.remove(path);

    for (const [k, doc] of this.documents) {
      const path = mapSourcePath(doc.id);
      if (writes.some((w) => w.path === path)) this.jsonMaps.add(k);
      if (removals.includes(path)) this.jsonMaps.delete(k);
      this.snapshots.set(k, toJson(doc));
    }
    return { written: writes.map((w) => w.path), removed: removals };
  }

  /**
   * タイルセットを読む。maps\tilesets にあればそれを、無ければベース ROM から読む。
   * `pointer` はマップの PrimaryTileset / SecondaryTileset の値。
   */
  async loadTileset(pointer: number, asSecondary: boolean): Promise<Tileset> {
    const k = tilesetKey(pointer, asSecondary);
    const cached = this.tilesetCache.get(k);
    if (cached) return cached;
    const entry = this.tilesetSources.get(k);
    const tileset = entry
      ? TilesetSourceJson.toTileset(entry.source, await this.fs.readBytes(`${entry.folder}/${TILESET_IMAGE_FILE}`), this.fs.inflate)
      : this.base.readTileset(pointer, asSecondary);
    this.tilesetCache.set(k, tileset);
    return tileset;
  }

  /** マップの主・副タイルセットを読む。 */
  async loadTilesets(doc: MapDocument): Promise<{ primary: Tileset; secondary: Tileset }> {
    return {
      primary: await this.loadTileset(doc.primaryTileset, false),
      secondary: await this.loadTileset(doc.secondaryTileset, true),
    };
  }

  private baseJsonOf(id: MapId): string | null {
    const k = key(id);
    if (!this.baseJson.has(k)) this.baseJson.set(k, this.base.has(id) ? toJson(this.base.read(id)) : null);
    return this.baseJson.get(k)!;
  }
}

function toJson(doc: MapDocument): string {
  return MapSourceJson.stringify(MapSourceConverter.toSource(doc));
}

function key(id: MapId): string {
  return `${id.bank}.${id.map}`;
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

function tilesetKey(pointer: number, secondary: boolean): string {
  return `${pointer >>> 0}:${secondary ? 1 : 0}`;
}
