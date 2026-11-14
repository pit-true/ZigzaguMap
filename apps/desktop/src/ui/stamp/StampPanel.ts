import { createStamp, renderBlocks, stampFits, type Stamp, type StampLibrary } from "@zigzagumap/core";
import { selectionWrites, type BlockSelection, type EditorState } from "../../app/EditorState";
import { jaStamp as t } from "../../i18n/ja.stamp";
import "../../styles/stamp.css";
import { canvasOf } from "../canvas";
import { showContextMenu } from "../ContextMenu";
import { inputDialog } from "../InputDialog";
import { messageBox } from "../MessageBox";

/** サムネイルの 1 辺の上限（画素）。 */
const THUMB_MAX = 40;

/** 選んだスタンプ（マップを替えたときに、組が違えば知らせる）。 */
interface Chosen {
  readonly name: string;
  readonly selection: BlockSelection;
  readonly stamp: Stamp;
}

/**
 * マップタブの右の欄のスタンプ（#239）。今のマップに貼れるもの（タイルセットの組が合うもの）を名前順にサムネイルつきで並べる。
 * 押すとそれを選択にし（左クリックで貼る。移動許可は「移動許可も貼る」に従う）、右クリックで名前の変更・削除・上書き。
 * 「選択を保存」で今の選択を名前を付けて maps\stamps\ に書く（すぐ書く。元に戻すの対象にしない。未決の点 Q9 の推奨）。
 * サムネイルは今読み込んでいるタイルセットで描き、保存しない。
 */
export class StampPanel {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private chosen: Chosen | null = null;
  /** 一覧を描いた番号（古い描き直しを捨てる）。 */
  private token = 0;

  constructor(private readonly state: EditorState) {
    this.element = document.createElement("div");
    this.element.className = "stamp-panel";
    this.element.dataset["autoId"] = "stamp.panel";
    const head = document.createElement("div");
    head.className = "stamp-head";
    const title = document.createElement("span");
    title.textContent = t.title;
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = t.save;
    save.title = t.saveHint;
    save.dataset["autoId"] = "stamp.save";
    save.addEventListener("click", () => void this.saveSelection());
    head.append(title, save);
    this.list = document.createElement("ul");
    this.list.className = "stamp-list";
    this.list.dataset["autoId"] = "stamp.list";
    this.note = document.createElement("div");
    this.note.className = "stamp-note";
    this.note.dataset["autoId"] = "stamp.note";
    this.element.append(head, this.list, this.note);

    state.on("session", () => {
      this.chosen = null;
      void this.refresh();
    });
    state.on("map", () => {
      void this.refresh();
      this.warnIfNotFit();
    });
    state.on("tiles", () => void this.refresh());
    state.on("selection", () => {
      // ほかの選び方をしたら、スタンプを選んでいる印を外す
      if (this.chosen && this.state.selection !== this.chosen.selection) {
        this.chosen = null;
        this.markSelected();
      }
    });
  }

  private library(): Promise<StampLibrary> | null {
    return this.state.session?.stamps() ?? null;
  }

  /** 一覧を描き直す。 */
  async refresh(): Promise<void> {
    const token = ++this.token;
    const lib = await this.library()?.catch(() => null);
    const map = this.state.map;
    if (token !== this.token) return;
    this.list.replaceChildren();
    if (!lib || !map) {
      this.note.hidden = true;
      return;
    }
    const all = lib.list();
    const fitting = lib.fitting(map.doc.primaryTileset, map.doc.secondaryTileset);
    for (const stamp of fitting) this.list.append(this.item(stamp));
    const notes: string[] = [];
    if (fitting.length === 0) notes.push(t.empty);
    if (all.length > fitting.length) notes.push(t.hidden(all.length - fitting.length));
    if (!lib.fs) notes.push(t.memoryOnly);
    if (lib.problems.length > 0) notes.push(t.problems(lib.problems.length));
    this.note.textContent = notes.join("\n");
    this.note.hidden = notes.length === 0;
    this.markSelected();
  }

