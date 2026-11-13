import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openDialogs } from "../ui/Dialog";
import type { App } from "./App";
import { handleEventUi } from "./automationEvent";
import { click, findField, getField, setField } from "./AutomationUi";
import { TAB_ORDER, type TabId } from "./EditorState";
import { timings } from "./timings";

/** Rust から届く要求。 */
interface AutomationEvent {
  readonly id: number;
  readonly request: Record<string, unknown>;
}

/**
 * 自動操作の入口の画面側（テスト用）。Rust が 127.0.0.1 で受けた JSON を `automation-request` で受け取り、
 * 結果を `automation_reply` で返す。起動引数 `--automation` か開発ビルドのときだけ呼ばれる。
 * 要求の形は README の「自動操作の入口」を参照。
 */
export async function startAutomation(app: App): Promise<void> {
  await listen<AutomationEvent>("automation-request", (event) => {
    const { id, request } = event.payload;
    void handle(app, request)
      .then(async (result) => {
        // 画面が描き直されるのを待ってから返す（直後のスクリーンショットに反映させるため）。
        await nextFrame();
        return { ok: true, result: result ?? null };
      })
      .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      .then((reply) => invoke("automation_reply", { id, body: JSON.stringify(reply) }));
  });
  await invoke("automation_ready");
}

