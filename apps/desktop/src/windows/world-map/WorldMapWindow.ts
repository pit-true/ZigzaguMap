import "../../styles/base.css";
import "../../styles/dialog.css";
import "./worldMap.css";
import {
  EditError,
  EditErrorCode,
  MAPSEC_FIRST,
  MAPSEC_NONE,
  RegionMapDocument,
  RegionMapGraphics,
  hasMapName,
  parseHexBytes,
  parseHexInput,
  parseIntInput,
  type CommandRecord,
  type JsonObject,
} from "@zigzagumap/core";
import { askYesNo, messageBox, showError, showInfo } from "../../ui/MessageBox";
import { jaWorldMap } from "../../i18n/ja.worldMap";
import { button, checkBox, label } from "./controls";
import { FlightPanel } from "./FlightPanel";
import { LayerPanel, type LayerPanelModel } from "./LayerPanel";
import type { WorldMapCurrent, WorldMapState } from "./protocol";
import { startToolWindowAutomation } from "./toolWindowAutomation";
import { TownMapNoPanel } from "./TownMapNoPanel";
import { WorldMapCanvas } from "./WorldMapCanvas";
import { WorldMapClient } from "./WorldMapClient";

/**
 * ワールドマップエディターのウィンドウ（AdvanceMap の TWeltkarteForm）。
 * 左: 世界地図と選択位置、表示の切り替え、ルーチンの変更・再読み込み・マップの保存。
 * 中: 基本レイヤーとフライトポジション。右: トップレイヤーとタウンマップNo。
 *
 * 編集中の表と操作の履歴はメインウィンドウが持つ。ここは表示と入力だけで、保存ボタンはコマンドを送って確定する
 * （ROM には書かない。ファイルへの出力はメインの「出力」= Ctrl+S）。
 */
export class WorldMapWindow {
  private readonly client = new WorldMapClient();
  private readonly canvas: WorldMapCanvas;
  private readonly base: LayerPanel;
  private readonly top: LayerPanel;
  private readonly flight: FlightPanel;
  private readonly townMap: TownMapNoPanel;
  private readonly posXLabel: HTMLSpanElement;
  private readonly posYLabel: HTMLSpanElement;
  private readonly editLayerCheck: HTMLInputElement;
  private readonly flyCheck: HTMLInputElement;
  private readonly topCheck: HTMLInputElement;

  private doc: RegionMapDocument | null = null;
  private names: (string | null)[] = [];
  private nameOffsets: number[] = [];
  private current: WorldMapCurrent | null = null;
  private page = 0;
  private selected: { x: number; y: number } | null = null;
  private canUndo = false;
  private canRedo = false;
  private loadError: string | null = null;

  constructor(root: HTMLElement) {
    document.title = jaWorldMap.title;
    root.classList.add("wm-form");
    this.canvas = new WorldMapCanvas((x, y) => this.select(x, y));
    this.canvas.element.style.left = "8px";
    this.canvas.element.style.top = "9px";
    root.append(this.canvas.element);
    // AdvanceMap では「縦座標」の後ろに横（X）の値、「横座標」の後ろに縦（Y）の値が出る。そのまま再現する。
    label(root, [8, 176], jaWorldMap.posX);
    this.posXLabel = label(root, [96, 176, 22], "", "Lbl_PosX");
    label(root, [136, 176], jaWorldMap.posY);
    this.posYLabel = label(root, [224, 176, 22], "", "Lbl_PosY");
    const redraw = () => this.draw();
    this.editLayerCheck = checkBox(root, [8, 192, 241, 17], jaWorldMap.showEditLayer, "Chk_Farbueberlagerung", true, redraw);
    this.flyCheck = checkBox(root, [8, 216, 241, 17], jaWorldMap.showFlyFlags, "Chk_ReadFlugFlags", false, redraw);
    this.topCheck = checkBox(root, [8, 240, 241, 17], jaWorldMap.readTopLayer, "Chk_BlauPos", true, () => {
      this.showSelection();
      this.draw();
    });
    button(root, [8, 264, 241, 25], jaWorldMap.changeRoutine, "Cmd_FlagRoutine", () => void this.changeRoutine());
    button(root, [8, 288, 121, 25], jaWorldMap.reload, "Cmd_RePaint", () => void this.reload());
    button(root, [128, 288, 121, 25], jaWorldMap.saveMap, "Cmd_MapSpeichern", () => void this.saveMap());
    const credit = label(root, [6, 342, 149, 13], jaWorldMap.credit, "Lbl_By");
    credit.classList.add("wm-link");

    const events = {
      valueChanged: (panel: LayerPanel, value: number) => this.showValue(panel, value),
      invalidValue: (text: string) => void showError(jaWorldMap.invalidInteger("$" + text), jaWorldMap.appTitle),
      savePosition: (panel: LayerPanel) => void this.savePosition(panel),
      saveFlag: (panel: LayerPanel) => void this.saveFlag(panel),
    };
    this.base = new LayerPanel(root, 0, 257, events);
    this.top = new LayerPanel(root, 1, 469, events);
    this.flight = new FlightPanel(root, () => void this.openFlightMap());
    this.townMap = new TownMapNoPanel(root, (page) => void this.changePage(page));

    root.addEventListener("keydown", (e) => this.onKey(e));
  }

