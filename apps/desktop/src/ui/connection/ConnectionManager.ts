import {
  AddConnectionCommand,
  ConnectionDirection,
  RemoveConnectionCommand,
  SetConnectionCommand,
  type Command,
  type MapConnection,
  type MapId,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { hex, ja } from "../../i18n/ja";
import { createDialog, handleDialogKeys, pressable, type DialogFrame } from "../Dialog";
import { askYesNo } from "../MessageBox";
import { commit, watchCommands } from "../form/commit";
import { button, combo, edit, label, panel, selectIndex, setEnabled, spin } from "../form/controls";
import { DraftList, type DraftOps } from "../form/DraftList";
import { toByte } from "../form/inputErrors";
import { checkOnInput, tryInteger } from "../form/integerInput";

/** 矢印ボタン 1 つ（方向と、同じ方向の何番目か）。 */
interface Arrow {
  readonly direction: number;
  readonly rank: number;
  readonly element: HTMLButtonElement;
}

/** 下書きの写しと比較用の文字列。 */
function newDraft(list: readonly MapConnection[]): DraftList<MapConnection> {
  return new DraftList(list, (c) => ({ ...c }), (l) => JSON.stringify(l.map((c) => [c.direction, c.offset, c.bank, c.map, c.padding])));
}

/** 下書きを編集中の状態へ反映するコマンド。 */
function connectionOps(id: MapId): DraftOps<MapConnection> {
  const m = { bank: id.bank, map: id.map };
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
 * コネクションマネージャー（TAnbindungenForm。モードレスで常に手前）。ツールメニュー「マップの移動」（Ctrl+A）とツールバーから開く。
 * - 方向・調整・バンク番号・マップ番号・不明の変更、追加（確認なし、方向 無し）、削除（確認あり）はメモリ上の表（下書き）に対して行い、
 *   「保存」で編集中の状態へ反映する（AdvanceMap の ROM への書き込みの読み替え）。
 * - 矢印ボタンはその方向・順位のコネクションがあるときだけ押せ、押すと相手のマップを開く。ダイアログは開いたマップに追従する。
 * - 開いたときに初めて読み込む（App から動的に読み込む）。
 */
export class ConnectionManager {
  private frame: DialogFrame | null = null;
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

  constructor(
    private readonly state: EditorState,
    private readonly openMap: (id: MapId) => Promise<void>,
  ) {
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
    this.saveButton = button("conn.save", c.save, 48, 207, 73, 17, () => this.save());
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
    });
    // AdvanceMap は 4 つとも入力のたびに読む（不明の欄は `$` を含めた文字のまま読む）。
    for (const el of [this.offset, this.bank, this.map, this.unknown]) {
      checkOnInput(el, "int");
      el.addEventListener("change", () => this.store());
    }

    state.on("map", () => this.reload(true));
    watchCommands(state, () => this.reload(false));
  }

  /** 開いているか。 */
  get isOpen(): boolean {
    return this.frame !== null;
  }

  /** 開く（開いていれば何もしない）。 */
  show(): void {
    if (this.frame) return;
    const frame = createDialog({ title: ja.conn.title, width: 410, modal: false, className: "connection-dialog", onClose: () => this.close() });
    frame.body.append(this.content);
    frame.box.style.left = `${Math.max(0, Math.round((window.innerWidth - 410) / 2))}px`;
    frame.box.style.top = `${Math.max(0, Math.round((window.innerHeight - 262) / 2))}px`;
    handleDialogKeys(frame, null);
    frame.register({ title: ja.conn.title, text: "", ...pressable([]) });
    this.frame = frame;
    this.reload(true);
  }

  /** 閉じる（保存していない変更は捨てる。AdvanceMap と同じく確認しない）。 */
  close(): void {
    this.frame?.remove();
    this.frame = null;
    this.draft = null;
  }

  private get count(): number {
    return this.draft?.items.length ?? 0;
  }

  private get current(): MapConnection | null {
    return this.draft?.items[this.index]?.value ?? null;
  }

  /** 表示中のマップのコネクションを読み直す（`force` でなければ、外で変わったときだけ）。 */
  private reload(force: boolean): void {
    if (!this.frame) return;
    const map = this.state.map;
    const list = map?.doc.connections ?? [];
    const key = map ? `${map.id.bank}.${map.id.map}` : "";
    if (force || !this.draft || this.draftMap !== key || this.draft.isStale(list)) {
      if (force || this.draftMap !== key) this.index = 0;
      this.draft = newDraft(list);
      this.draftMap = key;
      this.index = Math.min(this.index, Math.max(0, this.count - 1));
    }
    this.showCurrent();
  }

  private showCurrent(): void {
    const c = this.current;
    this.number.input.value = String(this.index + 1);
    const has = c !== null;
    setEnabled(has, this.number.input, this.direction, this.offset, this.bank, this.map, this.unknown, this.removeButton);
    setEnabled(this.state.map !== null, this.saveButton);
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

  private save(): void {
    const map = this.state.map;
    const draft = this.draft;
    if (!map || !draft) return;
    this.store();
    const commands: Command[] = draft.plan(map.doc.connections ?? [], connectionOps(map.id));
    if (commit(this.state, commands)) this.reload(false);
  }

  /** 矢印ボタン: そのコネクションの相手のマップを開く。 */
  private async follow(direction: number, rank: number): Promise<void> {
    const c = this.target(this.draft?.items.map((d) => d.value) ?? [], direction, rank);
    if (!c) return;
    const id = { bank: c.bank, map: c.map };
    if (!this.state.session?.catalog.has(id)) {
      this.state.setStatus(ja.mapNotFound, undefined, true);
      return;
    }
    await this.openMap(id);
  }
}
