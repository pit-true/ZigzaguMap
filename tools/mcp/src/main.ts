/**
 * ZigzaguMap の MCP サーバー（Phase7 #521・#522）。Node 22 で動き、MCP のクライアント（Claude Code など）と stdio でやり取りする。
 * ネットワークの待ち受けはしない。使い方は docs/mcp.md。
 *
 *   node zigzagumap-mcp.mjs [--profile <ZigzaguMap の個人設定のフォルダ>]
 *     開いている ZigzaguMap（設定 > MCP の窓口 をオン）につなぐ。
 */
import { createInterface } from "node:readline";
import { McpServer, type McpCallTool } from "@zigzagumap/core";
import { BridgeClient, defaultProfileDir } from "./bridge.js";

/** 起動の引数。 */
export interface McpArgs {
  readonly profile: string | null;
}

/** 起動の引数を読む（知らない引数は Error）。 */
export function parseArgs(argv: readonly string[]): McpArgs {
  let profile: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} の後に値を書いてください`);
      return v;
    };
    if (a === "--profile") profile = value();
    else throw new Error(`知らない引数です: ${a}`);
  }
  return { profile };
}

/** stdio の 1 行 1 通の受け答えを始める（stdin が閉じたら終わる）。 */
export function serveStdio(callTool: McpCallTool, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const server = new McpServer(callTool);
  const lines = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  lines.on("line", (line) => {
    if (line.trim() === "") return;
    const p = server.handleLine(line).then((reply) => {
      if (reply !== null) output.write(reply + "\n");
    });
    pending.add(p);
    void p.finally(() => pending.delete(p));
  });
  return new Promise((resolve) => lines.on("close", () => void Promise.all(pending).then(() => resolve())));
}

/** 起動の入口（src/cli.ts から呼ぶ）。 */
export async function main(): Promise<void> {
  let args: McpArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`zigzagumap-mcp: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
  const bridge = new BridgeClient(args.profile ?? defaultProfileDir());
  process.stderr.write(`zigzagumap-mcp: 開いている ZigzaguMap につなぎます（${bridge.infoPath}）\n`);
  await serveStdio((name, a) => bridge.call(name, a));
}

