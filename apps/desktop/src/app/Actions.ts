import { ja } from "../i18n/ja";
import type { EditorState } from "./EditorState";
import type { ImageKind } from "./ImageExport";
import type { SystemSettings } from "./SystemSettings";
import type { EnableWhen, MenuItem } from "./menuDefinition";
import type { SettingsData } from "./Settings";

/** アクションが呼ぶ App の操作。 */
export interface ActionTarget {
  readonly system: SystemSettings;
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
  saveImage(kind: ImageKind): Promise<void>;
  createIniFromHeader(): Promise<void>;
  openWorldMap(): Promise<void>;
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
  "view.hideEventPanel": "hideEventPanel",
  "opt.autoSearch": "autoSearch",
  "opt.advancedHeader": "advancedHeader",
  "opt.romShortcut": "romShortcut",
  "opt.contextMenu": "contextMenu",
};

/** いつもチェックが付く項目（言語は日本語だけ）。 */
const FIXED_CHECKS = new Set(["lang.ja"]);

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
    // 確認してから切り替えるもの（TOGGLES の既定の動作を上書きする）。
    h.set("opt.romShortcut", () => target.system.toggleRomShortcut());
    h.set("opt.contextMenu", () => target.system.toggleContextMenu());
    h.set("opt.scriptEditor", () => target.system.chooseScriptEditor());
    h.set("tools.desktopShortcut", () => target.system.createDesktopShortcut());
    // ROM へ書き込まないので意味の無いもの。
    for (const id of ["opt.backupOnOpen", "tools.find", "dummy.bankHeader", "dummy.bank", "dummy.connections", "dummy.wildHeader", "dummy.manage"]) {
      h.set(id, () => target.system.notNeeded());
    }
    // バックアップの作成は「出力先を指定して出力」に読み替える。
    h.set("file.backup", () => target.exportMaps(true));
    h.set("lang.ja", () => undefined);
    h.set("help.about", async () => (await import("../ui/help/HelpWindows")).openAbout());
    h.set("help.eula", async () => (await import("../ui/help/HelpWindows")).openEula());
    h.set("help.readme", async () => (await import("../ui/help/HelpWindows")).openReadme());
    h.set("view.paletteWidth", () => target.askPaletteWidth());
    h.set("view.opacity", () => target.askOpacity());
    h.set("recent.max", () => target.askRecentMax());
    h.set("recent.clear", () => target.changeSetting({ recent: [] }));
    h.set("tools.openMap", () => target.openMapByNumber());
    h.set("tools.previousMap", () => target.openPreviousMap());
    h.set("tools.worldMap", () => target.openWorldMap());
    h.set("display.header", () => target.changeSetting({ mapListSource: this.state.settings.data.mapListSource === "header" ? "both" : "header" }));
    h.set("display.ini", () => target.changeSetting({ mapListSource: this.state.settings.data.mapListSource === "ini" ? "both" : "ini" }));
    h.set("display.createIni", () => target.createIniFromHeader());
    h.set("image.map", () => target.saveImage("map"));
    h.set("image.mapEvent", () => target.saveImage("mapEvent"));
    h.set("image.palette", () => target.saveImage("palette"));
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
    if (id === "display.header") return this.state.settings.data.mapListSource === "header";
    if (id === "display.ini") return this.state.settings.data.mapListSource === "ini";
    return FIXED_CHECKS.has(id);
  }
}
