import type { CommandBus, MapDocument, MapId, McpMapEntry, McpPermissions, McpWorkspace, Tileset } from "@zigzagumap/core";
import { jaMcp as t } from "../../i18n/ja.mcp";
import type { App } from "../App";

/**
 * MCP の道具が読み書きする相手としての、開いている ZigzaguMap（#521）。書き換えは開いているセッションの CommandBus に積むので、
 * 画面の「元に戻す」（Ctrl+Z）でも戻せ、未出力の印も付く。許可は個人設定（設定 > MCP の窓口）を呼ぶたびに読む。
 */
export class AppMcpWorkspace implements McpWorkspace {
  constructor(private readonly app: App) {}

  private session() {
    const s = this.app.state.session;
    if (!s) throw new Error(t.noRom);
    return s;
  }

  notReady(): string | null {
    return this.app.state.session ? null : t.noRom;
  }

  maps(): readonly McpMapEntry[] {
    return this.session().catalog.maps.map((m) => ({ bank: m.id.bank, map: m.id.map, name: m.name ?? "" }));
  }

  current(): { readonly id: MapId; readonly doc: MapDocument } | null {
    const m = this.app.state.map;
    return m ? { id: m.id, doc: m.doc } : null;
  }

  async open(id: MapId): Promise<void> {
    await this.app.openMap(id);
  }

  peek(id: MapId): Promise<MapDocument | null> {
    return this.session().project.peek(id);
  }

  bus(): CommandBus {
    return this.session().bus;
  }

  tilesets(doc: MapDocument): Promise<{ primary: Tileset; secondary: Tileset }> {
    return this.session().project.loadTilesets(doc);
  }

  async speciesNames(): Promise<readonly (string | null)[]> {
    const session = this.session();
    await session.openSpeciesNames();
    const names = session.speciesNames;
    return Array.from({ length: session.speciesCount }, (_, i) => names?.name(i, session.project.textCodec) ?? null);
  }

  modifiedMaps(): readonly MapId[] {
    return this.session().modifiedMaps();
  }

  exportTouchesScripts(): boolean {
    const s = this.session();
    return s.labels.isModified() || s.scriptsTable.pendingFiles().length > 0;
  }

  async export(): Promise<{ readonly written: readonly string[]; readonly removed: readonly string[] }> {
    const session = this.session();
    // 出力先はプロジェクトフォルダだけ（別のフォルダは選ばせない）
    if (!session.projectDir) throw new Error(t.noProject);
    const result = await session.export();
    this.app.changes.checkDirty(true);
    return result;
  }

  permissions(): McpPermissions {
    const d = this.app.state.settings.data;
    return { write: d.mcpAllowWrite, export: d.mcpAllowExport, scripts: d.mcpAllowScripts };
  }

  writeBlocked(): string | null {
    return null;
  }

  notify(text: string): void {
    this.app.state.setStatus(text);
  }
}
