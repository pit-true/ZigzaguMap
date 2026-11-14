import { ROM_BASE, type RomEraseSpan } from "@zigzagumap/core";
import { jaEventDelete } from "../../i18n/ja.eventDelete";
import { openContextMenu } from "../../ui/ContextMenu";
import { openDialogs } from "../../ui/Dialog";
import { EventTab } from "../../ui/event/EventTab";
import { KIND_ORDER, type UiKind } from "../../ui/event/eventModel";
import type { App } from "../App";
import { int, settle, str, type AutomationRequest, type CommandTable } from "./registry";

/**
 * イベントタブ（`event.select` / `event.state`）。マップ上のマウス操作は `mouse`（target: event）。古い `event.mouse` は mouse.ts の別名。
 * 部品の ID は `event.kind`、`event.number`、`event.person.x` のような形（`event.<種別>.<欄>`）。
 */

function eventTab(app: App): EventTab {
  const tab = app.tabs.event;
  if (!(tab instanceof EventTab)) throw new Error("イベントタブがありません");
  return tab;
}

function kind(req: AutomationRequest): UiKind {
  const v = str(req, "kind");
  if (!(KIND_ORDER as readonly string[]).includes(v)) throw new Error(`kind は ${KIND_ORDER.join(" / ")} のどれかです`);
  return v as UiKind;
}

/** 削除の計画を JSON にする（`event.deletePlan` の返事）。 */
async function deletePlan(app: App, req: AutomationRequest) {
  const id = app.state.map?.id;
  const k = kind(req);
  if (!id || k === "fly") throw new Error("イベントタブで消せるイベント（人・看板・ワープ・スクリプト）を指定してください");
  const plan = await (await app.eventDeleter()).plan(id, k, int(req, "index"));
  const { eventDeleteLines } = await import("../../ui/event/EventDeleteDialog");
  const span = (s: RomEraseSpan) => ({ address: s.offset + ROM_BASE, length: s.length, type: s.type, label: s.label });
  return {
    map: plan.map,
    kind: plan.kind,
    index: plan.index,
    label: plan.label,
    pointer: plan.pointer,
    project: plan.project,
    hiddenItem: plan.hiddenItem,
    script: plan.script && {
      scriptPath: plan.script.scriptPath,
      removedLabels: plan.script.removedLabels,
      keptLabels: plan.script.keptLabels,
      removedStrings: plan.script.removedStrings,
      keptStrings: plan.script.keptStrings,
    },
    registry: plan.registry,
    rom: plan.rom && { erase: plan.rom.erase.map(span), keep: plan.rom.keep.map((s) => ({ ...span(s), reason: s.reason })), problems: plan.rom.problems },
    romNote: plan.romNote,
    files: plan.files.map((f) => f.path),
    lines: eventDeleteLines(plan),
  };
}

export const eventCommands: CommandTable = {
  "event.deletePlan": (app, req) => deletePlan(app, req),
  "event.delete": async (app, req) => {
    const k = kind(req);
    if (k === "fly") throw new Error("フライトポジションは削除できません");
    const index = int(req, "index");
    const tab = eventTab(app);
    tab.select(k, index);
    if (req["confirm"] === false) {
      const ok = await app.deleteEvent(k, index, false);
      await app.scripts.settle();
      return { ok, status: app.state.status.left, selection: tab.selection, counts: tab.counts() };
    }
    // 確認のダイアログを出したまま返す（`dialog` で「削除」か「キャンセル」を押す）
    void app.deleteEvent(k, index, true);
    for (let i = 0; i < 200 && !openDialogs.some((d) => d.title === jaEventDelete.title); i++) await settle(25);
    return { dialogs: openDialogs.map((d) => ({ title: d.title, text: d.text, buttons: d.buttons })) };
  },
  "contextMenu.state": () => {
    const menu = openContextMenu();
    return menu ? { items: menu.items.map((i) => ({ id: i.id, label: i.label, enabled: i.enabled !== false })) } : null;
  },
  "contextMenu.press": async (app, req) => {
    const menu = openContextMenu();
    if (!menu) throw new Error("右クリックのメニューが開いていません");
    const id = str(req, "id");
    const item = menu.items.find((i) => i.id === id || i.label === id);
    if (!item) throw new Error(`メニューの項目がありません: ${id}`);
    if (item.enabled === false) throw new Error(`押せない項目です: ${item.label}`);
    menu.close();
    item.run();
    for (let i = 0; i < 200 && !openDialogs.length && item.id === "delete"; i++) await settle(25);
    return { dialogs: openDialogs.map((d) => ({ title: d.title, text: d.text, buttons: d.buttons })), status: app.state.status.left };
  },
  "romErase.state": (app) => {
    const session = app.state.session;
    if (!session) return null;
    return {
      ranges: session.romErase.ranges.map((r) => ({ address: r.address, length: r.length, type: r.type, bank: r.bank, map: r.map, event: r.event, index: r.index })),
      modified: session.romErase.isModified(),
      loadError: session.romErase.loadError,
    };
  },
  "event.select": (app, req) => {
    const tab = eventTab(app);
    tab.select(kind(req), int(req, "index"));
    return tab.selection;
  },
  "event.state": (app) => {
    const tab = eventTab(app);
    const map = app.state.map;
    return {
      ...tab.selection,
      count: tab.count(),
      counts: tab.counts(),
      fly: tab.count("fly") > 0,
      events: map?.doc.events ?? null,
      itemBalls: map?.doc.itemBalls ?? [],
    };
  },
};
