import type { Actions } from "../../app/Actions";
import type { EditorState } from "../../app/EditorState";
import type { SettingsData } from "../../app/Settings";
import type { PlacedEvent } from "../map/EventLayer";

/** 表示メニューで隠せるイベントの種類（#304。フライトポジションは隠さない）。 */
export const TOGGLE_EVENT_KINDS = ["person", "sign", "trap", "warp"] as const;
export type ToggleEventKind = (typeof TOGGLE_EVENT_KINDS)[number];

/** 表示メニューの項目の ID（`view.eventKind.person` など）。 */
export function eventKindActionId(kind: ToggleEventKind): string {
  return `view.eventKind.${kind}`;
}

/** 隠していない種類のイベントだけを返す（隠したものは描かず、クリック・ホバーでも選ばない）。 */
export function visibleEvents(events: PlacedEvent[], hidden: readonly string[]): PlacedEvent[] {
  return hidden.length === 0 ? events : events.filter((e) => !hidden.includes(e.kind));
}

/** その種類を隠しているか。 */
export function isEventKindHidden(settings: SettingsData, kind: string): boolean {
  return settings.hiddenEventKinds.includes(kind);
}

/** 表示 > イベントの種類 の 4 項目を登録する（チェックが付いているものを描く。個人設定 `hiddenEventKinds`）。 */
export function registerEventKindActions(actions: Actions, state: EditorState, change: (patch: Partial<SettingsData>) => void): void {
  for (const kind of TOGGLE_EVENT_KINDS) {
    const id = eventKindActionId(kind);
    actions.registerCheck(id, () => !isEventKindHidden(state.settings.data, kind));
    actions.register(id, () => {
      const hidden = state.settings.data.hiddenEventKinds;
      change({ hiddenEventKinds: hidden.includes(kind) ? hidden.filter((k) => k !== kind) : [...hidden, kind] });
    });
  }
}
