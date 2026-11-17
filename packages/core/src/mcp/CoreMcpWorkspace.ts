import { CommandBus } from "../command/CommandBus.js";
import type { MapId, Tileset } from "../map/types.js";
import type { MapDocument } from "../model/MapDocument.js";
import type { CfruProject } from "../project/CfruProject.js";
import type { McpMapEntry, McpPermissions, McpWorkspace } from "./McpToolRunner.js";

/** CoreMcpWorkspace の作り方の指定。 */
export interface CoreMcpWorkspaceOptions {
  /** 許可（画面なしの形では起動の引数で決める）。 */
  readonly permissions: McpPermissions;
  /** 書き換えを断る理由を答える（ZigzaguMap が同じプロジェクトを開いているかを見る。無ければいつも書ける）。 */
  readonly writeBlocked?: () => string | null;
  /** 種族名（無ければ空の一覧）。 */
  readonly speciesNames?: () => Promise<readonly (string | null)[]>;
  /** 出力（省略すると CfruProject.save。画面なしの形はラベルなども書く関数を渡す）。 */
  readonly save?: () => Promise<{ readonly written: readonly string[]; readonly removed: readonly string[] }>;
  /** 出力が .s などスクリプトのファイルも書くか（省略すると書かない）。 */
  readonly exportTouchesScripts?: () => boolean;
}

/**
 * 画面を使わず、core の CfruProject を MCP の道具から読み書きする相手（#522 の画面なしの形と、道具のテスト）。
 * 開いているマップは 1 枚だけ覚える。書き換えは自分の CommandBus に積む。
 */
export class CoreMcpWorkspace implements McpWorkspace {
  private readonly history: CommandBus;
  private opened: { id: MapId; doc: MapDocument } | null = null;

  private constructor(
    readonly project: CfruProject,
    private readonly list: readonly McpMapEntry[],
    private readonly options: CoreMcpWorkspaceOptions,
  ) {
    this.history = new CommandBus(project.editorContext());
  }

  /** プロジェクトから作る（マップの一覧の名前を、各マップのヘッダーの地名から引く）。 */
  static async create(project: CfruProject, options: CoreMcpWorkspaceOptions): Promise<CoreMcpWorkspace> {
    const list: McpMapEntry[] = [];
    for (const id of project.mapIds()) {
      let name = "";
      try {
        const doc = project.loaded(id) ?? (await project.peek(id));
        if (doc) {
          const region = doc.header.regionMapSectionId;
          const edited = project.editorContext().mapNameEdit(region);
          name = (edited ? project.textCodec.decode(edited) : project.base.nameTable.name(region)) ?? "";
        }
      } catch {
        name = "";
      }
      list.push({ bank: id.bank, map: id.map, name });
    }
    return new CoreMcpWorkspace(project, list, options);
  }

  notReady(): string | null {
    return null;
  }

  maps(): readonly McpMapEntry[] {
    return this.list;
  }

  current(): { readonly id: MapId; readonly doc: MapDocument } | null {
    return this.opened;
  }

  async open(id: MapId): Promise<void> {
    this.opened = { id, doc: await this.project.load(id) };
  }

  peek(id: MapId): Promise<MapDocument | null> {
    const loaded = this.project.loaded(id);
    return loaded ? Promise.resolve(loaded) : this.project.peek(id);
  }

  bus(): CommandBus {
    return this.history;
  }

  tilesets(doc: MapDocument): Promise<{ primary: Tileset; secondary: Tileset }> {
    return this.project.loadTilesets(doc);
  }

  speciesNames(): Promise<readonly (string | null)[]> {
    return this.options.speciesNames?.() ?? Promise.resolve([]);
  }

  modifiedMaps(): readonly MapId[] {
    return this.project.mapIds().filter((id) => this.project.loaded(id) && this.project.isModified(id));
  }

  exportTouchesScripts(): boolean {
    return this.options.exportTouchesScripts?.() ?? false;
  }

  export(): Promise<{ readonly written: readonly string[]; readonly removed: readonly string[] }> {
    return this.options.save?.() ?? this.project.save();
  }

  permissions(): McpPermissions {
    return this.options.permissions;
  }

  writeBlocked(): string | null {
    return this.options.writeBlocked?.() ?? null;
  }
}
