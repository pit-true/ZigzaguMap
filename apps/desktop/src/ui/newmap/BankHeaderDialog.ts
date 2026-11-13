import "../../styles/newmap.css";
import { jaNewMap } from "../../i18n/ja.newMap";
import { createDialog } from "../Dialog";
import { button, edit, label, panel } from "../form/controls";
import { offsetText } from "../form/inputErrors";

/** 一覧の 1 行（既存のバンク）。 */
export interface BankRow {
  readonly bank: number;
  /** バンクのマップ一覧の位置（ベース ROM に無いバンクは 0）。 */
  readonly offset: number;
  /** 格納マップ数。 */
  readonly count: number;
}

/** 「変更の適用」で反映するもの。 */
export interface BankHeaderChanges {
  /** 「新バンク番号」で足した行の数。 */
  readonly newBanks: number;
  /** ダミーマップの残量・予約の欄を 0 以外にしたか（ZigzaguMap では意味を持たない）。 */
  readonly dummyChanged: boolean;
}

/** 行の高さ（AdvanceMap と同じ 24px）。 */
const ROW_HEIGHT = 24;

/**
 * 「マップバンクヘッダー」ダイアログ（AdvanceMap の TMapBankHeaderForm）。
 * 全バンクの、マップ一覧の位置・格納マップ数・ダミーマップの残量を出す。「新バンク番号」で末尾に行を足す。
 * 「変更の適用」で閉じて変更を返し、「キャンセル」と × は何もせずに閉じる（null）。
 * ダミーマップの残量と予約の欄は AdvanceMap と同じく編集できるが、ZigzaguMap にはダミーマップが無いので意味を持たない。
 */
export function openBankHeaderDialog(rows: readonly BankRow[]): Promise<BankHeaderChanges | null> {
  return new Promise((resolve) => {
    const t = jaNewMap;
    const finish = (value: BankHeaderChanges | null): void => {
      frame.remove();
      resolve(value);
    };
    const frame = createDialog({ title: t.bankTitle, width: 479, className: "bank-header-dialog", onClose: () => finish(null) });
    const body = panel("bank-header", 477, 466);
    const heading = (text: string, x: number): HTMLElement => {
      const l = label(text, x, 12);
      l.classList.add("bold");
      return l;
    };
    const list = document.createElement("div");
    list.className = "bank-header-list";
    const rowBox = document.createElement("div");
    rowBox.className = "bank-header-rows";
    const remainders: HTMLInputElement[] = [];
    let added = 0;
    const addRow = (bank: number, offset: number, count: number): HTMLInputElement => {
      const top = remainders.length * ROW_HEIGHT;
      const remaining = edit(`bankHeader.remaining.${bank}`, 316, top + 4, 120, 19);
      remaining.value = "0";
      rowBox.append(label(String(bank), 12, top + 8), label(offsetText(offset), 88, top + 8), label(String(count), 212, top + 8), remaining);
      remainders.push(remaining);
      rowBox.style.height = `${remainders.length * ROW_HEIGHT + 4}px`;
      return remaining;
    };
    for (const r of rows) addRow(r.bank, r.offset, r.count);
    const newBank = button("bankHeader.newBank", t.newBank, 0, 0, 89, 25, () => {
      const input = addRow(rows.length + added, 0, 0);
      added++;
      list.scrollTop = list.scrollHeight;
      input.focus();
    });
    newBank.classList.remove("am-abs");
    newBank.classList.add("bank-header-new");
    list.append(rowBox, newBank);

    const reservedBanks = edit("bankHeader.reservedBanks", 244, 346, 118, 19);
    const reservedMaps = edit("bankHeader.reservedMaps", 244, 370, 118, 19);
    reservedBanks.value = "0";
    reservedMaps.value = "0";
    const apply = (): void => {
      const nonZero = (input: HTMLInputElement): boolean => input.value.trim() !== "" && input.value.trim() !== "0";
      finish({ newBanks: added, dummyChanged: [...remainders, reservedBanks, reservedMaps].some(nonZero) });
    };
    body.append(
      heading(t.bankColumns, 12),
      heading(t.bankCount, 212),
      heading(t.bankRemaining, 316),
      list,
      label(t.reservedBanks, 12, 350),
      reservedBanks,
      label(t.reservedMaps, 12, 374),
      reservedMaps,
      button("bankHeader.cancel", t.bankCancel, 60, 419, 177, 33, () => finish(null)),
      button("bankHeader.apply", t.bankApply, 252, 419, 177, 33, apply),
    );
    frame.body.append(body);
    frame.box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") finish(null);
    });
    frame.register({
      title: t.bankTitle,
      text: "",
      buttons: [t.newBank, t.bankCancel, t.bankApply],
      press: (b) => {
        if (b === t.newBank) newBank.click();
        else if (b === t.bankCancel) finish(null);
        else if (b === t.bankApply) apply();
        else throw new Error(`ボタンがありません: ${b}`);
      },
    });
    remainders[0]?.focus();
    remainders[0]?.select();
  });
}
