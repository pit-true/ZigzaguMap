import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CommandEvent, MapId } from "@zigzagumap/core";
import { ja } from "../i18n/ja";
import { inputDialog } from "../ui/InputDialog";
import { messageBox, showError } from "../ui/MessageBox";
import { MapImage } from "../ui/map/MapImage";
import { MapCombo } from "../ui/MapCombo";
import { MapTree } from "../ui/MapTree";
import { MenuBar } from "../ui/MenuBar";
import { RomInfoPanel } from "../ui/RomInfoPanel";
import { Splitter } from "../ui/Splitter";
import { StatusBar } from "../ui/StatusBar";
import { TabControl } from "../ui/TabControl";
import { GrosserBlockWindow } from "../ui/GrosserBlockWindow";
import { EventTab } from "../ui/tabs/EventTab";
import { HeaderTab } from "../ui/tabs/HeaderTab";
import { MapTab } from "../ui/tabs/MapTab";
import { MovementTab } from "../ui/tabs/MovementTab";
import { WildTab } from "../ui/tabs/WildTab";
import { Toolbar } from "../ui/Toolbar";
import { Actions, type ActionTarget } from "./Actions";
import { startAutomation } from "./Automation";
import { EditorState, TAB_ORDER, type TabId } from "./EditorState";
import { FileDialogs, writeFile } from "./FileDialogs";
import { buildNewIni, NEW_MAIN_INI, NEW_MAPS_INI } from "./IniExport";
import { ImageExport, type ImageKind } from "./ImageExport";
import { buildMapTree, comboGroups } from "./MapTreeModel";
import { buildMenu, type MenuItem } from "./menuDefinition";
import { ProjectSession, UnknownRomError } from "./ProjectSession";
import { Settings, type SettingsData } from "./Settings";
import { installShortcuts } from "./Shortcuts";
import { timings } from "./timings";
import { keepWindowPlacement } from "./WindowPlacementKeeper";

/** 起動引数（Rust の StartupArgs）。 */
interface StartupArgs {
  readonly rom: string | null;
  readonly project: string | null;
  readonly automation: number | null;
}

/** 未出力の印を確かめるまでの待ち時間（ドラッグ中に何度も調べないため）。 */
const DIRTY_CHECK_DELAY = 150;

/** アプリ全体。画面部品を組み立て、ROM・マップの読み込み、出力、終了を受け持つ。 */
export class App implements ActionTarget {
  readonly state: EditorState;
  readonly actions: Actions;
  /** ファイル・フォルダを選ぶダイアログ（自動操作では先に答えを積める）。 */
  readonly files = new FileDialogs();
  private readonly menu: MenuBar;
  private readonly toolbar: Toolbar;
  private readonly tree: MapTree;
  private readonly combo: MapCombo;
  private readonly splitter: Splitter;
  private readonly romInfo = new RomInfoPanel();
  private readonly statusBar = new StatusBar();
  private readonly left: HTMLElement;
  private readonly hint: HTMLElement;
  readonly grosserBlock: GrosserBlockWindow;
  readonly tabs: Record<"map" | "movement" | "event", { view: { toPng(): string | null } }>;
  private unsubscribeBus: (() => void) | null = null;
  private dirtyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingDirty = new Map<string, MapId>();
  private closing = false;
  /** 自動操作で起動したか（PC 全体に影響する操作をしない、ウィンドウの位置を覚えない）。 */
  automation = false;

