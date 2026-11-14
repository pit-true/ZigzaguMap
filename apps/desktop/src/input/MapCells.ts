import { CommandGroup, resolveCell, type BlockGrid, type Command, type MapId } from "@zigzagumap/core";
import type { EditorState } from "../app/EditorState";
import type { NeighborService } from "../app/neighbors/NeighborService";
import type { Cell } from "../ui/map/MapView";

/** 画面のマスが指す、マップとそのマップの中のマス。 */
export interface CellRef {
  readonly id: MapId;
  readonly x: number;
  readonly y: number;
  /** 主マップか（false なら隣のマップの帯）。 */
  readonly main: boolean;
}

/** マップごとに分けた書き込み。 */
export interface MapWrites<T> {
  readonly id: MapId;
  readonly cells: T[];
}

/** ダブルクリックとみなす 2 回の押下の間（ms）。Windows の設定の最大（900ms）より長めに取る。 */
export const DOUBLE_CLICK_MS = 1500;

/** 左ボタンの 1 回の押下で描いたもの（ダブルクリックでマップを開くときに取り消す）。 */
interface Press {
  readonly at: number;
  /** この押下で履歴に積んだコマンド（まとめたものは最初の 1 つに入る）。 */
  readonly commands: Command[];
}

function keyOf(id: MapId): string {
  return `${id.bank}.${id.map}`;
}

/**
 * 画面のマス（主マップの左上が原点。隣のマップの帯の上は外の座標）を、どのマップのどのマスかに変える（Phase3 #234）。
 * 隣のマップへ書くときは、先に編集用に読み込む（読み取り専用で読んだものには書かない）。
 */
export class MapCells {
  /** 隣のマップの帯（App が入れる。無ければ主マップだけ）。 */
  neighbors: NeighborService | null = null;
  /** 隣のマップを読み込んでから実行する操作の列（順を守るため）。 */
  private queue: Promise<void> = Promise.resolve();
  private queued = 0;
  /** 最近の押下（新しい順に 2 つまで）と、押している間の押下。 */
  private presses: Press[] = [];
  private pressing: Press | null = null;

  constructor(private readonly state: EditorState) {}

  /** 隣の帯の上に書けるか（帯が出ていて、表示中のマップのもの）。 */
  get crossCapable(): boolean {
    const frame = this.frame();
    return frame !== null && frame.bands.length > 0;
  }

  private frame() {
    const f = this.neighbors?.frame ?? null;
    const main = this.state.map;
    return f && main && f.main.bank === main.id.bank && f.main.map === main.id.map ? f : null;
  }

  /** 画面のマスが指すマップとマス（主マップの外で、見せている帯の上でもなければ null）。 */
  resolve(cell: Cell): CellRef | null {
    const main = this.state.map;
    if (!main) return null;
    const doc = main.doc;
    if (cell.x >= 0 && cell.y >= 0 && cell.x < doc.width && cell.y < doc.height) return { id: main.id, x: cell.x, y: cell.y, main: true };
    const frame = this.frame();
    if (!frame) return null;
    const hit = resolveCell(frame.layout, { id: main.id, width: doc.width, height: doc.height }, cell.x, cell.y);
    return hit && hit.neighbor ? { id: hit.id, x: hit.x, y: hit.y, main: false } : null;
  }

  /** マップの配置（編集中のものがあればそれ、無ければ帯のために読んだもの）。読めなければ null。 */
  gridOf(id: MapId): BlockGrid | null {
    const session = this.state.session;
    const loaded = session?.project.loaded(id);
    if (loaded) return loaded.grid;
    const band = this.frame()?.bands.find((b) => b.placement.id.bank === id.bank && b.placement.id.map === id.map);
    return band?.grid ?? null;
  }

