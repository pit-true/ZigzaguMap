import { ja } from "../i18n/ja";
import type { EditorState } from "./EditorState";
import type { EnableWhen, MenuItem } from "./menuDefinition";
import type { SettingsData } from "./Settings";

/** アクションが呼ぶ App の操作。 */
export interface ActionTarget {
  openRomDialog(): Promise<void>;
  openProjectDialog(): Promise<void>;
  reload(): Promise<void>;
  exportMaps(chooseFolder: boolean): Promise<unknown>;
  openRecent(index: number): Promise<void>;
  exit(): Promise<void>;
  openMapByNumber(): Promise<void>;
  openPreviousMap(): Promise<void>;
  setSort(mode: number): void;
  changeSetting(patch: Partial<SettingsData>): void;
  askPaletteWidth(): Promise<void>;
  askOpacity(): Promise<void>;
  askRecentMax(): Promise<void>;
}

/** 設定の切り替え（チェックつきの項目）と、対応する設定の名前。 */
const TOGGLES: Readonly<Record<string, keyof SettingsData>> = {
  "view.grid": "grid",
  "view.objects": "showObjects",
  "zoom.map": "zoomMap",
  "zoom.movement": "zoomMovement",
  "zoom.event": "zoomEvent",
  "zoom.palette": "zoomBlockPalette",
  "zoom.movementPalette": "zoomMovementPalette",
  "view.toolbar": "showToolbar",
  "view.combobox": "comboBox",
  "opt.rememberLast": "rememberLast",
  "recent.showPath": "recentShowPath",
};

/**
 * 未実装の項目で、AdvanceMap の初期状態でチェックが付いているもの（表示だけ合わせる）。
 * 言語は Japanese（11 番目）にチェックを付ける。
 */
const FIXED_CHECKS = new Set([
  "view.hideEventPanel",
  "opt.autoSearch",
  "opt.advancedHeader",
  "opt.backupOnOpen",
  "opt.romShortcut",
  "lang.11",
]);

/**
 * メニュー・ツールバー・ショートカットのアクション。ID から処理を引き、有効・チェックの状態を答える。
 * 処理の無い ID は「未実装」としてステータスバーに出す。
 */
export class Actions {
  private readonly handlers = new Map<string, () => unknown>();

  constructor(
    private readonly state: EditorState,
    target: ActionTarget,
  ) {
    const h = this.handlers;
    h.set("file.open", () => target.openRomDialog());
    h.set("file.openProject", () => target.openProjectDialog());
    h.set("file.reload", () => target.reload());
    h.set("file.export", () => target.exportMaps(false));
    h.set("file.exportTo", () => target.exportMaps(true));
    h.set("file.exit", () => target.exit());
    for (let i = 0; i < 9; i++) h.set(`recent.${i}`, () => target.openRecent(i));
    for (const [id, key] of Object.entries(TOGGLES)) {
      h.set(id, () => target.changeSetting({ [key]: !this.state.settings.data[key] }));
    }
    for (let i = 0; i < ja.sortModes.length; i++) h.set(`sort.${i}`, () => target.setSort(i));
    h.set("view.paletteWidth", () => target.askPaletteWidth());
    h.set("view.opacity", () => target.askOpacity());
    h.set("recent.max", () => target.askRecentMax());
    h.set("recent.clear", () => target.changeSetting({ recent: [] }));
    h.set("tools.openMap", () => target.openMapByNumber());
    h.set("tools.previousMap", () => target.openPreviousMap());
  }

  /** 実装済みか。 */
  isImplemented(id: string): boolean {
    return this.handlers.has(id);
  }

  /** 実行する。未実装ならステータスバーに出す。 */
  run(id: string, label?: string): void {
    const handler = this.handlers.get(id);
    if (!handler) {
      this.state.setStatus(ja.notImplemented(label ?? id));
      return;
    }
    Promise.resolve()
      .then(handler)
      .catch((e: unknown) => this.state.setStatus(ja.error(e instanceof Error ? e.message : String(e)), undefined, true));
  }

  /** 押せる条件を満たすか。 */
  isEnabledWhen(when: EnableWhen | undefined): boolean {
    if (!when || when === "always") return true;
    if (when === "rom") return this.state.session !== null;
    return this.state.map !== null;
  }

  /** メニュー項目が押せるか。 */
  isEnabled(item: MenuItem): boolean {
    return this.isEnabledWhen(item.enable);
  }

  /** チェックが付くか。 */
  isChecked(id: string): boolean {
    const key = TOGGLES[id];
    if (key) return this.state.settings.data[key] === true;
    if (id.startsWith("sort.")) return Number(id.slice(5)) === this.state.settings.data.sortMode;
    return FIXED_CHECKS.has(id);
  }
}
