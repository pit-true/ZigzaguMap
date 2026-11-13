import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { installNativeDialogs, listDialogs, operateDialog, queuePath } from "../app/automation/dialogs";
import { click, findField, getField, listFields, setField, useAmNames } from "../app/automation/ui";
import type { FileDialogs } from "../app/FileDialogs";
import type { ToolClient } from "./ToolClient";
import { errorText } from "../util/errors";
import { num, settle, str } from "../app/automation/registry";

/** 別ウィンドウが自動操作に見せるもの。 */
export interface ToolAutomationTarget {
  /** `state` の返事（ウィンドウの欄の値など）。 */
  describe(): unknown;
  /** ファイルのダイアログ（`queuePath` で次に選ぶパスを積む）。 */
  readonly files: FileDialogs;
  /** メニューの項目（`action` の `id`）。 */
  readonly actions: Readonly<Record<string, () => unknown>>;
  /** ウィンドウだけの命令（知らない cmd なら undefined を返す）。 */
  extra?(request: Record<string, unknown>): Promise<unknown> | undefined;
}

/** Rust から届く要求。 */
interface AutomationEvent {
  readonly id: number;
  readonly request: Record<string, unknown>;
}

/**
 * 別ウィンドウの自動操作の入口。メインと同じく Rust が `"window": "<ラベル>"` 付きの要求を
 * `automation-request-window` でこのウィンドウへ送り、`automation_reply` で返事を返す（ワールドマップエディターと同じ仕組み）。
 * 部品は `data-auto-id` の ID で指す。命令はメインの入口と同じ名前・同じ引数（README の表）。
 */
export async function installToolAutomation(client: ToolClient, target: ToolAutomationTarget): Promise<void> {
  if ((await invoke<number | null>("automation_port")) === null) return;
  // AdvanceMap の部品名（field:<名前>）の対応表と、Windows のファイルのダイアログの代わり（メインと同じ）
  useAmNames(client.kind);
  installNativeDialogs();
  await getCurrentWebviewWindow().listen<AutomationEvent>("automation-request-window", (event) => {
    const { id, request } = event.payload;
    void (async () => {
      let reply: unknown;
      try {
        const result = await handle(client, target, request);
        // 押したあとの処理（メインへの要求と、その結果の写しの反映）が終わるのを待つ。
        await settle();
        await client.whenIdle();
        await settle();
        reply = { ok: true, result: result ?? null };
      } catch (e) {
        reply = { ok: false, error: errorText(e) };
      }
      await invoke("automation_reply", { id, body: JSON.stringify(reply) });
    })();
  });
  await invoke("automation_ready");
}

async function handle(client: ToolClient, target: ToolAutomationTarget, req: Record<string, unknown>): Promise<unknown> {
  switch (req["cmd"]) {
    case "state":
      return target.describe();
    case "getField":
      return getField(str(req, "id"));
    case "setField":
      return setField(str(req, "id"), req["value"]);
    case "click":
      click(str(req, "id"));
      return null;
    case "ui.list":
    case "fields":
      return listFields();
    case "dialogs":
      return { dialogs: listDialogs() };
    case "action": {
      const id = str(req, "id");
      const run = target.actions[id];
      if (!run) throw new Error(`知らないメニュー項目です: ${id}`);
      // ダイアログを出して待つ項目もあるので、少しだけ待って返す（失敗はステータスに出る）。
      let error: unknown = null;
      const p = Promise.resolve()
        .then(run)
        .catch((e: unknown) => (error = e));
      await Promise.race([p, settle(150)]);
      if (error) throw error instanceof Error ? error : new Error(String(error));
      return { dialogs: listDialogs() };
    }
    case "dialog":
      return operateDialog(req);
    case "queuePath":
      return queuePath(target.files, typeof req["path"] === "string" ? req["path"] : null);
    case "key": {
      const init = { key: str(req, "key"), ctrlKey: req["ctrl"] === true, altKey: req["alt"] === true, shiftKey: req["shift"] === true, bubbles: true, cancelable: true };
      const el = typeof req["id"] === "string" ? findField(req["id"]) : (document.activeElement ?? document.body);
      el.dispatchEvent(new KeyboardEvent("keydown", init));
      el.dispatchEvent(new KeyboardEvent("keyup", init));
      return null;
    }
    case "pointer": {
      // 部品の上のマウス操作をまねる。x, y は部品の左上からの表示上のピクセル。
      const el = findField(str(req, "id"));
      const r = el.getBoundingClientRect();
      const type = str(req, "type");
      const button = typeof req["button"] === "number" ? req["button"] : 0;
      el.dispatchEvent(
        new PointerEvent(`pointer${type}`, {
          clientX: r.left + num(req, "x"),
          clientY: r.top + num(req, "y"),
          button: type === "move" ? -1 : button,
          buttons: type === "up" ? 0 : button === 2 ? 2 : 1,
          ctrlKey: req["ctrl"] === true,
          shiftKey: req["shift"] === true,
          pointerId: 1,
          pointerType: "mouse",
          bubbles: true,
          cancelable: true,
        }),
      );
      return null;
    }
    case "canvasPng": {
      const el = findField(str(req, "id"));
      if (!(el instanceof HTMLCanvasElement)) throw new Error(`Canvas ではありません: ${str(req, "id")}`);
      const url = el.toDataURL("image/png");
      return { width: el.width, height: el.height, png: url.slice(url.indexOf(",") + 1) };
    }
    case "snapshot":
      // メインから届いている写し（出力を読み直した結果と比べる用）。
      return { snapshot: client.snapshot, ui: client.ui };
    case "close":
      // 返事を送ってから閉じる。
      setTimeout(() => void getCurrentWindow().close(), 300);
      return null;
    case "undo":
      return client.request({ op: "undo" });
    case "redo":
      return client.request({ op: "redo" });
    default: {
      const extra = target.extra?.(req);
      if (extra !== undefined) return extra;
      throw new Error(`知らない cmd です: ${String(req["cmd"])}`);
    }
  }
}
