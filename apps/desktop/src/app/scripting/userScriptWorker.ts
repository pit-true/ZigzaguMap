/// <reference lib="webworker" />
import { UserScriptRuntime, type HostToWorker, type UserScriptApi, type WorkerToHost } from "@zigzagumap/core";

/**
 * 利用者のスクリプトを動かす Web Worker（Phase5 #405）。スクリプトが使えるのは `zz`（決めた API）と `console` だけ。
 * ファイルや外部とのやり取りに使える関数（fetch・XMLHttpRequest・WebSocket・importScripts・IndexedDB など）は、
 * スクリプトを読み込む前に消す。Tauri の命令は Worker には届かない（IPC の入口が無い）。
 */
const scope = self as unknown as Record<string, unknown>;
const post = (m: WorkerToHost): void => postMessage(m);
for (const name of [
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

onmessage = (e: MessageEvent<HostToWorker>) => runtime.receive(e.data);
