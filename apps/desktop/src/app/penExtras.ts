import { AutoPenTool } from "../input/AutoPenTool";
import { isTyping, modalOpen } from "../input/keyGuards";
import { AutoPenPanel } from "../ui/autopen/AutoPenPanel";
import { AutoPenTint } from "../ui/autopen/AutoPenTint";
import { TripleChildMarks } from "../ui/map/TripleChildMarks";
import type { MapTab } from "../ui/tabs/MapTab";
import { AutoPenService } from "./AutoPenService";
import type { BlockUsageService } from "./BlockUsageService";
import type { EditorState } from "./EditorState";

/**
 * Phase4 で描く道具に足したもの（3 層の次の番号の印、自動ペン、マップ作成補助）。App が作ってマップタブへ取り付ける。
 * Phase3 の MapExtras とは分けて持つ（機能ごとに部品を分ける）。
 */
export class PenExtras {
  /** 3 層の次の番号が置かれているマスの印（#301。マップタブ）。 */
  readonly tripleMarks: TripleChildMarks;
  /** 自動ペンのパーツ（#303・#310）。 */
  readonly autopen: AutoPenService;
  /** 自動ペンの道具（#310）。 */
  readonly tool: AutoPenTool;
  /** マップタブの右の欄の自動ペン。 */
  readonly panel: AutoPenPanel;
  /** パレットの色（#310）。 */
  readonly tint: AutoPenTint;

  constructor(state: EditorState, mapTab: MapTab, usage: BlockUsageService) {
    this.tripleMarks = new TripleChildMarks(mapTab.view, state);
    this.autopen = new AutoPenService(state);
    this.tool = new AutoPenTool(state, this.autopen, usage, mapTab.painter, mapTab.view);
    mapTab.painter.autoPen = this.tool;
    this.panel = new AutoPenPanel(state, this.autopen);
    mapTab.insertSide(this.panel.element);
    this.tint = new AutoPenTint(state, this.autopen, mapTab.palette);
    // 自動ペンがオンのまま、パーツの無いタイルセットのマップを開いたときも候補を作る
    state.on("map", () => {
      if (state.settings.data.autoPen) queueMicrotask(() => this.panel.suggest());
    });
    // P: 自動ペンの切り替え（マップタブ。入力欄の中と、後ろを覆うダイアログの間は反応しない）
    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.key.toUpperCase() !== "P") return;
      if (state.tab !== "map" || !state.map || modalOpen() || isTyping(e.target)) return;
      e.preventDefault();
      this.panel.setActive(!state.settings.data.autoPen);
    });
  }
}
