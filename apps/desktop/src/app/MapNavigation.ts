import type { MapId } from "@zigzagumap/core";
import { ja } from "../i18n/ja";
import { inputDialog } from "../ui/InputDialog";
import { showError } from "../ui/MessageBox";
import type { EditorState } from "./EditorState";
import { mapSearchName } from "./MapTreeModel";

/** MapNavigation が呼ぶ App の操作。 */
export interface MapNavigationHost {
  readonly state: EditorState;
  /** マップを開く（今のマップを戻るの履歴に積む）。 */
  openMap(id: MapId): Promise<void>;
  /** 戻る・進むでマップを開く（履歴に積まない）。開けたら true。 */
  showFromHistory(id: MapId): Promise<boolean>;
}

/** 番号・名前でマップを開く、戻る・進む（#237）。 */
export class MapNavigation {
  constructor(private readonly host: MapNavigationHost) {}

  /** ツール > マップを指定して開く（Ctrl+M）。初期値は今のマップ。 */
  async openMapByNumber(): Promise<void> {
    const state = this.host.state;
    const session = state.session;
    if (!session) return;
    const current = state.map ? `${state.map.id.bank}.${state.map.id.map}` : "";
    const text = await inputDialog(ja.openMapTitle, ja.openMapPrompt, current);
    if (text === null) return;
    const m = /^\s*(\d+)\s*\.\s*(\d+)\s*$/.exec(text);
    // AdvanceMap は形の違う入力に、いつも空文字の StrToInt の例外を出す。
    if (!m) return void (await showError(ja.invalidInteger(""), ja.appTitle));
    const id = { bank: Number(m[1]), map: Number(m[2]) };
    if (!session.catalog.has(id)) return void (await showError(ja.mapNotFound));
    await this.host.openMap(id);
  }

  /** マップ名で探して開く（#237。Ctrl+F）。 */
  async findMap(): Promise<void> {
    const session = this.host.state.session;
    if (!session) return;
    const { mapFindDialog } = await import("../ui/MapFindDialog");
    const id = await mapFindDialog(session.catalog.maps.map((m) => ({ id: m.id, name: mapSearchName(m) })));
    if (id) await this.host.openMap(id);
  }

  /** 戻る（#237。ツール > 以前開いたマップを開く・Alt+BkSp・Alt+←・マウスの戻るボタン）。 */
  async openPreviousMap(): Promise<void> {
    await this.stepHistory("back");
  }

  /** 進む（#237。Alt+→・マウスの進むボタン）。 */
  async openNextMap(): Promise<void> {
    await this.stepHistory("forward");
  }

  /** 履歴を 1 つ戻る・進む。開けなかったら履歴を元に戻す。 */
  private async stepHistory(direction: "back" | "forward"): Promise<void> {
    const state = this.host.state;
    const session = state.session;
    if (!session) return;
    const current = state.map?.id ?? null;
    const valid = (id: MapId): boolean => session.catalog.has(id) || !!session.project.loaded(id);
    const h = state.history;
    const target = direction === "back" ? h.back(current, valid) : h.forward(current, valid);
    if (!target) return;
    if (!(await this.host.showFromHistory(target))) h.undoStep(direction, target, current);
  }
}
