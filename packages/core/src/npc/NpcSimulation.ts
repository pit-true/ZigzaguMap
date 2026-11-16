import { MOVEMENT_DELTA, movementAction, oppositeDirection, type MovementAction, type MovementDirection } from "../script/movement/MovementActionTable.js";
import type { PlaybackActorState } from "../script/playback/PlaybackState.js";
import { defaultFacingOf } from "../script/playback/StartState.js";
import { npcMovementType, type NpcMovementType } from "./NpcMovementTypes.js";

/**
 * 人物の移動タイプの再生（#471）。元の日本語版 `evobjmv.c` の段の関数（`act->work[1]` の番号で進む状態機械）を、そのまま
 * 1 フレームずつ動かす。1 フレームの中では、段の関数が 1 を返す間は続けて呼ぶ（`AcmdBranch` の `while( move(ev,act) )`）。
 *
 * - 乱数は実機と同じ式（`pp_rand`: seed × 0x41C64E6D + 0x6073 の上位 16 ビット）を 1 本だけ持ち、全員で順に使う。実機では
 *   ほかの処理も同じ乱数を使うので、並びは実機と一致しない（同じ種なら毎回同じ動きになる）。
 * - 通れるかの判定は `EvObjMoveChk` の順: 移動範囲 → 衝突のビット → マップの外 → 一方通行の属性（今のマスと行き先）→
 *   高さ → ほかの人物（今のマスと、歩く前のマス）。
 * - 主人公は止まっている障害物として渡す（走らないので、見回すトレーナーが主人公の方を向く処理は起きない）。
 * - マップの元データは書き換えない。
 */

/** 通れるかの判定に使うマップ。 */
export interface NpcWorld {
  readonly width: number;
  readonly height: number;
  /** 移動許可（0〜0x3F。下位 2 ビットが衝突、上位 4 ビットが高さ）。マップの外は null。 */
  movement(x: number, y: number): number | null;
  /** ブロックの挙動の番号（属性の下位 9 ビット）。 */
  behavior(x: number, y: number): number;
}

/** 動かす人物（イベントの値）。 */
export interface NpcSource {
  readonly localId: number;
  readonly graphicsId: number;
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
  readonly movementType: number;
  readonly movementRangeX: number;
  readonly movementRangeY: number;
}

/** 人物の通れないマス（主人公など）。 */
export interface NpcObstacle {
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
}

/** 止めて見せる理由。 */
export type NpcStillReason =
  /** 実機でも動かないタイプ。 */
  | "still"
  /** 主人公の動きをまねるタイプ（仮の主人公は歩かない）。 */
  | "copy"
  /** 隠れるタイプ（木・岩・砂の絵は描かない）。 */
  | "hide"
  /** 絵のアニメの長さがROMの命令次第で、まだ再現していない。 */
  | "unsupported"
  /** 表に無い番号。 */
  | "unknown";

/** 1 人の状態の要約（自動操作・画面の知らせ用）。 */
export interface NpcStatus {
  readonly localId: number;
  readonly movementType: number;
  readonly x: number;
  readonly y: number;
  readonly facing: MovementDirection;
  /** 止めて見せている理由。動いていれば null。 */
  readonly reason: NpcStillReason | null;
}

const FREE = 0;
const HOLD = 15;

/** 通れないときの種類（`EVOBJHIT_*`）。 */
export type NpcHit = "limit" | "attribute" | "height" | "object";
const HIT_LIMIT = 1, HIT_ATTRIBUTE = 2, HIT_HEIGHT = 4, HIT_OBJECT = 8;

/** 視界の 1 方向（`NpcSimulation.sight`）。 */
export interface NpcSightRay {
  readonly direction: MovementDirection;
  /** 主人公が立つと見つかるマス（近い順）。 */
  readonly tiles: readonly { readonly x: number; readonly y: number }[];
  /** 視界の距離の中で遮ったマスと理由。遮るものが無ければ null。 */
  readonly blocked: { readonly x: number; readonly y: number; readonly hit: NpcHit } | null;
}

