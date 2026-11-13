import "../../styles/newmap.css";
import { jaNewMap } from "../../i18n/ja.newMap";
import { button } from "../form/controls";

/** マップタブの作成ボタンが呼ぶもの。 */
export interface MakeButtonActions {
  makeMap(): unknown;
  makeBank(): unknown;
}

/**
 * マップタブの「新規マップ作成」「マップバンクの作成」（AdvanceMap の Cmd_MakeMap / Cmd_MakeBank。どちらも 24,24 の 225×41）。
 * AdvanceMap では一覧の「保留したダミーマップデータ」「保留したダミーバンク番号」を開いたときにだけ、マップの代わりに出る。
 * ZigzaguMap はダミーマップ・ダミーバンクを作らない（マップの配置はビルドが行う）ので、いつも隠しておく。
 * 押したときの動作だけは用意する（新規マップ作成 = ファイル > マップ > 新規マップの作成、マップバンクの作成 = 不要の案内）。
 */
export function installMakeButtons(tab: HTMLElement, actions: MakeButtonActions): { makeMap: HTMLButtonElement; makeBank: HTMLButtonElement } {
  const makeMap = button("map.makeMap", jaNewMap.makeMap, 24, 24, 225, 41, () => void actions.makeMap());
  const makeBank = button("map.makeBank", jaNewMap.makeBank, 24, 24, 225, 41, () => void actions.makeBank());
  for (const b of [makeMap, makeBank]) {
    b.classList.add("map-make-button");
    b.hidden = true;
  }
  tab.append(makeMap, makeBank);
  return { makeMap, makeBank };
}
