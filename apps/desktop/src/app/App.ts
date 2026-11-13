import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CommandEvent, MapId } from "@zigzagumap/core";
import { ja } from "../i18n/ja";
import { inputDialog } from "../ui/InputDialog";
import { MapImage } from "../ui/map/MapImage";
import { MapTree } from "../ui/MapTree";
import { MenuBar } from "../ui/MenuBar";
import { RomInfoPanel } from "../ui/RomInfoPanel";
import { Splitter } from "../ui/Splitter";
import { StatusBar } from "../ui/StatusBar";
import { TabControl } from "../ui/TabControl";
import { EventTab } from "../ui/tabs/EventTab";
import { HeaderTab } from "../ui/tabs/HeaderTab";
import { MapTab } from "../ui/tabs/MapTab";
import { MovementTab } from "../ui/tabs/MovementTab";
import { WildTab } from "../ui/tabs/WildTab";
import { Toolbar } from "../ui/Toolbar";
import { Actions, type ActionTarget } from "./Actions";
import { startAutomation } from "./Automation";
import { EditorState, TAB_ORDER, type TabId } from "./EditorState";
import { buildMapTree } from "./MapTreeModel";
import { buildMenu, type MenuItem } from "./menuDefinition";
import { ProjectSession } from "./ProjectSession";
import { Settings, type SettingsData } from "./Settings";
import { installShortcuts } from "./Shortcuts";
import { timings } from "./timings";

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
  private readonly menu: MenuBar;
  private readonly toolbar: Toolbar;
  private readonly tree: MapTree;
  private readonly romInfo = new RomInfoPanel();
  private readonly statusBar = new StatusBar();
  private readonly left: HTMLElement;
  private readonly hint: HTMLElement;
  readonly tabs: Record<"map" | "movement" | "event", { view: { toPng(): string | null } }>;
  private unsubscribeBus: (() => void) | null = null;
  private dirtyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingDirty = new Map<string, MapId>();
  private closing = false;

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
    this.hint = document.createElement("p");
    this.hint.className = "drop-hint";
    this.hint.textContent = ja.dropHint;
    tabControl.element.append(this.hint);

    const body = document.createElement("main");
    body.className = "main-body";
    body.append(this.left, splitter.element, tabControl.element);
    root.append(this.menu.element, this.toolbar.element, body, this.statusBar.element);

    state.on("status", () => this.statusBar.render(state.status));
    state.on("tab", () => {
      tabControl.show(state.tab);
      const last = state.settings.data.last;
      if (last && state.map) state.settings.update({ last: { ...last, tab: state.tab } });
    });
    state.on("dirty", () => this.tree.refreshMarks());
    state.on("view", () => this.toolbar.setVisible(state.settings.data.showToolbar));
    for (const topic of ["session", "map", "view"] as const) state.on(topic, () => this.toolbar.update());
    this.statusBar.render(state.status);
    this.toolbar.setVisible(settings.data.showToolbar);
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
    if (args.automation) await startAutomation(this);
    if (args.rom) await this.openSession(args.rom, args.project);
  }

  // ---- 開く ----

  async openRomDialog(): Promise<void> {
    const path = await invoke<string | null>("pick_rom");
    if (path) await this.openSession(path, null);
  }

  async openProjectDialog(): Promise<void> {
    const folder = await invoke<string | null>("pick_folder", { title: ja.projectFolderTitle });
    if (!folder) return;
    await this.openFolder(folder);
  }

  /** プロジェクトフォルダを開く。ベース ROM は、開いている ROM か、最近開いたものの組から選ぶ。無ければ選ばせる。 */
  private async openFolder(folder: string): Promise<void> {
    const known = this.state.settings.data.recent.find((r) => r.project?.toLowerCase() === folder.toLowerCase());
    let rom = this.state.session?.romPath ?? known?.rom ?? null;
    if (!rom) {
      this.state.setStatus(ja.needRomForProject);
      rom = await invoke<string | null>("pick_rom");
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

  /** ROM と（あれば）プロジェクトフォルダを開く。未出力の変更があれば先に確かめる。 */
  async openSession(rom: string, project: string | null, keepMap = false): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const state = this.state;
    const reopen = keepMap ? state.map?.id ?? null : null;
    state.setStatus(ja.loading);
    try {
      await state.session?.close();
      const session = await ProjectSession.open(rom, project);
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
      timings.mark("mapShown");
      timings.lastMapSwitchMs = performance.now() - start;
      state.setStatus(ja.statusMapLoaded(id.bank, id.map));
      state.settings.update({ last: { rom: session.romPath, bank: id.bank, map: id.map, tab: state.tab } });
      await this.setTitle(map.doc.mapNameText() ?? ja.noName);
    } catch (e) {
      this.showError(e);
    }
  }

  async openMapByNumber(): Promise<void> {
    const session = this.state.session;
    if (!session) return;
    const text = await inputDialog(ja.openMapTitle, ja.openMapPrompt, "");
    if (text === null) return;
    const m = /^\s*(\d+)\s*\.\s*(\d+)\s*$/.exec(text);
    if (!m) {
      this.state.setStatus(ja.invalidInput, undefined, true);
      return;
    }
    const id = { bank: Number(m[1]), map: Number(m[2]) };
    if (!session.catalog.has(id)) {
      this.state.setStatus(ja.mapNotFound, undefined, true);
      return;
    }
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
      const picked = await invoke<string | null>("pick_folder", { title: ja.exportFolderTitle });
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
    const answer = await invoke<string>("ask_yes_no_cancel", { title: ja.question, message: ja.saveChanges });
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
    this.state.settings.update(patch);
    this.state.emit("view");
    this.state.emit("recent");
  }

  async askPaletteWidth(): Promise<void> {
    const text = await inputDialog(ja.blockWidthTitle, ja.blockWidthPrompt, String(this.state.settings.data.paletteWidth));
    if (text === null) return;
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > 64) return this.state.setStatus(ja.invalidInput, undefined, true);
    this.changeSetting({ paletteWidth: n });
  }

  async askOpacity(): Promise<void> {
    const text = await inputDialog(ja.movementOpacity, ja.opacityPrompt, String(this.state.settings.data.movementOpacity));
    if (text === null) return;
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 1) return this.state.setStatus(ja.invalidInput, undefined, true);
    this.changeSetting({ movementOpacity: n });
  }

  async askRecentMax(): Promise<void> {
    const text = await inputDialog(ja.recentMax, ja.recentMaxPrompt, String(this.state.settings.data.recentMax));
    if (text === null) return;
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > 9) return this.state.setStatus(ja.invalidInput, undefined, true);
    this.changeSetting({ recentMax: n, recent: this.state.settings.data.recent.slice(0, n) });
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
    this.tree.show(buildMapTree(session.catalog, this.state.settings.data.sortMode));
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
    this.state.setStatus(ja.error(e instanceof Error ? e.message : String(e)), undefined, true);
  }
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
