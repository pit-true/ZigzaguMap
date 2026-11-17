import type { App } from "../App";
import { type AutomationRequest, type CommandTable } from "./registry";

/**
 * ミキシングバッグ（#236）。
 * - `bag.state`: 袋の中身（`blocks`）と、中身と同じ順の重み（`weights`。Phase7 #515）、今の選択に袋を使うか（`active`）。
 * - `bag.set {blocks, seed?, weights?}`: 袋の中身を置き換える（Ctrl＋パレットの左クリックで入れたのと同じ）。`seed` で乱数の種を決める（テスト用）。
 *   `weights` は中身と同じ順の重み（1〜9。無ければ全部 1）。
 * - `bag.weight {block, weight}`: 袋の中のブロックの重みを変える（袋の欄のホイール・数字キーと同じ。1〜9 に収める）。
 */
function state(app: App): unknown {
  const bag = app.mixingBag;
  return { blocks: [...bag.blocks], weights: bag.blocks.map((b) => bag.weightOf(b)), active: bag.appliesTo(app.state.selection) };
}

function set(app: App, req: AutomationRequest): unknown {
  const blocks = req["blocks"];
  if (!Array.isArray(blocks) || !blocks.every((b) => Number.isInteger(b) && (b as number) >= 0 && (b as number) <= 0x3ff)) throw new Error("blocks はブロック番号（0〜0x3FF）の配列です");
  const seed = req["seed"];
  const weights = req["weights"];
  if (weights !== undefined && (!Array.isArray(weights) || !weights.every((w) => typeof w === "number"))) throw new Error("weights は数の配列です");
  app.mixingBag.set(blocks as number[], typeof seed === "number" ? seed : undefined, weights as number[] | undefined);
  return state(app);
}

function weight(app: App, req: AutomationRequest): unknown {
  const block = req["block"];
  const w = req["weight"];
  if (typeof block !== "number" || typeof w !== "number") throw new Error("block と weight は数です");
  if (!app.mixingBag.blocks.includes(block)) throw new Error(`袋に無いブロックです: ${block}`);
  app.mixingBag.setWeight(block, w);
  return state(app);
}

export const bagCommands: CommandTable = {
  "bag.state": state,
  "bag.set": set,
  "bag.weight": weight,
};
