import { parseAutoPenFile, type AutoPenPart } from "@zigzagumap/core";
import type { App } from "../App";
import type { AutomationRequest, CommandTable } from "./registry";

/**
 * 描く道具（Phase4）。
 * - `tripleChildCells`: 今のマップで、3 層の次の番号（単独では置けないブロック）が置かれているマスの一覧 `cells`（表示の設定に関係なく）と、
 *   印を描いたマス `marked`（表示 > 3層の3枚目のブロックに印を付ける がオンのとき）。
 * - `autopen.state`: 自動ペンの設定（`active`・`size`・`movement`・`tint`）、今の組のパーツ `parts`（`name`・`kind`・`role`・`order`）、
 *   自動で描けるブロックの数 `blocks`、パレットで色を重ねているブロック `tinted`、選んでいるブロックで描くパーツ `part`、
 *   見分けたタイルセット `tilesets`（`primary`・`secondary` の識別子と位置）、読んだファイルの数 `files`、読めなかったファイル `problems`。
 * - `autopen.set {active?, size?, movement?, tint?, fraction?}`: 設定を変える（`fraction: [fx, fy]` はマスの中の位置 0〜1。偶数の筆の寄せる側。
 *   null で実際のマウスの位置に戻す）。
 * - `autopen.save {parts}`: 今の組のパーツを置き換えて保存する（`parts` は maps\autopen\*.json の `parts` と同じ形）。返事は書いたパス `written`。
 *   マップ作成補助の窓に保存していない変更があれば、窓の一覧にも足す（#379）。
 */

async function state(app: App): Promise<unknown> {
  const service = app.pen.autopen;
  const lib = await service.ready();
  const set = service.set;
  const s = app.state.settings.data;
  return {
    active: s.autoPen,
    size: s.autoPenSize,
    movement: s.autoPenMovement,
    tint: s.autoPenTint,
    parts: (set?.parts ?? []).map((p) => ({ name: p.name, kind: p.kind, role: p.role, order: p.order })),
    blocks: set?.index.size ?? 0,
    tinted: app.pen.tint.blocks(),
    part: app.pen.tool.partForSelection()?.part.name ?? null,
    tilesets: set
      ? {
          primary: { fingerprint: set.primary.fingerprint, headerAddress: set.primary.headerAddress },
          secondary: { fingerprint: set.secondary.fingerprint, headerAddress: set.secondary.headerAddress },
        }
      : null,
    files: lib?.fileCount ?? 0,
    problems: lib?.problems ?? [],
  };
}

async function set(app: App, req: AutomationRequest): Promise<unknown> {
  const patch: Record<string, unknown> = {};
  if (typeof req["active"] === "boolean") patch["autoPen"] = req["active"];
  if (typeof req["size"] === "number") patch["autoPenSize"] = req["size"];
  if (typeof req["movement"] === "boolean") patch["autoPenMovement"] = req["movement"];
  if (typeof req["tint"] === "boolean") patch["autoPenTint"] = req["tint"];
  if (Object.keys(patch).length > 0) {
    app.state.settings.update(patch);
    app.state.emit("view");
  }
  if (req["fraction"] === null) app.pen.tool.forcedFraction = null;
  else if (Array.isArray(req["fraction"])) {
    const [x, y] = req["fraction"] as number[];
    app.pen.tool.forcedFraction = { x: x ?? 0.5, y: y ?? 0.5 };
  }
  return state(app);
}

async function save(app: App, req: AutomationRequest): Promise<unknown> {
  if (!Array.isArray(req["parts"])) throw new Error("parts はパーツの配列です");
  // ファイルと同じ形で確かめる
  const text = JSON.stringify({ format: 1, tileset: { kind: "primary", game: "", headerAddress: null, fingerprint: "", blockCount: 0, name: "" }, parts: req["parts"] });
  const parts: AutoPenPart[] = [...parseAutoPenFile(text).parts];
  const written = await app.pen.autopen.save(parts);
  return { written, ...((await state(app)) as object) };
}

export const penCommands: CommandTable = {
  tripleChildCells: (app: App) => {
    const marks = app.pen.tripleMarks;
    return { cells: marks.cells(), marked: marks.marked };
  },
  "autopen.state": state,
  "autopen.set": set,
  "autopen.save": save,
};
