import { invoke } from "@tauri-apps/api/core";
import { EventTab } from "../ui/event/EventTab";
import { KIND_ORDER, type UiKind } from "../ui/event/eventModel";
import type { App } from "./App";

/**
 * 自動操作の入口の汎用の命令（部品の ID を指定して読み書き・クリック、ダイアログ、パネルの画像）と、イベントタブの命令。
 * 部品の ID は入力要素の `data-auto`（例: `event.person.x`、`event.manager.apply`）。`ui.list` で一覧できる。
 * 知らない cmd なら null を返す（呼び出し側がエラーにする）。
 */
export async function handleUi(app: App, req: Record<string, unknown>): Promise<{ value: unknown } | null> {
  switch (req["cmd"]) {
    case "ui.list": {
      const root = typeof req["root"] === "string" ? find(req["root"]) : document.body;
      return { value: [...root.querySelectorAll<HTMLElement>("[data-auto]")].map(describe) };
    }
    case "ui.get":
      return { value: describe(find(str(req, "id"))) };
    case "ui.set": {
      const el = find(str(req, "id"));
      setValue(el, req["value"]);
      return { value: describe(el) };
    }
    case "ui.type": {
      // 1 文字ずつ入力する（入力のたびに反映される動きの確認用）。
      const el = find(str(req, "id"));
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
    case "ui.click": {
      const el = find(str(req, "id"));
      if (isDisabled(el)) throw new Error(`無効な部品です: ${str(req, "id")}`);
      el.click();
      return { value: null };
    }
    case "ui.shot": {
      // 部品（パネル）の画像。位置は CSS ピクセル × devicePixelRatio でクライアント領域の物理ピクセルにする。
      const r = find(str(req, "id")).getBoundingClientRect();
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

function find(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-auto="${CSS.escape(id)}"]`);
  if (!el) throw new Error(`部品がありません: ${id}`);
  return el;
}

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLInputElement).disabled === true;
}

function visible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

function describe(el: HTMLElement): Record<string, unknown> {
  const base = { id: el.dataset["auto"], tag: el.tagName.toLowerCase(), disabled: isDisabled(el), visible: visible(el) };
  if (el instanceof HTMLSelectElement) {
    return { ...base, index: el.selectedIndex, value: el.selectedIndex >= 0 ? el.options[el.selectedIndex]!.text : null, options: el.options.length };
  }
  if (el instanceof HTMLInputElement) {
    return el.type === "checkbox" ? { ...base, checked: el.checked } : { ...base, value: el.value, readOnly: el.readOnly };
  }
  return { ...base, text: el.textContent };
}

/** 値を入れて、画面の操作と同じイベントを送る（文字の欄は入力の後にフォーカスを外す）。 */
function setValue(el: HTMLElement, value: unknown): void {
  if (isDisabled(el)) throw new Error(`無効な部品です: ${el.dataset["auto"]}`);
  if (el instanceof HTMLSelectElement) {
    const i = typeof value === "number" ? value : [...el.options].findIndex((o) => o.text === value);
    if (i < 0 || i >= el.options.length) throw new Error(`選択肢がありません: ${String(value)}`);
    el.selectedIndex = i;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    if (typeof value !== "boolean") throw new Error("チェックボックスの値は true / false です");
    if (el.checked !== value) el.click();
    return;
  }
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    leave(el);
    return;
  }
  throw new Error(`値を入れられる部品ではありません: ${el.dataset["auto"]}`);
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
