import type { App } from "../App";
import { readFile } from "../FileDialogs";
import { int, str, type CommandTable } from "./registry";

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
  /**
   * 画像からタイルとブロックを作る（Phase6 #443）。`paths`（PNG 1〜3 枚。下から順）、`target`（primary / secondary /
   * newPrimary / newSecondary）、`transparent`（BGR555。省略で 1 枚目の左上、null で使わない）、`options`（計画の設定）、
   * `stamp`（スタンプの名前。省略で作らない）。返事は書いたか `done`、計画のまとめ `plan`、書いたタイルセット `pointer`、スタンプの名前。
   */
  "tileset.importImage": async (app: App, req) => {
    const paths = Array.isArray(req["paths"]) ? (req["paths"] as unknown[]).map(String) : [str(req, "path")];
    const images = await Promise.all(paths.map((p) => readFile(p)));
    const { runTileImport } = await import("../../windows/tile-import/tileImportHost");
    return runTileImport(app, {
      images,
      target: (typeof req["target"] === "string" ? req["target"] : "secondary") as never,
      ...(req["transparent"] === undefined ? {} : { transparent: req["transparent"] as number | null }),
      options: (req["options"] ?? {}) as never,
      stamp: typeof req["stamp"] === "string" ? req["stamp"] : null,
    });
  },
};
