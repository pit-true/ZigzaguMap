import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openDialogs } from "../../ui/Dialog";
import { errorText } from "../../util/errors";
import { nextFrame, num, settle, str } from "../../app/automation/registry";

/** 押したあとの処理（メインウィンドウとのやり取り）が進むのを待つ時間（ms）。 */
const WORLD_MAP_SETTLE_MS = 150;

/** Rust から届く要求。 */
interface AutomationEvent {
  readonly id: number;
  readonly request: Record<string, unknown>;
}

/** ウィンドウごとの答え方。 */
export interface ToolWindowAutomation {
  /** `state` の答え。 */
  describe(): unknown;
  /** `canvasPng` で撮れる Canvas（data-auto-id → PNG の data URL）。 */
  canvas(id: string): string | null;
}

/**
 * 道具のウィンドウ（メイン以外）の自動操作の入口。Rust が `"window": "<ラベル>"` 付きの要求を
 * `automation-request-window` でこのウィンドウへ送り、`automation_reply` で返事を返す。
 *
 * 命令（部品は `data-auto-id` で指す。AdvanceMap の部品名と同じ）:
 * - `fields`: 全部品の値。`getField {id}`: 1 つの値（value / checked / enabled / text）。
 * - `setField {id, value}`: 入力欄は文字列、チェックは true/false、コンボは番号か文字列。input と change を起こす。
 * - `click {id}`: ボタンを押す。`pointer {id, type, x, y, button}`: 部品の左上からの位置でマウス操作をまねる。
 * - `canvasPng {id}`: Canvas の PNG（base64）。`key {key, ctrl, shift, alt, id?}`: キー操作（`id` の部品か、フォーカスのある部品へ送る）。
 * - `dialog {press?, input?}`: 画面内のダイアログを読む・押す。`state`: ウィンドウの状態。
 */
export async function startToolWindowAutomation(handler: ToolWindowAutomation): Promise<void> {
  const port = await invoke<number | null>("automation_port");
  if (port === null) return;
  await getCurrentWebviewWindow().listen<AutomationEvent>("automation-request-window", (event) => {
    const { id, request } = event.payload;
    void handle(handler, request)
      .then(async (result) => {
        await nextFrame();
        return { ok: true, result: result ?? null };
      })
      .catch((e: unknown) => ({ ok: false, error: errorText(e) }))
      .then((reply) => invoke("automation_reply", { id, body: JSON.stringify(reply) }));
  });
  await invoke("automation_ready");
}

async function handle(handler: ToolWindowAutomation, req: Record<string, unknown>): Promise<unknown> {
  switch (req["cmd"]) {
    case "state":
      return handler.describe();
    case "fields":
      return Object.fromEntries([...document.querySelectorAll<HTMLElement>("[data-auto-id]")].map((el) => [el.dataset["autoId"], describeField(el)]));
    case "getField":
      return describeField(find(str(req, "id")));
    case "setField": {
      const el = find(str(req, "id"));
      const value = req["value"];
      if (el instanceof HTMLInputElement && el.type === "checkbox") {
        if (typeof value !== "boolean") throw new Error("チェックボックスの value は true か false で指定してください");
        el.checked = value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (el instanceof HTMLSelectElement) {
        const index = typeof value === "number" ? value : [...el.options].findIndex((o) => o.text === value || o.value === value);
        if (index < 0 || index >= el.options.length) throw new Error(`選択肢がありません: ${String(value)}`);
        el.selectedIndex = index;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (el instanceof HTMLInputElement) {
        if (typeof value !== "string") throw new Error("入力欄の value は文字列で指定してください");
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else throw new Error(`値を入れられない部品です: ${str(req, "id")}`);
      await settle(WORLD_MAP_SETTLE_MS);
      return describeField(el);
    }
    case "click": {
      const el = find(str(req, "id"));
      if ((el as HTMLButtonElement).disabled) throw new Error(`押せない状態です: ${str(req, "id")}`);
      el.click();
      await settle(WORLD_MAP_SETTLE_MS);
      return { dialogs: describeDialogs() };
    }
    case "pointer": {
      const el = find(str(req, "id"));
      const r = el.getBoundingClientRect();
      const type = str(req, "type");
      const button = typeof req["button"] === "number" ? req["button"] : 0;
      el.dispatchEvent(
        new PointerEvent(`pointer${type}`, {
          clientX: r.left + num(req, "x"),
          clientY: r.top + num(req, "y"),
          button: type === "move" ? -1 : button,
          buttons: type === "up" ? 0 : button === 2 ? 2 : 1,
          pointerId: 1,
          pointerType: "mouse",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle(WORLD_MAP_SETTLE_MS);
      return null;
    }
    case "canvasPng": {
      const url = handler.canvas(str(req, "id"));
      if (!url) throw new Error(`Canvas がありません: ${str(req, "id")}`);
      return { png: url.slice(url.indexOf(",") + 1) };
    }
    case "key": {
      const init = { key: str(req, "key"), ctrlKey: req["ctrl"] === true, altKey: req["alt"] === true, shiftKey: req["shift"] === true, bubbles: true, cancelable: true };
      const target = typeof req["id"] === "string" ? find(req["id"]) : (document.activeElement ?? document.body);
      target.dispatchEvent(new KeyboardEvent("keydown", init));
      target.dispatchEvent(new KeyboardEvent("keyup", init));
      await settle(WORLD_MAP_SETTLE_MS);
      return null;
    }
    case "close":
      // × を押したときと同じく閉じる（返事を送ってから）。
      setTimeout(() => void getCurrentWebviewWindow().close(), 300);
      return null;
    case "dialogs":
      // 開いているダイアログ（メインの `dialogs` と同じ形）
      return { dialogs: openDialogs.map((d) => ({ kind: "app", title: d.title, text: d.text, buttons: d.buttons })) };
    case "dialog": {
      const top = openDialogs[openDialogs.length - 1];
      if (!top) {
        if (req["press"] !== undefined || req["input"] !== undefined) throw new Error("ダイアログが開いていません");
        return { dialogs: [] };
      }
      if (typeof req["input"] === "string") {
        if (!top.setInput) throw new Error("入力欄がありません");
        top.setInput(req["input"]);
      }
      if (typeof req["press"] === "string") {
        const before = describeDialogs();
        if (req["press"] === "close") top.close();
        else top.press(req["press"]);
        await settle(WORLD_MAP_SETTLE_MS);
        return { pressed: req["press"], before, dialogs: describeDialogs() };
      }
      return { dialogs: describeDialogs() };
    }
    default:
      throw new Error(`知らない cmd です: ${String(req["cmd"])}`);
  }
}

function find(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-auto-id="${CSS.escape(id)}"]`);
  if (!el) throw new Error(`部品が見つかりません: ${id}`);
  return el;
}

function describeField(el: HTMLElement): unknown {
  const enabled = !(el as HTMLInputElement).disabled;
  if (el instanceof HTMLInputElement && el.type === "checkbox") return { checked: el.checked, enabled };
  if (el instanceof HTMLSelectElement) return { value: el.selectedOptions[0]?.text ?? "", index: el.selectedIndex, count: el.options.length, enabled };
  if (el instanceof HTMLInputElement) return { value: el.value, enabled };
  return { text: el.textContent ?? "", enabled };
}

function describeDialogs(): unknown[] {
  return openDialogs.map((d) => ({ title: d.title, text: d.text, buttons: d.buttons, input: d.input?.() ?? null }));
}
