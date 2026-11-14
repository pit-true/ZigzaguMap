import type { BlockUsageService } from "../../app/BlockUsageService";
import type { EditorState } from "../../app/EditorState";
import { jaBlockUsage as t } from "../../i18n/ja.blockUsage";
import { movementName } from "../../input/MovementPainter";
import "../../styles/usage.css";

/**
 * マップタブの右の欄の「移動許可を自動で選ぶ」と、選んだブロックの使用回数（#235）。
 * - 自動で選ぶ（個人設定 `autoMovement`、既定オン）: ブロックを 1 つ選ぶと（パレット・マップの右クリック・境界ブロック）、
 *   全マップでそのブロックにいちばん多い移動許可を選ぶ（移動エリアタブで描く値）。移動許可を持つ選択（マップから拾った
 *   複数選択・スタンプ）には当てない。
 * - 使用回数: 主タイルセットのブロックは主が同じマップ全部、副のブロックは組が同じマップ全部で数える（共有している配置は 1 回）。
 */
export class BlockUsagePanel {
  readonly element: HTMLElement;
  private readonly count: HTMLElement;
  private readonly most: HTMLElement;
  private readonly auto: HTMLInputElement;
  private lastAuto: { block: number; selection: unknown } | null = null;

  constructor(
    private readonly state: EditorState,
    private readonly usage: BlockUsageService,
  ) {
    this.element = document.createElement("div");
    this.element.className = "block-usage";
    const row = document.createElement("label");
    row.className = "block-usage-auto";
    row.title = t.autoMovementHint;
    this.auto = document.createElement("input");
    this.auto.type = "checkbox";
    this.auto.dataset["autoId"] = "map.autoMovement";
    this.auto.checked = state.settings.data.autoMovement;
    this.auto.addEventListener("change", () => {
      state.settings.update({ autoMovement: this.auto.checked });
      this.render();
    });
    row.append(this.auto, document.createTextNode(t.autoMovement));
    this.count = document.createElement("div");
    this.count.className = "block-usage-count";
    this.count.dataset["autoId"] = "map.blockUsage";
    this.most = document.createElement("div");
    this.most.className = "block-usage-most";
    this.most.dataset["autoId"] = "map.blockUsageMost";
    this.element.append(row, this.count, this.most);

    state.on("selection", () => this.render());
    state.on("map", () => this.render());
    state.on("view", () => {
      this.auto.checked = state.settings.data.autoMovement;
      this.render();
    });
    usage.onChange(() => this.render());
    this.render();
  }

  /** 選んでいるブロック（1 つで、移動許可を持たない選択のときだけ）。 */
  private singleBlock(): number | null {
    const s = this.state.selection;
    return s.width === 1 && s.height === 1 && s.movements === undefined ? (s.blocks[0] ?? 0) : null;
  }

  private render(): void {
    const map = this.state.map;
    const s = this.state.selection;
    const block = s.width === 1 && s.height === 1 ? (s.blocks[0] ?? 0) : null;
    if (!map || block === null) {
      this.count.textContent = map ? t.multiple : "";
      this.most.textContent = "";
      return;
    }
    const usage = this.usage.ready;
    if (!usage) {
      this.count.textContent = t.counting;
      this.most.textContent = "";
      void this.usage.build();
      return;
    }
    const p = map.doc.primaryTileset;
    const q = map.doc.secondaryTileset;
    let here = 0;
    for (const v of map.doc.grid.cells) if ((v & 0x3ff) === block) here++;
    this.count.textContent = t.count(usage.count(block, p, q), here);
    const most = usage.mostMovement(block, p, q);
    this.most.textContent = most === null ? t.mostNone : t.most(most, movementName(most));
    // 移動許可の自動選択（同じ選択には 1 回だけ）
    const single = this.singleBlock();
    if (single !== null && most !== null && this.state.settings.data.autoMovement && this.lastAuto?.selection !== s) {
      this.lastAuto = { block: single, selection: s };
      if (this.state.movement !== most) {
        this.state.selectMovement(most);
        this.state.setStatusInfo(t.autoSelected(single, most, movementName(most)));
      }
    }
  }
}
