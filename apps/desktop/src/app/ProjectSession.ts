import { invoke } from "@tauri-apps/api/core";
import {
  CfruProject,
  CommandBus,
  OverworldSprites,
  RegionMapProject,
  Rom,
  SpeciesNameTable,
  createDefaultRegistry,
  detectGame,
  withRegionMap,
  type CommandRegistry,
  type MapDocument,
  type MapId,
  type SaveResult,
  type TilesetRef,
} from "@zigzagumap/core";
import { MapCatalog } from "./MapCatalog";
import { TauriProjectFs } from "./TauriProjectFs";
import { TilesetView } from "./TilesetView";

/** 開いているマップ。 */
export interface OpenMap {
  readonly id: MapId;
  readonly doc: MapDocument;
  readonly tiles: TilesetView;
}

/** 対応していない ROM（ゲームコードが BPRJ でない、小さすぎる）。 */
export class UnknownRomError extends Error {}

/** 同時に持っておくタイルセットの組の数（メモリを抑えるため古いものから捨てる）。 */
const TILESET_CACHE_SIZE = 2;

/**
 * 開いている ROM（とプロジェクトフォルダ）。マップの読み込み、タイルセットのキャッシュ、操作の履歴、出力を受け持つ。
 * 素の ROM だけのときはフォルダが無く、出力のときにフォルダを決める。
 */
export class ProjectSession {
  readonly bus: CommandBus;
  readonly registry: CommandRegistry = createDefaultRegistry();
  private readonly tilesets = new Map<string, TilesetView>();
  private readonly opened = new Map<string, MapId>();
  private species: SpeciesNameTable | null | undefined;
  private sprites: OverworldSprites | null | undefined;
  /** タウンマップ（ワールドマップエディターを開いたときに読む）。 */
  private regionMapValue: RegionMapProject | null = null;

  private constructor(
    readonly romPath: string,
    private readonly fs: TauriProjectFs,
    readonly project: CfruProject,
    private catalogValue: MapCatalog,
    /** 開くのにかかった時間（ミリ秒）。 */
    readonly loadMs: number,
  ) {
    this.bus = new CommandBus(withRegionMap(project.editorContext(), () => this.requireRegionMap().document));
  }

  /** ROM と（あれば）プロジェクトフォルダを開く。 */
  static async open(romPath: string, projectDir: string | null): Promise<ProjectSession> {
    const start = performance.now();
    const bytes = new Uint8Array(await invoke<ArrayBuffer>("read_rom", { path: romPath }));
    // フォルダの許可を切り替える前に、ROM の種類を確かめる（開いているものを壊さないため）。
    let supported = false;
    try {
      supported = detectGame(new Rom(bytes)).offsets !== null;
    } catch {
      supported = false;
    }
    if (!supported) throw new UnknownRomError(romPath);
    const fs = new TauriProjectFs();
    await fs.setRoot(projectDir);
    const project = await CfruProject.open(bytes, fs);
    const catalog = await MapCatalog.build(project);
    return new ProjectSession(romPath, fs, project, catalog, performance.now() - start);
  }

  /** マップ一覧用の情報。 */
  get catalog(): MapCatalog {
    return this.catalogValue;
  }

  /** マップ一覧用の情報を作り直す（マップを加えた・取り消したとき）。 */
  async refreshCatalog(): Promise<MapCatalog> {
    this.catalogValue = await MapCatalog.build(this.project);
    return this.catalogValue;
  }

  /** プロジェクトフォルダ（素の ROM だけなら null）。 */
  get projectDir(): string | null {
    return this.fs.root;
  }

  /** マップを読み、描画の準備をする。タイルセットの組は使い回す。 */
  async openMap(id: MapId): Promise<OpenMap> {
    const doc = await this.project.load(id);
    const key = `${doc.primaryTileset >>> 0}:${doc.secondaryTileset >>> 0}`;
    let tiles = this.tilesets.get(key);
    if (tiles) {
      this.tilesets.delete(key);
    } else {
      const { primary, secondary } = await this.project.loadTilesets(doc);
      tiles = new TilesetView(key, primary, secondary);
    }
    this.tilesets.set(key, tiles);
    while (this.tilesets.size > TILESET_CACHE_SIZE) this.tilesets.delete(this.tilesets.keys().next().value!);
    this.opened.set(mapKey(id), id);
    return { id, doc, tiles };
  }