  /** メインウィンドウとつなぎ、タウンマップを読む。 */
  async start(): Promise<void> {
    await this.client.connect({
      state: (s) => this.applyState(s),
      current: (c) => {
        this.current = c;
      },
      reset: () => void this.load(),
    });
    await startToolWindowAutomation({
      describe: () => this.describe(),
      canvas: (id) => (id === "WorldmapBox" ? this.canvas.toPng() : null),
    });
    await this.load();
  }

  // ---- 読み込みと表示 ----

  private async load(): Promise<void> {
    try {
      const init = await this.client.load();
      this.loadError = null;
      this.canvas.setGraphics(new RegionMapGraphics(init.graphics));
      this.nameOffsets = init.nameOffsets;
      this.current = init.current;
      this.applyState(init, false);
      this.selectCurrent();
    } catch (e) {
      this.loadError = e instanceof Error ? e.message : String(e);
      await showError(this.loadError, jaWorldMap.error);
    }
  }

  private applyState(state: WorldMapState, refresh = true): void {
    this.doc = new RegionMapDocument(state.snapshot);
    this.names = state.names;
    this.canUndo = state.canUndo;
    this.canRedo = state.canRedo;
    this.base.setNames(state.names);
    this.top.setNames(state.names);
    if (refresh) {
      // 表示している値はそのままにして、中身だけを新しい状態で出し直す。
      this.base.show(this.base.value, this.model());
      this.top.show(this.top.value, this.model());
      this.flight.show(this.doc, this.base.value);
      this.draw();
    }
  }

  /** メインで開いているマップの地名の位置を選ぶ（開いたとき）。 */
  private selectCurrent(): void {
    const doc = this.doc!;
    const id = this.current?.section ?? MAPSEC_FIRST;
    const found = doc.find(id, 0) ?? doc.find(id, 1);
    const section = doc.section(id);
    this.page = found?.page ?? 0;
    this.townMap.page = this.page;
    // AdvanceMap と同じく、地名の位置の表（MapPosTbl）の座標を選ぶ。位置が (0, 0) の洞窟などは置かれているマスを選ぶ。
    if (found && (!section || (section.x === 0 && section.y === 0))) this.selected = { x: found.x, y: found.y };
    else this.selected = section ? clampCell(section.x, section.y) : { x: 0, y: 0 };
    this.showSelection();
    this.draw();
  }

  private select(x: number, y: number): void {
    this.selected = { x, y };
    this.showSelection();
    this.draw();
  }

  /** 選んだマスの値を両方のレイヤーの欄へ読み込む。 */
  private showSelection(): void {
    const doc = this.doc;
    const s = this.selected;
    if (!doc || !s) return;
    this.posXLabel.textContent = String(s.x);
    this.posYLabel.textContent = String(s.y);
    this.showValue(this.base, doc.cell(this.page, 0, s.x, s.y));
    this.showValue(this.top, this.topCheck.checked ? doc.cell(this.page, 1, s.x, s.y) : MAPSEC_NONE);
  }