/** 一方通行の属性（`map_attr.c` の `ATR_IsBadMove*Check`。0x30〜0x37）。その向きへ動けない。 */
const BAD_MOVE: Readonly<Record<MovementDirection, readonly number[]>> = {
  right: [0x30, 0x34, 0x36],
  left: [0x31, 0x35, 0x37],
  up: [0x32, 0x34, 0x35],
  down: [0x33, 0x36, 0x37],
};

const LETTER: Readonly<Record<string, MovementDirection>> = { D: "down", U: "up", L: "left", R: "right" };
const SPIN: Readonly<Record<string, Readonly<Record<MovementDirection, MovementDirection>>>> = {
  // ObjDirectSpinL3 / R3 の tbl（今の向き → 次の向き）
  L: { down: "right", up: "left", left: "down", right: "up" },
  R: { down: "left", up: "right", left: "up", right: "down" },
};
const FACE = 0x00, WALK_05 = 0x08, WALK_1 = 0x10;
const STAY_WALK: Readonly<Record<string, number>> = { "1": 0x25, "2": 0x29, "4": 0x2d };
const DIR_INDEX: Readonly<Record<MovementDirection, number>> = { down: 0, up: 1, left: 2, right: 3 };

interface Running {
  readonly action: MovementAction;
  readonly direction: MovementDirection;
  /** 済んだ段の数。 */
  calls: number;
  /** 進んだ画素。 */
  moved: number;
}

interface Npc {
  readonly source: NpcSource;
  readonly type: NpcMovementType | null;
  readonly limitX: number;
  readonly limitY: number;
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  /** 通れるかに使う高さ（`ev->height`）と、重なり順の高さ（`ev->height_pri`）。 */
  height: number;
  heightPri: number;
  facing: MovementDirection;
  moveDir: MovementDirection;
  seq: number;
  wait: number;
  work0: number;
  running: Running | null;
  /** このフレームで動かした命令（絵のコマを選ぶため）。 */
  shown: { id: number; frame: number } | null;
  moveStart: boolean;
  vanish: boolean;
}

/** 1 フレームの段の関数の呼び出しの上限（壊れた表で止まらないための保険。実機の関数は数回で 0 を返す）。 */
const MAX_CALLS = 16;

export class NpcSimulation {
  private npcs: Npc[] = [];
  private seed: number;
  private frameValue = 0;
  private obstacles: readonly NpcObstacle[] = [];

  constructor(private readonly world: NpcWorld, private readonly sources: readonly NpcSource[], private readonly initialSeed = 0) {
    this.seed = initialSeed >>> 0;
    this.reset();
  }

  /** 進めたフレーム数。 */
  get frame(): number { return this.frameValue; }

  /** 全員を元の位置・向きへ戻し、乱数を最初の種へ戻す。 */
  reset(): void {
    this.seed = this.initialSeed >>> 0;
    this.frameValue = 0;
    this.npcs = this.sources.map(source => {
      const type = npcMovementType(source.movementType);
      let limitX = source.movementRangeX & 15, limitY = source.movementRangeY & 15;
      if (type?.limitFlag) { if (!limitX) limitX = 1; if (!limitY) limitY = 1; }
      const facing = defaultFacingOf(source.movementType);
      return {
        source, type, limitX, limitY, x: source.x, y: source.y, oldX: source.x, oldY: source.y,
        height: source.elevation & 15, heightPri: source.elevation & 15, facing, moveDir: facing, seq: 0, wait: 0, work0: 0,
        running: null, shown: null, moveStart: true, vanish: false,
      };
    });
  }

  /** 1 フレーム進める。`obstacles` は主人公など、人物の通れないマス。 */
  step(obstacles: readonly NpcObstacle[] = []): void {
    this.obstacles = obstacles;
    for (const npc of this.npcs) this.branch(npc);
    this.frameValue++;
  }

