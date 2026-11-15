import { CursorLayer } from "../ui/map/CursorLayer";
import { normalizeGridStyle, type GridStyle } from "../ui/map/gridStyle";
import type { MapView } from "../ui/map/MapView";
import { MovementValueField } from "../ui/map/MovementValueField";
import type { MovementTab } from "../ui/tabs/MovementTab";
import { jaTools } from "../i18n/ja.tools";
import type { Actions } from "./Actions";
import type { EditorState } from "./EditorState";
import { currentTool } from "./paintTool";
import type { SettingsData } from "./Settings";

/** 表示の補助を付けるタブ。 */
export type AidTab = "map" | "movement" | "event";

/**
 * Phase5 #391 の表示の補助。App が作ってマップ・移動エリア・イベントタブへ取り付ける。
 * - カーソルの枠（表示 > カーソルの枠、C）とプレイヤーの視界の枠（表示 > プレイヤーの視界の枠、V）: タブごとの CursorLayer。
 * - グリッドの設定（表示 > グリッドの設定…）: 3 つのタブの MapView のグリッドの形。窓のコードは初めて開くときに読み込む。
 * - 移動許可の数値の欄（移動エリアタブのパレットの上）。
 * 設定は個人設定（`cursorFrame`・`playerView`・`gridStyle`）に残す。既定はどれもオフか今の見た目。
 */
export class ViewAids {
  readonly layers: Readonly<Record<AidTab, CursorLayer>>;
  readonly movementValue: MovementValueField;
  private readonly views: Readonly<Record<AidTab, MapView>>;

  constructor(
    private readonly state: EditorState,
    views: Readonly<Record<AidTab, MapView>>,
    movementTab: MovementTab,
    actions: Actions,
  ) {
    this.views = views;
    // マップタブは鉛筆のとき選択（スタンプ）の大きさ、ほかは 1 マス
    const mapSize = (): { width: number; height: number } => {
      const s = state.selection;
      return currentTool(state) === "pencil" ? { width: s.width, height: s.height } : { width: 1, height: 1 };
    };
    this.layers = {
      map: new CursorLayer(views.map, mapSize),
      movement: new CursorLayer(views.movement),
      event: new CursorLayer(views.event),
    };
    this.movementValue = new MovementValueField(state, () => movementTab.palette.showSelection(state.movement, true));
    movementTab.insertSide(this.movementValue.element);

    actions.register("view.cursorFrame", () => this.toggle({ cursorFrame: !state.settings.data.cursorFrame }, jaTools.cursorFrameOn, jaTools.cursorFrameOff));
    actions.registerCheck("view.cursorFrame", () => state.settings.data.cursorFrame);
    actions.register("view.playerView", () => this.toggle({ playerView: !state.settings.data.playerView }, jaTools.playerViewOn, jaTools.playerViewOff));
    actions.registerCheck("view.playerView", () => state.settings.data.playerView);
    actions.register("view.gridSettings", async () => {
      const { openGridSettings } = await import("../ui/view/GridSettingsDialog");
      openGridSettings(this.gridStyle, (style) => this.showGrid(style), (style) => this.saveGrid(style));
    });

    state.on("view", () => this.apply());
    for (const topic of ["selection", "tool", "map", "neighbors", "tab"] as const) state.on(topic, () => this.redraw());
    this.apply();
  }

  /** 個人設定のグリッドの形。 */
  get gridStyle(): GridStyle {
    return normalizeGridStyle(this.state.settings.data.gridStyle);
  }

  /** 設定を変えて知らせる。 */
  private toggle(patch: Partial<SettingsData>, on: string, off: string): void {
    this.state.settings.update(patch);
    this.state.emit("view");
    const value = Object.values(patch)[0] === true;
    this.state.setStatus(value ? on : off);
  }

  /** グリッドの形を見せる（保存しない。窓で入れている間）。 */
  showGrid(style: GridStyle): void {
    for (const v of Object.values(this.views)) v.setGridStyle(style);
  }

  /** グリッドの形を個人設定に残し、グリッドを出す。 */
  saveGrid(style: GridStyle): void {
    this.state.settings.update({ gridStyle: { ...style }, grid: true });
    this.state.emit("view");
  }

  private apply(): void {
    const s = this.state.settings.data;
    this.showGrid(this.gridStyle);
    for (const l of Object.values(this.layers)) l.configure(s.cursorFrame, s.playerView);
  }

  private redraw(): void {
    for (const l of Object.values(this.layers)) l.redraw();
  }
}
