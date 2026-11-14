import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isWorkMapId, type MapId } from "@zigzagumap/core";
import { ja } from "../i18n/ja";
import { messageBox } from "../ui/MessageBox";
import { MapImage } from "../ui/map/MapImage";
import { MapCombo } from "../ui/MapCombo";
import { MapTree } from "../ui/MapTree";
import { MapTreeFilter } from "../ui/MapTreeFilter";
import { installHistoryMouse } from "./historyMouse";
import { MenuBar } from "../ui/MenuBar";
import { RomInfoPanel } from "../ui/RomInfoPanel";
import { Splitter } from "../ui/Splitter";
import { StatusBar } from "../ui/StatusBar";
import { TabControl } from "../ui/TabControl";
import type { ConnectionManager } from "../ui/connection/ConnectionManager";
import type { OpacityPopup } from "../ui/view/OpacityPopup";
import { HeaderTab } from "../ui/header/HeaderTab";
import { GrosserBlockWindow } from "../ui/GrosserBlockWindow";
import { EventTab } from "../ui/event/EventTab";
import { OutsideEventsBar } from "../ui/event/OutsideEventsBar";
import { MapTab } from "../ui/tabs/MapTab";
import { MovementTab } from "../ui/tabs/MovementTab";
import { WildTab } from "../ui/wild/WildTab";
import { installMakeButtons } from "../ui/newmap/MakeButtons";
import { NewMapController } from "../ui/newmap/NewMapController";
import { Toolbar } from "../ui/Toolbar";
import { Actions, type ActionTarget } from "./Actions";
import { EditorState } from "./EditorState";
import { FileDialogs, fileNameOf as fileName } from "./FileDialogs";
import { ImageExport, type ImageKind } from "./ImageExport";
import { SettingPrompts } from "./SettingPrompts";
import { SystemSettings } from "./SystemSettings";
import { buildMapTree, comboGroups } from "./MapTreeModel";
import { MapNavigation } from "./MapNavigation";
import { buildMenu, type MenuItem } from "./menuDefinition";
import type { ProjectSession } from "./ProjectSession";
import { SessionOpener } from "./SessionOpener";
import { Settings, type SettingsData } from "./Settings";
import { installShortcuts } from "./Shortcuts";
import { timings } from "./timings";
import { UsageService } from "./UsageService";
import { TrainerService } from "./TrainerService";
import { EventActions } from "./EventActions";
import { ChangeTracker } from "./ChangeTracker";
import { scheduleIdleGc } from "../util/idleGc";
import { keepWindowPlacement } from "./WindowPlacementKeeper";
import { openWorldMapWindow } from "../windows/world-map/openWorldMapWindow";
import { WorldMapHost } from "../windows/world-map/WorldMapHost";
import { installScriptEntry } from "../ui/script/ScriptEntry";
import type { ScriptHost } from "../ui/script/ScriptHost";
import { ScriptLink } from "../ui/script/ScriptLink";
import { jaScriptEditor } from "../i18n/ja.scriptEditor";
import { errorText } from "../util/errors";
import { startMainTheme, toTheme } from "../util/theme";
import type { MixingBag } from "./MixingBag";
import { MapExtras } from "./mapExtras";

/** 起動引数（Rust の StartupArgs）。 */
interface StartupArgs {
  readonly rom: string | null;
  readonly project: string | null;
  readonly automation: number | null;
  /** 個人設定と WebView2 のデータの置き場所（`--profile`、自動操作なら一時フォルダ。通常の場所なら null）。 */
  readonly profile: string | null;
}