  constructor(
    private readonly root: HTMLElement,
    settings: Settings,
  ) {
    const state = new EditorState(settings, ja.statusOpenRom);
    this.state = state;
    this.actions = new Actions(state, this);
    this.menu = new MenuBar({
      items: () => buildMenu(this.recentItems()),
      isEnabled: (item) => this.actions.isEnabled(item),
      isChecked: (id) => this.actions.isChecked(id),
      run: (id, label) => this.actions.run(id, label),
    });
    this.toolbar = new Toolbar({
      isEnabled: (when) => this.actions.isEnabledWhen(when),
      isChecked: (id) => this.actions.isChecked(id),
      run: (id) => this.actions.run(id, toolbarLabel(id)),
      setSort: (mode) => this.setSort(mode),
      sortMode: () => state.settings.data.sortMode,
    });
    this.tree = new MapTree({ openMap: (id) => void this.openMap(id), isDirty: (id) => state.isDirty(id) });
    this.combo = new MapCombo({ openMap: (id) => void this.openMap(id) });

    this.grosserBlock = new GrosserBlockWindow(state);
    const mapTab = new MapTab(state);
    const movementTab = new MovementTab(state);
    const eventTab = new EventTab(state);
    this.tabs = { map: mapTab, movement: movementTab, event: eventTab };
    const tabControl = new TabControl(
      [
        { id: "map", title: ja.tabMap, element: mapTab.element },
        { id: "movement", title: ja.tabMovement, element: movementTab.element },
        { id: "event", title: ja.tabEvents, element: eventTab.element },
        { id: "wild", title: ja.tabWild, element: new WildTab(state).element },
        { id: "header", title: ja.tabHeader, element: new HeaderTab(state).element },
      ],
      (id) => state.setTab(id),
    );
    tabControl.show(state.tab);

    this.left = document.createElement("aside");
    this.left.className = "left-panel";
    this.left.style.width = `${settings.data.leftWidth}px`;
    this.left.append(this.tree.element, this.romInfo.element);
    const splitter = new Splitter(this.left, 120, (width) => settings.update({ leftWidth: width }));
    this.splitter = splitter;
    this.hint = document.createElement("p");
    this.hint.className = "drop-hint";
    this.hint.textContent = ja.dropHint;
    tabControl.element.append(this.hint);

    const body = document.createElement("main");
    body.className = "main-body";
    body.append(this.left, splitter.element, tabControl.element);
    root.append(this.menu.element, this.toolbar.element, this.combo.element, body, this.statusBar.element);

    state.on("status", () => this.statusBar.render(state.status));
    state.on("tab", () => {
      tabControl.show(state.tab);
      const last = state.settings.data.last;
      if (last && state.map) state.settings.update({ last: { ...last, tab: state.tab } });
    });
    state.on("dirty", () => this.tree.refreshMarks());
    state.on("view", () => this.applyLayout());
    for (const topic of ["session", "map", "view"] as const) state.on(topic, () => this.toolbar.update());
    this.statusBar.render(state.status);
    this.applyLayout();
    state.emit("view");
  }

