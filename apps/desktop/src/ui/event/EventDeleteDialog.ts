import { jaEventDelete as t } from "../../i18n/ja.eventDelete";
import { createDialog, dialogButton, handleDialogKeys, pressable } from "../Dialog";
import { romAddress, type EventDeletePlan } from "./EventDeleter";
import type { RemovalKept, RomEraseBlocked } from "@zigzagumap/core";

/** イベントの名前（「人 3」）。 */
export function eventName(plan: Pick<EventDeletePlan, "kind" | "index">): string {
  return `${t.kind[plan.kind] ?? plan.kind} ${plan.index}`;
}

function keptText(k: RemovalKept): string {
  switch (k.reason) {
    case "external":
      return t.kept.external;
    case "reference":
      return t.kept.reference(k.where ?? "");
    case "fallthrough":
      return t.kept.fallthrough(k.where ?? "");
    case "other":
      return t.kept.other(k.where ?? "");
    case "registry":
      return t.registryReason;
  }
}

function romReason(b: RomEraseBlocked): string {
  const r = b.reason;
  switch (r.kind) {
    case "pointer":
      return t.romReason.pointer(romAddress(r.at));
    case "reference":
      return t.romReason.reference(r.where);
    case "protected":
      return t.romReason.protected(r.where);
    case "recorded":
      return t.romReason.recorded;
    case "keptParent":
      return t.romReason.keptParent(romAddress(r.at));
    case "unreadable":
      return t.romReason.unreadable;
  }
}

/** 確認のダイアログに出す行（1 行目が見出し。字下げは先頭の空白）。 */
export function eventDeleteLines(plan: EventDeletePlan): string[] {
  const what = eventName(plan);
  const lines = [t.intro(what), "", t.object(what, plan.map.bank, plan.map.map)];
  if (plan.kind === "warp") return lines;
  if (plan.hiddenItem) return [...lines, t.hiddenItem];
  const s = plan.script;
  if (s && plan.label) {
    if (!s.scriptPath) return [...lines, t.scriptNotFound(plan.label)];
    lines.push(t.scriptHeader(plan.label, s.scriptPath));
    if (s.removedLabels.length > 0) lines.push(`  ${t.removedLabels(s.removedLabels.length)}`, ...s.removedLabels.map((l) => `    ${l}`));
    if (s.keptLabels.length > 0) lines.push(`  ${t.keptLabels(s.keptLabels.length)}`, ...s.keptLabels.map((k) => `    ${k.label}（${keptText(k)}）`));
    if (s.removedStrings.length > 0) lines.push(`  ${t.removedStrings(s.removedStrings.length)}`, ...s.removedStrings.map((x) => `    ${x.label}（${x.path}）`));
    if (s.keptStrings.length > 0) lines.push(`  ${t.keptStrings(s.keptStrings.length)}`, ...s.keptStrings.map((k) => `    ${k.label}（${keptText(k)}）`));
    if (plan.registry) lines.push(`  ${t.registryEdit(plan.registry.path, plan.registry.removed.length)}`);
    return lines;
  }
  if (plan.pointer === null) return [...lines, t.noScript];
  const address = `0x${(plan.pointer >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  if (plan.romNote === "noProject") return [...lines, t.romNoProject];
  if (plan.romNote === "outside") return [...lines, t.romOutside(address)];
  if (plan.romNote === "broken") return [...lines, t.romEraseBroken("")];
  const rom = plan.rom!;
  lines.push(t.romHeader(address), `  ${t.romSummary(rom.erase.length, rom.keep.length)}`);
  if (rom.erase.length > 0) lines.push(`  ${t.romErase}`, ...rom.erase.map((x) => `    ${t.romSpan(romAddress(x.offset), x.length, t.romType[x.type] ?? x.type)}`));
  if (rom.keep.length > 0) lines.push(`  ${t.romKeep}`, ...rom.keep.map((x) => `    ${t.romSpan(romAddress(x.offset), x.length, t.romType[x.type] ?? x.type)}: ${romReason(x)}`));
  if (rom.problems.length > 0) lines.push(`  ${t.romProblems}`, ...rom.problems.map((p) => `    ${p}`));
  return lines;
}

/** 確認のダイアログ。「削除」なら true。 */
export function confirmEventDelete(plan: EventDeletePlan): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ok: boolean): void => {
      frame.remove();
      resolve(ok);
    };
    const frame = createDialog({ title: t.title, className: "event-delete-dialog", width: 620, onClose: () => finish(false) });
    const lines = eventDeleteLines(plan);
    const intro = document.createElement("p");
    intro.className = "event-delete-intro";
    intro.textContent = lines[0]!;
    const list = document.createElement("pre");
    list.className = "event-delete-list";
    list.dataset["autoId"] = "eventDelete.list";
    list.textContent = lines.slice(2).join("\n");
    const bar = document.createElement("div");
    bar.className = "message-buttons";
    const ok = dialogButton(t.ok, () => finish(true));
    ok.dataset["autoId"] = "eventDelete.ok";
    const cancel = dialogButton(t.cancel, () => finish(false));
    cancel.dataset["autoId"] = "eventDelete.cancel";
    bar.append(ok, cancel);
    frame.body.append(intro, list, bar);
    frame.box.tabIndex = -1;
    // Enter は手前のボタン（はじめは「キャンセル」）を押す
    handleDialogKeys(frame, () => finish(false));
    frame.register({
      title: t.title,
      text: lines.join("\n"),
      ...pressable([
        { label: t.ok, aliases: ["ok", "yes"], run: () => finish(true) },
        { label: t.cancel, aliases: ["cancel", "no"], run: () => finish(false) },
      ]),
    });
    cancel.focus();
  });
}
