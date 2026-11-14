import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** 大きさを変えられるウィンドウの指定（Rust の ResizeOptions）。省略すると大きさ固定。 */
export interface ToolWindowResize {
  readonly minWidth?: number;
  readonly minHeight?: number;
  /** 前回の位置と大きさ（物理ピクセル。個人設定から渡す）。 */
  readonly placement?: unknown;
  /** 動かしたり大きさを変えたりしたら `tool-placement` を送ってもらう。 */
  readonly remember?: boolean;
}

/**
 * 別ウィンドウを開く（同じラベルのウィンドウがあれば前に出すだけ）。メインウィンドウ側の窓口
 * （ToolWindowHost・MapAssistHost・ScriptHost・ワールドマップ）が共通で使う。
 */
export async function openToolWindow(label: string, title: string, size: { readonly width: number; readonly height: number }, resize?: ToolWindowResize): Promise<void> {
  await invoke("open_tool_window", { label, title, width: size.width, height: size.height, ...(resize ? { resize } : {}) });
}

/** 別ウィンドウを閉じる（無ければ何もしない）。 */
export function closeToolWindow(label: string): Promise<void> {
  return invoke("close_tool_window", { label });
}

/** 別ウィンドウが閉じたとき（Rust が `tool-closed` にウィンドウのラベルを入れて送る）。 */
export function onToolWindowClosed(handler: (label: string) => void): Promise<() => void> {
  return listen<string>("tool-closed", (e) => handler(e.payload));
}