  /** ドラッグ＆ドロップ、キー操作、終了の確認、自動操作を受け付け、起動引数の ROM を開く。 */
  async start(): Promise<void> {
    installShortcuts(this);
    await getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      this.root.classList.toggle("dragging", p.type === "enter" || p.type === "over");
      if (p.type === "drop" && p.paths.length > 0) void this.openDropped(p.paths[0]!);
    });
    await getCurrentWindow().onCloseRequested(async (event) => {
      if (this.closing) return;
      if (!(await this.confirmDiscard())) event.preventDefault();
      else await this.state.settings.flush();
    });
    const args = await invoke<StartupArgs>("startup_args");
    this.automation = args.automation !== null;
    if (args.automation) await startAutomation(this);
    else await keepWindowPlacement(this.state.settings);
    if (args.rom) await this.openSession(args.rom, args.project);
  }

  // ---- 開く ----

  async openRomDialog(): Promise<void> {
    const path = await this.files.rom();
    if (path) await this.openSession(path, null);
  }

  async openProjectDialog(): Promise<void> {
    const folder = await this.files.folder(ja.projectFolderTitle);
    if (!folder) return;
    await this.openFolder(folder);
  }

  /** プロジェクトフォルダを開く。ベース ROM は、開いている ROM か、最近開いたものの組から選ぶ。無ければ選ばせる。 */
  private async openFolder(folder: string): Promise<void> {
    const known = this.state.settings.data.recent.find((r) => r.project?.toLowerCase() === folder.toLowerCase());
    let rom = this.state.session?.romPath ?? known?.rom ?? null;
    if (!rom) {
      this.state.setStatus(ja.needRomForProject);
      rom = await this.files.rom();
    }
    if (rom) await this.openSession(rom, folder);
  }

  private async openDropped(path: string): Promise<void> {
    if (await invoke<boolean>("is_dir", { path })) await this.openFolder(path);
    else if (path.toLowerCase().endsWith(".gba")) await this.openSession(path, null);
    else this.state.setStatus(ja.unsupportedFile, undefined, true);
  }

  async openRecent(index: number): Promise<void> {
    const entry = this.state.settings.data.recent[index];
    if (entry) await this.openSession(entry.rom, entry.project);
  }

  async reload(): Promise<void> {
    const s = this.state.session;
    if (s) await this.openSession(s.romPath, s.projectDir, true);
  }

  /**
   * ROM と（あれば）プロジェクトフォルダを開く。未出力の変更があれば先に確かめる。
   * 開けなかったときはエラーを出し、開いていたものはそのまま残す。
   */
  async openSession(rom: string, project: string | null, keepMap = false): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const state = this.state;
    const reopen = keepMap ? state.map?.id ?? null : null;
    const previous = state.session;
    state.setStatus(ja.loading);
    let session: ProjectSession;
    try {
      session = await ProjectSession.open(rom, project);
    } catch (e) {
      await previous?.reattach().catch(() => undefined);
      state.setStatus(previous ? ja.statusRomLoaded : ja.statusOpenRom);
      if (e instanceof UnknownRomError) await showError(ja.unknownRomType);
      else await showError(errorText(e));
      return;
    }
    try {
      timings.mark("sessionOpened");
      this.unsubscribeBus?.();
      state.session = session;
      state.map = null;
      state.mapImage = null;
      state.dirty = new Set();
      state.previousMap = null;
      this.unsubscribeBus = session.bus.subscribe((e) => this.onCommand(e));
      this.tree.clear();
      this.rebuildTree();
      this.romInfo.show(session.project.game);
      this.hint.hidden = true;
      state.settings.addRecent({ rom, project: session.projectDir });
      state.emit("session");
      state.emit("map");
      await this.setTitle(null);
      state.setStatus(ja.statusRomLoaded, ja.statusLoadTime(formatDuration(session.loadMs)));

      const last = state.settings.data.last;
      const target =
        reopen ?? (state.settings.data.rememberLast && last && last.rom.toLowerCase() === rom.toLowerCase() ? { bank: last.bank, map: last.map } : null);
      if (target && session.catalog.has(target)) {
        if (!reopen && last && (TAB_ORDER as readonly string[]).includes(last.tab)) state.setTab(last.tab as TabId);
        await this.openMap(target);
      }
    } catch (e) {
      this.showError(e);
    }
  }

  // ---- マップ ----

  /** マップを開いて表示する。 */
  async openMap(id: MapId): Promise<void> {
    const state = this.state;
    const session = state.session;
    if (!session) return;
    const start = performance.now();
    try {
      const map = await session.openMap(id);
      if (state.map && (state.map.id.bank !== id.bank || state.map.id.map !== id.map)) state.previousMap = state.map.id;
      state.map = map;
      state.mapImage = new MapImage(map.doc.grid, map.tiles);
      state.emit("map");
      this.tree.setOpened(id);
      this.combo.setOpened(id);
      timings.mark("mapShown");
      timings.lastMapSwitchMs = performance.now() - start;
      state.setStatus(ja.statusMapLoaded(id.bank, id.map));
      state.settings.update({ last: { rom: session.romPath, bank: id.bank, map: id.map, tab: state.tab } });
      await this.setTitle(map.doc.mapNameText() ?? ja.noName);
    } catch (e) {
      this.showError(e);
    }
  }

  /** ツール > マップを指定して開く（Ctrl+M）。初期値は今のマップ。 */
  async openMapByNumber(): Promise<void> {
    const session = this.state.session;
    if (!session) return;
    const current = this.state.map ? `${this.state.map.id.bank}.${this.state.map.id.map}` : "";
    const text = await inputDialog(ja.openMapTitle, ja.openMapPrompt, current);
    if (text === null) return;
    const m = /^\s*(\d+)\s*\.\s*(\d+)\s*$/.exec(text);
    // AdvanceMap は形の違う入力に、いつも空文字の StrToInt の例外を出す。
    if (!m) return void (await showError(ja.invalidInteger(""), ja.appTitle));
    const id = { bank: Number(m[1]), map: Number(m[2]) };
    if (!session.catalog.has(id)) return void (await showError(ja.mapNotFound));
    await this.openMap(id);
  }

  async openPreviousMap(): Promise<void> {
    if (this.state.previousMap) await this.openMap(this.state.previousMap);
  }

  // ---- 編集 ----

  /** 元に戻す。 */
  undo(): void {
    const bus = this.state.session?.bus;
    if (bus && !bus.undo()) this.state.setStatus(ja.nothingToUndo);
  }

  /** やり直す。 */
  redo(): void {
    const bus = this.state.session?.bus;
    if (bus && !bus.redo()) this.state.setStatus(ja.nothingToRedo);
  }

  /** 操作の後: 表示中のマップなら描き直し、未出力の印を確かめる予約をする。 */
  private onCommand(e: CommandEvent): void {
    const args = e.command?.args as { bank?: unknown; map?: unknown } | undefined;
    if (typeof args?.bank !== "number" || typeof args.map !== "number") return;
    const id = { bank: args.bank, map: args.map };
    const current = this.state.map;
    if (current && current.id.bank === id.bank && current.id.map === id.map) {
      this.state.mapImage?.update();
      this.state.emit("cells");
    }
    this.pendingDirty.set(`${id.bank}.${id.map}`, id);
    if (this.dirtyTimer) clearTimeout(this.dirtyTimer);
    this.dirtyTimer = setTimeout(() => this.checkDirty(), DIRTY_CHECK_DELAY);
  }

  /** 未出力の印を付け直す。 */
  checkDirty(all = false): void {
    if (this.dirtyTimer) clearTimeout(this.dirtyTimer);
    this.dirtyTimer = null;
    const session = this.state.session;
    if (!session) return;
    const ids = all ? session.modifiedMaps() : [...this.pendingDirty.values()];
    if (all) this.state.dirty = new Set(ids.map((id) => `${id.bank}.${id.map}`));
    else {
      for (const id of ids) {
        const key = `${id.bank}.${id.map}`;
        if (session.isModified(id)) this.state.dirty.add(key);
        else this.state.dirty.delete(key);
      }
    }
    this.pendingDirty.clear();
    this.state.emit("dirty");
  }

  // ---- 出力 ----

  /** 変更のあったマップを出力する。フォルダが無いとき（素の ROM）か `chooseFolder` なら選ばせる。 */
  async exportMaps(chooseFolder: boolean, dir?: string): Promise<boolean> {
    const session = this.state.session;
    if (!session) return false;
    let target = dir;
    if (target === undefined && (chooseFolder || !session.projectDir)) {
      const picked = await this.files.folder(ja.exportFolderTitle);
      if (!picked) return false;
      target = picked;
    }
    try {
      const result = await session.export(target);
      if (target !== undefined) this.state.settings.addRecent({ rom: session.romPath, project: session.projectDir });
      this.checkDirty(true);
      this.state.setStatus(ja.exported(result.written.length, result.removed.length));
      return true;
    } catch (e) {
      this.showError(e);
      return false;
    }
  }

  /** 未出力の変更があれば「出力しますか」と聞く。続けてよければ true。 */
  private async confirmDiscard(): Promise<boolean> {
    const session = this.state.session;
    if (!session || session.modifiedMaps().length === 0) return true;
    const answer = await messageBox(ja.question, ja.saveChanges, "warning", "yesNoCancel");
    if (answer === "cancel") return false;
    if (answer === "yes") return this.exportMaps(false);
    return true;
  }

  async exit(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    await this.state.settings.flush();
    this.closing = true;
    await getCurrentWindow().destroy();
  }

  // ---- 設定 ----

  setSort(mode: number): void {
    this.state.settings.update({ sortMode: mode });
    this.rebuildTree();
    this.toolbar.update();
  }

  changeSetting(patch: Partial<SettingsData>): void {
    const rebuild = patch.mapListSource !== undefined && patch.mapListSource !== this.state.settings.data.mapListSource;
    this.state.settings.update(patch);
    if (rebuild) this.rebuildTree();
    this.state.emit("view");
    this.state.emit("recent");
  }

  /** 設定 > マップブロックの横幅（Ctrl+P）。0 は AdvanceMap では「Division by zero.」になるが、入力エラーにする。 */
  async askPaletteWidth(): Promise<void> {
    const text = await inputDialog(ja.blockWidthTitle, ja.blockWidthPrompt, String(this.state.settings.data.paletteWidth));
    if (text === null) return;
    const n = parseInteger(text);
    if (n === null) return void (await showError(ja.invalidInteger(text), ja.appTitle));
    if (n < 1 || n > 64) return void (await showError(ja.invalidInput));
    this.changeSetting({ paletteWidth: n });
  }

  /** 設定 > 移動エリアの設定の透明度。 */
  async askOpacity(): Promise<void> {
    const text = await inputDialog(ja.movementOpacity, ja.opacityPrompt, String(this.state.settings.data.movementOpacity));
    if (text === null) return;
    const n = Number(text.trim().replace(",", "."));
    if (text.trim() === "" || !Number.isFinite(n) || n < 0 || n > 1) return void (await showError(ja.invalidInput));
    this.changeSetting({ movementOpacity: n });
  }

  /** 設定 > 最近開いたファイルの設定 > 最近開いたファイルリストの最大数の変更。 */
  async askRecentMax(): Promise<void> {
    const text = await inputDialog(ja.recentMax, ja.recentMaxPrompt, String(this.state.settings.data.recentMax));
    if (text === null) return;
    const n = parseInteger(text);
    if (n === null) return void (await showError(ja.invalidInteger(text), ja.appTitle));
    if (n < 1 || n > 9) return void (await showError(ja.invalidInput));
    this.changeSetting({ recentMax: n, recent: this.state.settings.data.recent.slice(0, n) });
  }

  /** ツール > 画像の保存（3 種）。 */
  async saveImage(kind: ImageKind): Promise<void> {
    const path = await new ImageExport(this.state, this.files).save(kind);
    if (path) this.state.setStatus(ja.imageSaved(path));
  }

  /** 設定 > マップの表示設定 > ヘッダーから新たなIniファイルを作る。書き出し先のフォルダを選ばせる。 */
  async createIniFromHeader(): Promise<void> {
    const session = this.state.session;
    if (!session) return;
    const folder = await this.files.folder(ja.iniFolderTitle);
    if (!folder) return;
    const { main, maps } = buildNewIni(session.catalog);
    await writeFile(`${folder}\\${NEW_MAIN_INI}`, main);
    await writeFile(`${folder}\\${NEW_MAPS_INI}`, maps);
    this.state.setStatus(ja.iniCreated(folder));
  }

  // ---- 内部 ----

  /** ファイル > 最近開いたもの（登録されている分だけ。最大数を超えた分は出さない）。 */
  private recentItems(): MenuItem[] {
    const s = this.state.settings.data;
    return s.recent.slice(0, s.recentMax).map((entry, i): MenuItem => {
      const text = s.recentShowPath
        ? entry.rom + (entry.project ? ` + ${entry.project}` : "")
        : fileName(entry.rom) + (entry.project ? ` + ${fileName(entry.project)}` : "");
      return { id: `recent.${i}`, label: `${i + 1} ${text}`, accel: String(i + 1), inlineAccel: true };
    });
  }

  private rebuildTree(): void {
    const session = this.state.session;
    if (!session) return;
    this.tree.show(buildMapTree(session.catalog, this.state.settings.data.sortMode, this.state.settings.data.mapListSource));
    if (this.state.settings.data.comboBox) this.combo.show(comboGroups(session.catalog));
  }

  /** ツールバーの表示と、左の一覧かコンボボックスかの切り替え。 */
  private applyLayout(): void {
    const s = this.state.settings.data;
    this.toolbar.setVisible(s.showToolbar);
    const comboMode = s.comboBox;
    if (comboMode && this.combo.element.hidden && this.state.session) {
      this.combo.show(comboGroups(this.state.session.catalog));
      this.combo.setOpened(this.state.map?.id ?? null);
    }
    this.combo.setVisible(comboMode);
    this.left.hidden = comboMode;
    this.splitter.element.hidden = comboMode;
  }

  private async setTitle(mapName: string | null): Promise<void> {
    const map = this.state.map;
    const title = mapName && map ? ja.windowTitle(mapName, map.id.bank, map.id.map) : ja.appTitle;
    document.title = title;
    await getCurrentWindow()
      .setTitle(title)
      .catch(() => undefined);
  }

  showError(e: unknown): void {
    this.state.setStatus(ja.error(errorText(e)), undefined, true);
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Delphi の StrToInt と同じく、前後の空白を除いた 10 進の整数だけを受け付ける。 */
function parseInteger(text: string): number | null {
  return /^\s*[+-]?\d+\s*$/.test(text) ? Number(text) : null;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function toolbarLabel(id: string): string {
  const map: Record<string, string> = {
    "map.new": ja.toolbar.newMap,
    "map.insert": ja.toolbar.insertMap,
    "view.objects": ja.toolbar.showObjects,
    "tools.blockEditor": ja.toolbar.blockEditor,
    "tools.connections": ja.toolbar.connections,
    "tools.worldMap": ja.toolbar.worldMap,
    "tools.find": ja.toolbar.find,
    "help.about": ja.toolbar.about,
  };
  return map[id] ?? id;
}

/** 読込時間の表記（00:00:01.601）。 */
function formatDuration(ms: number): string {
  const total = Math.round(ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor(total / 60_000) % 60;
  const s = Math.floor(total / 1000) % 60;
  const pad = (n: number, d = 2): string => String(n).padStart(d, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(total % 1000, 3)}`;
}
