import type { App } from "../App";
import { type AutomationRequest, type CommandTable } from "./registry";

/**
 * ミキシングバッグ（#236）。
 * - `bag.state`: 袋の中身（`blocks`）と、今の選択に袋を使うか（`active`）。
 * - `bag.set {blocks, seed?}`: 袋の中身を置き換える（Ctrl＋パレットの左クリックで入れたのと同じ）。`seed` で乱数の種を決める（テスト用）。
 */
function state(app: App): unknown {
  return { blocks: [...app.mixingBag.blocks], active: app.mixingBag.appliesTo(app.state.selection) };
}

function set(app: App, req: AutomationRequest): unknown {
  const blocks = req["blocks"];
  if (!Array.isArray(blocks) || !blocks.every((b) => Number.isInteger(b) && (b as number) >= 0 && (b as number) <= 0x3ff)) throw new Error("blocks はブロック番号（0〜0x3FF）の配列です");
  const seed = req["seed"];
  app.mixingBag.set(blocks as number[], typeof seed === "number" ? seed : undefined);
  return state(app);
}

export const bagCommands: CommandTable = {
  "bag.state": state,
  "bag.set": set,
};
