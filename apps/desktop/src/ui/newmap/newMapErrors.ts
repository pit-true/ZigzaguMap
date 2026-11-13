import { EditError, EditErrorCode } from "@zigzagumap/core";
import { ja } from "../../i18n/ja";
import { jaNewMap } from "../../i18n/ja.newMap";
import { showEditError } from "../form/inputErrors";
import { messageBox } from "../MessageBox";

/**
 * 新規マップ・マップの追加/挿入・作成したマップの読み込みのエラーを出す。
 * 「すべて記入してください」は AdvanceMap と同じく題名「情報」。途中の番号への挿入などは ZigzaguMap だけの文言。
 * それ以外は場所の設定タブと同じ文言（大きさの上限、タイルセット、整数でない入力）。
 */
export async function showNewMapError(e: unknown): Promise<void> {
  if (!(e instanceof EditError)) return showEditError(e);
  const p = e.params;
  const n = jaNewMap;
  switch (e.code) {
    case EditErrorCode.FillAllFields:
      await messageBox(ja.information, n.fillAll, "info");
      return;
    case EditErrorCode.MapSlotNotAppend:
      await messageBox(ja.errorTitle, n.slotNotAppend(Number(p["bank"]), Number(p["expected"])), "error");
      return;
    case EditErrorCode.BankSkip:
      await messageBox(ja.errorTitle, n.bankSkip(Number(p["expected"])), "error");
      return;
    case EditErrorCode.MapExists:
      await messageBox(ja.errorTitle, n.mapExists(Number(p["bank"]), Number(p["map"])), "error");
      return;
    case EditErrorCode.InvalidMapFile:
      await messageBox(ja.errorTitle, n.invalidMapFile(String(p["reason"] ?? "")), "error");
      return;
    case EditErrorCode.MapNotFound:
      await messageBox(ja.errorTitle, ja.mapNotFound, "error");
      return;
    default:
      return showEditError(e);
  }
}
