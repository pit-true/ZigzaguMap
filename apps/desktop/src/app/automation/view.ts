import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { MOUSE_TARGETS } from "./mouse";
import { int, nextFrame, settle, str, type AutomationRequest, type CommandTable } from "./registry";
import { describeScroll, scrollBy, scrollContainerOf } from "./scroll";
import { listDialogs } from "./dialogs";
import { findField } from "./ui";

/**
 * 画面の見え方を変える操作（動画の撮影と比較テスト用）。
 * - `scroll`: マップ・パレットなどのスクロール（スクロールバーを動かしたときと同じ）
 * - `view.scroll`: スクロールの状態（スクロールバーが出ているか、枠がウィンドウに収まっているか）
 * - `splitter`: 左の欄の幅（分割バーをドラッグして離したときと同じ処理）
 * - `resize`: メインウィンドウの大きさ
 * - `drop`: ファイル・フォルダのドラッグ＆ドロップ（ドロップの出来事と同じ処理。.gba ならフォルダを選ぶダイアログが出たところで返る）
 */

/** `target`（マウスと同じ名前）か `id` の部品の、スクロールの枠。 */
function scrollTarget(req: AutomationRequest): HTMLElement {
  if (typeof req["id"] === "string") return scrollContainerOf(findField(req["id"]));
  const name = str(req, "target");
  const selector = MOUSE_TARGETS[name];
  if (!selector) throw new Error(`target は ${Object.keys(MOUSE_TARGETS).join(" / ")} のどれかです: ${name}`);
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`部品が見つかりません: ${name}`);
  return scrollContainerOf(el);
}

export const viewCommands: CommandTable = {
  scroll: (_app, req) => scrollBy(scrollTarget(req), req),
  "view.scroll": (_app, req) => describeScroll(scrollTarget(req)),
  splitter: async (app, req) => {
    const width = app.setLeftWidth(int(req, "width"));
    await nextFrame();
    return { width };
  },
  resize: async (_app, req) => {
    await getCurrentWindow().setSize(new LogicalSize(int(req, "width"), int(req, "height")));
    await settle(200);
    return { width: window.innerWidth, height: window.innerHeight };
  },
  drop: async (app, req) => {
    const paths = req["paths"] ?? (typeof req["path"] === "string" ? [req["path"]] : null);
    if (!Array.isArray(paths) || paths.length === 0 || !paths.every((p) => typeof p === "string")) {
      throw new Error("paths（パスの配列）か path を指定してください");
    }
    // .gba を落とすと、続けてフォルダを選ぶダイアログが出る。開き終わるか、ダイアログが出るまで待つ
    // （ダイアログには queuePath で答える。答えたあとの状態は state で読む）。
    const before = listDialogs().length;
    let finished = false;
    const done = app.drop(paths as string[]).finally(() => (finished = true));
    while (!finished && listDialogs().length <= before) await settle(30);
    if (finished) await done;
    else done.catch(() => undefined);
    return {
      rom: app.state.session?.romPath ?? null,
      project: app.state.session?.projectDir ?? null,
      status: app.state.status,
      dialogs: listDialogs(),
    };
  },
};