  /** 画面のマスの一覧をマップごとに分ける（どのマップでもないマスは捨てる）。主マップが先頭。 */
  split<T extends { x: number; y: number }>(list: readonly T[]): MapWrites<T>[] {
    const groups = new Map<string, MapWrites<T>>();
    for (const c of list) {
      const ref = this.resolve(c);
      if (!ref) continue;
      const k = keyOf(ref.id);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { id: ref.id, cells: [] }));
      g.cells.push({ ...c, x: ref.x, y: ref.y });
    }
    const main = this.state.map?.id;
    return [...groups.values()].sort((a, b) => Number(main && keyOf(b.id) === keyOf(main)) - Number(main && keyOf(a.id) === keyOf(main)));
  }

  /** 隣のマップを編集用に読み込む（読めなかったマップは false）。 */
  async ensureLoaded(ids: readonly MapId[]): Promise<boolean> {
    const session = this.state.session;
    if (!session) return false;
    let ok = true;
    for (const id of ids) {
      if (session.project.loaded(id)) continue;
      ok = (await session.project.load(id).then(() => true).catch(() => false)) && ok;
    }
    return ok;
  }

  /** 読み込まれていない（書く前に読み込みが要る）マップがあるか。 */
  needsLoad(ids: readonly MapId[]): boolean {
    const session = this.state.session;
    return !!session && ids.some((id) => !session.project.loaded(id));
  }

  /**
   * `ids` のマップを読み込んでから、`make` で作ったコマンドを 1 回の操作として実行する。読み込みが要らなければすぐ実行し、
   * 要るときは読み込んでから実行する（その間の操作は順に待たせる）。
   */
  run(ids: readonly MapId[], make: () => Command[], forDrag: boolean, merge: boolean): void {
    const session = this.state.session;
    if (!session) return;
    const press = this.pressing;
    const exec = (): void => {
      const command = this.combine(make(), forDrag);
      if (!command) return;
      session.bus.execute(command, { merge });
      // まとめられずに積まれたものだけを覚える（まとめたものは前のコマンドを戻せば一緒に戻る）
      if (press && session.bus.last === command) press.commands.push(command);
    };
    if (this.queued === 0 && !this.needsLoad(ids)) return exec();
    this.queued++;
    this.queue = this.queue
      .then(async () => {
        if ((await this.ensureLoaded(ids)) && this.state.session === session) exec();
      })
      .catch(() => undefined)
      .finally(() => this.queued--);
  }

  /**
   * 左ボタンで描き始めた（離すまでに実行したコマンドを、この押下のものとして覚える）。描く道具が押したときに呼ぶ。
   * ダブルクリックでマップを開くとき（隣の帯・Space で重ねたダイブ先）に `retractPresses` で取り消すため。
   */
  pressStart(): void {
    this.pressing = { at: performance.now(), commands: [] };
    this.presses = [this.pressing, ...this.presses].slice(0, 2);
  }

  /** 離した。 */
  pressEnd(): void {
    this.pressing = null;
  }

  /**
   * ダブルクリックでマップを開く前に、その 2 回の押下で描いた分を取り消し、やり直しの履歴にも残さない。
   * 押下が `DOUBLE_CLICK_MS` より前のもの、そのあとにほかの操作が積まれたものは戻さない。戻したコマンドの数を返す。
   */
  async retractPresses(): Promise<number> {
    const now = performance.now();
    const recent = this.presses.filter((p) => now - p.at < DOUBLE_CLICK_MS);
    this.presses = [];
    this.pressing = null;
    // 隣のマップの読み込みを待っている描画は、実行されてから戻す
    await this.settle();
    const bus = this.state.session?.bus;
    if (!bus) return 0;
    let count = 0;
    for (const press of recent) {
      for (const command of [...press.commands].reverse()) {
        if (!bus.retract(command)) return count;
        count++;
      }
    }
    return count;
  }

  /** 読み込み待ちの操作が残っていないことを待つ（自動操作用）。 */
  async settle(): Promise<void> {
    while (this.queued > 0) await this.queue;
  }

  /**
   * マップごとのコマンドを 1 つの操作にする。隣の帯があるときのドラッグは、いつもまとめたもの（group）にして、
   * 途中で境界をまたいでも 1 回の取り消しで戻るようにする（`CommandGroup.merge`）。
   */
  combine(commands: readonly Command[], forDrag: boolean): Command | null {
    if (commands.length === 0) return null;
    if (forDrag && this.crossCapable) return new CommandGroup(commands);
    return CommandGroup.of(commands);
  }
}
