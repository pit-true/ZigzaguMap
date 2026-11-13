// 起動からマップ表示までの時間と、マップの切り替えの時間を測る（軽さの目標: 1 秒以内・100ms 以内）。
// 使い方: node scripts/measure-startup.mjs --exe <zigzagumap.exe> --rom <素の BPRJ> [--port 17996] [--runs 5]
//
// - 毎回、一時フォルダの --profile に「最後に選択したものを覚える」と前回のマップ（3.0）を書いた settings.json を置き、
//   `zigzagumap.exe --automation <ポート> --profile <一時フォルダ> <ROM>` で起動する（通常の個人設定には触れない。画面外・非アクティブ）。
// - 起動時間 = exe を起動してから、マップを描いた時刻（画面側の記録 `mapShown`）まで。
// - 切り替え時間 = 自動操作の `selectMap` の返事の `switchMs`（読み込み・描画・一覧の更新まで）。10 枚を順に開く。
// - 終わったら `exit` で閉じる（閉じなければ自分が起動したプロセスだけを終わらせる）。一時フォルダも消す。
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const opts = { port: "17996", runs: "5" };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) opts[argv[i].replace(/^--/, "")] = argv[i + 1];
if (!opts.exe || !opts.rom) {
  console.error("使い方: node scripts/measure-startup.mjs --exe <zigzagumap.exe> --rom <素の BPRJ> [--port 17996] [--runs 5]");
  process.exit(2);
}
const port = Number(opts.port);
const runs = Number(opts.runs);
const SWITCH_MAPS = [[3, 1], [3, 3], [3, 19], [4, 1], [1, 1], [3, 37], [3, 45], [3, 50], [5, 0], [3, 0]];

async function call(body) {
  const res = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: JSON.stringify(body) });
  const reply = await res.json();
  if (!reply.ok) throw new Error(reply.error);
  return reply.result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measureOnce() {
  const profile = mkdtempSync(join(tmpdir(), "zzm-startup-"));
  writeFileSync(
    join(profile, "settings.json"),
    JSON.stringify({ rememberLast: true, last: { rom: opts.rom, bank: 3, map: 0, tab: "map" } }),
  );
  const start = Date.now();
  const proc = spawn(opts.exe, ["--automation", String(port), "--profile", profile, opts.rom], { stdio: "ignore" });
  try {
    let state = null;
    for (let i = 0; i < 300; i++) {
      try {
        state = await call({ cmd: "state" });
        if (state.map) break;
      } catch {
        // 入口がまだ応答しない
      }
      await sleep(50);
    }
    if (!state?.map) throw new Error("マップが開きませんでした");
    const { origin, marks } = state.timings;
    const startupMs = origin + marks.mapShown - start;
    const switches = [];
    for (const [bank, map] of SWITCH_MAPS) switches.push((await call({ cmd: "selectMap", bank, map })).switchMs);
    return { startupMs, pageToMapMs: marks.mapShown, switches };
  } finally {
    await call({ cmd: "exit" }).catch(() => undefined);
    for (let i = 0; i < 40 && proc.exitCode === null; i++) await sleep(100);
    if (proc.exitCode === null) spawnSync("taskkill", ["/T", "/F", "/PID", String(proc.pid)]);
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
  }
}

const results = [];
for (let i = 0; i < runs; i++) {
  const r = await measureOnce();
  results.push(r);
  console.log(
    `${i + 1} 回目: 起動→マップ表示 ${r.startupMs.toFixed(0)} ms（ページの読み込みから ${r.pageToMapMs.toFixed(0)} ms）、` +
      `切り替え 最大 ${Math.max(...r.switches).toFixed(1)} ms`,
  );
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const allSwitches = results.flatMap((r) => r.switches);
console.log(`起動→マップ表示: 中央値 ${median(results.map((r) => r.startupMs)).toFixed(0)} ms、最大 ${Math.max(...results.map((r) => r.startupMs)).toFixed(0)} ms`);
console.log(`マップの切り替え: 中央値 ${median(allSwitches).toFixed(1)} ms、最大 ${Math.max(...allSwitches).toFixed(1)} ms（${allSwitches.length} 回）`);
