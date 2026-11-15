import type { App } from "../App";
import { KEY_ACTIONS, keyText } from "../keymap";
import type { CommandTable } from "./registry";

/**
 * ショートカットの変更（Phase5 #392）。
 * - `shortcuts.state`: 今のキー `keys`（操作の ID → 表記。2 つなら「、」で区切る。無ければ空）と、個人設定に残す形 `overrides`（既定と違うものだけ）。
 * 窓は `action` の `opt.shortcuts` で開き、キーの欄を `click` してから `key` 命令をその欄の ID へ送る（部品の ID は `ui/settings/ShortcutDialog.ts`）。
 */
function state(app: App): unknown {
  return {
    keys: Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, keyText(a.id)])),
    overrides: app.state.settings.data.shortcuts,
  };
}

export const shortcutCommands: CommandTable = {
  "shortcuts.state": state,
};