  /** 今の状態を、再生と同じ人物の形で返す（番号は localId）。 */
  actors(): PlaybackActorState[] {
    return this.npcs.map(npc => {
      const r = npc.running;
      const d = r ? MOVEMENT_DELTA[r.direction] : { x: 0, y: 0 };
      const walking = r && r.action.pixels !== null && r.action.kind === "walk";
      const pixelX = walking ? (npc.oldX * 16) + d.x * r.moved : npc.x * 16;
      const pixelY = walking ? (npc.oldY * 16) + d.y * r.moved : npc.y * 16;
      const shown = npc.shown;
      const action = shown ? movementAction(shown.id) : null;
      return {
        id: npc.source.localId, graphicsId: npc.source.graphicsId, tileX: npc.x, tileY: npc.y, pixelX, pixelY, height: 0,
        facing: npc.facing, sprite: action?.sprite ?? "stand", actionFrame: shown?.frame ?? 0, movementId: shown?.id ?? null,
        visible: !npc.vanish, present: true, shadow: false, mark: null, elevation: npc.heightPri, fixedPriority: false, animHold: false,
      };
    });
  }

  /** 人ごとの要約。 */
  status(): NpcStatus[] {
    return this.npcs.map(npc => ({
      localId: npc.source.localId, movementType: npc.source.movementType, x: npc.x, y: npc.y, facing: npc.facing, reason: stillReason(npc.type),
    }));
  }

  /** `EvObjMoveChk`。通れれば null、通れなければ理由。 */
  hitAt(localId: number, x: number, y: number, direction: MovementDirection): NpcHit | null {
    const npc = this.npcs.find(n => n.source.localId === localId);
    return npc ? this.moveCheck(npc, x, y, direction) : null;
  }

  private branch(npc: Npc): void {
    npc.shown = null;
    if (npc.moveStart) { this.updateHeight(npc); npc.moveStart = false; }
    const type = npc.type;
    if (type && stillReason(type) === null) {
      for (let calls = 0; calls < MAX_CALLS && this.move(npc, type); calls++);
    }
  }

  /** 移動タイプの段の関数を 1 つ呼ぶ。1 を返したら同じフレームで続ける。 */
  private move(npc: Npc, type: NpcMovementType): boolean {
    switch (type.family) {
      case "wander": return this.wander(npc, type);
      case "look": return this.look(npc, type);
      case "face": return this.face(npc);
      case "spin": return this.spin(npc, type);
      case "route2": return this.route2(npc);
      case "route3": return this.route3(npc, type);
      case "stayWalk": return this.stayWalk(npc, type);
      case "vanish": return this.vanish(npc);
      default: return false;
    }
  }

  /** ObjRandomMove0〜6・ObjVMove・ObjHMove・ObjRandomSlowMove。 */
  private wander(npc: Npc, type: NpcMovementType): boolean {
    switch (npc.seq) {
      case 0: this.init(npc); npc.seq = 1; return true;
      case 1: this.set(npc, FACE, npc.facing); npc.seq = 2; return true;
      case 2:
        if (!this.action(npc)) return false;
        npc.wait = type.waits![this.rand() & 3]!; npc.seq = 3; return true;
      case 3:
        if (--npc.wait === 0) { npc.seq = 4; return true; }
        return false;
      case 4: {
        const table = type.table;
        const site = LETTER[table[this.rand() & (table.length - 1)]!]!;
        this.siteSet(npc, site);
        npc.seq = this.moveCheckSite(npc, site) ? 1 : 5;
        return true;
      }
      case 5: this.set(npc, type.id === 0x50 ? WALK_05 : WALK_1, npc.moveDir); npc.seq = 6; return true;
      default:
        if (this.action(npc)) npc.seq = 1;
        return false;
    }
  }

  /** ObjDirectMove・ObjDirect*Site（その場の見回し）。 */
  private look(npc: Npc, type: NpcMovementType): boolean {
    switch (npc.seq) {
      case 0: this.init(npc); npc.seq = 1; return true;
      case 1: this.set(npc, FACE, npc.facing); npc.seq = 2; return true;
      case 2:
        if (this.action(npc)) { npc.wait = type.waits![this.rand() & 3]!; npc.seq = 3; }
        return false;
      case 3:
        if (--npc.wait === 0) { npc.seq = 4; return true; }
        return false;
      default: {
        const table = type.table;
        this.siteSet(npc, LETTER[table[this.rand() & (table.length - 1)]!]!);
        npc.seq = 1;
        return true;
      }
    }
  }