/** アプリ全体。画面部品を組み立て、ROM・マップの読み込み、出力、終了を受け持つ。 */
export class App implements ActionTarget {
  readonly state: EditorState;
  readonly actions: Actions;
  /** 番号・名前でマップを開く、戻る・進む。 */
  readonly nav: MapNavigation;
  /** ファイル・フォルダを選ぶダイアログ（自動操作では先に答えを積める）。 */
  readonly files = new FileDialogs();
  /** ROM・プロジェクトフォルダを開く。 */
  readonly opener = new SessionOpener(this);
  readonly system: SystemSettings;
  /** 数を入力して変える設定。 */
  readonly prompts: SettingPrompts;
  private readonly menu: MenuBar;
  private readonly toolbar: Toolbar;
  /** 左のマップ一覧（自動操作の `tree.list` も読む）。 */
  readonly tree: MapTree;
  /** マップ一覧の絞り込みの欄（#237）。 */
  readonly treeFilter: MapTreeFilter;
  private readonly combo: MapCombo;
  private readonly splitter: Splitter;
  private readonly romInfo = new RomInfoPanel();
  private readonly statusBar = new StatusBar();
  private readonly left: HTMLElement;
  private readonly hint: HTMLElement;
  readonly grosserBlock: GrosserBlockWindow;
  private readonly eventTab: EventTab;
  /** マップの外のイベントの帯。 */
  readonly outsideBar: OutsideEventsBar;
  readonly tabs: Record<"map" | "movement" | "event", { view: { toPng(withNeighbors?: boolean): string | null } }>;
  private unsubscribeBus: (() => void) | null = null;
  /** 操作のあとの描き直しと未出力の印。 */
  readonly changes = new ChangeTracker(this);
  private closing = false;
  /** ワールドマップエディター（別ウィンドウ）の受け手。 */
  private readonly worldMap = new WorldMapHost({
    session: () => this.state.session,
    currentMap: () => (this.state.map ? { id: this.state.map.id, section: this.state.map.doc.header.regionMapSectionId } : null),
    openMap: (id) => this.openMap(id),
    exportMaps: () => this.exportMaps(false),
  });
  private connections: ConnectionManager | null = null;
  /** スクリプトエディタの窓口（初めてスクリプトを開くときに読み込む）。 */
  private scriptHostValue: Promise<ScriptHost> | null = null;
  /** スクリプト連携（ひな形・取り込み・マップスクリプトの表の書き出し）。 */
  readonly scripts: ScriptLink;
  /** 使われているフラグ・変数などの番号の索引（#227）。 */
  readonly usage: UsageService;
  /** トレーナーの表と trainers.json（#244・#245）。 */
  readonly trainers: TrainerService;
  /** イベントタブの操作（ひな形を置く・イベントの削除など）。 */
  readonly events: EventActions;
  /** 移動エリアの透明度のスライダー（初めて開くときに読み込む）。 */
  opacityPopup: OpacityPopup | null = null;
  /** 新規マップ・作成したマップの保存と読み込み・マップの追加/挿入・マップバンクヘッダー。 */
  readonly newMaps: NewMapController;
  /** 自動操作で起動したか（PC 全体に影響する操作をしない、ウィンドウの位置を覚えない）。 */
  automation = false;
  /** 個人設定の置き場所（通常の場所なら null）。 */
  profileDir: string | null = null;
  /** Phase3 でマップの表示に足したもの（隣の帯・つまみ・使用の印・画像のコピーなど）。 */
  readonly extras: MapExtras;
  /** ミキシングバッグ（#236。マップタブ）。 */
  readonly mixingBag: MixingBag;
  /** 画面のテーマ（個人設定 `theme`）。変われば道具のウィンドウへも送る。 */
  private readonly theme: { sync(): void };

