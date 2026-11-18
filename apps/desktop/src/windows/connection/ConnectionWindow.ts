import "../../styles/connectionWindow.css";
import {
  AddConnectionCommand,
  ConnectionDirection,
  RemoveConnectionCommand,
  SetConnectionCommand,
  type Command,
  type MapConnection,
} from "@zigzagumap/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { hex, ja } from "../../i18n/ja";
import { jaConnectionWindow as tw } from "../../i18n/ja.connectionWindow";
import { askYesNo } from "../../ui/MessageBox";
import { button, combo, edit, label, panel, selectIndex, setEnabled, spin } from "../../ui/form/controls";
import { DraftList, type DraftOps } from "../../ui/form/DraftList";
import { toByte } from "../../ui/form/inputErrors";
import { checkOnInput, tryInteger } from "../../ui/form/integerInput";
import { PendingReplies } from "../../util/pendingReplies";
import { installToolAutomation } from "../toolAutomation";
import { drawMinimapImage } from "../minimap/rgba";
import {
  CONNECTION_MESSAGE_EVENT,
  CONNECTION_REQUEST_EVENT,
  CONNECTION_WINDOW,
  type ConnectionData,
  type ConnectionMessage,
  type ConnectionPreview,
  type ConnectionRequest,
  type PreviewTarget,
} from "./protocol";

/** 欄を打っている間に絵を頼む間（ミリ秒。この間の入力をまとめる）。 */
const PREVIEW_DELAY = 120;

/** 要求の中身（番号は付けて送る）。 */
type RequestBody = ConnectionRequest extends infer R ? (R extends ConnectionRequest ? Omit<R, "id"> : never) : never;

/** 矢印ボタン 1 つ（方向と、同じ方向の何番目か）。 */
interface Arrow {
  readonly direction: number;
  readonly rank: number;
  readonly element: HTMLButtonElement;
}

/** 下書きのコピーと比較用の文字列。 */
function newDraft(list: readonly MapConnection[]): DraftList<MapConnection> {
  return new DraftList(list, (c) => ({ ...c }), (l) => JSON.stringify(l.map((c) => [c.direction, c.offset, c.bank, c.map, c.padding])));
}

/** 下書きを編集中の状態へ反映するコマンド（メインへは JSON で送る）。 */
function connectionOps(key: string): DraftOps<MapConnection> {
  const [bank, map] = key.split(".").map(Number) as [number, number];
  const m = { bank, map };
  const fields = (c: MapConnection) => ({ direction: c.direction, offset: c.offset, targetBank: c.bank, targetMap: c.map, padding: c.padding });
  return {
    remove: (index) => new RemoveConnectionCommand({ ...m, index }),
    update: (index, before, after) => {
      const a = fields(after);
      const b = fields(before);
      const changed = Object.fromEntries(Object.entries(a).filter(([k, v]) => b[k as keyof typeof b] !== v));
      return Object.keys(changed).length === 0 ? [] : [new SetConnectionCommand({ ...m, index, ...changed })];
    },
    add: (_index, after) => [new AddConnectionCommand({ ...m, ...fields(after) })],
  };
}

/**
 * コネクションマネージャーのウィンドウ（TAnbindungenForm。#561 で別ウィンドウにした）。ツールメニュー「マップの移動」（Ctrl+A）とツールバーから開く。
 * - 上は AdvanceMap と同じ欄。方向・調整・バンク番号・マップ番号・不明の変更、追加（確認なし、方向 無し）、削除（確認あり）は表（下書き）に対して行い、
 *   「保存」でメインの編集中の状態へ反映する（相手のずれもそろえるかはメインの設定）。
 * - 矢印ボタンはその方向・順位のコネクションがあるときだけ押せ、押すとメインで相手のマップを開く。ウィンドウはメインで開いたマップに追従する。
 * - 下は接続先の見た目（ZigzaguMap 独自）。欄を変えるとすぐ、今のマップと接続先の境目の絵をメインに頼んで出す。
 */
