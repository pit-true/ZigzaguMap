import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileDialogs } from "../../app/FileDialogs";
import { ja } from "../../i18n/ja";
import { jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { autoId, button, edit, label, place } from "../../ui/form/controls";
import { readHex } from "../../ui/form/inputErrors";
import { showError } from "../../ui/MessageBox";
import { installToolAutomation } from "../toolAutomation";
import type { ToolClient } from "../ToolClient";

/** 行の数（パレット 0〜14）。 */
const ROWS = 15;

/**
 * ブロックパレット一括変更（別ウィンドウ。AdvanceMap の BlockdatenAnpassenForm）。
 * タイルセット 1/2 を選び、左のパレット番号を右の番号に置き換える表（15 行）を入れて「変更を保存する」を押すと、
 * そのタイルセットの全ブロックのタイル指定のパレット番号を置き換える（remapBlockPalettes コマンド、確認なし）。
 * 右の欄は 10 進で読む（数でなければ AdvanceMap と同じ「'$zz' is not a valid integer value.」）。
 */
export class BlockAdjustWindow {
  private readonly tileset1: HTMLInputElement;
  private readonly tileset2: HTMLInputElement;
  private readonly to: HTMLInputElement[] = [];

  static start(root: HTMLElement, client: ToolClient): BlockAdjustWindow {
    return new BlockAdjustWindow(root, client);
  }

  private constructor(
    root: HTMLElement,
    private readonly client: ToolClient,
  ) {
    const radio = (id: string, caption: string, x: number, checked: boolean): { root: HTMLElement; input: HTMLInputElement } => {
      const wrap = place(document.createElement("label"), x, 8, x === 8 ? 129 : 121, 25);
      wrap.classList.add("am-check");
      const input = autoId(document.createElement("input"), id);
      input.type = "radio";
      input.name = "adjust-tileset";
      input.checked = checked;
      wrap.append(input, caption);
      return { root: wrap, input };
    };
    const r1 = radio("adj.tileset1", t.changeTileset1, 8, true);
    const r2 = radio("adj.tileset2", t.changeTileset2, 136, false);
    this.tileset1 = r1.input;
    this.tileset2 = r2.input;
    const form = document.createElement("div");
    form.className = "adjust-form";
    form.append(r1.root, r2.root, label(t.adjustHint, 8, 48));
    for (let i = 0; i < ROWS; i++) {
      const from = edit(`adj.from.${i}`, 8, 64 + i * 24, 121);
      from.value = String(i);
      from.readOnly = true;
      const to = edit(`adj.to.${i}`, 136, 64 + i * 24, 121);
      to.value = String(i);
      this.to.push(to);
      form.append(from, to);
    }
    form.append(button("adj.save", t.adjustSave, 8, 432, 249, 25, () => void this.save()));
    root.classList.add("block-adjust");
    root.append(form);
    installToolAutomation(client, {
      files: new FileDialogs(),
      actions: {},
      describe: () => ({ secondary: this.tileset2.checked, mapping: this.to.map((e) => e.value) }),
    });
  }

  /** 変更を保存する（読めない欄があればエラーを出して何もしない）。保存したら閉じる。 */
  private async save(): Promise<void> {
    const mapping: number[] = [];
    for (const field of this.to) {
      // 表は 10 進で出しているので、10 進として読める欄は 10 進で読む（「10」をパレット 16 と読まないため）。
      // 読めない欄は AdvanceMap と同じく 16 進として読み、だめなら「'$zz' is not a valid integer value.」。
      const text = field.value.trim();
      const value = /^\d+$/.test(text) ? Number(text) : readHex(text);
      if (value === null) return;
      if (value > 15) {
        await showError(ja.invalidInput);
        return;
      }
      mapping.push(value);
    }
    const secondary = this.tileset2.checked;
    const data = secondary ? this.client.snapshot.secondary : this.client.snapshot.primary;
    if (!data) return;
    try {
      await this.client.execute("remapBlockPalettes", { tileset: data.pointer, secondary, mapping });
    } catch (e) {
      await showError(e instanceof Error ? e.message : String(e));
      return;
    }
    await getCurrentWindow().close();
  }
}