  constructor(
    private readonly root: HTMLElement,
    settings: Settings,
  ) {
    const state = new EditorState(settings, ja.statusOpenRom);
    this.state = state;
    this.nav = new MapNavigation({ state, openMap: (id) => this.openMap(id), showFromHistory: (id) => this.showMap(id, "history") });
    this.theme = startMainTheme(() => toTheme(state.settings.data.theme));
    state.on("view", () => this.theme.sync());
    this.scripts = new ScriptLink(this);
    state.on("session", () => this.scripts.attach(state.session));
    this.usage = new UsageService(this);
    this.trainers = new TrainerService(this);
    this.events = new EventActions(this);
    this.system = new SystemSettings(state, () => this.automation);
    this.prompts = new SettingPrompts(state, (patch) => this.changeSetting(patch));
    this.actions = new Actions(state, this);
    this.newMaps = new NewMapController({
      state,
      files: this.files,
      openMap: (id) => this.openMap(id),
      refreshMapList: () => this.refreshMapList(),
      notNeeded: () => this.system.notNeeded(),
    });
    this.actions.register("map.new", () => this.newMaps.newMap());
    this.actions.register("map.openCreated", () => this.newMaps.openFile());
    this.actions.register("map.saveCreatedAs", () => this.newMaps.saveAs());
    this.actions.register("map.insert", () => this.newMaps.insert());
    this.actions.register("dummy.manage", () => this.newMaps.bankHeader());
    // ツール > スクリプトファイルの対応表（maps\scripts.json）。画面のコードは初めて開くときに読み込む。
    this.actions.register("tools.build", async () => (await this.scriptHost()).build());
    this.actions.register("tools.scriptsTable", async () => (await import("../ui/script/ScriptsTableDialog")).ScriptsTableDialog.get(this).open());
    this.menu = new MenuBar({
      items: () => this.menuItems(),
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
    this.tree = new MapTree({
      openMap: (id) => void this.openMap(id),
      isDirty: (id) => state.isDirty(id),
      openMapFile: (path, name) => void this.newMaps.openEntry(path, name),
    });
    this.combo = new MapCombo({ openMap: (id) => void this.openMap(id) });

    this.grosserBlock = new GrosserBlockWindow(state);
    const mapTab = new MapTab(state);
    installMakeButtons(mapTab.element, { makeMap: () => this.newMaps.newMap(), makeBank: () => this.newMaps.makeBank() });
    const movementTab = new MovementTab(state);
    const events = this.events;
    const eventTab = new EventTab(state, {
      openMap: (id) => this.openMap(id),
      scriptFiles: this.scripts.files,
      deleteEvent: (kind, index) => void events.deleteEvent(kind, index),
      pickUnused: (kind) => events.pickUnused(kind),
      createWarpMap: (index) => void events.warpMapCreator().then((c) => c.run(index)),
      editTrainer: (index) => void this.trainers.editForPerson(index),
      placeTemplate: (x, y) => void events.placeTemplate(x, y),
      canPlaceTemplate: () => this.state.session?.projectDir != null,
      summaries: () => events.eventSummaries(),
    });
    this.eventTab = eventTab;
    this.tabs = { map: mapTab, movement: movementTab, event: eventTab };
    this.extras = new MapExtras(state, this.actions, { map: mapTab, movement: movementTab, event: eventTab }, (id) => this.openMap(id));
    this.mixingBag = mapTab.bag;
    const tabControl = new TabControl(
      [
        { id: "map", title: ja.tabMap, element: mapTab.element },
        { id: "movement", title: ja.tabMovement, element: movementTab.element },
        { id: "event", title: ja.tabEvents, element: eventTab.element },
        { id: "wild", title: ja.tabWild, element: new WildTab(state).element },
        { id: "header", title: ja.tabHeader, element: new HeaderTab(state, { openConnections: () => void this.openConnections(), openMap: (id) => void this.openMap(id), scripts: this.scripts }).element },
      ],
      (id) => state.setTab(id),
    );
    tabControl.show(state.tab);

    this.left = document.createElement("aside");
    this.left.className = "left-panel";
    this.left.style.width = `${settings.data.leftWidth}px`;
    this.treeFilter = new MapTreeFilter(this.tree);
    this.left.append(this.treeFilter.element, this.tree.element, this.romInfo.element);
    const splitter = new Splitter(this.left, 120, (width) => settings.update({ leftWidth: width }));
    this.splitter = splitter;
    this.hint = document.createElement("p");
    this.hint.className = "drop-hint";
    this.hint.textContent = ja.dropHint;
    tabControl.element.append(this.hint);

    const body = document.createElement("main");
    body.className = "main-body";
    body.append(this.left, splitter.element, tabControl.element);
    // マップの外にイベントがあるときの帯（ツールバーの下。どのタブでも出す）
    this.outsideBar = new OutsideEventsBar(state);
    root.append(this.menu.element, this.toolbar.element, this.combo.element, this.outsideBar.element, body, this.statusBar.element);

    state.on("status", () => this.statusBar.render(state.status, state.statusInfo));
    state.on("tab", () => {
      tabControl.show(state.tab);
      const last = state.settings.data.last;
      if (last && state.map) state.settings.update({ last: { ...last, tab: state.tab } });
    });
    state.on("dirty", () => this.tree.refreshMarks());
    state.on("view", () => this.applyLayout());
    for (const topic of ["session", "map", "view"] as const) state.on(topic, () => this.toolbar.update());
    state.on("session", () => this.worldMap.sessionChanged());
    state.on("map", () => this.worldMap.mapChanged());
    installScriptEntry({
      available: () => state.session !== null,
      open: (target, pointer) => void this.scriptHost().then((h) => h.openTarget(target, pointer)).catch((e: unknown) => this.showError(e)),
      openFile: (path, line) => void this.scriptHost().then((h) => h.openFile(path, line)).catch((e: unknown) => this.showError(e)),
      openPointer: (pointer, target) => void this.scriptHost().then((h) => h.openRom(pointer, target)).catch((e: unknown) => this.showError(e)),
    });
    this.statusBar.render(state.status);
    this.applyLayout();
    state.emit("view");
  }

  /** ドラッグ＆ドロップ、キー操作、終了の確認、自動操作を受け付け、起動引数の ROM を開く。 */
  async start(): Promise<void> {
    installShortcuts(this);
    installHistoryMouse(this.nav);
    await this.worldMap.start();
    // 外のエディタで .s を書き換えたかもしれないので、前面に戻ったらラベルの一覧を読み直す
    await getCurrentWindow().listen("tauri://focus", () => this.scripts.files.forget());
    await getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      this.root.classList.toggle("dragging", p.type === "enter" || p.type === "over");
      if (p.type === "drop") void this.opener.drop(p.paths);
    });
    await getCurrentWindow().onCloseRequested(async (event) => {
      if (this.closing) return;
      if (!(await this.confirmScriptEditor()) || !(await this.confirmDiscard())) event.preventDefault();
      else await this.state.settings.flush();
    });
    const args = await invoke<StartupArgs>("startup_args");
    this.automation = args.automation !== null;
    this.profileDir = args.profile;
    // 自動操作の入口のコードは、自動操作で起動したときだけ読み込む（通常の起動では読まない）。
    if (args.automation) await (await import("./automation")).startAutomation(this);
    else await keepWindowPlacement(this.state.settings);
    // 起動引数の ROM は、--project が無ければ記録済みの組のフォルダで開く（ダイアログは出さない）
    if (args.rom) await this.opener.openSession(args.rom, args.project ?? this.opener.recordedProject(args.rom));
  }

