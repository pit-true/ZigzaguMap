import type { MapId } from "@zigzagumap/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ja } from "../i18n/ja";
import { MapCanvas } from "../ui/MapCanvas";
import { MapList } from "../ui/MapList";
import { StatusBar } from "../ui/StatusBar";
import { Toolbar } from "../ui/Toolbar";
import { EditorState } from "./EditorState";
import { RomFiles } from "./RomFiles";

/** アプリ全体。画面部品をつなぎ、ROM の読み込みとマップの表示を受け持つ。 */
export class App {
  private readonly files = new RomFiles();
  private readonly list = new MapList((id) => this.showMap(id));
  private readonly canvas = new MapCanvas();
  private readonly status = new StatusBar(ja.noRom);
  private readonly hint = document.createElement("p");
  private state: EditorState | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly root: HTMLElement) {}

  /** 画面を組み立て、ドラッグ＆ドロップとキー操作を受け付ける。 */
  async start(): Promise<void> {
    const toolbar = new Toolbar(() => void this.openWithDialog());
    this.hint.className = "drop-hint";
    this.hint.textContent = ja.dropHint;
    this.canvas.element.append(this.hint);

    const body = document.createElement("main");
    body.className = "body";
    body.append(this.list.element, this.canvas.element);
    this.root.append(toolbar.element, body, this.status.element);

    document.addEventListener("keydown", (e) => this.onKey(e));
    await getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      this.root.classList.toggle("dragging", payload.type === "enter" || payload.type === "over");
      if (payload.type === "drop" && payload.paths.length > 0) void this.open(payload.paths[0]!);
    });
  }

  private async openWithDialog(): Promise<void> {
    try {
      const path = await this.files.pick();
      if (path) await this.open(path);
    } catch (e) {
      this.showError(e);
    }
  }

  /** パスの ROM を開く。 */
  async open(path: string): Promise<void> {
    if (!path.toLowerCase().endsWith(".gba")) {
      this.status.set(ja.unsupportedFile, true);
      return;
    }
    this.status.set(ja.loading);
    try {
      const state = new EditorState(await this.files.read(path));
      this.unsubscribe?.();
      this.state = state;
      this.unsubscribe = state.bus.subscribe(() => this.redraw());
      this.list.show(state.loader.bankTable);
      this.canvas.clear();
      this.hint.hidden = true;
      document.title = `${ja.appTitle} - ${fileName(path)}`;
      this.status.set(ja.loaded(state.game.code, state.mapCount));
    } catch (e) {
      this.showError(e);
    }
  }

  private showMap(id: MapId): void {
    if (!this.state) return;
    try {
      const map = this.state.select(id);
      this.redraw();
      this.status.set(ja.mapInfo(id.bank, id.map, map.layout.width, map.layout.height));
    } catch (e) {
      this.showError(e);
    }
  }

  private redraw(): void {
    const image = this.state?.render();
    if (image) this.canvas.draw(image);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.state || !e.ctrlKey) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      this.state.bus.undo();
      e.preventDefault();
    } else if (key === "y" || (key === "z" && e.shiftKey)) {
      this.state.bus.redo();
      e.preventDefault();
    }
  }

  private showError(e: unknown): void {
    this.status.set(ja.error(e instanceof Error ? e.message : String(e)), true);
  }
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
