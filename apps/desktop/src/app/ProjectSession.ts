import { invoke } from "@tauri-apps/api/core";
import {
  CfruProject,
  CommandBus,
  createDefaultRegistry,
  type CommandRegistry,
  type MapDocument,
  type MapId,
  type SaveResult,
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

/** 同時に持っておくタイルセットの組の数（メモリを抑えるため古いものから捨てる）。 */
const TILESET_CACHE_SIZE = 8;

/**
 * 開いている ROM（とプロジェクトフォルダ）。マップの読み込み、タイルセットのキャッシュ、操作の履歴、出力を受け持つ。
 * 素の ROM だけのときはフォルダが無く、出力のときにフォルダを決める。
 */
export class ProjectSession {
  readonly bus: CommandBus;
  readonly registry: CommandRegistry = createDefaultRegistry();
  private readonly tilesets = new Map<string, TilesetView>();
  private readonly opened = new Map<string, MapId>();

  private constructor(
    readonly romPath: string,
    private readonly fs: TauriProjectFs,
    readonly project: CfruProject,
    readonly catalog: MapCatalog,
    /** 開くのにかかった時間（ミリ秒）。 */
    readonly loadMs: number,
  ) {
    this.bus = new CommandBus(project.editorContext());
  }

  /** ROM と（あれば）プロジェクトフォルダを開く。 */
  static async open(romPath: string, projectDir: string | null): Promise<ProjectSession> {
    const start = performance.now();
    const bytes = new Uint8Array(await invoke<ArrayBuffer>("read_rom", { path: romPath }));
    const fs = new TauriProjectFs();
    await fs.setRoot(projectDir);
    const project = await CfruProject.open(bytes, fs);
    const catalog = await MapCatalog.build(project);
    return new ProjectSession(romPath, fs, project, catalog, performance.now() - start);
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

  /** そのマップが読み込み済みか。 */
  isLoaded(id: MapId): boolean {
    return this.project.loaded(id) !== undefined;
  }

  /** 未出力の変更があるか。 */
  isModified(id: MapId): boolean {
    return this.project.isModified(id);
  }

  /** 未出力の変更があるマップ（バンク・マップの順）。 */
  modifiedMaps(): MapId[] {
    return [...this.opened.values()].filter((id) => this.project.isModified(id)).sort((a, b) => a.bank - b.bank || a.map - b.map);
  }

  /**
   * 変更のあったマップを maps\BB\MM.json へ書く。`dir` を渡すとそのフォルダへ書く（以後そこをプロジェクトフォルダにする）。
   * フォルダが決まっていなければ Error。
   */
  async export(dir?: string): Promise<SaveResult> {
    if (dir !== undefined) await this.fs.setRoot(dir);
    if (!this.fs.root) throw new Error("出力先のフォルダが決まっていません");
    return this.project.save();
  }

  /** 閉じる（Rust 側のフォルダの許可も外す）。 */
  async close(): Promise<void> {
    await this.fs.setRoot(null);
  }
}

function mapKey(id: MapId): string {
  return `${id.bank}.${id.map}`;
}