  private showValue(panel: LayerPanel, value: number): void {
    if (!this.doc) return;
    const typing = document.activeElement?.getAttribute("data-auto-id")?.startsWith("Txt_Wert") === true && panel.input().value.length < 2;
    panel.show(value, this.model(), typing);
    if (panel === this.base) this.flight.show(this.doc, value);
  }

  private model(): LayerPanelModel {
    return { doc: this.doc!, names: this.names, nameOffsets: this.nameOffsets };
  }

  private draw(): void {
    if (!this.doc) return;
    this.canvas.draw(this.doc, this.page, this.selected, {
      editLayer: this.editLayerCheck.checked,
      flyPoints: this.flyCheck.checked,
      topLayer: this.topCheck.checked,
    });
  }

  // ---- ボタン ----

  /** ポジションの保存: 位置・大きさ・名前（基本レイヤーはフライトポジションも）を確定する。 */
  private async savePosition(panel: LayerPanel): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const id = panel.value;
    const input = panel.input();
    const args: JsonObject = { id };
    try {
      args["x"] = parseIntInput(input.x);
      args["y"] = parseIntInput(input.y);
      args["width"] = parseIntInput(input.width);
      args["height"] = parseIntInput(input.height);
      if (hasMapName(id) && input.name !== (this.names[id - MAPSEC_FIRST] ?? "")) args["name"] = input.name;
      if (panel === this.base && this.flight.hasFly) {
        const old = doc.flyDestination(id)!;
        const text = this.flight.input();
        const fly = parseHexBytes("fly", text.fly, 3);
        args["flyBank"] = fly[0]!;
        args["flyMap"] = fly[1]!;
        args["flyHeal"] = fly[2]!;
        if (this.flight.hasHeal) {
          const heal = parseHexBytes("heal", text.heal, 6);
          const healNow = doc.healLocation(old.heal)!;
          const next = { bank: heal[0]!, map: heal[1]!, x: s16(heal[2]! | (heal[3]! << 8)), y: s16(heal[4]! | (heal[5]! << 8)) };
          if (JSON.stringify(next) !== JSON.stringify(healNow)) {
            Object.assign(args, { healIndex: old.heal, healBank: next.bank, healMap: next.map, healX: next.x, healY: next.y });
          }
        }
      }
    } catch (e) {
      return this.inputError(e);
    }
    await this.send({ name: "setRegionSection", args });
  }

  /** フラグの保存: 人ID を確定する。 */
  private async saveFlag(panel: LayerPanel): Promise<void> {
    let flag: number;
    try {
      flag = parseHexInput(panel.input().flag.trim());
    } catch (e) {
      return this.inputError(e);
    }
    await this.send({ name: "setRegionFlag", args: { layer: panel.layer, id: panel.value, flag } });
  }

  /** マップの保存: 選んでいるマスに、欄のマップの値を置く。 */
  private async saveMap(): Promise<void> {
    for (const [layer, cells] of this.pendingCells()) {
      await this.send({ name: "setRegionCells", args: { page: this.page, layer, cells } });
    }
  }

  /** 選んでいるマスと欄の値が違うもの（レイヤーごと）。 */
  private pendingCells(): [number, { x: number; y: number; value: number }[]][] {
    const doc = this.doc;
    const s = this.selected;
    if (!doc || !s) return [];
    const out: [number, { x: number; y: number; value: number }[]][] = [];
    if (doc.cell(this.page, 0, s.x, s.y) !== this.base.value) out.push([0, [{ x: s.x, y: s.y, value: this.base.value }]]);
    if (this.topCheck.checked && doc.cell(this.page, 1, s.x, s.y) !== this.top.value) out.push([1, [{ x: s.x, y: s.y, value: this.top.value }]]);
    return out;
  }

  /** タウンマップNo の切り替え。マスに置いていない値があれば「ワールドマップの変更を保存しますか？」。 */
  private async changePage(page: number): Promise<void> {
    if (this.pendingCells().length > 0) {
      const answer = await messageBox(jaWorldMap.question, jaWorldMap.saveChanges, "question", "yesNoCancel");
      if (answer === "cancel") {
        this.townMap.page = this.page;
        return;
      }
      if (answer === "yes") await this.saveMap();
    }
    this.page = page;
    this.showSelection();
    this.draw();
  }

  /** このマップを開く: フライトポジションのバンク・マップをメインウィンドウで開く。 */
  private async openFlightMap(): Promise<void> {
    let fly: Uint8Array;
    try {
      fly = parseHexBytes("fly", this.flight.input().fly, 3);
    } catch (e) {
      return this.inputError(e);
    }
    try {
      await this.client.openMap(fly[0]!, fly[1]!);
    } catch (e) {
      await showError(e instanceof Error ? e.message : String(e), jaWorldMap.error);
    }
  }

  /** 再読み込み: メインウィンドウの編集中の状態を読み直し、欄の入力を捨てる。 */
  private async reload(): Promise<void> {
    try {
      const init = await this.client.load();
      this.applyState(init, false);
      this.showSelection();
      this.draw();
    } catch (e) {
      await showError(e instanceof Error ? e.message : String(e), jaWorldMap.error);
    }
  }

  /**
   * ルーチンの変更: AdvanceMap は人ID とトップレイヤーの位置を読むために ROM の命令を書き換える。
   * ZigzaguMap は書き換えずに読めるので、書き換え済みのときと同じ質問だけを出し、何も書かない。
   */
  private async changeRoutine(): Promise<void> {
    if (!(await askYesNo(jaWorldMap.routineAlreadyFlags, jaWorldMap.question))) {
      await showInfo(jaWorldMap.routineCanceled, jaWorldMap.information);
      return;
    }
    if (await askYesNo(jaWorldMap.routineAlreadyPositions, jaWorldMap.question)) await showInfo(jaWorldMap.routineNotNeeded, jaWorldMap.information);
  }

  // ---- 送信 ----

  private async send(record: CommandRecord): Promise<void> {
    try {
      await this.client.command(record);
    } catch (e) {
      await showError(e instanceof Error ? e.message : String(e), jaWorldMap.error);
    }
  }

  private async inputError(e: unknown): Promise<void> {
    if (e instanceof EditError && e.code === EditErrorCode.InvalidInteger) {
      await showError(jaWorldMap.invalidInteger(String(e.params["text"])), jaWorldMap.appTitle);
    } else if (e instanceof EditError && e.code === EditErrorCode.InvalidRawBytes) {
      await showError(jaWorldMap.invalidInteger(""), jaWorldMap.appTitle);
    } else await showError(e instanceof Error ? e.message : String(e), jaWorldMap.error);
  }

  /** Ctrl+Z / Ctrl+Y はメインの履歴、Ctrl+S はメインの「出力」。入力欄の中の Ctrl+Z は文字の取り消しに残す。 */
  private onKey(e: KeyboardEvent): void {
    if (!e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const inText = e.target instanceof HTMLInputElement && e.target.type === "text";
    if (key === "s") {
      e.preventDefault();
      void this.client.exportMaps().catch((err: unknown) => showError(err instanceof Error ? err.message : String(err), jaWorldMap.error));
    } else if (!inText && (key === "z" || key === "y")) {
      e.preventDefault();
      void (key === "z" ? this.client.undo() : this.client.redo());
    }
  }

  /** 自動操作の state の答え。 */
  private describe(): unknown {
    const doc = this.doc;
    return {
      loaded: doc !== null,
      error: this.loadError,
      page: this.page,
      selected: this.selected,
      current: this.current,
      base: this.base.value,
      top: this.top.value,
      cell: doc && this.selected ? [doc.cell(this.page, 0, this.selected.x, this.selected.y), doc.cell(this.page, 1, this.selected.x, this.selected.y)] : null,
      section: doc ? doc.section(this.base.value) : null,
      fly: doc ? doc.flyDestination(this.base.value) : null,
      canUndo: this.canUndo,
      canRedo: this.canRedo,
    };
  }
}

function s16(v: number): number {
  return v >= 0x8000 ? v - 0x10000 : v;
}

function clampCell(x: number, y: number): { x: number; y: number } {
  return { x: Math.min(Math.max(x, 0), 21), y: Math.min(Math.max(y, 0), 14) };
}
