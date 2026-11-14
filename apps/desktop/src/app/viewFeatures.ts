import { SeamNotice } from "../ui/connection/SeamNotice";
import type { TownMiniView } from "../ui/view/TownMiniView";
import type { PointerDialog } from "../ui/pointer/PointerDialog";
import type { EventTab } from "../ui/event/EventTab";
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
  readonly files: FileDialogs;
  /** 自動操作で起動したか（クリップボードを汚さない）。 */
  readonly isAutomation: () => boolean;
}

/**
 * Phase4 の表示・一覧・調査の機能（列 3）をまとめて取り付ける。機能ごとのクラスを作り、メニューのアクションを登録する。
 * - 接続の境目の注意（#305）: ステータスバーの「注意: 接続 N か所」と、マップタブの隣の帯の枠。
 * - タウンマップの小窓（#306）: 表示 > タウンマップの小窓（個人設定 `showTownMap`）。中身は初めて出すときに読み込む。
 * - ポインタ一覧と参照元の検索（#307）: ツール > ポインタ一覧と参照元の検索（Ctrl+Shift+P）。初めて開くときに読み込む。
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
