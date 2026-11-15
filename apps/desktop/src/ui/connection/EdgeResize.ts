import {
  boxResizeCommands,
  CommandGroup,
  MIN_EDGE_RESIZE,
  ResizeMapEdgeCommand,
  ShiftEventLabelPositionsCommand,
  edgeShift,
  findCoordinateRefs,
  isVertical,
  listScriptSourcePaths,
  maxMapHeight,
  type BoxResize,
  type Command,
  type CoordinateRef,
  type EdgeFill,
  type MapId,
  type Side,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaNeighbors } from "../../i18n/ja.neighbors";
import { showEditError } from "../form/inputErrors";
import { messageBox } from "../MessageBox";

/** 一覧に出す `.s` の行の数の上限。 */
const MAX_LISTED_REFS = 30;

/** 幅・高さの上限（`(幅+15)×(高さ+14) ≤ 10240`）と下限で、`amount` を丸める。 */
export function clampEdgeAmount(width: number, height: number, side: Side, amount: number): number {
  const horizontal = side === "left" || side === "right";
  const current = horizontal ? width : height;
  let next = Math.max(MIN_EDGE_RESIZE, current + amount);
  if (horizontal) while (next > MIN_EDGE_RESIZE && maxMapHeight(next) < height) next--;
  else next = Math.min(next, Math.max(MIN_EDGE_RESIZE, maxMapHeight(width)));
  return next - current;
}

/**
 * 辺のつまみのドラッグでのリサイズ（#231）。`ResizeMapEdgeCommand` と、照合用の座標のずらし（プロジェクトがあるとき）を
 * 1 回の操作で実行する。左・上へ広げた・縮めたときは、`.s` の中の直さない座標（このマップへ来る座標つきのワープ、
 * このマップのスクリプトの人の座標の指定）を探し、あれば一覧で知らせる。
 */
export class EdgeResize {
  /** 最後に知らせた `.s` の行（自動操作で読む）。 */
  lastRefs: readonly CoordinateRef[] = [];

  constructor(private readonly state: EditorState) {}

  /** `side` の向きへ `amount` マス広げる（負なら縮める）。 */
  async resize(side: Side, amount: number): Promise<void> {
    const main = this.state.map;
    if (!this.state.session || !main || amount === 0) return;
    const { dx, dy } = edgeShift(side, amount);
    const partners = await this.partners(dx !== 0, dy !== 0);
    await this.run([ResizeMapEdgeCommand.of(main.id, side, amount, partners)], dx, dy);
  }

  /**
   * 4 辺をまとめて変える（Phase5 #390 の対話式リサイズの窓。辺ごとの ResizeMapEdgeCommand を 1 回の操作にまとめる）。
   * `fill` があれば広げた所をその柄で埋める（省略で端の写し）。左・上へずれたときの補正は辺のつまみと同じ。成功したら true。
   */
  async resizeBox(box: BoxResize, fill?: EdgeFill): Promise<boolean> {
    const main = this.state.map;
    if (!this.state.session || !main) return false;
    if (box.left === 0 && box.right === 0 && box.up === 0 && box.down === 0) return true;
    let commands: Command[];
    try {
      const partners = await this.partners(box.left !== 0, box.up !== 0);
      commands = boxResizeCommands(main.id, main.doc.width, main.doc.height, box, partners, fill);
    } catch (e) {
      await showEditError(e);
      return false;
    }
    return this.run(commands, box.left, box.up);
  }

  /** ずれを直す接続の相手（左右へずらすなら上下の接続、上下なら左右の接続）を読み込んで返す。 */
  private async partners(horizontal: boolean, vertical: boolean): Promise<MapId[]> {
    const session = this.state.session;
    const main = this.state.map;
    const partners: MapId[] = [];
    if (!session || !main || (!horizontal && !vertical)) return partners;
    for (const c of main.doc.connections ?? []) {
      const affected = (horizontal && isVertical(c.direction)) || (vertical && (c.direction === 3 || c.direction === 4));
      const p = { bank: c.bank, map: c.map };
      if (!affected || partners.some((x) => x.bank === p.bank && x.map === p.map) || !session.catalog.has(p)) continue;
      if (await session.project.load(p).then(() => true).catch(() => false)) partners.push(p);
    }
    return partners;
  }

  /** リサイズのコマンドと、照合用の座標のずらし（プロジェクトがあるとき）を 1 回の操作で実行する。成功したら true。 */
  private async run(resize: readonly Command[], dx: number, dy: number): Promise<boolean> {
    const session = this.state.session;
    const main = this.state.map;
    if (!session || !main) return false;
    const id = main.id;
    const commands: Command[] = [...resize];
    if ((dx !== 0 || dy !== 0) && session.projectDir) commands.push(new ShiftEventLabelPositionsCommand({ bank: id.bank, map: id.map, dx, dy }));
    try {
      session.bus.execute(CommandGroup.of(commands));
    } catch (e) {
      await showEditError(e);
      return false;
    }
    this.state.setStatus(jaNeighbors.resized(main.doc.width, main.doc.height));
    if (dx !== 0 || dy !== 0) await this.reportRefs(id);
    return true;
  }

  /** `.s` の中の、直さなかった座標を探して知らせる。 */
  private async reportRefs(id: MapId): Promise<void> {
    this.lastRefs = [];
    const session = this.state.session;
    const fs = session?.projectFs();
    if (!session || !fs) return;
    const m = session.labels.store.get(id.bank, id.map);
    const labels = new Set<string>([...m.person, ...m.sign, ...m.tile].flatMap((l) => (l ? [l.label] : [])));
    if (m.mapScripts) labels.add(m.mapScripts);
    const refs: CoordinateRef[] = [];
    for (const path of await listScriptSourcePaths(fs)) {
      try {
        refs.push(...findCoordinateRefs(path, await fs.readText(path), id, labels));
      } catch {
        /* 読めないファイルは飛ばす */
      }
    }
    this.lastRefs = refs;
    if (refs.length === 0) return;
    const lines = refs.slice(0, MAX_LISTED_REFS).map((r) => `${r.path}:${r.line}  ${r.text}`);
    if (refs.length > MAX_LISTED_REFS) lines.push(jaNeighbors.refsMore(refs.length - MAX_LISTED_REFS));
    await messageBox(jaNeighbors.refsTitle, `${jaNeighbors.refsText}\n\n${lines.join("\n")}`, "warning");
  }
}
