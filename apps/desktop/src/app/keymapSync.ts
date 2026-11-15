import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { applyKeyOverrides } from "./keymap";

/**
 * ショートカットキー（個人設定 `shortcuts`。#392）をメインと別ウィンドウでそろえる。テーマ（`util/theme.ts`）と同じ形。
 * メインが変えたら全ウィンドウへ送り、別ウィンドウは開いたときに settings.json で当ててからメインに今の値を問い合わせる。
 */

/** メイン → 別ウィンドウ: キーが変わった（値は `shortcuts`）。 */
const KEYMAP_EVENT = "shortcuts";
/** 別ウィンドウ → メイン: 今のキーを送ってほしい（開いたとき）。 */
const KEYMAP_REQUEST_EVENT = "shortcuts-request";

/** メインウィンドウ側。`current` が今の設定の値を返す。`sync` で当て直して別ウィンドウへも送る。 */
export function startMainKeymap(current: () => unknown): { sync(): void } {
  const sync = (): void => {
    applyKeyOverrides(current());
    void emit(KEYMAP_EVENT, current()).catch(() => undefined);
  };
  applyKeyOverrides(current());
  void listen(KEYMAP_REQUEST_EVENT, () => void emit(KEYMAP_EVENT, current()).catch(() => undefined)).catch(() => undefined);
  return { sync };
}

/** 別ウィンドウ側。 */
export async function followMainKeymap(): Promise<void> {
  await listen<unknown>(KEYMAP_EVENT, (e) => applyKeyOverrides(e.payload)).catch(() => undefined);
  try {
    const text = await invoke<string>("load_settings");
    if (text) applyKeyOverrides((JSON.parse(text) as { shortcuts?: unknown }).shortcuts);
  } catch {
    // 読めなければ既定のキーのまま（すぐあとにメインから届く）
  }
  await emitTo("main", KEYMAP_REQUEST_EVENT).catch(() => undefined);
}
