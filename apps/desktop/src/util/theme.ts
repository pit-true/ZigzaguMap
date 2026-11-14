import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 画面のテーマ（個人設定 `theme`。明るい標準色とダーク）。
 * `<html data-theme="dark">` にすると base.css の `:root[data-theme="dark"]` の色になる。
 * マップやタイルの canvas の色は変えない（データなので）。
 * スクリプトエディタの別ウィンドウは自分のテーマ（`scriptEditorTheme`）を持つので、これを使わない。
 */
export type Theme = "light" | "dark";

/** メイン → 別ウィンドウ: テーマが変わった（値は Theme）。全ウィンドウへ送る。 */
const THEME_EVENT = "theme";
/** 別ウィンドウ → メイン: 今のテーマを送ってほしい（開いたとき）。 */
const THEME_REQUEST_EVENT = "theme-request";

/** 設定の値をテーマにする（知らない値は明るい標準色）。 */
export function toTheme(value: unknown): Theme {
  return value === "dark" ? "dark" : "light";
}

/** このウィンドウの見た目をテーマにする（題名の帯も。明るい標準色では今までどおり Windows の設定に任せる）。 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const dark = theme === "dark";
  const wasDark = root.dataset["theme"] === "dark";
  if (dark) root.dataset["theme"] = "dark";
  else delete root.dataset["theme"];
  // 明るい標準色のまま起動したときは題名の帯に触れない（今までと同じ）
  if (dark || wasDark) void getCurrentWindow().setTheme(dark ? "dark" : null).catch(() => undefined);
}

/**
 * メインウィンドウ側。`current` が今の設定の値を返す。`sync` を呼ぶと、変わっていれば
 * このウィンドウに当て、開いている別ウィンドウへも送る。別ウィンドウが開いたときの問い合わせにも答える。
 */
export function startMainTheme(current: () => Theme): { sync(): void } {
  let applied: Theme | null = null;
  const sync = (): void => {
    const theme = current();
    if (theme === applied) return;
    applied = theme;
    applyTheme(theme);
    void emit(THEME_EVENT, theme).catch(() => undefined);
  };
  sync();
  void listen(THEME_REQUEST_EVENT, () => void emit(THEME_EVENT, current()).catch(() => undefined)).catch(() => undefined);
  return { sync };
}

/**
 * 別ウィンドウ側。まず settings.json の値で当て（ちらつきを減らすため）、メインに今の値を問い合わせ、
 * そのあとはメインからの知らせに合わせる（自動操作の `setting` はファイルに残らないので、メインの値を正とする）。
 */
export async function followMainTheme(): Promise<void> {
  await listen<unknown>(THEME_EVENT, (e) => applyTheme(toTheme(e.payload))).catch(() => undefined);
  try {
    const text = await invoke<string>("load_settings");
    if (text) applyTheme(toTheme((JSON.parse(text) as { theme?: unknown }).theme));
  } catch {
    // 読めなければ明るい標準色のまま（すぐあとにメインから届く）
  }
  await emitTo("main", THEME_REQUEST_EVENT).catch(() => undefined);
}
