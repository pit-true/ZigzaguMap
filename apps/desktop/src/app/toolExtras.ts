import { isTyping, modalOpen } from "../input/keyGuards";
import { jaTools } from "../i18n/ja.tools";
import { ToolStrip } from "../ui/tools/ToolStrip";
import type { MapTab } from "../ui/tabs/MapTab";
import type { MovementTab } from "../ui/tabs/MovementTab";
import type { EditorState } from "./EditorState";
import { PAINT_TOOLS, setPaintTool } from "./paintTool";
import { matchesKey } from "./keymap";
import type { EdgeResize } from "../ui/connection/EdgeResize";
import type { ResizePlan } from "../ui/resize/ResizeDialog";

/**
 * Phase5 の列 1（描く道具と表示）で足したもの。App が作ってマップタブと移動エリアタブへ取り付ける（機能ごとに部品を分ける）。
 * - 道具の帯（#388）と、N・B・S のキーでの切り替え。
 * - 対話式リサイズの窓（#390）。場所の設定タブのかんたん表示のボタンと、辺のつまみの右クリックから開く（窓のコードは初めて開くときに読み込む）。
 */
export class ToolExtras {
  /** マップタブの道具の帯。 */
  readonly mapStrip: ToolStrip;
  /** 移動エリアタブの道具の帯。 */
  readonly movementStrip: ToolStrip;

  constructor(
    private readonly state: EditorState,
    readonly mapTab: MapTab,
    readonly movementTab: MovementTab,
    private readonly resizer: EdgeResize,
  ) {
    this.mapStrip = new ToolStrip(state, "map");
    mapTab.prependSide(this.mapStrip.element);
    this.movementStrip = new ToolStrip(state, "movement");
    movementTab.insertSide(this.movementStrip.element);
    // N・B・S: 道具の切り替え（マップタブと移動エリアタブ。修飾キーなし。入力欄の中と、後ろを覆うダイアログの間は反応しない）
    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented || e.metaKey || e.repeat) return;
      if ((state.tab !== "map" && state.tab !== "movement") || !state.map || modalOpen() || isTyping(e.target)) return;
      const tool = PAINT_TOOLS.find((t) => matchesKey(t.keyAction, e));
      if (!tool) return;
      e.preventDefault();
      setPaintTool(this.state, tool.id);
      this.state.setStatus(jaTools.toolChanged(jaTools.toolNames[tool.id] ?? tool.id));
    });
  }

  /** 大きさと位置を変える窓を開く。 */
  async openResize(): Promise<void> {
    if (!this.state.map) return;
    const { openResizeDialog } = await import("../ui/resize/ResizeDialog");
    openResizeDialog(this.state, (plan) => this.applyResize(plan));
  }

  /** 窓で決めた大きさと位置で変える（自動操作からも使う）。成功したら true。 */
  async applyResize(plan: ResizePlan): Promise<boolean> {
    const { fillPattern } = await import("../ui/resize/ResizeDialog");
    return this.resizer.resizeBox(plan.box, fillPattern(this.state, plan.fill));
  }
}
