import { jaMcp as t } from "../../i18n/ja.mcp";
import type { App } from "../App";
import type { SettingsData } from "../Settings";
import type { McpBridgeHost } from "./McpBridgeHost";

/** 設定 > MCP の窓口 の許可の項目と、対応する個人設定。 */
const PERMISSION_TOGGLES: Readonly<Record<string, keyof SettingsData>> = {
  "mcp.allowWrite": "mcpAllowWrite",
  "mcp.allowExport": "mcpAllowExport",
  "mcp.allowScripts": "mcpAllowScripts",
};

/**
 * 設定 > MCP の窓口（#521）。窓口を開く・閉じる、AI に許す操作の切り替え。窓口の中身（McpBridgeHost）は、
 * オンにしたときに初めて読み込む（オフのままなら起動の時間とメモリを変えない）。
 */
export class McpBridgeControl {
  private host: McpBridgeHost | null = null;

  constructor(private readonly app: App) {
    const { actions, state } = app;
    const data = state.settings.data;
    actions.register("mcp.bridge", () => this.setBridge(!data.mcpBridge));
    actions.registerCheck("mcp.bridge", () => data.mcpBridge);
    for (const [id, key] of Object.entries(PERMISSION_TOGGLES)) {
      actions.register(id, () => state.settings.update({ [key]: !data[key] }));
      actions.registerCheck(id, () => data[key] === true);
    }
  }

  /** 起動のとき: 設定でオンなら窓口を開く。 */
  async startIfEnabled(): Promise<void> {
    if (this.app.state.settings.data.mcpBridge) await this.open();
  }

  /** 窓口を開く・閉じる（設定に覚える）。 */
  async setBridge(on: boolean): Promise<void> {
    this.app.state.settings.update({ mcpBridge: on });
    if (on) await this.open();
    else await this.close();
  }

  private async open(): Promise<void> {
    try {
      if (!this.host) this.host = new (await import("./McpBridgeHost")).McpBridgeHost(this.app);
      const port = await this.host.start();
      this.app.state.setStatus(t.opened(port));
    } catch (e) {
      this.app.state.setStatus(t.openFailed(e instanceof Error ? e.message : String(e)), undefined, true);
    }
  }

  private async close(): Promise<void> {
    if (!this.host) return;
    await this.host.stop();
    this.app.state.setStatus(t.closed);
  }
}
