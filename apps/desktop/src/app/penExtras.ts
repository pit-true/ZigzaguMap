import { TripleChildMarks } from "../ui/map/TripleChildMarks";
import type { MapTab } from "../ui/tabs/MapTab";
import type { EditorState } from "./EditorState";

/**
 * Phase4 で描く道具に足したもの（3 層の次の番号の印、自動ペン、マップ作成補助）。App が作ってマップタブへ取り付ける。
 * Phase3 の MapExtras とは分けて持つ（機能ごとに部品を分ける）。
 */
export class PenExtras {
  /** 3 層の次の番号が置かれているマスの印（#301。マップタブ）。 */
  readonly tripleMarks: TripleChildMarks;

  constructor(state: EditorState, mapTab: MapTab) {
    this.tripleMarks = new TripleChildMarks(mapTab.view, state);
  }
}