  /** ObjDirectSite0〜2。 */
  private face(npc: Npc): boolean {
    switch (npc.seq) {
      case 0: this.init(npc); this.set(npc, FACE, npc.facing); npc.seq = 1; return true;
      case 1:
        if (this.action(npc)) { npc.seq = 2; return true; }
        return false;
      default: return false;
    }
  }

  /** ObjDirectSpinL0〜3・R0〜3。 */
  private spin(npc: Npc, type: NpcMovementType): boolean {
    switch (npc.seq) {
      case 0: this.init(npc); this.set(npc, FACE, npc.facing); npc.seq = 1; return true;
      case 1:
        if (this.action(npc)) { npc.wait = type.waits![0]!; npc.seq = 2; }
        return false;
      case 2:
        if (--npc.wait === 0) npc.seq = 3;
        return false;
      default:
        this.siteSet(npc, SPIN[type.table]![npc.facing]);
        npc.seq = 0;
        return true;
    }
  }

  /** ObjRoute2Pos0〜3（往復）。 */
  private route2(npc: Npc): boolean {
    switch (npc.seq) {
      case 0: this.init(npc); npc.seq = 1; return true;
      case 1: {
        const site = defaultFacingOf(npc.source.movementType);
        this.siteSet(npc, npc.work0 ? oppositeDirection(site) : site);
        npc.seq = 2;
        return true;
      }
      case 2: {
        if (npc.work0 && npc.source.x === npc.x && npc.source.y === npc.y) {
          npc.work0 = 0;
          this.siteSet(npc, oppositeDirection(npc.moveDir));
        }
        let hit = this.moveCheckSite(npc, npc.moveDir);
        if (hit === "limit") {
          npc.work0++;
          this.siteSet(npc, oppositeDirection(npc.moveDir));
          hit = this.moveCheckSite(npc, npc.moveDir);
        }
        if (hit) this.set(npc, STAY_WALK["1"]!, npc.facing);
        else this.set(npc, WALK_1, npc.moveDir);
        npc.seq = 3;
        return true;
      }
      default:
        if (this.action(npc)) npc.seq = 1;
        return false;
    }
  }

  /** ObjRoute3Pos0・ObjRouteXXXX1・ObjRoute3PosMoveSet・ObjRoute3Pos2（周回）。 */
  private route3(npc: Npc, type: NpcMovementType): boolean {
    switch (npc.seq) {
      case 0: this.init(npc); npc.seq = 1; return true;
      case 1: {
        const [letters, rule] = type.table.split(":") as [string, string];
        const at = Number(rule[0]);
        const back = rule[1] === "x" ? npc.source.x === npc.x : npc.source.y === npc.y;
        if (npc.work0 === at && back) npc.work0 = at + 1;
        if (npc.work0 === 3 && npc.source.x === npc.x && npc.source.y === npc.y) npc.work0 = 0;
        const site = (): MovementDirection => LETTER[letters[npc.work0 & 3]!]!;
        this.siteSet(npc, site());
        let hit = this.moveCheckSite(npc, npc.moveDir);
        if (hit === "limit") {
          // 元のソースは表の 4 つ目を越えて読むことがある（スタックの別の値）。エディタでは表を一周させる。
          npc.work0 = (npc.work0 + 1) & 3;
          this.siteSet(npc, site());
          hit = this.moveCheckSite(npc, npc.moveDir);
        }
        if (hit) this.set(npc, STAY_WALK["1"]!, npc.facing);
        else this.set(npc, WALK_1, npc.moveDir);
        npc.seq = 2;
        return true;
      }
      default:
        if (this.action(npc)) npc.seq = 1;
        return false;
    }
  }

  /** ObjStayWalk1_0・ObjStayWalk_1。向きは移動タイプの基本の向き。 */
  private stayWalk(npc: Npc, type: NpcMovementType): boolean {
    if (npc.seq === 0) { this.init(npc); this.set(npc, STAY_WALK[type.table]!, npc.facing); npc.seq = 1; return true; }
    if (this.action(npc)) npc.seq = 0;
    return false;
  }

