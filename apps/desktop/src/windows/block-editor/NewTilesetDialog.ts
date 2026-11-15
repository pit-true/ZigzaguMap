import { newTilesetLimits } from "@zigzagumap/core";
import { ja } from "../../i18n/ja";
import { jaBlockTools as tt } from "../../i18n/ja.blockTools";
import { createDialog, dialogButton, handleDialogKeys, pressable } from "../../ui/Dialog";
import { showError } from "../../ui/MessageBox";
import { errorText } from "../../util/errors";
import type { ToolClient } from "../ToolClient";
import type { TilesetModel } from "../TilesetModel";

/** 新しいタイルセットの窓が使う窓口。 */
export interface NewTilesetHost {
  readonly model: TilesetModel;
  readonly client: ToolClient;
  /** 作ったとき（窓の下の案内に出す）。 */
  created(text: string): void;
}

/**
 * 画像 > 新しいタイルセット…（#397、#407 の Q9）。主か副、タイル数とブロック数、初めの中身（空・今のタイルセットの写し）を選ぶ。
 * 作るのはメインのウィンドウ（頼み `newTileset`）で、表示中のマップの組を付け替える。
 */
export function openNewTileset(host: NewTilesetHost): void {
  const finish = (): void => frame.remove();
  const frame = createDialog({ title: tt.newTilesetTitle, width: 360, className: "be-newts", onClose: finish });
  const model = host.model;
  const current = (secondary: boolean): { tiles: number; blocks: number } => {
    const data = secondary ? model.secondary : model.primary;
    return data ? { tiles: model.tilesOf(secondary).length / 32, blocks: data.attributes.length } : newTilesetLimits(secondary);
  };
  const kind = select("be.nt.kind", [tt.exportTileset1, tt.exportTileset2], 1);
  const tiles = text("be.nt.tiles", String(current(true).tiles));
  const blocks = text("be.nt.blocks", String(current(true).blocks));
  const content = select("be.nt.content", [tt.newTilesetEmpty, tt.newTilesetCopy], 0);
  const limit = document.createElement("div");
  limit.className = "be-export-info";
  limit.dataset["autoId"] = "be.nt.limit";
  const showLimit = (): void => {
    const l = newTilesetLimits(kind.selectedIndex === 1);
    limit.textContent = tt.newTilesetLimit(l.tiles, l.blocks);
  };
  kind.addEventListener("change", () => {
    const c = current(kind.selectedIndex === 1);
    tiles.value = String(c.tiles);
    blocks.value = String(c.blocks);
    showLimit();
  });
  showLimit();
  const note = document.createElement("div");
  note.className = "be-export-info";
  note.textContent = tt.newTilesetNote;
  const form = document.createElement("div");
  form.append(row(tt.newTilesetKind, kind), row(tt.newTilesetCount, tiles), row(tt.newTilesetBlocks, blocks), row(tt.newTilesetContent, content), limit, note);

  const create = async (): Promise<void> => {
    const num = (el: HTMLInputElement, field: string): number => {
      const v = el.value.trim();
      if (!/^\d+$/.test(v)) throw new Error(tt.newTilesetNumber(field, v));
      return Number(v);
    };
    try {
      const req = { secondary: kind.selectedIndex === 1, tileCount: num(tiles, tt.newTilesetCount), blockCount: num(blocks, tt.newTilesetBlocks), copy: content.selectedIndex === 1 };
      const r = (await host.client.request({ op: "newTileset", ...req })) as { pointer: number; tileCount: number; blockCount: number };
      host.created(tt.newTilesetDone(r.pointer, r.tileCount, r.blockCount));
      finish();
    } catch (e) {
      await showError(errorText(e));
    }
  };
  const buttons = document.createElement("div");
  buttons.className = "dialog-buttons";
  buttons.append(dialogButton(tt.newTilesetCreate, () => void create()), dialogButton(ja.cancel, finish));
  frame.body.append(form, buttons);
  handleDialogKeys(frame, finish);
  frame.register({
    title: tt.newTilesetTitle,
    text: tt.newTilesetNote,
    ...pressable([
      { label: tt.newTilesetCreate, aliases: ["create", "ok"], run: () => void create() },
      { label: ja.cancel, aliases: ["cancel"], run: finish },
    ]),
  });
}

function select(id: string, options: readonly string[], index: number): HTMLSelectElement {
  const el = document.createElement("select");
  el.dataset["autoId"] = id;
  for (const o of options) el.append(new Option(o));
  el.selectedIndex = Math.max(0, index);
  return el;
}

function text(id: string, value: string): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.dataset["autoId"] = id;
  el.value = value;
  el.size = 6;
  return el;
}

function row(caption: string, ...children: Node[]): HTMLElement {
  const div = document.createElement("div");
  div.className = "be-export-row";
  const head = document.createElement("span");
  head.className = "be-export-caption";
  head.textContent = caption;
  div.append(head, ...children);
  return div;
}
