import { SeamNotice } from "../ui/connection/SeamNotice";
import type { TownMiniView } from "../ui/view/TownMiniView";
import type { PointerDialog } from "../ui/pointer/PointerDialog";
import type { EventTab } from "../ui/event/EventTab";
import type { MapTab } from "../ui/tabs/MapTab";
import type { MapTree } from "../ui/MapTree";
import { ThumbnailService } from "./ThumbnailService";
import { MapZoomControls } from "../ui/map/MapZoomControls";
import { togglePatch, type ZoomTab } from "./mapZoom";
import type { MovementTab } from "../ui/tabs/MovementTab";
import { RecentBlocksView } from "../ui/map/RecentBlocks";
import { blockInfoSource, blockInfoText } from "../ui/map/blockInfo";
import { drawPaletteBoundary } from "../ui/map/paletteBoundary";
import { movementInfo } from "./data/movementInfo";
import { jaMovementInfo } from "../i18n/ja.movementInfo";
import { hex } from "../i18n/ja";
import type { FileDialogs } from "./FileDialogs";
import { regionQuery } from "./mapTreeQuery";
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
  readonly eventTab: EventTab;
  readonly tree: MapTree;
  readonly mapTab: MapTab;
  readonly movementTab: MovementTab;
  readonly files: FileDialogs;
  /** 自動操作で起動したか（クリップボードを汚さない）。 */
  readonly isAutomation: () => boolean;
}

/**
 * Phase4 の表示・一覧・調査の機能（列 3）をまとめて取り付ける。機能ごとのクラスを作り、メニューのアクションを登録する。
 * - 接続の境目の注意（#305）: ステータスバーの「注意: 接続 N か所」と、マップタブの隣の帯の枠。
 * - タウンマップの小窓（#306）: 表示 > タウンマップの小窓（個人設定 `showTownMap`）。中身は初めて出すときに読み込む。
 * - ポインタ一覧と参照元の検索（#307）: ツール > ポインタ一覧と参照元の検索（Ctrl+Shift+P）。初めて開くときに読み込む。
 * - パレットの情報（#308）: ブロックパレットと最近使ったブロックに乗せたときのブロックの情報、TS1 と TS2 の境目（表示メニュー）、
 *   最近使ったブロック（マップタブの右の欄）、移動許可のパレットに乗せた・選んだときの説明（ステータスバーの補助の欄）。
 * - マップ一覧のサムネイル（#315）: 表示 > マップ一覧にサムネイルを出す（既定オフ）。
 * - マップの拡大（#316）: Ctrl＋ホイールで 1〜8 倍、中ボタンのドラッグでスクロール（マップ・移動エリア・イベントの各タブ）。
 */
export class ViewFeatures {
  /** 接続の境目の点検（#305）。 */
  readonly seams: SeamWarnings;
  readonly seamNotice: SeamNotice;
  /** タウンマップの小窓（#306。初めて出すときに作る）。 */
  private townValue: Promise<TownMiniView> | null = null;
  private townCreated: TownMiniView | null = null;
  /** ポインタ一覧（#307。初めて開くときに作る）。 */
  private pointerValue: Promise<PointerDialog> | null = null;
  /** 最近使ったブロック（#308）。 */
  readonly recent: RecentBlocksView;
  /** マップ一覧のサムネイル（#315。設定でオンのときだけ作る）。 */
  readonly thumbnails: ThumbnailService;
  /** マップの拡大（#316。タブごと）。 */
  readonly zoom: Record<ZoomTab, MapZoomControls>;
  /** 自動操作のときにクリップボードの代わりに書いた文字（最後の 1 つ）。 */
  lastCopied: string | null = null;