export class ConnectionWindow {
  readonly kind = CONNECTION_WINDOW;
  private readonly pending = new PendingReplies();
  private data: ConnectionData | null = null;
  private draft: DraftList<MapConnection> | null = null;
  private draftMap = "";
  private index = 0;
  private readonly arrows: Arrow[] = [];
  private readonly number: { root: HTMLElement; input: HTMLInputElement };
  private readonly direction: HTMLSelectElement;
  private readonly offset: HTMLInputElement;
  private readonly bank: HTMLInputElement;
  private readonly map: HTMLInputElement;
  private readonly unknown: HTMLInputElement;
  private readonly removeButton: HTMLButtonElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly content: HTMLElement;
  private readonly previewBox = document.createElement("div");
  private readonly previewCanvas = document.createElement("canvas");
  private readonly previewThumb = document.createElement("canvas");
  private readonly previewLabel = document.createElement("div");
  private preview: ConnectionPreview | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewSeq = 0;
  private displayScale = 1;

  constructor(private readonly root: HTMLElement) {
    const c = ja.conn;
    this.content = panel("connection-manager", 402, 233);
    const box = panel("connection-arrows", 233, 233);
    box.classList.add("am-abs");
    const arrow = (id: string, glyph: string, direction: number, rank: number, x: number, y: number, w: number, h: number): void => {
      const b = button(`conn.${id}`, glyph, x, y, w, h, () => void this.follow(direction, rank));
      b.classList.add("conn-arrow");
      this.arrows.push({ direction, rank, element: b });
      box.append(b);
    };
    const D = ConnectionDirection;
    arrow("up1", "▲", D.Up, 1, 25, 0, 180, 25);
    arrow("down1", "▼", D.Down, 1, 25, 205, 180, 25);
    arrow("left1", "◀", D.Left, 1, 0, 25, 25, 180);
    arrow("right1", "▶", D.Right, 1, 205, 25, 25, 180);
    arrow("up2", "▲", D.Up, 2, 85, 0, 60, 25);
    arrow("down2", "▼", D.Down, 2, 85, 205, 60, 25);
    arrow("left2", "◀", D.Left, 2, 0, 85, 25, 60);
    arrow("right2", "▶", D.Right, 2, 205, 85, 25, 60);
    arrow("up3", "▲", D.Up, 3, 145, 0, 60, 25);
    arrow("down3", "▼", D.Down, 3, 145, 205, 60, 25);
    arrow("left3", "◀", D.Left, 3, 0, 145, 25, 60);
    arrow("right3", "▶", D.Right, 3, 205, 145, 25, 60);
    arrow("emerge", c.emerge, D.Emerge, 1, 75, 60, 80, 25);
    arrow("dive", c.dive, D.Dive, 1, 75, 145, 80, 25);
    // 1 番目の帯は全幅なので、2・3 番目より奥に置く（AdvanceMap と同じ重なり）。
    for (const a of this.arrows) if (a.rank > 1) a.element.style.zIndex = "1";

    const side = panel("connection-fields", 168, 233);
    side.classList.add("am-abs");
    side.style.left = "234px";
    this.number = spin("conn.number", 96, 24, 49, (d) => this.select(this.index + d));
    this.direction = combo("conn.direction", c.directions, 96, 48, 65);
    this.offset = edit("conn.offset", 96, 72, 49);
    this.bank = edit("conn.bank", 96, 96, 49);
    this.map = edit("conn.map", 96, 120, 49);
    this.unknown = edit("conn.unknown", 96, 144, 49);
    this.removeButton = button("conn.remove", c.remove, 48, 191, 73, 17, () => void this.remove());
    this.saveButton = button("conn.save", c.save, 48, 207, 73, 17, () => void this.save());
    side.append(
      label(c.group, 8, 8),
      label(c.number, 8, 24),
      this.number.root,
      label(c.direction, 8, 50),
      this.direction,
      label(c.offset, 8, 74),
      this.offset,
      label(c.bank, 8, 98),
      this.bank,
      label(c.map, 8, 122),
      this.map,
      label(c.unknown, 8, 146),
      this.unknown,
      button("conn.add", c.add, 48, 175, 73, 17, () => this.add()),
      this.removeButton,
      this.saveButton,
    );
    this.content.append(box, side);

    this.number.input.addEventListener("change", () => {
      // テキストで入れた番号は検査しない（AdvanceMap と同じ。範囲外なら内容は変えない）。
      const n = Number(this.number.input.value);
      if (Number.isInteger(n) && n >= 1 && n <= this.count) this.select(n - 1);
    });
    this.direction.addEventListener("change", () => {
      const d = this.current;
      if (!d || this.direction.selectedIndex < 0) return;
      d.direction = this.direction.selectedIndex;
      this.showArrows();
      this.queuePreview(0);
    });
    // AdvanceMap は 4 つとも入力のたびに読む（不明の欄は `$` を含めた文字のまま読む）。
    for (const el of [this.offset, this.bank, this.map, this.unknown]) {
      checkOnInput(el, "int");
      el.addEventListener("change", () => {
        this.store();
        this.queuePreview(0);
      });
    }
    // 接続先の見た目は、打っている間も変える（欄の値は下書きに入れず、絵だけ頼む）
    for (const el of [this.offset, this.bank, this.map]) el.addEventListener("input", () => this.queuePreview(PREVIEW_DELAY));

    // 接続先の見た目（ZigzaguMap 独自）
    this.previewBox.className = "connection-preview";
    this.previewCanvas.className = "connection-preview-canvas";
    this.previewCanvas.dataset["autoId"] = "conn.preview";
    this.previewCanvas.width = this.previewCanvas.height = 0;
    this.previewLabel.className = "connection-preview-label";
    this.previewLabel.dataset["autoId"] = "conn.previewLabel";
    const stage = document.createElement("div");
    stage.className = "connection-preview-stage";
    stage.append(this.previewCanvas);
    const heading = document.createElement("div");
    heading.className = "connection-preview-heading";
    heading.textContent = tw.preview;
    this.previewBox.append(heading, stage, this.previewLabel);
  }