  // ---- 開く ----

  /** 開いたセッションを画面に付ける（SessionOpener が開けたときに呼ぶ）。前のセッションの購読はやめる。 */
  async attachSession(session: ProjectSession, rom: string): Promise<void> {
    const state = this.state;
    this.unsubscribeBus?.();
    state.session = session;
    state.map = null;
    state.mapImage = null;
    state.dirty = new Set();
    state.history.clear();
    this.unsubscribeBus = session.bus.subscribe((e) => this.changes.onCommand(e));
    this.tree.clear();
    this.rebuildTree();
    this.romInfo.show(session.project.game);
    this.hint.hidden = true;
    state.settings.addRecent({ rom, project: session.projectDir });
    void this.system.updateRomShortcut(rom);
    state.emit("session");
    state.emit("map");
    await this.setTitle(null);
    state.setStatus(ja.statusRomLoaded, ja.statusLoadTime(session.loadMs));
  }

  // ---- マップ ----

  /** マップを開いて表示する。 */
  /** マップを開く（今のマップを戻るの履歴に積む。#237）。 */
  async openMap(id: MapId): Promise<void> {
    await this.showMap(id, "visit");
  }

  /** マップを開く。`nav` が `visit` なら今のマップを戻るの履歴に積む。戻る・進むで開くときは `history`。開けたら true。 */
  private async showMap(id: MapId, nav: "visit" | "history"): Promise<boolean> {
    const state = this.state;
    const session = state.session;
    if (!session) return false;
    const start = performance.now();
    timings.lastMapSwitchStart = start;
    try {
      const map = await session.openMap(id);
      if (nav === "visit") state.history.visit(state.map?.id ?? null, id);
      state.map = map;
      state.mapImage = new MapImage(map.doc.grid, map.tiles);
      state.emit("map");
      if (isWorkMapId(id)) {
        // 作業用のマップ（新規作成・.map）は一覧に無い。AdvanceMap と同じく一覧の選択とステータスバーは変えず、
        // 題名は .map から開いたときだけ「ZigzaguMap - <拡張子を除いたパス>」にする。
        const path = session.project.workMapInfo(id)?.path;
        if (path) await this.setRawTitle(`${ja.appTitle} - ${path.replace(/\.[^.\\/]*$/, "")}`);
        timings.lastMapSwitchMs = performance.now() - start;
        return true;
      }
      this.tree.setOpened(id);
      this.combo.setOpened(id);
      timings.mark("mapShown");
      timings.lastMapSwitchMs = performance.now() - start;
      // 前のマップの画像やタイルセットのごみを、操作が落ち着いてから片付ける（メモリを 150MB 以下に保つ）
      scheduleIdleGc();
      state.setStatus(ja.statusMapLoaded(id.bank, id.map));
      state.settings.update({ last: { rom: session.romPath, bank: id.bank, map: id.map, tab: state.tab } });
      await this.setTitle(map.doc.mapNameText() ?? ja.noName);
      return true;
    } catch (e) {
      this.showError(e);
      return false;
    }
  }

