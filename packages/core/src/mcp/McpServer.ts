/**
 * MCP の JSON-RPC の受け答え（Phase7 #521）。送り方（stdio）は持たず、届いた 1 通に返事を 1 通（か無し）返す。
 *
 * 仕様は https://modelcontextprotocol.io/specification の 2026-07-28 版（毎回の頼みに `_meta` で版を付ける形）と、
 * それより前の `initialize` で始める形（2025-11-25 まで）の両方に答える（仕様の「Dual-era」）。
 * - 新しい形: `server/discover`、`tools/list`、`tools/call`。`_meta` の `io.modelcontextprotocol/protocolVersion` を見て、
 *   知らない版なら -32022（UnsupportedProtocolVersion）。
 * - 前の形: `initialize` の返事で版を決め、以後の `_meta` の無い頼みに答える。`notifications/initialized` などの通知には返事しない。
 */

import { MCP_TOOLS } from "./tools.js";
import type { McpToolResult } from "./McpToolRunner.js";

/** 新しい形の版。 */
export const MCP_MODERN_VERSIONS = ["2026-07-28"] as const;
/** 前の形の版（新しい順。`initialize` で知らない版を頼まれたら先頭を返す）。 */
export const MCP_LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** サーバーの名前と版。 */
export const MCP_SERVER_INFO = { name: "zigzagumap", title: "ZigzaguMap", version: "0.7.0" } as const;

/** AI に渡す使い方の説明。 */
export const MCP_INSTRUCTIONS =
  "ZigzaguMap（CFRU-JP 用のマップエディタ）のマップを読み書きする道具。maps_list でマップを探し、map_open で開いてから map_ で始まる道具を使う。" +
  "書き換えは ZigzaguMap の「元に戻す」に乗り、project_export で出力するまでファイルは変わらない。書き換えと出力は、ZigzaguMap の設定で許可したときだけ使える。";

const VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";

/** JSON-RPC の 1 通。 */
type JsonRpcMessage = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

/** 道具を呼ぶ相手（知らない道具なら null）。 */
export type McpCallTool = (name: string, args: unknown) => Promise<McpToolResult | null>;

/** MCP の JSON-RPC の受け答え。 */
export class McpServer {
  /** 前の形で `initialize` が済んだときの版。 */
  private legacyVersion: string | null = null;

  constructor(private readonly callTool: McpCallTool) {}

  /** 届いた 1 行（JSON）に答える。返事が要らなければ null。 */
  async handleLine(line: string): Promise<string | null> {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return JSON.stringify(errorResponse(null, -32700, "JSON が読めません"));
    }
    const reply = await this.handle(message);
    return reply === null ? null : JSON.stringify(reply);
  }

  /** 届いた 1 通に答える。返事が要らなければ null。 */
  async handle(message: unknown): Promise<object | null> {
    if (Array.isArray(message) || typeof message !== "object" || message === null) return errorResponse(null, -32600, "JSON-RPC の頼みではありません");
    const m = message as JsonRpcMessage;
    const isRequest = typeof m.id === "string" || (typeof m.id === "number" && Number.isInteger(m.id));
    if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return isRequest ? errorResponse(m.id, -32600, "JSON-RPC 2.0 の頼みではありません") : null;
    // 通知（id の無いもの）には返事しない
    if (!isRequest) return null;
    const id = m.id as string | number;
    const params = (typeof m.params === "object" && m.params !== null ? m.params : {}) as Record<string, unknown>;
    try {
      return await this.request(id, m.method, params);
    } catch (e) {
      return errorResponse(id, -32603, e instanceof Error ? e.message : String(e));
    }
  }

  private async request(id: string | number, method: string, params: Record<string, unknown>): Promise<object> {
    if (method === "initialize") return this.initialize(id, params);
    const meta = typeof params["_meta"] === "object" && params["_meta"] !== null ? (params["_meta"] as Record<string, unknown>) : null;
    const version = meta?.[VERSION_KEY];
    let modern = false;
    if (version !== undefined) {
      if (!(MCP_MODERN_VERSIONS as readonly unknown[]).includes(version) && version !== this.legacyVersion) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32022, message: "Unsupported protocol version", data: { supported: [...MCP_MODERN_VERSIONS, ...MCP_LEGACY_VERSIONS], requested: version } },
        };
      }
      modern = version !== this.legacyVersion;
      if (modern && (typeof meta?.[CAPABILITIES_KEY] !== "object" || meta?.[CAPABILITIES_KEY] === null)) {
        return errorResponse(id, -32602, `_meta に ${CAPABILITIES_KEY} がありません`);
      }
    } else if (this.legacyVersion === null && method !== "ping") {
      return errorResponse(id, -32602, `_meta に ${VERSION_KEY} がありません（前のバージョンの形なら、先に initialize を送ってください）`);
    }
    const result = (body: Record<string, unknown>) => ({ jsonrpc: "2.0", id, result: modern ? { resultType: "complete", ...body, _meta: { [SERVER_INFO_KEY]: MCP_SERVER_INFO } } : body });
    switch (method) {
      case "server/discover":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "complete",
            supportedVersions: [...MCP_MODERN_VERSIONS],
            capabilities: { tools: {} },
            instructions: MCP_INSTRUCTIONS,
            _meta: { [SERVER_INFO_KEY]: MCP_SERVER_INFO },
          },
        };
      case "ping":
        return result({});
      case "tools/list":
        return result({ tools: toolList() });
      case "tools/call": {
        const name = params["name"];
        if (typeof name !== "string") return errorResponse(id, -32602, "name がありません");
        const reply = await this.callTool(name, params["arguments"] ?? {});
        if (!reply) return errorResponse(id, -32602, `知らない道具です: ${name}`);
        return result({ ...reply });
      }
      default:
        return errorResponse(id, -32601, `知らないメソッドです: ${method}`);
    }
  }

  private initialize(id: string | number, params: Record<string, unknown>): object {
    const asked = params["protocolVersion"];
    const version = (MCP_LEGACY_VERSIONS as readonly unknown[]).includes(asked) ? (asked as string) : MCP_LEGACY_VERSIONS[0];
    this.legacyVersion = version;
    return {
      jsonrpc: "2.0",
      id,
      result: { protocolVersion: version, capabilities: { tools: {} }, serverInfo: MCP_SERVER_INFO, instructions: MCP_INSTRUCTIONS },
    };
  }
}

/** `tools/list` の道具の一覧。 */
export function toolList(): object[] {
  return MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      readOnlyHint: t.kind === "read",
      destructiveHint: false,
      idempotentHint: t.kind === "read",
      openWorldHint: false,
    },
  }));
}

function errorResponse(id: unknown, code: number, message: string): object {
  return { jsonrpc: "2.0", id: typeof id === "string" || typeof id === "number" ? id : null, error: { code, message } };
}
