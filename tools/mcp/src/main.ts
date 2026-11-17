/**
 * ZigzaguMap の MCP サーバー（Phase7 #521・#522）。Node 22 で動き、MCP のクライアント（Claude Code など）と stdio でやり取りする。
 * ネットワークの待ち受けはしない。使い方は docs/mcp.md。
 *
 *   node zigzagumap-mcp.mjs [--profile <ZigzaguMap の個人設定のフォルダ>]
 *     開いている ZigzaguMap（設定 > MCP の窓口 をオン）につなぐ。
 *   node zigzagumap-mcp.mjs --rom <ベース ROM> --project <プロジェクトフォルダ> [--allow-write] [--allow-export]
 *     ZigzaguMap を起動せずに、core でプロジェクトを開く（画面なしの形）。書き換えと出力は付けた許可の分だけ。
 */
import { createInterface } from "node:readline";
import { McpServer, McpToolRunner, type McpCallTool } from "@zigzagumap/core";
import { openHeadlessWorkspace } from "@zigzagumap/core/node";
import { BridgeClient, defaultProfileDir } from "./bridge.js";

/** 起動の引数。 */
export interface McpArgs {
  readonly profile: string | null;
  readonly rom: string | null;
  readonly project: string | null;
  readonly allowWrite: boolean;
  readonly allowExport: boolean;
}

/** 起動の引数を読む（知らない引数・組の足りない引数は Error）。 */
export function parseArgs(argv: readonly string[]): McpArgs {
  let profile: string | null = null;
  let rom: string | null = null;
  let project: string | null = null;
  let allowWrite = false;
  let allowExport = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} の後に値を書いてください`);
      return v;
    };
    if (a === "--profile") profile = value();
    else if (a === "--rom") rom = value();
    else if (a === "--project") project = value();
    else if (a === "--allow-write") allowWrite = true;
    else if (a === "--allow-export") allowExport = true;
    else throw new Error(`知らない引数です: ${a}`);
  }
  if ((rom === null) !== (project === null)) throw new Error("画面なしで使うときは --rom と --project を両方付けてください");
  if (rom === null && (allowWrite || allowExport)) throw new Error("--allow-write・--allow-export は画面なしの形（--rom・--project）で使います。開いている ZigzaguMap につなぐときの許可は ZigzaguMap の設定で決めます");
  if (rom !== null && profile !== null) throw new Error("--profile は開いている ZigzaguMap につなぐときだけ使います");
  return { profile, rom, project, allowWrite, allowExport };
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

/** 呼び出しを 1 つずつ順に動かす（画面なしの形で、書き換えが重ならないように）。 */
function serial(call: McpCallTool): McpCallTool {
  let queue: Promise<unknown> = Promise.resolve();
  return (name, args) => {
    const next = queue.then(() => call(name, args));
    queue = next.catch(() => undefined);
    return next;
  };
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
  if (args.rom !== null && args.project !== null) {
    let runner: McpToolRunner;
    try {
      const opened = await openHeadlessWorkspace({ rom: args.rom, project: args.project, permissions: { write: args.allowWrite, export: args.allowExport, scripts: false } });
      runner = new McpToolRunner(opened.workspace);
      process.stderr.write(`zigzagumap-mcp: 画面なしで開きました（${opened.projectDir}、${opened.openMs}ms。書き換え: ${args.allowWrite ? "許す" : "許さない"}、出力: ${args.allowExport ? "許す" : "許さない"}）\n`);
    } catch (e) {
      process.stderr.write(`zigzagumap-mcp: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    }
    await serveStdio(serial((name, a) => runner.call(name, a)));
    return;
  }
  const bridge = new BridgeClient(args.profile ?? defaultProfileDir());
  process.stderr.write(`zigzagumap-mcp: 開いている ZigzaguMap につなぎます（${bridge.infoPath}）\n`);
  await serveStdio((name, a) => bridge.call(name, a));
}
