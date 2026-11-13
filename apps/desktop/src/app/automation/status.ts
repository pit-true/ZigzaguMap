import { getCurrentWindow } from "@tauri-apps/api/window";
import type { App } from "../App";
import { EventTab } from "../../ui/event/EventTab";
import { mouseCommands } from "./mouse";
import { int, settle, type AutomationRequest, type CommandTable } from "./registry";

/**
 * ステータスバー・題名・選択中のもの（`status` / `title` / `selection` / `selectMovement`）。
 */

/** 選択中のブロック・移動許可・イベントとステータスバー（マウス操作の返事にも使う）。 */
export function describeSelection(app: App): Record<string, unknown> {
  const s = app.state;
  const tab = app.tabs.event;
  return {
    block: s.selection,
    movement: s.movement,
    event: tab instanceof EventTab ? { ...tab.selection, count: tab.count() } : null,
    status: s.status,
  };
}

/** ステータスバーの各欄（画面に出ている文字列）。 */
function statusPanels(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".status-bar .status-panel")].map((p) => p.textContent ?? "");
}

export const statusCommands: CommandTable = {
  status: (app) => ({ panels: statusPanels(), left: app.state.status.left, right: app.state.status.right, error: app.state.status.error }),
  title: async () => ({ document: document.title, window: await getCurrentWindow().title() }),
  selection: (app) => describeSelection(app),
  /** 移動許可の選択を変える（移動許可のパレットの値のマスを左クリックするのと同じ）。 */
  selectMovement: async (app, req: AutomationRequest) => {
    const value = int(req, "value");
    if (app.state.tab !== "movement") {
      // パレットは移動エリアタブにあるので、見えていなければ値だけ変える（画面のクリックと同じ処理を通す）
      app.state.selectMovement(value);
      await settle();
      return describeSelection(app);
    }
    return mouseCommands["mouse"]!(app, { target: "movementPalette", action: "click", cell: [0, value] });
  },
};