  constructor(private readonly parts: ViewFeatureParts) {
    const { state, actions, extras, statusBar } = parts;
    this.seams = new SeamWarnings(state);
    this.seamNotice = new SeamNotice(state, this.seams, extras.neighborLayers.map);
    statusBar.addSlot(this.seamNotice.element);
    actions.registerCheck("view.townMap", () => state.settings.data.showTownMap);
    actions.register("view.townMap", () => this.setTownMap(!state.settings.data.showTownMap));
    actions.register("tools.pointers", async () => (await this.pointers()).open());
    // マップの拡大（#316）。メニューの「拡大表示」を押したら、Ctrl＋ホイールで決めた倍率は忘れて 1 倍・2 倍に戻す
    this.zoom = {
      map: new MapZoomControls(parts.mapTab.view, state, "map"),
      movement: new MapZoomControls(parts.movementTab.view, state, "movement"),
      event: new MapZoomControls(parts.eventTab.view, state, "event"),
    };
    for (const [id, tab] of [["zoom.map", "map"], ["zoom.movement", "movement"], ["zoom.event", "event"]] as const) {
      actions.register(id, () => {
        state.settings.update(togglePatch(state.settings.data, tab));
        state.emit("view");
      });
    }
    // マップ一覧のサムネイル（#315）
    this.thumbnails = new ThumbnailService(state, (id) => parts.tree.refreshThumbnails(id));
    // パレットの情報（#308）
    const { mapTab, movementTab } = parts;
    const palette = mapTab.palette;
    palette.hoverListeners.push((block) => {
      const tiles = state.map?.tiles;
      state.setStatusInfo(block !== null && tiles ? blockInfoText(blockInfoSource(tiles), block) : "");
    });
    palette.gridDecorators.push((c, size, width) => {
      if (state.settings.data.paletteBoundary) drawPaletteBoundary(c, size, width);
    });
    let boundary = state.settings.data.paletteBoundary;
    state.on("view", () => {
      if (state.settings.data.paletteBoundary === boundary) return;
      boundary = state.settings.data.paletteBoundary;
      palette.refresh();
    });
    this.recent = new RecentBlocksView(state, () => palette.scrollToSelection());
    mapTab.insertSide(this.recent.element);
    const showMovement = (value: number | null): void =>
      state.setStatusInfo(value === null ? "" : jaMovementInfo.label(hex(value, 2)) + movementInfo(value));
    movementTab.palette.hoverListeners.push(showMovement);
    state.on("movement", () => {
      if (state.tab === "movement") showMovement(state.movement);
    });
    // 前回出していたら、ROM を開いたときに出す
    state.on("session", () => {
      if (state.session && state.settings.data.showTownMap) void this.setTownMap(true);
    });
  }

  /** タウンマップの小窓（作っていなければ作る）。 */
  town(): Promise<TownMiniView> {
    const { state, treeFilter } = this.parts;
    return (this.townValue ??= import("../ui/view/TownMiniView").then(
      ({ TownMiniView }) =>
        (this.townCreated = new TownMiniView(state, {
          filterByRegion: (region) => treeFilter.setText(regionQuery(region)),
          regionName: (region) => state.session?.catalog.regionNames.find(([id]) => id === region)?.[1] ?? null,
          closed: () => {
            state.settings.update({ showTownMap: false });
            state.emit("view");
          },
        })),
    ));
  }

  /** ポインタ一覧と参照元の検索の窓（作っていなければ作る）。 */
  pointers(): Promise<PointerDialog> {
    const { state, files, eventTab } = this.parts;
    return (this.pointerValue ??= import("../ui/pointer/PointerDialog").then(({ PointerDialog }) => {
      const dialog = new PointerDialog({
        state,
        files,
        selectEvent: (kind, index) => {
          state.setTab("event");
          eventTab.select(kind, index);
        },
        eventSelection: () => (state.tab === "event" ? eventTab.selection : null),
        copyText: (text) => this.copyText(text),
      });
      eventTab.onSelect(() => dialog.followEvent());
      return dialog;
    }));
  }

  /** 文字をクリップボードへ（自動操作で起動したときは `lastCopied` に残すだけ。テストでクリップボードを汚さない）。 */
  copyText(text: string): void {
    this.lastCopied = text;
    if (!this.parts.isAutomation()) void navigator.clipboard.writeText(text).catch(() => undefined);
  }

  /** タウンマップの小窓（作っていなければ null。自動操作用）。 */
  townIfCreated(): TownMiniView | null {
    return this.townCreated;
  }

  /** タウンマップの小窓を出す・隠す（個人設定に残す）。 */
  async setTownMap(show: boolean): Promise<void> {
    const state = this.parts.state;
    state.settings.update({ showTownMap: show });
    if (show) {
      if (state.session) await (await this.town()).open();
    } else if (this.townValue) {
      (await this.townValue).close();
    }
    state.emit("view");
  }
}