  async start(): Promise<void> {
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    this.root.classList.add("tool-app", "connection-window");
    this.root.append(this.content, this.previewBox);
    await getCurrentWebviewWindow().listen<ConnectionMessage>(CONNECTION_MESSAGE_EVENT, (e) => this.onMessage(e.payload));
    const data = (await this.request({ op: "hello" })) as ConnectionData;
    this.setData(data);
    new ResizeObserver(() => this.layoutPreview()).observe(this.previewBox);
    await installToolAutomation({ kind: this.kind, whenIdle: (timeout) => this.whenIdle(timeout) }, {
      describe: () => this.describe(),
      actions: {},
    });
  }

  // ---- メインとのやり取り ----

  private request(body: RequestBody): Promise<unknown> {
    const { id, reply, fail } = this.pending.open();
    emitTo("main", CONNECTION_REQUEST_EVENT, { ...body, id }).catch(fail);
    return reply;
  }

  /** 送った要求の返事が全部届くまで待つ（自動操作の後始末用）。 */
  async whenIdle(timeout = 5000): Promise<void> {
    const end = performance.now() + timeout;
    while ((this.pending.size > 0 || this.previewTimer !== null) && performance.now() < end) await new Promise((r) => setTimeout(r, 10));
  }

  private onMessage(m: ConnectionMessage): void {
    if (m.type === "reply") this.pending.settle(m);
    else this.setData(m.data);
  }