  /** 種族名表（初めて使うときに読む。読めなければ null）。 */
  get speciesNames(): SpeciesNameTable | null {
    if (this.species === undefined) {
      try {
        this.species = SpeciesNameTable.read(this.project.rom, this.project.game.offsets.speciesNameTablePointer);
      } catch {
        this.species = null;
      }
    }
    return this.species;
  }

  /** OW の画像（初めて使うときに読む。読めなければ null）。 */
  get overworldSprites(): OverworldSprites | null {
    if (this.sprites === undefined) {
      const o = this.project.game.offsets;
      try {
        this.sprites = OverworldSprites.read(this.project.rom, o.overworldGraphicsTablePointer, o.overworldPaletteTablePointer);
      } catch {
        this.sprites = null;
      }
    }
    return this.sprites;
  }

  /** タウンマップを読む（2 回目以降は同じものを返す）。maps\regionmap.json があれば重ねる。 */
  async openRegionMap(): Promise<RegionMapProject> {
    this.regionMapValue ??= await RegionMapProject.open(this.project.rom, this.project.game.code, this.fs.root ? this.fs : null);
    return this.regionMapValue;
  }

  /** 読み込み済みのタウンマップ（まだなら null）。 */
  get regionMap(): RegionMapProject | null {
    return this.regionMapValue;
  }

  private requireRegionMap(): RegionMapProject {
    if (!this.regionMapValue) throw new Error("ワールドマップエディターを開いてから実行してください");
    return this.regionMapValue;
  }

  /** そのマップが読み込み済みか。 */
  isLoaded(id: MapId): boolean {
    return this.project.loaded(id) !== undefined;
  }

  /** 未出力の変更があるか。 */
  isModified(id: MapId): boolean {
    return this.project.isModified(id);
  }

  /** 未出力の変更があるか（マップ・タイルセット・マップ名）。 */
  hasUnsavedChanges(): boolean {
    return this.project.hasUnsavedChanges();
  }

  /**
   * タイルセットを編集したあと、それを使う組（キャッシュにあるもの）を作り直す。作り直した組を返す。
   * 組のキーは「主のポインタ値:副のポインタ値」。
   */
  refreshTilesets(ref: TilesetRef): TilesetView[] {
    const context = this.project.editorContext();
    const out: TilesetView[] = [];
    for (const view of this.tilesets.values()) {
      const [primary, secondary] = view.key.split(":").map(Number) as [number, number];
      if ((ref.secondary ? secondary : primary) !== ref.pointer >>> 0) continue;
      view.reload(
        context.tileset({ pointer: primary, secondary: false }).toTileset(),
        context.tileset({ pointer: secondary, secondary: true }).toTileset(),
      );
      out.push(view);
    }
    return out;
  }

  /** タウンマップに未出力の変更があるか。 */
  isRegionMapModified(): boolean {
    return this.regionMapValue?.isModified() ?? false;
  }

  /** 未出力の変更があるマップ（バンク・マップの順）。 */
  modifiedMaps(): MapId[] {
    // 開いたマップと、読み込み済みのマップ（追加・差し替えたもの、開かずに足したバンクも含む）。
    const ids = new Map(this.opened);
    for (const id of this.project.mapIds()) if (this.project.loaded(id)) ids.set(mapKey(id), id);
    return [...ids.values()].filter((id) => this.project.isModified(id)).sort((a, b) => a.bank - b.bank || a.map - b.map);
  }

  /**
   * 変更のあったマップを maps\BB\MM.json へ書く。`dir` を渡すとそのフォルダへ書く（以後そこをプロジェクトフォルダにする）。
   * フォルダが決まっていなければ Error。
   */
  async export(dir?: string): Promise<SaveResult> {
    if (dir !== undefined) await this.fs.setRoot(dir);
    if (!this.fs.root) throw new Error("出力先のフォルダが決まっていません");
    const result = await this.project.save();
    if (!this.regionMapValue) return result;
    const region = await this.regionMapValue.save(this.fs);
    return { written: [...result.written, ...region.written], removed: [...result.removed, ...region.removed] };
  }

  /** 別のものを開くのに失敗したあと、Rust 側のフォルダの許可をこのセッションのものに戻す。 */
  async reattach(): Promise<void> {
    await this.fs.setRoot(this.fs.root);
  }

  /** 閉じる（Rust 側のフォルダの許可も外す）。 */
  async close(): Promise<void> {
    await this.fs.setRoot(null);
  }
}

function mapKey(id: MapId): string {
  return `${id.bank}.${id.map}`;
}
