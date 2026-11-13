import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Settings } from "./Settings";

/** 動かし終わってから保存するまでの待ち時間。 */
const SAVE_DELAY = 400;

/**
 * ウィンドウの位置と大きさを個人設定に覚える（次の起動では Rust 側が最初に当てる）。
 * 最大化中は、元の位置と大きさを残したまま「最大化」だけを覚える。最小化中と自動操作のときは覚えない。
 */
export async function keepWindowPlacement(settings: Settings): Promise<void> {
  const win = getCurrentWindow();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = async (): Promise<void> => {
    if (await win.isMinimized()) return;
    const maximized = await win.isMaximized();
    const prev = settings.data.window;
    if (maximized) {
      if (prev) settings.update({ window: { ...prev, maximized: true } });
      return;
    }
    const pos = await win.outerPosition();
    const size = await win.innerSize();
    settings.update({ window: { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized: false } });
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save().catch(() => undefined), SAVE_DELAY);
  };
  await win.onMoved(schedule);
  await win.onResized(schedule);
}