  private setData(data: ConnectionData): void {
    this.data = data;
    // 題名は AdvanceMap と同じ（マップの名前は付けない。比較テストのダイアログの題名と合わせる）
    document.title = ja.conn.title;
    this.reload(data.force);
  }

  /** 今のマップのコネクションを読み直す（`force` でなければ、外で変わったときだけ）。 */
  private reload(force: boolean): void {
    const data = this.data;
    const list = data?.connections ?? [];
    const key = data?.key ?? "";
    if (force || !this.draft || this.draftMap !== key || this.draft.isStale(list)) {
      if (force || this.draftMap !== key) this.index = 0;
      this.draft = newDraft(list);
      this.draftMap = key;
      this.index = Math.min(this.index, Math.max(0, this.count - 1));
    }
    this.showCurrent();
  }

  // ---- 欄 ----

  private get count(): number {
    return this.draft?.items.length ?? 0;
  }

  private get current(): MapConnection | null {
    return this.draft?.items[this.index]?.value ?? null;
  }

  private showCurrent(): void {
    const c = this.current;
    this.number.input.value = String(this.index + 1);
    const has = c !== null;
    setEnabled(has, this.number.input, this.direction, this.offset, this.bank, this.map, this.unknown, this.removeButton);
    setEnabled((this.data?.key ?? "") !== "", this.saveButton);
    if (c) {
      selectIndex(this.direction, c.direction);
      this.offset.value = String(c.offset);
      this.bank.value = String(c.bank);
      this.map.value = String(c.map);
      this.unknown.value = `$${hex(c.padding, 4)}`;
    } else {
      this.direction.selectedIndex = -1;
      for (const el of [this.offset, this.bank, this.map, this.unknown]) el.value = "";
    }
    this.showArrows();
    this.queuePreview(0);
  }

  /** 矢印ボタンの有効・無効（その方向の何番目のコネクションがあるか）。 */
  private showArrows(): void {
    const items = this.draft?.items.map((d) => d.value) ?? [];
    for (const a of this.arrows) {
      const has = this.target(items, a.direction, a.rank) !== null;
      a.element.disabled = !has;
      // 2・3 番目の帯は、その順位のコネクションがあるときだけ出す。
      if (a.rank > 1) a.element.hidden = !has;
    }
  }

  private target(items: readonly MapConnection[], direction: number, rank: number): MapConnection | null {
    return items.filter((c) => c.direction === direction)[rank - 1] ?? null;
  }

  /**
   * 欄の値を下書きに入れる。読めない欄は（入力のときにエラーを出してあるので）黙って元の値のままにする。
   * AdvanceMap は範囲を確かめず、書くときに型の大きさに切り詰める。
   */
  private store(): void {
    const c = this.current;
    if (!c) return;
    const offset = tryInteger(this.offset.value, "int");
    const bank = tryInteger(this.bank.value, "int");
    const map = tryInteger(this.map.value, "int");
    const padding = tryInteger(this.unknown.value, "int");
    if (offset !== null) c.offset = offset | 0;
    if (bank !== null) c.bank = toByte(bank);
    if (map !== null) c.map = toByte(map);
    if (padding !== null) c.padding = padding & 0xffff;
  }

  private select(index: number): void {
    if (index < 0 || index >= this.count) return;
    this.store();
    this.index = index;
    this.showCurrent();
  }

  private add(): void {
    if (!this.draft) return;
    this.store();
    this.index = this.draft.add({ direction: 0, offset: 0, bank: 0, map: 0, padding: 0 });
    this.showCurrent();
  }

  private async remove(): Promise<void> {
    if (!this.draft || !this.current) return;
    if (!(await askYesNo(ja.conn.confirmRemove(this.index + 1)))) return;
    this.draft.remove(this.index);
    this.index = Math.max(0, this.index - 1);
    this.showCurrent();
  }

