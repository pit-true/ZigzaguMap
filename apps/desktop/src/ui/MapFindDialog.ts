import type { MapId } from "@zigzagumap/core";
import { findMaps, type FindableMap, type FindCandidate } from "../app/mapFind";
import { ja } from "../i18n/ja";
import { jaMapFind as t } from "../i18n/ja.mapFind";
import "../styles/mapFind.css";
import { createDialog, dialogButton, handleDialogKeys, pressable } from "./Dialog";

/**
 * マップ名で探して開く（#237。ツール > マップ名で探して開く、Ctrl+F）。入力するたびに候補を出し、↑↓で選んで Enter か
 * ダブルクリックで開く。選んだマップを返す（取り消しなら null）。
 */
export function mapFindDialog(maps: readonly FindableMap[], initial = ""): Promise<MapId | null> {
  return new Promise((resolve) => {
    let candidates: FindCandidate[] = [];
    let index = 0;
    const finish = (value: MapId | null): void => {
      frame.remove();
      resolve(value);
    };
    const pick = (): void => finish(candidates[index]?.id ?? null);
    const frame = createDialog({ title: t.title, width: 360, className: "map-find-dialog", onClose: () => finish(null) });
    const text = document.createElement("p");
    text.textContent = t.prompt;
    const input = document.createElement("input");
    input.type = "text";
    input.value = initial;
    input.dataset["autoId"] = "mapFind.input";
    const list = document.createElement("ul");
    list.className = "map-find-list";
    list.dataset["autoId"] = "mapFind.list";
    const none = document.createElement("div");
    none.className = "map-find-none";
    none.textContent = t.none;
    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    buttons.append(dialogButton(ja.ok, pick), dialogButton(ja.cancel, () => finish(null)));
    frame.body.append(text, input, list, none, buttons);

    const render = (): void => {
      candidates = findMaps(maps, input.value);
      index = Math.min(index, Math.max(0, candidates.length - 1));
      list.replaceChildren(
        ...candidates.map((c, i) => {
          const li = document.createElement("li");
          li.textContent = c.text;
          li.className = i === index ? "selected" : "";
          li.dataset["autoId"] = `mapFind.item:${c.id.bank}.${c.id.map}`;
          li.addEventListener("mousedown", () => {
            index = i;
            render();
          });
          li.addEventListener("dblclick", () => {
            index = i;
            pick();
          });
          return li;
        }),
      );
      none.hidden = candidates.length > 0 || input.value.trim() === "";
      list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
    };
    input.addEventListener("input", () => {
      index = 0;
      render();
    });
    handleDialogKeys(frame, () => finish(null), (e) => {
      if (e.key === "Enter") pick();
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        index = Math.max(0, Math.min(candidates.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)));
        render();
      }
    });
    frame.register({
      title: t.title,
      text: t.prompt,
      ...pressable([
        { label: ja.ok, aliases: ["ok"], run: pick },
        { label: ja.cancel, aliases: ["cancel"], run: () => finish(null) },
      ]),
      setInput: (v) => {
        input.value = v;
        index = 0;
        render();
      },
      input: () => input.value,
    });
    render();
    input.focus();
    input.select();
  });
}

