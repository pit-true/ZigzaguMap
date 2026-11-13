import { EditError, parseIntInput, type MapId } from "@zigzagumap/core";
import "../../styles/newmap.css";
import { ja } from "../../i18n/ja";
import { jaNewMap } from "../../i18n/ja.newMap";
import { createDialog, pressable } from "../Dialog";
import { button, combo, edit, label, panel, setOptions } from "../form/controls";
import { showEditError } from "../form/inputErrors";
import { messageBox } from "../MessageBox";
import { showNewMapError } from "./newMapErrors";

/** マップの追加/挿入ダイアログが使う窓口。 */
export interface MapInsertHost {
  /** 「現在のマップ: 3.0」か「ファイル: パス」の文字列。 */
  currentText(): string;
  /** バンクごとのマップ数（追加したものを含む）。 */
  bankCounts(): number[];
  /** 指定先にインポート（中身の差し替え）。入力エラーなら例外。成功したら差し替えた番号。 */
  replace(target: MapId): Promise<MapId>;
  /** バンクの末尾（bank がバンク数と同じなら新しいバンク）に写して加える。成功したら加えた番号。 */
  append(bank: number): Promise<MapId>;
  /** 写した先のマップを開く。 */
  openMap(id: MapId): Promise<void>;
  /** マップバンクヘッダーを開く（閉じるまで待つ）。 */
  showBankHeader(): Promise<void>;
}

/**
 * 「マップの追加/挿入」ダイアログ（AdvanceMap の TMapEinfuegenForm）。
 * AdvanceMap は押すとすぐ ROM へ書くが、ZigzaguMap は編集中のプロジェクトへ反映する（出力で maps\ に書く）。
 * - 指定先にインポート: 選んだ既存のマップの中身を、今のマップで差し替える。
 * - ダミーマップにインポート: ZigzaguMap にはダミーマップ（予約した空き）が無いので、残量はいつも 0 で押せない。
 * - ダミーマップ数の変更: 選んだバンクの末尾に今のマップを写して加える（総数の値は 1 以上なら幾つでも 1 つだけ加える。0 以下は何もしない）。
 *   「バンク番号の追加」を選ぶと、新しいバンクのマップ 0 に加える。
 * 成功すると「現在のマップデータをコピーし、( B.M ) にマップデータをインポートしました！」を出し、閉じてそのマップを開く。
 * × で閉じると「マップの追加/挿入を中止しました！」。ダミーマップの総数の欄は 1 文字ごとに整数か確かめる（AdvanceMap と同じ）。
 */
export function openMapInsertDialog(host: MapInsertHost): Promise<void> {
  return new Promise((resolve) => {
    const t = jaNewMap;
    let closed = false;
    const finish = (): void => {
      if (closed) return;
      closed = true;
      frame.remove();
      resolve();
    };
    const cancel = async (): Promise<void> => {
      await messageBox(ja.information, t.insertCanceled, "info");
      finish();
    };
    const frame = createDialog({ title: t.insertTitle, width: 455, className: "map-insert-dialog", onClose: () => void cancel() });
    const body = panel("map-insert", 453, 267);
    const bold = (text: string, x: number, y: number, large = false): HTMLElement => {
      const l = label(text, x, y);
      l.classList.add("bold");
      if (large) l.classList.add("large");
      return l;
    };
    const replaceBank = combo("mapInsert.replaceBank", [], 8, 112, 137);
    const replaceMap = combo("mapInsert.replaceMap", [], 160, 112, 137);
    const dummyBank = combo("mapInsert.dummyBank", [], 8, 176, 137);
    const currentLabel = label(host.currentText(), 8, 32);
    currentLabel.dataset["autoId"] = "mapInsert.current";
    const remaining = label("0", 160, 180);
    remaining.dataset["autoId"] = "mapInsert.dummyRemaining";
    const dummyImport = button("mapInsert.dummyImport", t.dummyImport, 312, 168, 137, 25, () => undefined);
    dummyImport.disabled = true;
    const countBank = combo("mapInsert.countBank", [], 8, 240, 137);
    const count = edit("mapInsert.count", 160, 240, 137, 21);
    count.value = "1";
    for (const c of [replaceBank, replaceMap, dummyBank, countBank]) c.style.height = "21px";

    const fill = (): void => {
      const counts = host.bankCounts();
      const banks = counts.map((_, i) => String(i));
      const keep = (select: HTMLSelectElement, options: string[]): void => {
        const index = select.selectedIndex;
        setOptions(select, options);
        select.selectedIndex = index >= 0 && index < options.length ? index : 0;
      };
      keep(replaceBank, banks);
      keep(dummyBank, banks);
      keep(countBank, [...banks, t.addBank]);
      const maps = Array.from({ length: counts[replaceBank.selectedIndex] ?? 0 }, (_, i) => String(i));
      keep(replaceMap, maps);
    };
    replaceBank.addEventListener("change", () => {
      replaceMap.selectedIndex = 0;
      fill();
      replaceMap.selectedIndex = replaceMap.options.length > 0 ? 0 : -1;
    });
    count.addEventListener("input", () => {
      if (count.value === "") return;
      try {
        parseIntInput(count.value);
      } catch (e) {
        void showEditError(e);
      }
    });

    let busy = false;
    const run = async (action: () => Promise<MapId>): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const id = await action();
        await messageBox(ja.information, t.imported(id.bank, id.map), "info");
        finish();
        await host.openMap(id);
      } catch (e) {
        if (e instanceof EditError || e instanceof Error) await showNewMapError(e);
      } finally {
        busy = false;
      }
    };
    const replace = (): Promise<void> => run(() => host.replace({ bank: replaceBank.selectedIndex, map: replaceMap.selectedIndex }));
    const changeCount = async (): Promise<void> => {
      let n: number;
      try {
        n = parseIntInput(count.value);
      } catch (e) {
        await showEditError(e);
        return;
      }
      if (n < 1) return;
      await run(() => host.append(countBank.selectedIndex));
    };
    const showBankHeader = async (): Promise<void> => {
      await host.showBankHeader();
      fill();
    };

    body.append(
      bold(t.insertNotice, 8, 8, true),
      currentLabel,
      bold(t.insertPosition, 8, 56, true),
      button("mapInsert.bankHeader", t.showBankHeader, 312, 56, 137, 25, () => void showBankHeader()),
      bold(t.replaceHead, 8, 80),
      label(t.bankNumber, 8, 96),
      label(t.mapNumber, 160, 96),
      replaceBank,
      replaceMap,
      button("mapInsert.replace", t.replace, 312, 104, 137, 25, () => void replace()),
      bold(t.dummyHead, 8, 144),
      label(t.bankNumber, 8, 160),
      label(t.dummyRemaining, 160, 160),
      dummyBank,
      remaining,
      dummyImport,
      bold(t.countHead, 8, 208),
      label(t.bankNumber, 8, 224),
      label(t.countValue, 160, 224),
      countBank,
      count,
      button("mapInsert.countApply", t.countApply, 312, 232, 137, 25, () => void changeCount()),
    );
    fill();
    frame.body.append(body);
    frame.box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") void cancel();
    });
    frame.register({
      title: t.insertTitle,
      text: t.insertNotice,
      ...pressable([
        { label: t.showBankHeader, run: () => void showBankHeader() },
        { label: t.replace, run: () => void replace() },
        {
          label: t.dummyImport,
          run: () => {
            throw new Error("ダミーマップにインポートは押せません");
          },
        },
        { label: t.countApply, run: () => void changeCount() },
      ]),
    });
  });
}
