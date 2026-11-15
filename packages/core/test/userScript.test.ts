import { describe, expect, it } from "vitest";
import {
  MemoryProjectFs,
  UserScriptRuntime,
  loadUserScriptListing,
  parseUserScriptSettings,
  saveUserScriptEnabled,
  type HostToWorker,
  type UserScriptApi,
  type WorkerToHost,
} from "../src/index.js";

describe("スクリプトの置き場所と有効にするもの（#405）", () => {
  it("zigzagumap.json の userScripts を読み書きし、ほかの節は残す", async () => {
    const fs = new MemoryProjectFs();
    fs.files.set("zigzagumap.json", JSON.stringify({ script: { dialect: "nd" } }));
    fs.files.set("zigzagumap-scripts/grass.js", "");
    fs.files.set("zigzagumap-scripts/count.js", "");
    fs.files.set("zigzagumap-scripts/readme.txt", "");
    expect(await loadUserScriptListing(fs)).toEqual({ files: ["count.js", "grass.js"], enabled: [] });
    await saveUserScriptEnabled(fs, ["grass.js", "gone.js"]);
    const root = JSON.parse(fs.files.get("zigzagumap.json") as string);
    expect(root.script).toEqual({ dialect: "nd" });
    expect(root.userScripts.enabled).toEqual(["grass.js", "gone.js"]);
    // ファイルが無いものは有効の一覧から外す
    expect((await loadUserScriptListing(fs)).enabled).toEqual(["grass.js"]);
  });

  it("フォルダの外を指す名前は受け付けない", () => {
    expect(() => parseUserScriptSettings(JSON.stringify({ userScripts: { enabled: ["../x.js"] } }))).toThrow();
    expect(() => parseUserScriptSettings(JSON.stringify({ userScripts: { enabled: ["a/b.js"] } }))).toThrow();
    expect(parseUserScriptSettings(null)).toEqual({ enabled: [] });
  });
});

/** ホストの代わり（API の返事をすぐ返す）。 */
function harness(answer: (method: string, args: readonly unknown[]) => unknown) {
  const sent: WorkerToHost[] = [];
  let runtime: UserScriptRuntime;
  const post = (m: WorkerToHost) => {
    sent.push(m);
    if (m.type === "call") queueMicrotask(() => runtime.receive({ type: "reply", id: m.id, ok: true, value: answer(m.method, m.args) }));
  };
  runtime = new UserScriptRuntime(post, (code, api: UserScriptApi) => new Function("zz", code)(api));
  const flush = () => new Promise((r) => setTimeout(r, 10));
  return { sent, runtime, flush, send: (m: HostToWorker) => runtime.receive(m) };
}

describe("Worker の中の API の橋渡し（#405）", () => {
  it("コールバックの中の呼び出しを begin と end で囲む", async () => {
    const h = harness((method) => (method === "map.getBlock" ? 7 : null));
    h.send({ type: "load", name: "a.js", code: "zz.on('blocksChanged', async (p) => { const b = await zz.map.getBlock(1, 2); await zz.map.setBlock(1, 2, b + p.add); });" });
    await h.flush();
    h.send({ type: "event", event: "blocksChanged", payload: { add: 1 } });
    await h.flush();
    const kinds = h.sent.map((m) => (m.type === "call" ? `${m.method}(${m.args.join(",")})` : m.type));
    expect(kinds).toEqual(["begin", "loaded", "end", "begin", "map.getBlock(1,2)", "map.setBlock(1,2,8)", "end"]);
  });

  it("登録した操作を動かす。エラーはログと end に出す", async () => {
    const h = harness(() => null);
    h.send({ type: "load", name: "b.js", code: "zz.registerAction('boom', 'こわす', () => { throw new Error('だめ'); });" });
    await h.flush();
    expect(h.sent.some((m) => m.type === "call" && m.method === "ui.registerAction" && m.args[0] === "boom")).toBe(true);
    h.send({ type: "action", id: "boom" });
    await h.flush();
    expect(h.sent.at(-1)).toEqual({ type: "end", error: "だめ" });
    expect(h.sent.some((m) => m.type === "log" && m.level === "error" && m.text.includes("だめ"))).toBe(true);
  });

  it("読み込みの失敗を知らせる", async () => {
    const h = harness(() => null);
    h.send({ type: "load", name: "c.js", code: "zz.on('nope', () => 0);" });
    await h.flush();
    expect(h.sent.find((m) => m.type === "loaded")).toEqual({ type: "loaded", name: "c.js", error: "知らないコールバックです: nope" });
  });
});
