import { SeamNotice } from "../ui/connection/SeamNotice";
import type { MapTreeFilter } from "../ui/MapTreeFilter";
import type { StatusBar } from "../ui/StatusBar";
import type { Actions } from "./Actions";
import type { EditorState } from "./EditorState";
import type { MapExtras } from "./mapExtras";
import { SeamWarnings } from "./neighbors/SeamWarnings";

/** ViewFeatures が使う画面の部品（App が渡す）。 */
export interface ViewFeatureParts {
  readonly state: EditorState;
  readonly actions: Actions;
  readonly extras: MapExtras;
  readonly statusBar: StatusBar;
  readonly treeFilter: MapTreeFilter;
}

/**
 * Phase4 の表示・一覧・調査の機能（列 3）をまとめて取り付ける。機能ごとのクラスを作り、メニューのアクションを登録する。
 * - 接続の境目の注意（#305）: ステータスバーの「注意: 接続 N か所」と、マップタブの隣の帯の枠。
 */
export class ViewFeatures {
  /** 接続の境目の点検（#305）。 */
  readonly seams: SeamWarnings;
  readonly seamNotice: SeamNotice;

  constructor(parts: ViewFeatureParts) {
    const { state, extras, statusBar } = parts;
    this.seams = new SeamWarnings(state);
    this.seamNotice = new SeamNotice(state, this.seams, extras.neighborLayers.map);
    statusBar.addSlot(this.seamNotice.element);
  }

}
