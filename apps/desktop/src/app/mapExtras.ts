import type { MapId } from "@zigzagumap/core";
import { jaComposite } from "../i18n/ja.composite";
import { EdgeMenu } from "../ui/connection/EdgeMenu";
import { EdgeResize } from "../ui/connection/EdgeResize";
import type { EventTab } from "../ui/event/EventTab";
import { ConnectionHandles } from "../ui/map/ConnectionHandles";
import { DiveOverlay } from "../ui/map/DiveOverlay";
import { EdgeHandles } from "../ui/map/EdgeHandles";
import { NeighborLayer } from "../ui/map/NeighborLayer";
import { installViewExtras } from "../ui/map/viewExtras";
import type { MapTab } from "../ui/tabs/MapTab";
import type { MovementTab } from "../ui/tabs/MovementTab";
import { BlockUsagePanel } from "../ui/usage/BlockUsagePanel";
import { UsageMarks } from "../ui/usage/UsageMarks";
import type { Actions } from "./Actions";
import { BlockUsageService } from "./BlockUsageService";
import { CompositeImage } from "./CompositeImage";
import type { EditorState } from "./EditorState";
import { NeighborService } from "./neighbors/NeighborService";

/** MapExtras を付けるタブ。 */
export interface MapExtraTabs {
  readonly map: MapTab;
  readonly movement: MovementTab;
  readonly event: EventTab;
}

/**
 * Phase3 でマップの表示に足したもの（隣のマップの帯、ダイブ先の重ね表示、帯と辺のつまみ、ブロックの使用回数と使用の印、
 * 画像のコピー、Ctrl の表示の補助）。作るときに 3 つのタブへ取り付け、`image.copy*` のアクションを登録する。
 */
export class MapExtras {
  /** 隣のマップの帯（Phase3 #223。マップ・移動エリア・イベントの 3 タブで同じものを描く）。 */
  readonly neighbors: NeighborService;
  /** Space で重ねるダイブ先・浮上先（マップタブとイベントタブ）。 */
  readonly diveOverlays: DiveOverlay[];
  /** 隣の帯の角と辺のつまみ（マップタブ）。 */
  readonly connectionHandles: ConnectionHandles;
  readonly edgeHandles: EdgeHandles;
  /** 辺のつまみのドラッグでのリサイズ（#231）。 */
  readonly edgeResize: EdgeResize;
  /** ブロックの使用回数の索引（#235）。 */
  readonly blockUsage: BlockUsageService;
  /** 接続している全マップ（か今のマップ）の画像（#246）。 */
  readonly composite: CompositeImage;
  /** 使用の印（#235。マップタブと移動エリアタブ）。 */
  readonly usageMarks: { readonly map: UsageMarks; readonly movement: UsageMarks };

  constructor(
    state: EditorState,
    actions: Actions,
    private readonly tabs: MapExtraTabs,
    openMap: (id: MapId) => Promise<void>,
  ) {
    const { map: mapTab, movement: movementTab, event: eventTab } = tabs;
    this.neighbors = new NeighborService(state);
    // 境界をまたぐ描画（#234）: 描く道具に隣の帯を教える
    mapTab.painter.cells.neighbors = this.neighbors;
    movementTab.painter.cells.neighbors = this.neighbors;
    // Space でダイブ先・浮上先を重ねる（#232。マップタブとイベントタブ）
    this.diveOverlays = [new DiveOverlay(mapTab.view, state, "map", openMap), new DiveOverlay(eventTab.view, state, "event", openMap)];
    const layers = ([[mapTab.view, "map"], [movementTab.view, "movement"], [eventTab.view, "event"]] as const).map(
      ([view, tab]) => new NeighborLayer(view, state, this.neighbors, openMap, { tab, movement: tab === "movement", clones: tab === "event" }),
    );
    // 隣の帯のつまみ（マップタブだけ。#229）
    this.connectionHandles = new ConnectionHandles(mapTab.view, state, this.neighbors, layers[0]!);
    // 主マップの辺のつまみ（右クリックで接続のメニュー。#230）
    this.edgeResize = new EdgeResize(state);
    this.edgeHandles = new EdgeHandles(mapTab.view, state, new EdgeMenu(state), this.edgeResize);
    // ブロックの使用回数・移動許可の自動選択・使用の印（#235）
    this.blockUsage = new BlockUsageService(state);
    // ミキシングバッグで描くときの移動許可（#236）
    mapTab.painter.usage = this.blockUsage;
    // 画像のコピー（#246）: ツール > マップの画像をコピー／接続している全マップの画像をコピー
    this.composite = new CompositeImage(state);
    for (const whole of [false, true]) {
      for (const events of ["none", "persons", "all"] as const) {
        actions.register(`image.${whole ? "copyWhole" : "copyMap"}.${events}`, async () => {
          const r = await this.composite.copy({ whole, events, ask: true });
          if (r) state.setStatus(jaComposite.copied(r.width, r.height, r.maps, r.scale));
        });
      }
    }
    mapTab.insertSide(new BlockUsagePanel(state, this.blockUsage).element);
    this.usageMarks = { map: new UsageMarks(mapTab.view, state, "map", this.blockUsage), movement: new UsageMarks(movementTab.view, state, "movement", this.blockUsage) };
    // Ctrl で重ね描きを隠す・ステータスバーの補助の欄（#238）
    for (const [view, tab] of [[mapTab.view, "map"], [movementTab.view, "movement"], [eventTab.view, "event"]] as const) installViewExtras(view, state, tab, this.neighbors);
  }

  /** 隣のマップを読み込んでから書く操作（境界をまたぐ描画。#234）が残っていないことを待つ（自動操作用）。 */
  async settlePainting(): Promise<void> {
    await this.tabs.map.painter.cells.settle();
    await this.tabs.movement.painter.cells.settle();
  }
}