  private item(stamp: Stamp): HTMLElement {
    const li = document.createElement("li");
    li.className = "stamp-item";
    li.dataset["autoId"] = `stamp.item:${stamp.name}`;
    li.dataset["name"] = stamp.name;
    li.title = t.item(stamp.name, stamp.width, stamp.height);
    const thumb = this.thumbnail(stamp);
    if (thumb) li.append(thumb);
    const label = document.createElement("span");
    label.textContent = stamp.name;
    li.append(label);
    li.addEventListener("click", () => void this.select(stamp.name));
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.menu(stamp.name, e.clientX, e.clientY);
    });
    return li;
  }

  /** 今のマップのタイルセットで描いたサムネイル（1 辺 40 画素まで）。 */
  private thumbnail(stamp: Stamp): HTMLCanvasElement | null {
    const tiles = this.state.map?.tiles;
    if (!tiles) return null;
    const image = renderBlocks(tiles.renderer, stamp.width, stamp.height, (x, y) => stamp.cells[y * stamp.width + x]?.[0] ?? null);
    const canvas = canvasOf(image);
    const scale = Math.min(1, THUMB_MAX / Math.max(image.width, image.height));
    canvas.style.width = `${Math.max(1, Math.round(image.width * scale))}px`;
    canvas.style.height = `${Math.max(1, Math.round(image.height * scale))}px`;
    return canvas;
  }

  private markSelected(): void {
    for (const li of this.list.querySelectorAll<HTMLElement>(".stamp-item")) li.classList.toggle("selected", li.dataset["name"] === this.chosen?.name);
  }

  /** スタンプを選択にする。無ければ false。 */
  async select(name: string): Promise<boolean> {
    const lib = await this.library();
    const stamp = lib?.get(name);
    if (!stamp) return false;
    // 四角でないスタンプの null のマスは穴（貼らないマス）にする
    const cells = stamp.cells;
    const selection: BlockSelection = {
      width: stamp.width,
      height: stamp.height,
      blocks: cells.map((c) => c?.[0] ?? 0),
      ...(stamp.withMovements ? { movements: cells.map((c) => c?.[1] ?? 0) } : {}),
      ...(cells.some((c) => c === null) ? { holes: cells.map((c) => c === null) } : {}),
    };
    this.chosen = { name: stamp.name, selection, stamp };
    this.state.selectStamp(selection);
    this.state.setStatus(t.selected(stamp.name, stamp.width, stamp.height));
    this.markSelected();
    this.warnIfNotFit();
    return true;
  }

  /** 選んでいるスタンプが今のマップの組で作ったものでなければ知らせる（Q9）。 */
  private warnIfNotFit(): void {
    const c = this.chosen;
    const map = this.state.map;
    if (c && map && this.state.selection === c.selection && !stampFits(c.stamp, map.doc.primaryTileset, map.doc.secondaryTileset)) {
      this.state.setStatus(t.notFit(c.name), undefined, true);
    }
  }

  /** 今の選択から作るスタンプ。 */
  private stampOfSelection(name: string): Stamp | null {
    const map = this.state.map;
    if (!map) return null;
    const s = this.state.selection;
    const values = s.blocks.map((b, i) => (selectionWrites(s, i) ? (b & 0x3ff) | (((s.movements?.[i] ?? 0) & 0x3f) << 10) : null));
    return createStamp(name, s.width, s.height, values, { primary: map.doc.primaryTileset, secondary: map.doc.secondaryTileset }, new Date().toISOString(), s.movements !== undefined);
  }

  /** 「選択を保存」: 名前を聞いて今の選択を保存する。`name` を渡すと聞かない（自動操作）。保存したら true。 */
  async saveSelection(name?: string, overwrite?: boolean): Promise<boolean> {
    const lib = await this.library();
    if (!lib || !this.state.map) return false;
    const s = this.state.selection;
    const answer = name ?? (await inputDialog(t.saveTitle, t.savePrompt(s.width, s.height), ""));
    if (answer === null) return false;
    const trimmed = answer.trim();
    if (trimmed === "") {
      this.state.setStatus(t.emptyName, undefined, true);
      return false;
    }
    let replace = overwrite ?? false;
    if (lib.get(trimmed) && overwrite === undefined) {
      replace = (await messageBox(t.overwriteTitle, t.overwriteConfirm(trimmed), "question", "yesNo")) === "yes";
      if (!replace) return false;
    }
    const stamp = this.stampOfSelection(trimmed);
    if (!stamp) return false;
    try {
      const path = await lib.save(stamp, replace);
      this.state.setStatus(t.saved(stamp.name, path));
    } catch (e) {
      this.state.setStatus(t.failed(e instanceof Error ? e.message : String(e)), undefined, true);
      return false;
    }
    await this.refresh();
    return true;
  }

  /** 名前を変える。`to` を渡すと聞かない（自動操作）。 */
  async rename(name: string, to?: string): Promise<boolean> {
    const lib = await this.library();
    if (!lib?.get(name)) return false;
    const answer = to ?? (await inputDialog(t.renameTitle, t.renamePrompt, name));
    if (answer === null || answer.trim() === name) return false;
    try {
      await lib.rename(name, answer);
      if (this.chosen?.name === name) this.chosen = { ...this.chosen, name: answer.trim() };
      this.state.setStatus(t.renamed(answer.trim()));
    } catch (e) {
      this.state.setStatus(t.failed(e instanceof Error ? e.message : String(e)), undefined, true);
      return false;
    }
    await this.refresh();
    return true;
  }

  /** 消す。`confirm` が false なら聞かない（自動操作）。 */
  async remove(name: string, confirm = true): Promise<boolean> {
    const lib = await this.library();
    if (!lib?.get(name)) return false;
    if (confirm && (await messageBox(t.removeTitle, t.removeConfirm(name), "warning", "yesNo")) !== "yes") return false;
    try {
      await lib.remove(name);
      if (this.chosen?.name === name) this.chosen = null;
      this.state.setStatus(t.removed(name));
    } catch (e) {
      this.state.setStatus(t.failed(e instanceof Error ? e.message : String(e)), undefined, true);
      return false;
    }
    await this.refresh();
    return true;
  }

  private menu(name: string, x: number, y: number): void {
    showContextMenu(x, y, [
      { id: "stampRename", label: t.menuRename, run: () => void this.rename(name) },
      { id: "stampOverwrite", label: t.menuOverwrite, run: () => void this.saveSelection(name, true) },
      { id: "stampRemove", label: t.menuRemove, run: () => void this.remove(name) },
    ]);
  }
}
