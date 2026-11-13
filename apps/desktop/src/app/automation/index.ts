import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { App } from "../App";
import { coreCommands } from "./core";
import { dialogCommands, installNativeDialogs } from "./dialogs";
import { eventCommands } from "./events";
import { fieldCommands } from "./fields";
import { imageCommands } from "./images";
import { menuCommands } from "./menu";
import { mouseCommands } from "./mouse";
import { CommandRegistry, nextFrame, type AutomationRequest } from "./registry";
import { statusCommands } from "./status";
import { treeCommands } from "./tree";
import { errorText } from "../../util/errors";

/** Rust から届く要求。 */
interface AutomationEvent {
  readonly id: number;
  readonly request: AutomationRequest;
}

/** 命令の登録表（分野ごとのファイルの表をまとめたもの）。 */
const registry = new CommandRegistry([
  coreCommands,
  fieldCommands,
  mouseCommands,
  dialogCommands,
  menuCommands,
  treeCommands,
  imageCommands,
  statusCommands,
  eventCommands,
  { commands: () => registry.names() },
]);

/**
 * 自動操作の入口の画面側（テスト用）。Rust が 127.0.0.1 で受けた JSON を `automation-request` で受け取り、
 * 結果を `automation_reply` で返す。起動引数 `--automation` か開発ビルドのときだけ、App が初めて読み込む（通常の起動では読まない）。
 * 命令の一覧は docs/automation.md（`{"cmd":"commands"}` でも出る）。
 */
export async function startAutomation(app: App): Promise<void> {
  installNativeDialogs();
  await listen<AutomationEvent>("automation-request", (event) => {
    const { id, request } = event.payload;
    void handle(app, request)
      .then(async (result) => {
        // 画面が描き直されるのを待ってから返す（直後のスクリーンショットに反映させるため）。
        await nextFrame();
        return { ok: true, result: result ?? null };
      })
      .catch((e: unknown) => ({ ok: false, error: errorText(e) }))
      .then((reply) => invoke("automation_reply", { id, body: JSON.stringify(reply) }));
  });
  await invoke("automation_ready");
}

async function handle(app: App, req: AutomationRequest): Promise<unknown> {
  const name = String(req["cmd"]);
  const handler = registry.get(name);
  if (!handler) throw new Error(`知らない cmd です: ${name}`);
  return handler(app, req);
}
