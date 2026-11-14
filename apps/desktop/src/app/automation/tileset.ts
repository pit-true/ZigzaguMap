import type { App } from "../App";
import { int, type CommandTable } from "./registry";

/**
 * タイルセットのブロックの情報（#299）。`blockInfo` は `block`（通し番号。省略で選んでいるブロック）の
 * 属性、重ね方の値（ビット 28〜30）、3 層か（`triple`）、3 層の次の番号か（`tripleChild`）、
 * 3 層だが 3 枚目が表の外で描けないか（`unresolved`）、実機で描かれない値か（`undrawn`）を返す。
 */
export const tilesetCommands: CommandTable = {
  blockInfo: (app: App, req) => {
    const map = app.state.map;
    if (!map) throw new Error("マップが開かれていません");
    const block = req["block"] === undefined ? (app.state.selection.blocks[0] ?? 0) : int(req, "block");
    const triple = map.tiles.triple;
    return { ...triple.info(block), attribute: triple.attribute(block), third: triple.thirdOf(block), parent: triple.parentOf(block) };
  },
};