  private async save(): Promise<void> {
    const data = this.data;
    const draft = this.draft;
    if (!data || !draft || !data.key) return;
    this.store();
    const commands: Command[] = draft.plan(data.connections, connectionOps(data.key));
    await this.request({ op: "save", key: data.key, commands: commands.map((c) => ({ name: c.name, args: c.args })) });
    // 実行したら、メインから新しい一覧が届いて読み直す
  }

  /** 矢印ボタン: そのコネクションの相手のマップをメインで開く。 */
  private async follow(direction: number, rank: number): Promise<void> {
    const c = this.target(this.draft?.items.map((d) => d.value) ?? [], direction, rank);
    if (!c) return;
    await this.request({ op: "follow", bank: c.bank, map: c.map });
  }

  // ---- 接続先の見た目 ----

  /** 今の欄の値で、接続先の絵を頼む（`delay` ミリ秒の間の変更をまとめる）。 */
  private queuePreview(delay: number): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      void this.requestPreview();
    }, delay);
  }

  /** 欄に今入っている値（打っている途中も含む）。接続が無ければ null。 */
  private previewTarget(): PreviewTarget | null {
    const c = this.current;
    if (!c) return null;
    const offset = tryInteger(this.offset.value, "int");
    const bank = tryInteger(this.bank.value, "int");
    const map = tryInteger(this.map.value, "int");
    return {
      direction: this.direction.selectedIndex >= 0 ? this.direction.selectedIndex : c.direction,
      offset: offset !== null ? offset | 0 : c.offset,
      bank: bank !== null ? toByte(bank) : c.bank,
      map: map !== null ? toByte(map) : c.map,
    };
  }

  private async requestPreview(): Promise<void> {
    const data = this.data;
    if (!data) return;
    const seq = ++this.previewSeq;
    const target = this.previewTarget();
    const r = (await this.request({ op: "preview", key: data.key, generation: data.generation, target }).catch(() => ({ unchanged: true }))) as
      | { unchanged: true }
      | { preview: ConnectionPreview | null };
    if (seq !== this.previewSeq || "unchanged" in r) return;
    this.preview = r.preview ?? (target ? null : { image: null, region: null, bandAt: null, band: null, cell: 16, text: tw.noConnection });
    if (this.preview?.image) drawMinimapImage(this.previewThumb, this.preview.image);
    else this.previewThumb.width = this.previewThumb.height = 0;
    this.previewLabel.textContent = this.preview?.text ?? "";
    this.layoutPreview();
  }

  /** 絵を、下の場所に収まる大きさで出す（拡大は画素をそのまま大きくする）。 */
  private layoutPreview(): void {
    const canvas = this.previewCanvas;
    const tw0 = this.previewThumb.width;
    const th0 = this.previewThumb.height;
    canvas.hidden = tw0 === 0;
    if (tw0 === 0) return;
    const stage = canvas.parentElement!;
    const s = Math.min(1, stage.clientWidth / tw0, stage.clientHeight / th0) || 1;
    // 小さい絵は 2 倍まで大きくする（1 マスが見えるように）
    const scale = s < 1 ? s : Math.min(2, stage.clientWidth / tw0, stage.clientHeight / th0) >= 2 ? 2 : 1;
    this.displayScale = scale;
    canvas.width = tw0;
    canvas.height = th0;
    canvas.getContext("2d")!.drawImage(this.previewThumb, 0, 0);
    canvas.style.width = `${Math.floor(tw0 * scale)}px`;
    canvas.style.height = `${Math.floor(th0 * scale)}px`;
  }

  private describe(): unknown {
    const p = this.preview;
    return {
      map: this.data?.key ?? "",
      title: document.title,
      index: this.index,
      count: this.count,
      draft: this.draft?.items.map((d) => d.value) ?? [],
      preview: p ? { region: p.region, bandAt: p.bandAt, band: p.band, cell: p.cell, text: p.text, width: p.image?.width ?? 0, height: p.image?.height ?? 0 } : null,
      displayScale: this.displayScale,
    };
  }
}
