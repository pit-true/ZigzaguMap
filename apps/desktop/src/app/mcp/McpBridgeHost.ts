import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { McpToolRunner, type McpToolResult } from "@zigzagumap/core";
import { jaMcp as t } from "../../i18n/ja.mcp";
import type { App } from "../App";
import { AppMcpWorkspace } from "./AppMcpWorkspace";

/** Rust から届く道具の呼び出し。 */
interface McpRequestEvent {
  readonly id: number;
  readonly request: { readonly tool: string; readonly arguments: unknown };
}

/** 合言葉（16 バイトの乱数の 16 進。起動ごと・開くごとに作り直す）。 */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * MCP の窓口の画面の側（#521）。設定で窓口をオンにしたときだけ読み込む。Rust の窓口（mcp_bridge.rs）が受けた道具の呼び出しを
 * `mcp-request` で受け、core の McpToolRunner で動かして返す。呼び出しは 1 つずつ順に動かす。
 */
export class McpBridgeHost {
  private readonly runner: McpToolRunner;
  private unlisten: UnlistenFn | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(app: App) {
    this.runner = new McpToolRunner(new AppMcpWorkspace(app));
  }

  /** 窓口を開く。開いたポートを返す。 */
  async start(): Promise<number> {
    if (!this.unlisten) this.unlisten = await listen<McpRequestEvent>("mcp-request", (e) => this.receive(e.payload));
    return invoke<number>("mcp_bridge_start", { token: newToken() });
  }

  /** 窓口を閉じる（mcp.json も消える）。 */
  async stop(): Promise<void> {
    await invoke("mcp_bridge_stop");
    this.unlisten?.();
    this.unlisten = null;
  }

  private receive({ id, request }: McpRequestEvent): void {
    this.queue = this.queue
      .then(() => this.run(request.tool, request.arguments))
      .then((result) => invoke("mcp_bridge_reply", { id, body: JSON.stringify(result) }));
  }

  private async run(tool: string, args: unknown): Promise<McpToolResult> {
    try {
      return (await this.runner.call(String(tool), args)) ?? { content: [{ type: "text", text: t.unknownTool(String(tool)) }], isError: true };
    } catch (e) {
      return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  }
}