  /** ObjVanishOn0〜2。 */
  private vanish(npc: Npc): boolean {
    switch (npc.seq) {
      case 0: this.init(npc); this.set(npc, FACE, npc.facing); npc.vanish = true; npc.seq = 1; return true;
      case 1:
        if (this.action(npc)) { npc.seq = 2; return true; }
        return false;
      default: return false;
    }
  }

  /** EvObjMoveWorkInit。 */
  private init(npc: Npc): void {
    npc.running = null;
    npc.seq = 0;
  }

  /** EvObjSiteSet（向きの固定は使わない）。 */
  private siteSet(npc: Npc, site: MovementDirection): void {
    npc.facing = site;
    npc.moveDir = site;
  }

  /** CmdActionSet。命令の番号は向き +0〜+3 の 4 つ組の先頭。 */
  private set(npc: Npc, base: number, direction: MovementDirection): void {
    npc.running = { action: movementAction(base + DIR_INDEX[direction]), direction, calls: 0, moved: 0 };
  }

  /** CmdAction。命令を 1 段進め、終わったら true。 */
  private action(npc: Npc): boolean {
    const r = npc.running;
    if (!r) return true;
    const a = r.action;
    if (r.calls === 0) {
      if (a.kind === "face" || a.kind === "walk" || a.kind === "walkInPlace") npc.facing = r.direction;
      if (a.kind === "face") { npc.oldX = npc.x; npc.oldY = npc.y; }
      if (a.kind === "walk") {
        const d = MOVEMENT_DELTA[r.direction];
        npc.oldX = npc.x; npc.oldY = npc.y;
        npc.x += d.x; npc.y += d.y;
        this.updateHeight(npc);
      }
    }
    r.moved += a.pixels?.[r.calls] ?? 0;
    npc.shown = { id: a.id, frame: r.calls };
    r.calls++;
    if (r.calls < a.frames) return false;
    if (a.kind === "walk") { npc.oldX = npc.x; npc.oldY = npc.y; this.updateHeight(npc); }
    npc.running = null;
    return true;
  }

  /** EvObjHeight（`evobjmv.c:12046`）。 */
  private updateHeight(npc: Npc): void {
    const now = this.cellHeight(npc.x, npc.y), old = this.cellHeight(npc.oldX, npc.oldY);
    if (now === HOLD || old === HOLD) return;
    npc.height = now;
    if (now === FREE) return;
    npc.heightPri = now;
  }

  private cellHeight(x: number, y: number): number {
    const m = this.world.movement(x, y);
    return m === null ? FREE : m >> 2;
  }

  /** EvObjMoveChkSite。 */
  private moveCheckSite(npc: Npc, site: MovementDirection): NpcHit | null {
    const d = MOVEMENT_DELTA[site];
    return this.moveCheck(npc, npc.x + d.x, npc.y + d.y, site);
  }

  /** EvObjMoveChk（`evobjmv.c:4930`）。ビットの順が判定の順なので、いちばん下のビットが理由。 */
  private moveCheck(npc: Npc, x: number, y: number, site: MovementDirection): NpcHit | null {
    const bits = this.checkAll(npc, x, y, site, true);
    return bits & HIT_LIMIT ? "limit" : bits & HIT_ATTRIBUTE ? "attribute" : bits & HIT_HEIGHT ? "height" : bits & HIT_OBJECT ? "object" : null;
  }

