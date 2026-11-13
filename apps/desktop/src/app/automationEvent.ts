import { invoke } from "@tauri-apps/api/core";
import { EventTab } from "../ui/event/EventTab";
import { KIND_ORDER, type UiKind } from "../ui/event/eventModel";
import type { App } from "./App";
import { findField } from "./AutomationUi";

/**
 * 自動操作の入口の命令のうち、部品の一覧・1 文字ずつの入力・部品の範囲の画像（`ui.list` / `ui.type` / `ui.shot`）、
 * 個人設定の一時的な変更（`setting`）、イベントタブの命令（`event.select` / `event.mouse` / `event.state`）。
 * 部品の値の読み書きとクリックは AutomationUi の `getField` / `setField` / `click` を使う。
 * 部品の ID は `data-auto-id`（例: `event.person.x`、`event.manager.apply`）。知らない cmd なら null を返す。
 */
export async function handleEventUi(app: App, req: Record<string, unknown>): Promise<{ value: unknown } | null> {
  switch (req["cmd"]) {
    case "ui.list": {
      const root = typeof req["root"] === "string" ? findField(req["root"]) : document.body;
      return { value: [...root.querySelectorAll<HTMLElement>("[data-auto-id]")].map(describe) };
    }
    case "ui.type": {
      // 1 文字ずつ入力する（入力のたびに反映される動きの確認用）。
      const el = findField(str(req, "id"));
      if (!(el instanceof HTMLInputElement)) throw new Error("文字を入力できる部品ではありません");
      el.focus();
      if (req["clear"] !== false) {
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      for (const ch of str(req, "text")) {
        el.value += ch;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (req["blur"] !== false) leave(el);
      return { value: describe(el) };
    }
    case "ui.shot": {
      // 部品（パネル）の画像。位置は CSS ピクセル × devicePixelRatio でクライアント領域の物理ピクセルにする。
      const r = findField(str(req, "id")).getBoundingClientRect();
      const s = window.devicePixelRatio || 1;
      return {
        value: await invoke("automation_capture", {
          x: Math.round(r.left * s),
          y: Math.round(r.top * s),
          width: Math.max(1, Math.round(r.width * s)),
          height: Math.max(1, Math.round(r.height * s)),
        }),
      };
    }
    case "setting": {
      // 個人設定の値をこのセッションの間だけ変える（ファイルには保存しない。スクリプトエディターの確認用）。
      (app.state.settings.data as unknown as Record<string, unknown>)[str(req, "key")] = req["value"];
      return { value: null };
    }
    case "event.select": {
      const tab = eventTab(app);
      tab.select(kind(req), int(req, "index"));
      return { value: tab.selection };
    }
    case "event.mouse": {
      // マップ上のマウス操作（x, y はマス。drag は toX, toY まで 1 マスずつ動かす）。
      const tab = eventTab(app);
      const cell = { x: int(req, "x"), y: int(req, "y") };
      const action = str(req, "action");
      if (action === "click" || action === "drag") {
        const grabbed = tab.press(cell);
        if (grabbed && action === "drag") {
          const to = { x: int(req, "toX"), y: int(req, "toY") };
          let { x, y } = cell;
          while (x !== to.x || y !== to.y) {
            x += Math.sign(to.x - x);
            y += Math.sign(to.y - y);
            tab.dragTo({ x, y });
          }
        }
        if (grabbed) tab.release();
        return { value: { grabbed, ...tab.selection } };
      }
      if (action === "hover") {
        tab.hover(cell);
        return { value: app.state.status };
      }
      if (action === "dblclick") {
        tab.activate(cell);
        return { value: tab.selection };
      }
      throw new Error(`action は click / drag / dblclick / hover のどれかです: ${action}`);
    }
    case "event.state": {
      const tab = eventTab(app);
      const map = app.state.map;
      return {
        value: {
          ...tab.selection,
          count: tab.count(),
          counts: tab.counts(),
          fly: tab.count("fly") > 0,
          events: map?.doc.events ?? null,
          itemBalls: map?.doc.itemBalls ?? [],
          lastLaunch: tab.launcher.last,
        },
      };
    }
    default:
      return null;
  }
}

function eventTab(app: App): EventTab {
  const tab = app.tabs.event;
  if (!(tab instanceof EventTab)) throw new Error("イベントタブがありません");
  return tab;
}

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLInputElement).disabled === true;
}

function visible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

function describe(el: HTMLElement): Record<string, unknown> {
  const base = { id: el.dataset["autoId"], tag: el.tagName.toLowerCase(), disabled: isDisabled(el), visible: visible(el) };
  if (el instanceof HTMLSelectElement) {
    return { ...base, index: el.selectedIndex, value: el.selectedIndex >= 0 ? el.options[el.selectedIndex]!.text : null, options: el.options.length };
  }
  if (el instanceof HTMLInputElement) {
    return el.type === "checkbox" ? { ...base, checked: el.checked } : { ...base, value: el.value, readOnly: el.readOnly };
  }
  return { ...base, text: el.textContent };
}

/**
 * 欄から離れる。ウィンドウがアクティブでない（自動操作で画面外に出している）と blur の出来事が来ないことがあるので、
 * そのときは同じ出来事を送る。
 */
function leave(el: HTMLElement): void {
  let fired = false;
  const mark = (): void => {
    fired = true;
  };
  el.addEventListener("blur", mark, { once: true });
  el.blur();
  el.removeEventListener("blur", mark);
  if (!fired) {
    el.dispatchEvent(new FocusEvent("blur"));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  }
}

function kind(req: Record<string, unknown>): UiKind {
  const v = str(req, "kind");
  if (!(KIND_ORDER as readonly string[]).includes(v)) throw new Error(`kind は ${KIND_ORDER.join(" / ")} のどれかです`);
  return v as UiKind;
}

function str(req: Record<string, unknown>, key: string): string {
  const v = req[key];
  if (typeof v !== "string") throw new Error(`${key} は文字列で指定してください`);
  return v;
}

function int(req: Record<string, unknown>, key: string): number {
  const v = req[key];
  if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`${key} は整数で指定してください`);
  return v;
}
