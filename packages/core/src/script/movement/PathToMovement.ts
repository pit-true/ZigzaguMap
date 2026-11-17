import { knownMovementIds, MOVEMENT_DELTA, MOVEMENT_DIRECTIONS, movementAction, movementWithDirection, type MovementDirection } from "./MovementActionTable.js";

/**
 * 道をなぞって移動データを作る（#517）の計算。マスの並びや矢印キーの操作を「操作」の列として持ち、移動コマンドの値の列に直す。
 * 画面（DOM）は持たない。下見と「通れないマス」の判定に使う位置の計算もここに置く。
 *
 * - 歩き 1 歩は、選んだ速さの歩きの命令（`walk_up` など。表 #448 の歩きの 4 つ組）1 つ。
 * - 向きだけは `look_*`（0x00〜0x03）。
 * - 待ちはフレーム数を 16・8・4・2・1 の待ちの命令（0x1C〜0x18）に分ける。
 * - ジャンプは作らない（#507 の Q9。段差の向きと合わせる必要があり、なぞって作ると間違えやすい）。
 */

/** 操作 1 つ。 */
export type PathOp =
  /** 1 歩歩く。value は歩きの命令の番号（向きを含む）。 */
  | { readonly kind: "walk"; readonly direction: MovementDirection; readonly value: number }
  /** 向きだけ変える。 */
  | { readonly kind: "face"; readonly direction: MovementDirection }
  /** 待つ（フレーム数）。 */
  | { readonly kind: "wait"; readonly frames: number };

/** 位置と向き。 */
export interface PathPoint {
  readonly x: number;
  readonly y: number;
  readonly facing: MovementDirection;
}

/** 待ちの命令（大きい順。`pause_long` 16、0x1B 8、`pause_short` 4、`pause_vshort` 2、`pause_xshort` 1）。 */
const WAITS: readonly (readonly [number, number])[] = [
  [16, 0x1c],
  [8, 0x1b],
  [4, 0x1a],
  [2, 0x19],
  [1, 0x18],
];

/** 待ちの上限（1 回に足せるフレーム数）。 */
export const PATH_WAIT_MAX = 9999;

/** 歩きの速さとして選べる命令（下向きの番号）。表の歩きの 4 つ組のうち、1 マス進むもの。 */
export function pathWalkSpeeds(): number[] {
  return knownMovementIds().filter((id) => {
    const a = movementAction(id);
    return a.kind === "walk" && a.direction === "down" && a.tileSteps.length === 1 && movementWithDirection(id, "up") === id + 1;
  });
}

/** 既定の歩き（`walk_down`、1 倍）。 */
export const PATH_DEFAULT_WALK = 0x10;

/** 歩きの操作（speed は速さの命令の番号。向きの 4 つ組のどれでもよい）。速さが歩きの 4 つ組でなければ null。 */
export function walkOp(direction: MovementDirection, speed: number = PATH_DEFAULT_WALK): PathOp | null {
  const a = movementAction(speed);
  if (a.kind !== "walk" || a.tileSteps.length !== 1) return null;
  const value = movementWithDirection(speed, direction);
  return value === null ? null : { kind: "walk", direction, value };
}

/** 待ちのフレーム数を待ちの命令に分ける（20 → 16 と 4）。 */
export function waitValues(frames: number): number[] {
  if (!Number.isInteger(frames) || frames < 1 || frames > PATH_WAIT_MAX) throw new RangeError(`待ちのフレーム数は 1〜${PATH_WAIT_MAX} です: ${frames}`);
  const out: number[] = [];
  let rest = frames;
  for (const [n, id] of WAITS) while (rest >= n) { out.push(id); rest -= n; }
  return out;
}

/** 操作 1 つの命令の値。 */
export function pathOpValues(op: PathOp): number[] {
  switch (op.kind) {
    case "walk": return [op.value];
    case "face": return [MOVEMENT_DIRECTIONS.indexOf(op.direction)];
    case "wait": return waitValues(op.frames);
  }
}

/** 操作の列を移動コマンドの値の列にする（`end_m` は含まない）。 */
export function pathToMovement(ops: readonly PathOp[]): number[] {
  return ops.flatMap(pathOpValues);
}

/**
 * from から to へのマスの歩きの向き（横を先に、次に縦）。同じマスなら空。
 * ドラッグで飛んだマス（斜めや 2 マス以上）を 1 歩ずつに分ける。
 */
export function stepsBetween(from: { readonly x: number; readonly y: number }, to: { readonly x: number; readonly y: number }): MovementDirection[] {
  const out: MovementDirection[] = [];
  const dx = to.x - from.x, dy = to.y - from.y;
  for (let i = 0; i < Math.abs(dx); i++) out.push(dx > 0 ? "right" : "left");
  for (let i = 0; i < Math.abs(dy); i++) out.push(dy > 0 ? "down" : "up");
  return out;
}