  /** EvObjMoveChkAll（`evobjmv.c:4979`）。`limit` が false なら移動範囲を見ない。 */
  private checkAll(npc: Npc, x: number, y: number, site: MovementDirection, limit: boolean): number {
    let bits = 0;
    const src = npc.source;
    if (limit && npc.limitX && (x < src.x - npc.limitX || x > src.x + npc.limitX)) bits |= HIT_LIMIT;
    if (limit && npc.limitY && (y < src.y - npc.limitY || y > src.y + npc.limitY)) bits |= HIT_LIMIT;
    const movement = this.world.movement(x, y);
    if (movement === null || (movement & 3) !== 0
      || BAD_MOVE[site].includes(this.world.behavior(npc.x, npc.y))
      || BAD_MOVE[oppositeDirection(site)].includes(this.world.behavior(x, y))) bits |= HIT_ATTRIBUTE;
    if (npc.height !== FREE && movement !== null) {
      const next = movement >> 2;
      if (next !== FREE && next !== HOLD && next !== npc.height) bits |= HIT_HEIGHT;
    }
    const hits = (h: number): boolean => npc.height === FREE || h === FREE || npc.height === h;
    for (const other of this.npcs) {
      if (other === npc) continue;
      if (((other.x === x && other.y === y) || (other.oldX === x && other.oldY === y)) && hits(other.height)) bits |= HIT_OBJECT;
    }
    for (const o of this.obstacles) if (o.x === x && o.y === y && hits(o.elevation)) bits |= HIT_OBJECT;
    return bits;
  }

  /**
   * トレーナーの視界（`ev_trai.c:179` `TrainerEyeChk` と、有効な版の `trai_move_range_attr_chk`（326 行））。
   * 主人公が立つと見つかるマスを、向きごとに近い順で返す。自分のマスから主人公の手前のマスまでに、移動範囲以外の
   * 当たり（衝突・マップの外・一方通行・高さ・ほかの人物）があると見えない。主人公のマス自身も、衝突・高さで入れなければ
   * 見つからない。主人公（`step` の obstacles）は見る相手なので、遮るものに数えない。
   */
  sight(localId: number, range: number, allDirections: boolean): NpcSightRay[] {
    const npc = this.npcs.find(n => n.source.localId === localId);
    if (!npc || range <= 0) return [];
    const saved = this.obstacles;
    this.obstacles = [];
    try {
      const directions: readonly MovementDirection[] = allDirections ? ["down", "up", "left", "right"] : [npc.facing];
      return directions.map(direction => {
        const d = MOVEMENT_DELTA[direction];
        const tiles: { x: number; y: number }[] = [];
        let blocked: NpcSightRay["blocked"] = null;
        if (this.checkAll(npc, npc.x, npc.y, direction, false)) blocked = { x: npc.x, y: npc.y, hit: this.firstHit(this.checkAll(npc, npc.x, npc.y, direction, false)) };
        for (let i = 1; !blocked && i <= range; i++) {
          const x = npc.x + d.x * i, y = npc.y + d.y * i;
          const bits = this.checkAll(npc, x, y, direction, false);
          if (bits) blocked = { x, y, hit: this.firstHit(bits) };
          else tiles.push({ x, y });
        }
        return { direction, tiles, blocked };
      });
    } finally {
      this.obstacles = saved;
    }
  }

  private firstHit(bits: number): NpcHit {
    return bits & HIT_LIMIT ? "limit" : bits & HIT_ATTRIBUTE ? "attribute" : bits & HIT_HEIGHT ? "height" : "object";
  }

  /** 移動範囲（元の位置を中心に、0 を 1 に直した後の値）。範囲の無い人物は null。 */
  rangeOf(localId: number): { x0: number; y0: number; x1: number; y1: number } | null {
    const npc = this.npcs.find(n => n.source.localId === localId);
    if (!npc || (!npc.limitX && !npc.limitY)) return null;
    const s = npc.source;
    return { x0: npc.limitX ? s.x - npc.limitX : -Infinity, y0: npc.limitY ? s.y - npc.limitY : -Infinity, x1: npc.limitX ? s.x + npc.limitX : Infinity, y1: npc.limitY ? s.y + npc.limitY : Infinity };
  }

  /** pp_rand。 */
  private rand(): number {
    this.seed = (Math.imul(this.seed, 0x41c64e6d) + 0x6073) >>> 0;
    return this.seed >>> 16;
  }
}

function stillReason(type: NpcMovementType | null): NpcStillReason | null {
  if (!type) return "unknown";
  if (type.preview === "unsupported") return "unsupported";
  if (type.family === "copy") return "copy";
  if (type.family === "hide") return "hide";
  if (type.family === "still") return "still";
  return null;
}
