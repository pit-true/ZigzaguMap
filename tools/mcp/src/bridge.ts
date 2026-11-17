import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { mcpTool, type McpToolResult } from "@zigzagumap/core";

/** ZigzaguMap の個人設定のフォルダ（`%APPDATA%\io.github.pit-true.zigzagumap`）。 */
export function defaultProfileDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["APPDATA"] ?? join(homedir(), ".config");
  return join(base, "io.github.pit-true.zigzagumap");
}

/** `mcp.json` の中身（ZigzaguMap が窓口を開いたときに書く）。 */
interface BridgeInfo {
  readonly port: number;
  readonly token: string;
}

/** 道具の呼び出しの待ち時間（ZigzaguMap の側の上限より少し長く）。 */
const CALL_TIMEOUT_MS = 130_000;

const NOT_OPEN =
  "ZigzaguMap が開いていないか、MCP の窓口がオフです。ZigzaguMap を起動し、設定 > MCP の窓口 >「MCP の窓口を開く」をオンにしてください。";

function failure(text: string): McpToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * 開いている ZigzaguMap につなぐ形（#521）。道具を呼ぶたびに `mcp.json` を読み直し（ZigzaguMap を開き直しても続けて使える）、
 * 127.0.0.1 の窓口へ合言葉を付けて送る。道具の中身と許可の判断は ZigzaguMap の側で行う。
 */
export class BridgeClient {
  constructor(
    private readonly profileDir: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** `mcp.json` の場所。 */
  get infoPath(): string {
    return join(this.profileDir, "mcp.json");
  }

  /** 道具を呼ぶ。知らない道具なら null。 */
  async call(name: string, args: unknown): Promise<McpToolResult | null> {
    if (!mcpTool(name)) return null;
    const info = await this.readInfo();
    if (!info) return failure(NOT_OPEN);
    let response: Response;
    try {
      response = await this.fetcher(`http://127.0.0.1:${info.port}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${info.token}` },
        body: JSON.stringify({ tool: name, arguments: args ?? {} }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch {
      return failure(NOT_OPEN);
    }
    const text = await response.text();
    if (response.status === 401) return failure("ZigzaguMap の窓口に断られました（合言葉が合いません）。ZigzaguMap を開き直したときは、もう一度呼んでください。");
    if (!response.ok) return failure(`ZigzaguMap の窓口に断られました（${response.status}）: ${text}`);
    try {
      const reply = JSON.parse(text) as McpToolResult;
      if (!Array.isArray(reply.content)) throw new Error("content がありません");
      return reply;
    } catch (e) {
      return failure(`ZigzaguMap の返事が読めません: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async readInfo(): Promise<BridgeInfo | null> {
    try {
      const v = JSON.parse(await readFile(this.infoPath, "utf8")) as Partial<BridgeInfo>;
      if (typeof v.port !== "number" || typeof v.token !== "string") return null;
      return { port: v.port, token: v.token };
    } catch {
      return null;
    }
  }
}
