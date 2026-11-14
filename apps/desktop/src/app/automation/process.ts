import { ProcessRunner, type ProcessExit, type ProcessSpec, type RunningProcess } from "../../util/processRunner";
import { optStr, str, type AutomationRequest, type CommandTable } from "./registry";

/**
 * 外部コマンドの確認（`process.run` / `process.start` / `process.output` / `process.kill` / `process.launch` / `process.launched`）。
 * 自動操作の入口と同じく、`--automation` で起動したときだけ読み込む。
 */

/** `process.start` で起動したもの（ID → 状態）。 */
const started = new Map<string, { proc: RunningProcess; exit: ProcessExit | null }>();

function spec(req: AutomationRequest): ProcessSpec {
  const args = req["args"] ?? [];
  if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) throw new Error("args は文字列の配列で指定してください");
  return { command: str(req, "command"), args, cwd: optStr(req, "cwd") };
}

function describe(proc: RunningProcess, exit: ProcessExit | null): unknown {
  return { id: proc.id, cwd: proc.cwd, lines: proc.lines, done: exit !== null, code: exit?.code ?? null, killed: exit?.killed ?? false };
}

export const processCommands: CommandTable = {
  "process.run": async (_app, req) => {
    // 起動して終わるまで待つ（`timeout` ミリ秒、既定 30 秒を過ぎたら止めて返す）。
    const runner = await ProcessRunner.get();
    const proc = await runner.spawn(spec(req));
    const timeout = typeof req["timeout"] === "number" ? req["timeout"] : 30_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exit = await Promise.race([proc.done, new Promise<null>((r) => (timer = setTimeout(() => r(null), timeout)))]);
    clearTimeout(timer);
    if (exit) return describe(proc, exit);
    await proc.kill();
    return { ...(describe(proc, await proc.done) as object), timedOut: true };
  },
  "process.start": async (_app, req) => {
    const runner = await ProcessRunner.get();
    const proc = await runner.spawn(spec(req));
    const entry = { proc, exit: null as ProcessExit | null };
    started.set(proc.id, entry);
    void proc.done.then((e) => (entry.exit = e));
    return { id: proc.id, cwd: proc.cwd };
  },
  "process.output": (_app, req) => {
    const entry = started.get(str(req, "id"));
    if (!entry) throw new Error(`起動していない ID です: ${str(req, "id")}`);
    return describe(entry.proc, entry.exit);
  },
  "process.kill": async (_app, req) => {
    const entry = started.get(str(req, "id"));
    if (!entry) throw new Error(`起動していない ID です: ${str(req, "id")}`);
    const killed = await entry.proc.kill();
    entry.exit = await entry.proc.done;
    return { killed, ...(describe(entry.proc, entry.exit) as object) };
  },
  "process.launch": async (_app, req) => ({ launched: await ProcessRunner.launch(spec(req)) }),
  "process.launched": async () => ProcessRunner.launched(),
};
