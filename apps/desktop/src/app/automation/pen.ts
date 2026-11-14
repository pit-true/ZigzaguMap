import type { App } from "../App";
import type { CommandTable } from "./registry";

/**
 * 描く道具（Phase4）。
 * - `tripleChildCells`: 今のマップで、3 層の次の番号（単独では置けないブロック）が置かれているマスの一覧 `cells`（表示の設定に関係なく）と、
 *   印を描いたマス `marked`（表示 > 3層の3枚目のブロックに印を付ける がオンのとき）。
 */
export const penCommands: CommandTable = {
  tripleChildCells: (app: App) => {
    const marks = app.pen.tripleMarks;
    return { cells: marks.cells(), marked: marks.marked };
  },
};