/** 操作 1 つの前後。 */
export interface PathTraceStep {
  readonly op: PathOp;
  readonly from: PathPoint;
  readonly to: PathPoint;
}

/** 始めの位置から操作を順にたどる。最後の位置は `end`。 */
export function tracePath(start: PathPoint, ops: readonly PathOp[]): { readonly steps: PathTraceStep[]; readonly end: PathPoint } {
  const steps: PathTraceStep[] = [];
  let at = start;
  for (const op of ops) {
    let next = at;
    if (op.kind === "walk") {
      const d = MOVEMENT_DELTA[op.direction];
      next = { x: at.x + d.x, y: at.y + d.y, facing: op.direction };
    } else if (op.kind === "face") next = { ...at, facing: op.direction };
    steps.push({ op, from: at, to: next });
    at = next;
  }
  return { steps, end: at };
}

/** 通れない理由。 */
export type PathBlockReason =
  /** マップの外。 */
  | "outside"
  /** 移動許可が通れない（衝突のビットが立っている）。 */
  | "collision"
  /** 高さが合わない（段差の上下）。 */
  | "elevation"
  /** ほかの人物が居る。 */
  | "person";

/** 通れるかを決める材料。 */
export interface PathWorld {
  readonly width: number;
  readonly height: number;
  /** 移動許可（0〜0x3F。下 2 ビットが衝突、上 4 ビットが高さ）。 */
  movementAt(x: number, y: number): number;
  /** ほかの人物の居るマス（動かす人物は含めない）。 */
  readonly occupied: readonly { readonly x: number; readonly y: number }[];
}

/** 歩きの 1 歩が通れないなら、その理由。 */
export interface PathProblem {
  /** 操作の何番目か。 */
  readonly index: number;
  readonly reason: PathBlockReason;
  readonly x: number;
  readonly y: number;
}

/**
 * 歩きの各歩について、通れないマスを調べる。スクリプトの移動データは壁でも人物でも通り抜けるので、作るのは止めない（知らせるだけ）。
 * 高さはゲームの決まり（高さ 0 と 15 はどこへでも行ける。歩いた先が 0・15 でなければ今の高さになる）で追う。
 */
export function pathProblems(start: PathPoint, ops: readonly PathOp[], world: PathWorld): PathProblem[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < world.width && y < world.height;
  const occupied = new Set(world.occupied.map((p) => `${p.x},${p.y}`));
  let elevation = inside(start.x, start.y) ? world.movementAt(start.x, start.y) >> 2 : 0;
  const out: PathProblem[] = [];
  tracePath(start, ops).steps.forEach((step, index) => {
    if (step.op.kind !== "walk") return;
    const { x, y } = step.to;
    let reason: PathBlockReason | null = null;
    if (!inside(x, y)) reason = "outside";
    else {
      const m = world.movementAt(x, y), z = m >> 2;
      if ((m & 3) !== 0) reason = "collision";
      else if (elevation !== 0 && z !== 0 && z !== 15 && z !== elevation) reason = "elevation";
      else if (occupied.has(`${x},${y}`)) reason = "person";
      if (z !== 0 && z !== 15) elevation = z;
    }
    if (reason) out.push({ index, reason, x, y });
  });
  return out;
}

/**
 * 操作の列の取り消し・やり直し（窓の「1 つ戻す」「やり直す」「全部消す」）。新しい操作を足すと、やり直しの分は消える。
 */
export class PathOps {
  private list: PathOp[] = [];
  private redoList: PathOp[][] = [];

  get ops(): readonly PathOp[] { return this.list; }
  get canUndo(): boolean { return this.list.length > 0; }
  get canRedo(): boolean { return this.redoList.length > 0; }

  /** 足す（ドラッグで飛んだマスの数歩もまとめて 1 回）。 */
  push(...ops: PathOp[]): void {
    if (ops.length === 0) return;
    this.list.push(...ops);
    this.redoList = [];
  }

  /** 1 つ戻す（最後の操作 1 つ）。戻したら true。 */
  undo(): boolean {
    const op = this.list.pop();
    if (!op) return false;
    this.redoList.push([op]);
    return true;
  }

  /** やり直す。 */
  redo(): boolean {
    const ops = this.redoList.pop();
    if (!ops) return false;
    this.list.push(...ops);
    return true;
  }

  /** 全部消す（やり直しで戻せる）。 */
  clear(): void {
    if (this.list.length === 0) return;
    this.redoList.push(this.list);
    this.list = [];
  }

  /** 操作の列を置き換える（やり直しの分も消す）。 */
  reset(ops: readonly PathOp[] = []): void {
    this.list = [...ops];
    this.redoList = [];
  }
}
