/// <reference lib="webworker" />
import { UserScriptRuntime, type HostToWorker, type UserScriptApi, type WorkerToHost } from "@zigzagumap/core";

/**
 * 利用者のスクリプトを動かす Web Worker（Phase5 #405）。スクリプトが使えるのは `zz`（決めた API）と `console` だけ。
 * ファイルや外部とのやり取りに使える関数（fetch・XMLHttpRequest・WebSocket・importScripts・IndexedDB など）は、
 * スクリプトを読み込む前に消す。Tauri の命令は Worker には届かない（IPC の入口が無い）。
 */
const scope = self as unknown as Record<string, unknown>;
const post = (m: WorkerToHost): void => postMessage(m);
/** `--js-flags=--expose-gc` の GC（Worker にもある）。スクリプトからは使えないよう、下で消す前に持っておく。 */
const gc = typeof scope["gc"] === "function" ? (scope["gc"] as (options?: object) => void) : null;
for (const name of [
  "gc",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "importScripts",
  "indexedDB",
  "caches",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "WebTransport",
  "Request",
  "navigator",
]) {
  try {
    Object.defineProperty(scope, name, { value: undefined, configurable: false, writable: false });
  } catch {
    // 消せないものは無視する
  }
}

const consoleFor = (name: string) => {
  const write = (level: "log" | "warn" | "error") => (...values: unknown[]) =>
    post({ type: "log", level, text: `[${name}] ${values.map((v) => (typeof v === "string" ? v : safeJson(v))).join(" ")}` });
  return { log: write("log"), info: write("log"), warn: write("warn"), error: write("error") };
};

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const runtime = new UserScriptRuntime(post, (code: string, api: UserScriptApi, name: string) => {
  // スクリプトは厳格モードの関数として動かす（`zz` と `console` を引数で渡す）
  const run = new Function("zz", "console", `"use strict";\n${code}\n//# sourceURL=zigzagumap-scripts/${name}`) as (zz: UserScriptApi, c: unknown) => void;
  run(api, consoleFor(name));
});

/**
 * 頼みが落ち着いたら（最後に受けてから 1.5 秒後）、Worker の GC を 1 回走らせ、空いた領域も OS へ返す。
 * 全マップを読むスクリプト（count.js など）のあと、Worker のヒープが 10MB ほど大きいまま残っていた（#429）。
 */
let gcTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleWorkerGc(): void {
  if (!gc) return;
  if (gcTimer !== null) clearTimeout(gcTimer);
  gcTimer = setTimeout(() => {
    gcTimer = null;
    try {
      gc({ type: "major", execution: "async", flavor: "last-resort" });
    } catch {
      gc();
    }
  }, 1500);
}

onmessage = (e: MessageEvent<HostToWorker>) => {
  void Promise.resolve(runtime.receive(e.data)).finally(scheduleWorkerGc);
};
