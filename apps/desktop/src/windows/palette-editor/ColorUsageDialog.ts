import { jaPaletteTools as pt } from "../../i18n/ja.paletteTools";
import { createDialog, dialogButton, dialogButtonRow, handleDialogKeys, pressable } from "../../ui/Dialog";

/** 色の使用箇所の窓に渡すもの。 */
export interface ColorUsageHost {
  readonly palette: number;
  readonly color: number;
  /** その色を使うブロック（一覧の通し番号）。 */
  readonly blocks: readonly number[];
  /** 行を押したとき（ブロックエディタでそのブロックを選ぶ）。 */
  select(block: number): void;
}

/**
 * ツール > 色の使用箇所…（#396）。選んでいる色を使っているブロックの一覧を、パレットエディタの窓の中に出す。
 * 行を押すとブロックエディタでそのブロックを選ぶ（窓は開いたまま）。
 */
export function openColorUsage(host: ColorUsageHost): void {
  const finish = (): void => frame.remove();
  const frame = createDialog({ title: pt.usageTitle(host.palette, host.color), width: 270, className: "pal-usage", onClose: finish });
  const info = document.createElement("div");
  info.className = "pal-usage-info";
  info.dataset["autoId"] = "pal.usage.info";
  info.textContent = host.blocks.length === 0 ? pt.usageNone : pt.usageCount(host.blocks.length);
  const list = document.createElement("div");
  list.className = "pal-usage-list";
  list.dataset["autoId"] = "pal.usage.list";
  for (const block of host.blocks) {
    const row = document.createElement("div");
    row.className = "pal-usage-row";
    row.dataset["autoId"] = `pal.usage.${block}`;
    row.textContent = pt.usageRow(block);
    row.addEventListener("click", () => {
      for (const r of list.querySelectorAll(".selected")) r.classList.remove("selected");
      row.classList.add("selected");
      host.select(block);
    });
    list.append(row);
  }
  const buttons = dialogButtonRow(dialogButton(pt.close, finish));
  frame.body.append(info, list, buttons);
  handleDialogKeys(frame, finish);
  frame.register({
    title: pt.usageTitle(host.palette, host.color),
    text: info.textContent,
    ...pressable([{ label: pt.close, aliases: ["close", "cancel", "ok"], run: finish }]),
  });
}
