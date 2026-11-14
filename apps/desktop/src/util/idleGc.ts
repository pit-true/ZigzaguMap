/** `--js-flags=--expose-gc` のときに使える V8 の GC（src-tauri/src/lib.rs の BROWSER_ARGS）。 */
type GcFunction = (options?: { type?: "major" | "minor"; execution?: "sync" | "async" }) => void;

/** 最後の操作から GC するまでの時間（ms）。 */
const DELAY_MS = 1500;

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * 操作が落ち着いたら（最後に呼ばれてから 1.5 秒後の手の空いたとき）、V8 の GC を 1 回走らせる。
 * マップを切り替えると、前のマップの画像やタイルセットの描画のごみが残る。V8 はヒープが大きくなるまで集めないので、
 * 何枚か切り替えたあとに専用ワーキングセットが 150MB を超えることがあった。`gc` が無い（--expose-gc を付けていない）ときは何もしない。
 */
export function scheduleIdleGc(): void {
  const gc = (globalThis as { gc?: GcFunction }).gc;
  if (typeof gc !== "function") return;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const run = (): void => {
      try {
        gc({ type: "major", execution: "async" });
      } catch {
        gc();
      }
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 });
    else run();
  }, DELAY_MS);
}