/** 描画を 2 回待つ（描画が止まっていても 300ms で諦める）。 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 300);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      }),
    );
  });
}

async function handle(app: App, req: Record<string, unknown>): Promise<unknown> {
  const state = app.state;
  switch (req["cmd"]) {
    case "open":
      await app.openSession(str(req, "rom"), typeof req["project"] === "string" ? req["project"] : null);
      return describe(app);
    case "selectMap": {
      const id = { bank: int(req, "bank"), map: int(req, "map") };
      if (!state.session?.catalog.has(id)) throw new Error(`マップ ${id.bank}.${id.map} はありません`);
      await app.openMap(id);
      return { switchMs: timings.lastMapSwitchMs };
    }
    case "tab": {
      const name = str(req, "name") as TabId;
      if (!TAB_ORDER.includes(name)) throw new Error(`タブの名前が違います: ${name}`);
      state.setTab(name);
      return null;
    }
    case "command": {
      const session = requireSession(app);
      const record = { name: str(req, "name"), args: (req["args"] ?? {}) as Record<string, unknown> };
      const bank = record.args["bank"];
      const map = record.args["map"];
      if (typeof bank === "number" && typeof map === "number") await session.openMap({ bank, map });
      session.bus.execute(session.registry.create(record));
      return null;
    }
    case "undo":
      return requireSession(app).bus.undo();
    case "redo":
      return requireSession(app).bus.redo();
    case "export": {
      const dir = typeof req["dir"] === "string" ? req["dir"] : undefined;
      const session = requireSession(app);
      if (dir === undefined && !session.projectDir) throw new Error("出力先 dir を指定してください");
      const result = await session.export(dir);
      app.checkDirty(true);
      return result;
    }
    case "selectBlock": {
      const blocks = Array.isArray(req["blocks"]) ? (req["blocks"] as number[]) : [int(req, "block")];
      const width = typeof req["width"] === "number" ? req["width"] : 1;
      state.select({ width, height: Math.ceil(blocks.length / width), blocks });
      return null;
    }
    case "action":
      app.actions.run(str(req, "id"));
      await settle();
      return { status: state.status, dialogs: describeDialogs() };
    case "key": {
      // キー操作をまねる（メニューの見た目の確認用）。押して離すまでを送る。
      const init = { key: str(req, "key"), ctrlKey: req["ctrl"] === true, altKey: req["alt"] === true, shiftKey: req["shift"] === true, bubbles: true, cancelable: true };
      const target = typeof req["id"] === "string" ? findField(req["id"]) : (document.activeElement ?? document.body);
      target.dispatchEvent(new KeyboardEvent("keydown", init));
      target.dispatchEvent(new KeyboardEvent("keyup", init));
      return null;
    }
    case "canvasPng": {
      const tab = (typeof req["tab"] === "string" ? req["tab"] : state.tab) as keyof App["tabs"];
      const view = app.tabs[tab];
      if (!view) throw new Error(`このタブには Canvas がありません: ${tab}`);
      const url = view.view.toPng();
      if (!url) throw new Error("マップが開かれていません");
      return { png: url.slice(url.indexOf(",") + 1) };
    }
    case "cells": {
      const map = state.map;
      if (!map) throw new Error("マップが開かれていません");
      return { width: map.doc.width, height: map.doc.height, cells: [...map.doc.grid.cells], border: [...map.doc.border.cells] };
    }
    case "getField":
      return getField(str(req, "id"));
    case "setField":
      return setField(str(req, "id"), req["value"]);
    case "click":
      return click(str(req, "id"));
    case "state":
      app.checkDirty(true);
      return describe(app);
    case "dialog": {
      // 開いているダイアログ（画面内のもの）を読む。`input` で入力欄に入れ、`press` でボタンを押す。
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
        await settle();
        return { pressed: req["press"], before, dialogs: describeDialogs() };
      }
      return { dialogs: describeDialogs() };
    }
    case "queuePath":
      // 次に出るファイル・フォルダのダイアログで選ぶパス（null はキャンセル）。ダイアログは出さない。
      app.files.queue(typeof req["path"] === "string" ? req["path"] : null);
      return null;
    case "pointer": {
      // 部品の上のマウス操作をまねる。x, y は部品の左上からの表示上のピクセル。
      const el = document.querySelector<HTMLElement>(POINTER_TARGETS[str(req, "target")] ?? "");
      if (!el) throw new Error(`部品が見つかりません: ${String(req["target"])}`);
      const r = el.getBoundingClientRect();
      const type = str(req, "type");
      const init: PointerEventInit = {
        clientX: r.left + int(req, "x"),
        clientY: r.top + int(req, "y"),
        button: type === "move" ? -1 : typeof req["button"] === "number" ? req["button"] : 0,
        buttons: typeof req["button"] === "number" && req["button"] === 2 ? 2 : 1,
        ctrlKey: req["ctrl"] === true,
        shiftKey: req["shift"] === true,
        pointerId: 1,
        pointerType: "mouse",
        bubbles: true,
        cancelable: true,
      };
      el.dispatchEvent(new PointerEvent(`pointer${type}`, init));
      await settle();
      return { status: state.status };
    }
    default: {
      const ui = await handleEventUi(app, req);
      if (ui) return ui.value;
      throw new Error(`知らない cmd です: ${String(req["cmd"])}`);
    }
  }
}

/** 自動操作の pointer 命令で使える部品。 */
const POINTER_TARGETS: Readonly<Record<string, string>> = {
  map: ".map-tab-view .map-stage",
  movement: ".movement-tab-view .map-stage",
  event: ".event-tab-view .map-stage",
  palette: ".block-palette .palette-stage",
};

function describeDialogs(): unknown[] {
  return openDialogs.map((d) => ({ title: d.title, text: d.text, buttons: d.buttons, input: d.input?.() ?? null }));
}

/** 押したあとの処理（次のダイアログを出すなど）が進むのを少し待つ。 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

function describe(app: App): unknown {
  const s = app.state;
  const session = s.session;
  return {
    rom: session?.romPath ?? null,
    project: session?.projectDir ?? null,
    map: s.map
      ? { bank: s.map.id.bank, map: s.map.id.map, name: s.map.doc.mapNameText(), width: s.map.doc.width, height: s.map.doc.height }
      : null,
    tab: s.tab,
    selection: s.selection,
    movement: s.movement,
    dirty: [...s.dirty].sort(),
    canUndo: session?.bus.canUndo ?? false,
    canRedo: session?.bus.canRedo ?? false,
    history: session?.bus.history().length ?? 0,
    status: s.status,
    dialogs: describeDialogs(),
    settings: s.settings.data,
    profile: app.profileDir,
    title: document.title,
    timings: timings.toJson(),
  };
}

function requireSession(app: App): NonNullable<App["state"]["session"]> {
  const s = app.state.session;
  if (!s) throw new Error("ROM が開かれていません");
  return s;
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