  /** コネクションマネージャーを開く（初めて開くときに読み込む）。 */
  async openConnections(): Promise<void> {
    if (!this.connections) {
      const { ConnectionManager } = await import("../ui/connection/ConnectionManager");
      this.connections = new ConnectionManager(this.state, (id) => this.openMap(id));
    }
    this.connections.show();
  }

  /** 表示 > 移動エリアの設定の透明度。スライダーの小窓を開く（初めて開くときに読み込む）。 */
  async openOpacity(): Promise<void> {
    if (!this.opacityPopup) {
      const { OpacityPopup } = await import("../ui/view/OpacityPopup");
      this.opacityPopup = new OpacityPopup(this.state);
    }
    this.opacityPopup.open();
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

  /** マップ一覧を作り直す（マップを加えた・取り消した・差し替えたとき、マップファイルを登録したとき）。 */
  async refreshMapList(): Promise<void> {
    const session = this.state.session;
    if (!session) return;
    await session.refreshCatalog();
    if (this.state.session !== session) return;
    this.rebuildTree();
    const current = this.state.map;
    if (current && !isWorkMapId(current.id)) {
      this.tree.setOpened(current.id);
      this.combo.setOpened(current.id);
    }
    this.changes.checkDirty(true);
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
      // ひな形などの書き足しが済んでから書く
      await this.scripts.settle();
      const result = await session.export(target);
      if (target !== undefined) this.state.settings.addRecent({ rom: session.romPath, project: session.projectDir });
      this.changes.checkDirty(true);
      this.state.setStatus(ja.exported(result.written.length, result.removed.length));
      return true;
    } catch (e) {
      this.showError(e);
      return false;
    }
  }

  /** 未出力の変更があれば「出力しますか」と聞く。続けてよければ true。 */
  async confirmDiscard(): Promise<boolean> {
    const session = this.state.session;
    if (!session || (session.modifiedMaps().length === 0 && !session.hasUnsavedChanges() && !session.isRegionMapModified())) return true;
    const answer = await messageBox(ja.question, ja.saveChanges, "warning", "yesNoCancel");
    if (answer === "cancel") return false;
    if (answer === "yes") return this.exportMaps(false);
    return true;
  }

  /** イベントタブで選んでいるイベントを削除する（Delete キー。「イベントの削除」ボタンと同じ）。 */
  deleteSelectedEvent(): void {
    this.eventTab.removeSelected();
  }

  /** イベントタブでイベントを選ぶ（ひな形を置いたあと）。 */
  eventTabSelect(kind: "person" | "sign" | "trap", index: number): void {
    this.eventTab.select(kind, index);
  }

