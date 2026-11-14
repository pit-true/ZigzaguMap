/** `--js-flags=--expose-gc` のときに使える V8 の GC（src-tauri/src/lib.rs の BROWSER_ARGS）。 */
type GcFunction = (options?: {
  type?: "major" | "minor";
  execution?: "sync" | "async";
  /** `last-resort` は、集めたあとの空いた領域も OS へ返す（V8 の CollectAllAvailableGarbage）。 */
  flavor?: "regular" | "last-resort";
}) => void;

/** 最後の操作から GC するまでの時間（ms）。 */
const DELAY_MS = 1500;

let timer: ReturnType<typeof setTimeout> | null = null;
let release = false;

/**
 * 操作が落ち着いたら（最後に呼ばれてから 1.5 秒後の手の空いたとき）、V8 の GC を 1 回走らせる。
 * マップを切り替えると、前のマップの画像やタイルセットの描画のごみが残る。V8 はヒープが大きくなるまで集めないので、
 * 何枚か切り替えたあとに専用ワーキングセットが 150MB を超えることがあった。`gc` が無い（--expose-gc を付けていない）ときは何もしない。
 *
 * `releaseMemory` を付けると、集めたあとの空いた領域もすぐ OS へ返す（スクリプトエディタの読み込みのあと。
 * ふだんの GC では、空いた領域を V8 が 30 秒ほど持ったままにするため、その間は専用ワーキングセットが 20MB ほど多く見える）。
 * 待っている間に一度でも付けて呼べば、その回は返す。
 */
export function scheduleIdleGc(releaseMemory = false): void {
  const gc = (globalThis as { gc?: GcFunction }).gc;
  if (typeof gc !== "function") return;
  release ||= releaseMemory;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const flavor = release ? "last-resort" : "regular";
    release = false;
    const run = (): void => {
      try {
        gc({ type: "major", execution: "async", flavor });
      } catch {
        gc();
      }
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 });
    else run();
  }, DELAY_MS);
}