  /** スクリプトエディタの窓口（初めて呼ばれたときに読み込む）。 */
  scriptHost(): Promise<ScriptHost> {
    return (this.scriptHostValue ??= import("../ui/script/ScriptHost").then(({ ScriptHost }) => ScriptHost.get(this)));
  }

  /** スクリプトエディタの窓口（読み込み済みのときだけ。まだなら null）。 */
  async scriptHostIfLoaded(): Promise<ScriptHost | null> {
    return this.scriptHostValue ? this.scriptHostValue.catch(() => null) : null;
  }

  /** スクリプトエディタに未保存のファイルがあれば「保存しますか？」と聞く。続けてよければ true。 */
  async confirmScriptEditor(): Promise<boolean> {
    if (!this.scriptHostValue) return true;
    const host = await this.scriptHostValue;
    let dirty: string[];
    try {
      dirty = await host.dirtyFiles();
    } catch {
      return true;
    }
    if (dirty.length === 0) return true;
    const answer = await messageBox(ja.question, jaScriptEditor.mainDirty(dirty.length), "warning", "yesNoCancel");
    if (answer === "cancel") return false;
    if (answer === "yes") return host.saveAll().catch(() => false);
    return true;
  }

  /** ツール > ワールドマップエディター（Ctrl+W）。別ウィンドウで開く。 */
  async openWorldMap(): Promise<void> {
    if (this.state.session) await openWorldMapWindow(ja.worldMapEditor);
  }

  async exit(): Promise<void> {
    if (!(await this.confirmScriptEditor()) || !(await this.confirmDiscard())) return;
    await this.state.settings.flush();
    this.closing = true;
    await getCurrentWindow().destroy();
  }

  // ---- 設定 ----

  /** 左の欄の幅を変える（分割バーを動かしたときと同じ。決まった幅を返す）。 */
  setLeftWidth(width: number): number {
    return this.splitter.setWidth(width);
  }

  setSort(mode: number): void {
    this.state.settings.update({ sortMode: mode });
    this.rebuildTree();
    this.toolbar.update();
  }

  /** 個人設定のテーマを画面に当てる（自動操作の `setting` で値だけ変えたとき用。変わっていなければ何もしない）。 */
  syncTheme(): void {
    this.theme.sync();
  }

  changeSetting(patch: Partial<SettingsData>): void {
    this.state.settings.update(patch);
    this.state.emit("view");
    this.state.emit("recent");
  }

  /** ツール > 画像の保存（3 種）。 */
  async saveImage(kind: ImageKind): Promise<void> {
    const path = await new ImageExport(this.state, this.files, () => this.eventTab.exportOverlay()).save(kind);
    if (path) this.state.setStatus(ja.imageSaved(path));
  }

  /** 別ウィンドウ（ブロックエディタなど）を開く。窓口のコードは初めて開くときに読み込む。 */
  async openToolWindow(kind: "block-editor"): Promise<void> {
    const { ToolWindowHost } = await import("../windows/ToolWindowHost");
    await (await ToolWindowHost.get(this)).open(kind);
  }

  // ---- 内部 ----

  /** メニューの全項目（今の状態で。メニューバーと自動操作の `menu.list` が使う）。 */
  menuItems(): MenuItem[] {
    return buildMenu(this.recentItems());
  }

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
    const s = this.state.settings.data;
    this.tree.show(buildMapTree(session.catalog, s.sortMode, s.mapFiles));
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
    // AdvanceMap と同じく、一覧で選んでいる項目の文字列（補足を含む）を使う。
    const item = map ? (this.tree.openedLabel() ?? (mapName ? ja.mapItem(mapName, "", map.id.bank, map.id.map) : null)) : null;
    await this.setRawTitle(item ? ja.windowTitle(item) : ja.appTitle);
  }

  private async setRawTitle(title: string): Promise<void> {
    document.title = title;
    await getCurrentWindow()
      .setTitle(title)
      .catch(() => undefined);
  }

  showError(e: unknown): void {
    this.state.setStatus(ja.error(errorText(e)), undefined, true);
  }
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
