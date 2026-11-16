import { SpriteAnimation } from "../sprite/SpriteAnimation.js";
import type { WeatherGraphics, WeatherObjectKind } from "./WeatherGraphics.js";
import { FADE_CLOUD_MAX, FADE_THUNDER_MAX } from "./WeatherPalette.js";
import { WEATHER, isRainyWeather } from "./WeatherTypes.js";

/**
 * 天候の動き（weather.c の FieldWeatherTask と wea_*.c）を 1 フレームずつ写したもの。DOM を使わない。
 * - 座標は GBA の OAM と同じ（x・y は絵の真ん中、`scroll` の絵は ActOX・ActOY を足す）。
 * - `camera(dx, dy)` で画面が動いた量を渡す（ActOX・ActOY はその逆向き）。
 * - 乱数（pp_rand）は同じ式だが、種は呼ぶ側が決める（実機の並びとは同じにならない）。
 */

const s16 = (v: number) => (v << 16) >> 16;
const u16 = (v: number) => v & 0xffff;

/** 天候の絵 1 つ（actWork の要るところだけ）。 */
export interface WeatherActor {
  readonly kind: WeatherObjectKind;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** 真ん中から左上へのずれ（cx・cy）。 */
  cx: number;
  cy: number;
  /** 画面の動きに合わせて動くか（scr）。 */
  scroll: boolean;
  /** 隠れているか（banish）。 */
  hidden: boolean;
  /** OAM の大きさ（砂嵐の渦は 32×32 に替える）。 */
  width: number;
  height: number;
  /** BG に対する優先度（泡は作ったあとに 1 へ替える）。 */
  priority: number;
  readonly work: number[];
  readonly animation: SpriteAnimation;
  /** 今のコマ（タイルの番号）。 */
  frame: number;
  move: (actor: WeatherActor) => void;
  removed: boolean;
}

/** 描く 1 つ分。 */
export interface WeatherDraw {
  readonly kind: WeatherObjectKind;
  /** 画面の左上の位置（OAM の 9bit・8bit の折り返しの前）。 */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly frame: number;
  readonly priority: number;
}

/** 色と合成の今の値。 */
export interface WeatherScreenState {
  /** 暗くする・光る段（0〜19）。 */
  readonly evy: number;
  /** 半透明の係数（BLDALPHA）。 */
  readonly eva: number;
  readonly evb: number;
}

const RAIN_POSITIONS: readonly (readonly [number, number])[] = [
  [0, 0], [0, 160], [0, 64], [144, 224], [144, 128], [32, 32], [32, 192], [32, 96],
  [72, 128], [72, 32], [72, 192], [216, 96], [216, 0], [104, 160], [104, 64], [104, 224],
  [144, 0], [144, 160], [144, 64], [32, 224], [32, 128], [72, 32], [72, 192], [48, 96],
];
const RAIN_SPEED = [[-0x68, 0xd0], [-0xa0, 0x140]] as const;
/** 落ちるフレームとはじけるフレームの合計（RainMoveSync）。 */
const RAIN_SYNC = [[18, 7], [12, 10]] as const;
const RAIN_OBJ_MAX = 24;
const CLOUD_POSITIONS = [[0, 66], [5, 73], [10, 78]] as const;
const BUBBLE_INTERVALS = [40, 90, 60, 90, 2, 60, 40, 30] as const;
const BUBBLE_POSITIONS = [[120, 160], [376, 160], [40, 140], [296, 140], [180, 130], [436, 130], [60, 160], [436, 160], [220, 180], [476, 180], [10, 90], [266, 90], [256, 160]] as const;
const STORM_WAITS = [0, 120, 80, 160, 40] as const;
const THUNDER_TYPES = 2;
const CLOUD_CHANGE_WAIT = 20;

/** 状態ごとの関数（sub_proc_tbl の 1 行）。 */
interface WeatherProcs {
  init(): void;
  proc(): void;
  direct(): void;
  /** true の間は終わる途中。 */
  quit(): boolean;
}

export class WeatherSimulation {
  status: number = WEATHER.NONE;
  nextStatus: number = WEATHER.NONE;
  /** 色の段と合成。 */
  nowEvy = 0;
  nextEvy = 0;
  private evyWait = 0;
  private evyTimer = 0;
  private fading = false;
  eva = 0x10;
  evb = 0;
  private endEva = 0x10;
  private endEvb = 0;
  private blendCnt = 0;
  private blendTimer = 0;
  private blendWait = 0;
  private prog = 0;
  private quitProg = 0;
  private directEnd = false;
  /** 画面の動き（gSpriteCoordOffsetX/Y）。 */
  actOX = 0;
  actOY = 0;
  private seed: number;
  readonly actors: WeatherActor[] = [];
  /** 経ったフレーム数。 */
  frame = 0;
  // 雨
  private rainSpeed = 0;
  private rainDispMax = 0;
  private rainDispCnt = 0;
  private rainDispTimer = 0;
  private rainDispWait = 0;
  private rainActors: (WeatherActor | null)[] = [];
  private rainObjCnt = 0;
  // 雪
  private snowActors: WeatherActor[] = [];
  private snowMax = 0;
  private snowTimer = 0;
  private snowComebackTimer = 0;
  // 雷
  private thunderTimer = 0;
  private thunderType = 0;
  private thunderCount = 0;
  private thunderStop = false;
  // 霧・霧2・灰・砂嵐・雲・泡
  private mistTimer = 0;
  private mistScr = 0;
  private mistLine = 0;
  private mistActors: WeatherActor[] | null = null;
  private mist2: { xcnt: number; ycnt: number; xofs: number; yofs: number; xline: number; yline: number } | null = null;
  private mist2Actors: WeatherActor[] | null = null;
  private ashLine = 0;
  private ashActors: WeatherActor[] | null = null;
  private storm = { xofs: 0, yofs: 0, cnt: 8, sub: 0, xline: 0, yline: 0 };
  private stormActors: WeatherActor[] | null = null;
  private storm2Actors: WeatherActor[] | null = null;
  private cloudActors: WeatherActor[] | null = null;
  private bubbles = { active: false, add: 0, interval: 0, pos: 0 };
  /** マップの画素で、始めたときの画面の左上（雲の位置に使う）。 */
  private origin = { x: 0, y: 0 };

  constructor(private readonly graphics: WeatherGraphics, seed = 0) {
    this.seed = seed >>> 0;
  }

  /** pp_rand（×1103515245＋24691 の上 16bit）。 */
  random(): number {
    this.seed = (Math.imul(this.seed, 1103515245) + 24691) >>> 0;
    return this.seed >>> 16;
  }

  /** マップに入ったときと同じ「すぐ」の始め方（WeatherChangeDirect と direct_func）。`viewX`・`viewY` は画面の左上（マップの画素）。 */
  startDirect(weather: number, viewX = 0, viewY = 0): void {
    this.clearActors();
    this.origin = { x: viewX, y: viewY };
    this.actOX = 0; this.actOY = 0;
    this.status = weather; this.nextStatus = weather;
    this.eva = 0x10; this.evb = 0; this.endEva = 0x10; this.endEvb = 0;
    this.nowEvy = 0; this.nextEvy = 0;
    this.procs(weather).direct();
    // フィールドに入るフェードの終わり（fade_field_in）: 曇りの仲間は段 3、ほかは next_evy。
    this.nowEvy = this.nextEvy;
    this.fading = false;
  }

  /** setweather ＋ doweather（WeatherChangeSmooth）: 今の天候を終えてから次を始める。 */
  changeSmooth(weather: number): void {
    if (this.nextStatus !== weather && this.status === weather) this.procs(weather).init();
    this.nextStatus = weather;
    this.quitProg = 0;
  }

  /** 画面の動き（画素。右・下へ動いたら正）。 */
  camera(dx: number, dy: number): void {
    this.actOX = s16(this.actOX - dx);
    this.actOY = s16(this.actOY - dy);
  }

  /** 1 フレーム進める（天候のタスク → 絵ごとの動き → アニメ）。 */
  step(): void {
    this.frame++;
    if (this.status !== this.nextStatus) {
      if (!this.procs(this.status).quit()) {
        this.procs(this.nextStatus).init();
        this.evyTimer = 0;
        this.fading = true;
        this.status = this.nextStatus;
      }
    } else this.procs(this.status).proc();
    if (this.fading) this.fadeEffect();
    for (const actor of [...this.actors]) {
      if (actor.removed) continue;
      actor.move(actor);
      if (actor.removed) continue;
      const frame = actor.animation.tick();
      if (frame) actor.frame = frame.index;
    }
    for (let i = this.actors.length - 1; i >= 0; i--) if (this.actors[i]!.removed) this.actors.splice(i, 1);
  }

  /** 色と合成の今の値。 */
  get screen(): WeatherScreenState { return { evy: Math.max(0, this.nowEvy), eva: this.eva, evb: this.evb }; }

  /** 描くもの（作った順。先に作ったものが手前）。 */
  draws(): WeatherDraw[] {
    const out: WeatherDraw[] = [];
    for (const a of this.actors) {
      if (a.hidden || a.removed) continue;
      const x = a.x + a.dx + a.cx + (a.scroll ? this.actOX : 0);
      const y = a.y + a.dy + a.cy + (a.scroll ? this.actOY : 0);
      out.push({ kind: a.kind, x, y, width: a.width, height: a.height, frame: a.frame, priority: a.priority });
    }
    return out;
  }

  // ---- 共通 ----

  private fadeEffect(): void {
    if (this.nowEvy === this.nextEvy) { this.fading = false; return; }
    if (++this.evyTimer >= this.evyWait) {
      this.evyTimer = 0;
      this.nowEvy += this.nowEvy < this.nextEvy ? 1 : -1;
    }
  }

  /** WeatherFadeNow（フェードの途中は変えない）。 */
  private fadeNow(evy: number): void { if (!this.fading) this.nowEvy = evy; }

  /** WeatherFadeReq。 */
  private fadeRequest(begin: number, end: number, wait: number): void {
    if (this.fading) return;
    this.fading = true;
    this.nowEvy = begin; this.nextEvy = end; this.evyTimer = 0; this.evyWait = wait;
  }

  private blendInit(eva: number, evb: number): void { this.eva = eva; this.evb = evb; this.endEva = eva; this.endEvb = evb; }
  private blendRequest(eva: number, evb: number, wait: number): void {
    this.endEva = eva; this.endEvb = evb; this.blendWait = wait; this.blendTimer = 0; this.blendCnt = 0;
  }
  /** WeatherBlendProg（true で終わり）。 */
  private blendProg(): boolean {
    if (this.eva === this.endEva && this.evb === this.endEvb) return true;
    if (++this.blendTimer > this.blendWait) {
      this.blendTimer = 0;
      this.blendCnt++;
      if (this.blendCnt & 1) { if (this.eva < this.endEva) this.eva++; else if (this.eva > this.endEva) this.eva--; }
      else if (this.evb < this.endEvb) this.evb++; else if (this.evb > this.endEvb) this.evb--;
    }
    return this.eva === this.endEva && this.evb === this.endEvb;
  }

  private addActor(kind: WeatherObjectKind, x: number, y: number, move: (a: WeatherActor) => void): WeatherActor | null {
    const g = this.graphics.object(kind);
    if (!g) return null;
    const actor: WeatherActor = {
      kind, x: s16(x), y: s16(y), dx: 0, dy: 0, cx: -(g.width >> 1), cy: -(g.height >> 1), scroll: false, hidden: false,
      width: g.width, height: g.height, priority: g.priority, work: [0, 0, 0, 0, 0, 0, 0, 0], animation: new SpriteAnimation(g.animation, 0), frame: 0, move, removed: false,
    };
    this.actors.push(actor);
    return actor;
  }
  private removeActor(actor: WeatherActor | null | undefined): void { if (actor) actor.removed = true; }
  private clearActors(): void {
    for (const a of this.actors) a.removed = true;
    this.actors.length = 0;
    this.rainActors = []; this.rainObjCnt = 0; this.rainDispCnt = 0;
    this.snowActors = []; this.mistActors = null; this.mist2Actors = null; this.ashActors = null;
    this.stormActors = null; this.storm2Actors = null; this.cloudActors = null; this.bubbles.active = false;
  }
  private changeAnimation(actor: WeatherActor, animation: number): void { actor.animation.restart(animation); }

  private readonly table: Record<number, WeatherProcs> = {};
  private procs(weather: number): WeatherProcs {
    let p = this.table[weather];
    if (!p) { p = this.makeProcs(weather); this.table[weather] = p; }
    return p;
  }

  private makeProcs(weather: number): WeatherProcs {
    const off: WeatherProcs = { init: () => { this.nextEvy = 0; this.evyWait = 0; }, proc: () => {}, direct: () => { this.nextEvy = 0; this.evyWait = 0; }, quit: () => false };
    const loop = (init: () => void, proc: () => void) => () => { init(); for (let i = 0; i < 100000 && !this.directEnd; i++) proc(); };
    switch (weather) {
      case WEATHER.CLOUDS: {
        const init = () => { this.nextEvy = 0; this.evyWait = CLOUD_CHANGE_WAIT; this.directEnd = false; this.prog = 0; if (!this.cloudActors) this.blendInit(0, 16); };
        const proc = () => {
          if (this.prog === 0) { this.addClouds(); this.prog++; }
          else if (this.prog === 1) { this.blendRequest(12, 8, 1); this.prog++; }
          else if (this.prog === 2 && this.blendProg()) { this.directEnd = true; this.prog++; }
        };
        return { init, proc, direct: loop(init, proc), quit: () => {
          if (this.quitProg === 0) { this.blendRequest(0, 16, 1); this.quitProg++; return true; }
          if (this.quitProg === 1) { if (this.blendProg()) { for (const a of this.cloudActors ?? []) this.removeActor(a); this.cloudActors = null; this.quitProg++; } return true; }
          return false;
        } };
      }
      case WEATHER.SUNNY: return { ...off, init: () => { this.nextEvy = 0; this.evyWait = CLOUD_CHANGE_WAIT; }, direct: () => { this.nextEvy = 0; this.evyWait = CLOUD_CHANGE_WAIT; } };
      case WEATHER.RAIN:
      case WEATHER.THUNDER:
      case WEATHER.HEAVY_RAIN: {
        const thunder = weather !== WEATHER.RAIN;
        const init = () => {
          this.prog = 0; this.directEnd = false; this.rainDispTimer = 0;
          this.rainDispWait = weather === WEATHER.RAIN ? 8 : 4;
          this.rainSpeed = weather === WEATHER.HEAVY_RAIN ? 1 : 0;
          this.rainDispMax = weather === WEATHER.RAIN ? 10 : weather === WEATHER.THUNDER ? 16 : RAIN_OBJ_MAX;
          this.nextEvy = FADE_CLOUD_MAX; this.evyWait = CLOUD_CHANGE_WAIT;
        };
        const proc = thunder ? () => this.thunderProc() : () => {
          if (this.prog === 0) this.prog++;
          else if (this.prog === 1) { if (!this.rainActorAdd()) this.prog++; }
          else if (this.prog === 2) { if (!this.adjustRain()) { this.directEnd = true; this.prog++; } }
        };
        const quit = thunder ? () => this.quitThunder() : () => {
          if (this.quitProg === 0) {
            if (isRainyWeather(this.nextStatus)) { this.quitProg = 0xff; return false; }
            this.rainDispMax = 0; this.quitProg++;
          }
          if (this.quitProg === 1) { if (!this.adjustRain()) { this.deleteRain(); this.quitProg++; return false; } return true; }
          return false;
        };
        return { init, proc, direct: loop(init, proc), quit };
      }
      case WEATHER.SNOW: {
        const init = () => { this.prog = 0; this.directEnd = false; this.nextEvy = FADE_CLOUD_MAX; this.evyWait = CLOUD_CHANGE_WAIT; this.snowMax = 16; this.snowTimer = 0; };
        const proc = () => { if (this.prog === 0 && !this.adjustSnow()) { this.directEnd = true; this.prog++; } };
        return {
          init, proc,
          direct: () => {
            init();
            for (let i = 0; i < 100000 && !this.directEnd; i++) { proc(); for (const a of [...this.snowActors]) this.snowMove(a); }
          },
          quit: () => {
            if (this.quitProg === 0) { this.snowMax = 0; this.snowTimer = 0; this.quitProg++; }
            if (this.quitProg === 1) { if (!this.adjustSnow()) { this.quitProg++; return false; } return true; }
            return false;
          },
        };
      }
      case WEATHER.FOG:
      case WEATHER.UNDERWATER:
      case WEATHER.BUBBLES: {
        const init = () => {
          this.prog = 0; this.directEnd = false; this.nextEvy = 0; this.evyWait = CLOUD_CHANGE_WAIT;
          if (!this.mistActors) { this.mistTimer = 0; this.mistScr = 0; this.mistLine = 0; this.blendInit(0, 16); }
          if (weather === WEATHER.BUBBLES && !this.bubbles.active) this.bubbles = { active: true, add: BUBBLE_INTERVALS[0], interval: 0, pos: 0 };
        };
        const mistProc = () => {
          this.mistLine = u16(this.actOX - this.mistScr) & 255;
          if (++this.mistTimer > 3) { this.mistTimer = 0; this.mistScr++; }
          if (this.prog === 0) {
            this.addMist();
            if (this.status === WEATHER.FOG) this.blendRequest(12, 8, 3); else this.blendRequest(4, 16, 0);
            this.prog++;
          } else if (this.prog === 1 && this.blendProg()) { this.directEnd = true; this.prog++; }
        };
        const proc = weather === WEATHER.BUBBLES ? () => { mistProc(); this.bubbleProc(); } : mistProc;
        const quitMist = () => {
          this.mistLine = u16(this.actOX - this.mistScr) & 255;
          if (++this.mistTimer > 3) { this.mistTimer = 0; this.mistScr++; }
          if (this.quitProg === 0) { this.blendRequest(0, 16, 3); this.quitProg++; return true; }
          if (this.quitProg === 1) { if (this.blendProg()) this.quitProg++; return true; }
          if (this.quitProg === 2) { for (const a of this.mistActors ?? []) this.removeActor(a); this.mistActors = null; this.quitProg++; return true; }
          return false;
        };
        return {
          init, proc, direct: loop(init, weather === WEATHER.BUBBLES ? proc : mistProc),
          quit: weather === WEATHER.BUBBLES ? () => {
            if (!quitMist()) { for (const a of this.actors) if (a.kind === "bubble") this.removeActor(a); this.bubbles.active = false; return false; }
            return true;
          } : quitMist,
        };
      }
      case WEATHER.ASH:
        if (this.graphics.ashIsSandstorm) return this.makeProcs(WEATHER.SANDSTORM);
        return this.ashProcs();
      case WEATHER.SANDSTORM: return this.stormProcs();
      case WEATHER.FOG_DIAGONAL: return this.mist2Procs();
      case WEATHER.SHADE: {
        const init = () => { this.prog = 0; this.nextEvy = FADE_CLOUD_MAX; this.evyWait = CLOUD_CHANGE_WAIT; };
        return { init, proc: () => {}, direct: init, quit: () => false };
      }
      case WEATHER.DROUGHT: {
        // 素の FR は色を変えない（weather_fade の負の段は何もしない）。表を作る関数が空のため prog 2 から先へ進まない。
        const init = () => { this.prog = 0; this.directEnd = false; this.nextEvy = 0; this.evyWait = 0; };
        return { init, proc: () => {}, direct: init, quit: () => false };
      }
      default: return off;
    }
  }

  // ---- 雲（wea_shine.c）----
  private addClouds(): void {
    if (this.cloudActors) return;
    this.cloudActors = [];
    for (const [tx, ty] of CLOUD_POSITIONS) {
      const a = this.addActor("cloud", tx * 16 - this.origin.x + this.actOX, ty * 16 - this.origin.y + this.actOY, (actor) => {
        actor.work[0] = (actor.work[0]! + 1) & 1;
        if (actor.work[0]) actor.x = s16(actor.x - 1);
      });
      if (a) { a.scroll = true; this.cloudActors.push(a); }
    }
  }

  // ---- 雨（wea_rain.c）----
  private rainSetNextPos(a: WeatherActor): void {
    if (a.work[1] === 0) a.work[1] = 361;
    const seed = (Math.imul(a.work[1]!, 1103515245) + 12345) >>> 0;
    a.work[1] = s16(((Math.floor(seed / 65536) % 32768) % 600));
    const sync = RAIN_SYNC[this.rainSpeed]![0];
    const [ax, ay] = RAIN_SPEED[this.rainSpeed]!;
    a.work[2] = s16(((a.work[1]! % 30) * 8) << 4);
    a.work[3] = s16((Math.trunc(a.work[1]! / 30) * 8) << 4);
    a.work[2] = s16(a.work[2]! - ax * sync);
    a.work[3] = s16(a.work[3]! - ay * sync);
    this.changeAnimation(a, 0);
    a.work[4] = 0;
    a.scroll = false;
    a.work[0] = sync;
  }
  private rainMove = (a: WeatherActor): void => {
    if (a.work[4] === 0) {
      const [ax, ay] = RAIN_SPEED[this.rainSpeed]!;
      a.work[2] = s16(a.work[2]! + ax); a.work[3] = s16(a.work[3]! + ay);
      a.x = a.work[2]! >> 4; a.y = a.work[3]! >> 4;
      if (a.work[5]) a.hidden = a.x < -8 || a.x > 248 || a.y < -16 || a.y > 176;
      else a.hidden = true;
      a.work[0] = s16(a.work[0]! - 1);
      if (a.work[0] === 0) {
        this.changeAnimation(a, this.rainSpeed + 1);
        a.work[4] = 1;
        a.x = s16(a.x - this.actOX); a.y = s16(a.y - this.actOY);
        a.scroll = true;
      }
    } else if (a.animation.finished) {
      a.hidden = true;
      this.rainSetNextPos(a);
    }
  };
  private rainCountWait = (a: WeatherActor): void => {
    if (a.work[0] === 0) { this.rainSetNextPos(a); a.move = this.rainMove; }
    else a.work[0] = s16(a.work[0]! - 1);
  };
  private rainMoveLoop(a: WeatherActor, count: number): void {
    const [moveWait, animWait] = RAIN_SYNC[this.rainSpeed]!;
    let loops = Math.floor(count / (moveWait + animWait));
    let rem = count % (moveWait + animWait);
    while (loops--) this.rainSetNextPos(a);
    if (rem < moveWait) { while (rem--) this.rainMove(a); a.work[6] = 0; }
    else { a.work[0] = rem - moveWait; a.hidden = true; a.work[6] = 1; }
  }
  /** RainActorAdd（false で 24 個そろった）。 */
  private rainActorAdd(): boolean {
    if (this.rainObjCnt === RAIN_OBJ_MAX) return false;
    const c = this.rainObjCnt;
    const [px, py] = RAIN_POSITIONS[c]!;
    const a = this.addActor("rain", px, py, this.rainMove);
    if (a) {
      a.work[5] = 0;
      a.work[1] = (c * 145) % 600;
      this.rainSetNextPos(a);
      this.rainMoveLoop(a, c * 9);
      a.hidden = true;
      this.rainActors[c] = a;
    } else this.rainActors[c] = null;
    if (++this.rainObjCnt === RAIN_OBJ_MAX) {
      for (const r of this.rainActors) if (r) r.move = r.work[6] === 0 ? this.rainMove : this.rainCountWait;
      return false;
    }
    return true;
  }
  /** AdjustRainActor（false で数がそろった）。 */
  private adjustRain(): boolean {
    if (this.rainDispCnt === this.rainDispMax) return false;
    if (++this.rainDispTimer > this.rainDispWait) {
      this.rainDispTimer = 0;
      if (this.rainDispCnt < this.rainDispMax) { const a = this.rainActors[this.rainDispCnt++]; if (a) a.work[5] = 1; }
      else { this.rainDispCnt--; const a = this.rainActors[this.rainDispCnt]; if (a) { a.work[5] = 0; a.hidden = true; } }
    }
    return true;
  }
  private deleteRain(): void {
    for (const a of this.rainActors) this.removeActor(a);
    this.rainActors = []; this.rainObjCnt = 0;
  }

  // ---- 雷（wea_thunder.c）----
  private thunderProc(): void {
    switch (this.prog) {
      case 0: this.prog++; break;
      case 1: if (!this.rainActorAdd()) this.prog++; break;
      case 2: if (!this.adjustRain()) { this.directEnd = true; this.prog++; } break;
      case 3: if (!this.fading) this.prog = 6; break;
      case 4:
        this.thunderStop = true; this.thunderTimer = 360 + (this.random() % 360); this.prog++;
        if (--this.thunderTimer === 0) this.prog++;
        break;
      case 5: if (--this.thunderTimer === 0) this.prog++; break;
      case 6: this.thunderStop = true; this.thunderType = this.random() % THUNDER_TYPES; this.prog++; break;
      case 7:
        this.thunderCount = 1 + (this.random() & 1);
        this.fadeNow(FADE_THUNDER_MAX); this.thunderTimer = 6 + (this.random() % 3); this.prog = 9;
        break;
      case 8: this.fadeNow(FADE_THUNDER_MAX); this.thunderTimer = 6 + (this.random() % 3); this.prog++; break;
      case 9:
        if (--this.thunderTimer === 0) {
          this.fadeNow(FADE_CLOUD_MAX); this.thunderStop = true;
          if (--this.thunderCount) { this.thunderTimer = 60 + (this.random() % 16); this.prog = 10; }
          else this.prog = this.thunderType === 0 ? 4 : 11;
        }
        break;
      case 10: if (--this.thunderTimer === 0) this.prog = 8; break;
      case 11: this.thunderTimer = 60 + (this.random() % 16); this.prog++; break;
      case 12: if (--this.thunderTimer === 0) { this.fadeNow(FADE_THUNDER_MAX); this.thunderTimer = 30 + (this.random() & 15); this.prog++; } break;
      case 13: if (--this.thunderTimer === 0) { this.fadeRequest(FADE_THUNDER_MAX, FADE_CLOUD_MAX, 5); this.prog++; } break;
      case 14: if (!this.fading) { this.thunderStop = true; this.prog = 4; } break;
    }
  }
  private quitThunder(): boolean {
    if (this.quitProg === 0) { this.thunderStop = false; this.quitProg = 1; }
    switch (this.quitProg) {
      case 1:
        this.thunderProc();
        if (this.thunderStop) {
          if (isRainyWeather(this.nextStatus)) return false;
          this.rainDispMax = 0; this.quitProg++;
        }
        return true;
      case 2:
        if (!this.adjustRain()) { this.deleteRain(); this.quitProg++; return false; }
        return true;
      default: return false;
    }
  }

  // ---- 雪（wea_snow.c）----
  private adjustSnow(): boolean {
    if (this.snowActors.length === this.snowMax) return false;
    if (++this.snowTimer > 36) {
      this.snowTimer = 0;
      if (this.snowActors.length < this.snowMax) this.addSnow();
      else this.removeActor(this.snowActors.pop());
    }
    return this.snowActors.length !== this.snowMax;
  }
  private addSnow(): void {
    const a = this.addActor("snow", 0, 0, this.snowMove);
    if (!a) return;
    a.work[4] = this.snowActors.length;
    this.resetSnow(a);
    a.scroll = true;
    this.snowActors.push(a);
  }
  private resetSnow(a: WeatherActor): void {
    const x = ((a.work[4]! * 5) & 7) * 30 + (this.random() % 30);
    a.y = s16(-3 - (this.actOY + a.cy));
    a.x = s16(x - (this.actOX + a.cx));
    a.work[0] = s16(a.y * 128);
    a.dx = 0;
    const v = this.random();
    a.work[1] = 64 + 5 * (v & 3);
    a.work[7] = a.work[1]!;
    this.changeAnimation(a, (v & 1) === 0 ? 1 : 0);
    a.work[3] = 0;
    a.work[2] = (v & 3) === 0 ? 2 : 1;
    a.work[6] = 210 + (v & 31);
    a.work[5] = 0;
  }
  private snowWait = (a: WeatherActor): void => {
    // ROM の FR 日本語版では snow_comeback_timer を増やす処理が無く、ここから戻らない（調べた結果のとおり）。
    if (this.snowComebackTimer > 18) {
      a.hidden = false; a.move = this.snowMove;
      a.y = s16(250 - (this.actOY + a.cy)); a.work[0] = s16(a.y * 128);
      this.snowComebackTimer = 0;
    }
  };
  private snowMove = (a: WeatherActor): void => {
    a.work[0] = s16(a.work[0]! + a.work[1]!);
    a.y = a.work[0]! >> 7;
    a.work[3] = (a.work[3]! + a.work[2]!) & 0xff;
    a.dx = Math.trunc(this.graphics.sine[a.work[3]!]! / 64);
    let x = (a.x + a.cx + this.actOX) & 0x1ff;
    if (x & 0x100) x = s16(x | 0xff00);
    if (x < -3) a.x = s16(242 - (this.actOX + a.cx));
    else if (x > 242) a.x = s16(-3 - (this.actOX + a.cx));
    const y = (a.y + a.cy + this.actOY) & 0xff;
    if (y > 163 && y < 171) {
      a.y = s16(250 - (this.actOY + a.cy)); a.work[0] = s16(a.y * 128); a.work[5] = 0; a.work[6] = 220;
    } else if (y > 242 && y < 250) {
      a.y = 163; a.work[0] = s16(a.y * 128); a.work[5] = 0; a.work[6] = 220; a.hidden = true; a.move = this.snowWait;
    }
    a.work[5] = s16(a.work[5]! + 1);
    if (a.work[5] === a.work[6]) {
      this.resetSnow(a);
      a.y = 250; a.hidden = true; a.move = this.snowWait;
    }
  };

  // ---- 霧（wea_mist.c）----
  private addMist(): void {
    if (this.mistActors) return;
    this.mistActors = [];
    for (let i = 0; i < 20; i++) {
      const a = this.addActor("fog", 32 + (i % 5) * 64, 32 + Math.floor(i / 5) * 64, (actor) => {
        actor.dy = this.actOY & 0xff;
        actor.x = s16(this.mistLine + 32 + actor.work[0]! * 64);
        if (actor.x > 271) actor.x = s16(((this.mistLine + 480) - (4 - actor.work[0]!) * 64) & 511);
      });
      if (a) { a.work[0] = i % 5; this.mistActors.push(a); }
    }
  }
  private bubbleProc(): void {
    const b = this.bubbles;
    if (++b.add > BUBBLE_INTERVALS[b.interval]!) {
      b.add = 0;
      if (++b.interval >= BUBBLE_INTERVALS.length) b.interval = 0;
      const [x, y] = BUBBLE_POSITIONS[b.pos]!;
      const a = this.addActor("bubble", x, y - this.actOY, (actor) => {
        actor.work[0] = actor.work[0]! + 2;
        if (actor.work[0]! > 8) {
          actor.work[0] = 0;
          if (actor.work[1] === 0) { if (++actor.dx >= 5) actor.work[1] = 1; }
          else if (--actor.dx <= 0) actor.work[1] = 0;
        }
        actor.y = s16(actor.y - 3);
        if (++actor.work[2]! >= 120) this.removeActor(actor);
      });
      if (a) { a.scroll = true; a.priority = 1; }
      if (++b.pos >= BUBBLE_POSITIONS.length) b.pos = 0;
    }
  }

  // ---- 火山灰（wea_ash.c）----
  private ashProcs(): WeatherProcs {
    const init = () => {
      this.prog = 0; this.directEnd = false; this.nextEvy = 0; this.evyWait = CLOUD_CHANGE_WAIT;
      if (!this.ashActors) this.blendInit(0, 16);
    };
    const proc = () => {
      this.ashLine = this.actOX & 511;
      while (this.ashLine > 239) this.ashLine -= 240;
      if (this.prog === 0) this.prog++;
      else if (this.prog === 1) {
        if (!this.ashActors) {
          this.ashActors = [];
          for (let i = 0; i < 20; i++) {
            const a = this.addActor("ash", 0, 0, (actor) => {
              if (++actor.work[1]! > 5) { actor.work[1] = 0; actor.work[0] = s16(actor.work[0]! + 1); }
              actor.y = s16(this.actOY + actor.work[0]!);
              actor.x = s16(this.ashLine + 32 + actor.work[2]! * 64);
              if (actor.x > 271) actor.x = s16(((this.ashLine + 480) - (4 - actor.work[2]!) * 64) & 511);
            });
            if (a) { a.work[1] = 0; a.work[2] = i % 5; a.work[3] = Math.floor(i / 5); a.work[0] = 32 + a.work[3]! * 64; this.ashActors.push(a); }
          }
        }
        this.blendRequest(16, 0, 1); this.prog++;
      } else if (this.prog === 2) { if (this.blendProg()) { this.directEnd = true; this.prog++; } }
      else this.blendProg();
    };
    return {
      init, proc, direct: () => { init(); for (let i = 0; i < 100000 && !this.directEnd; i++) proc(); },
      quit: () => {
        if (this.quitProg === 0) { this.blendRequest(0, 16, 1); this.quitProg++; return true; }
        if (this.quitProg === 1) { if (this.blendProg()) { for (const a of this.ashActors ?? []) this.removeActor(a); this.ashActors = null; this.quitProg++; } return true; }
        if (this.quitProg === 2) { this.quitProg++; return false; }
        return false;
      },
    };
  }

  // ---- 霧2（wea_mist2.c）----
  private mist2Procs(): WeatherProcs {
    const line = () => {
      const m = this.mist2!;
      if (++m.xcnt > 2) { m.xofs++; m.xcnt = 0; }
      if (++m.ycnt > 4) { m.yofs++; m.ycnt = 0; }
      m.xline = u16(this.actOX - m.xofs) & 255;
      m.yline = u16(this.actOY + m.yofs);
    };
    const init = () => {
      this.prog = 0; this.directEnd = false; this.nextEvy = 0; this.evyWait = CLOUD_CHANGE_WAIT;
      this.mistTimer = 0; this.mistScr = 1;
      if (!this.mist2Actors) { this.mist2 = { xcnt: 0, ycnt: 0, xofs: 0, yofs: 0, xline: 0, yline: 0 }; this.blendInit(0, 16); }
    };
    const proc = () => {
      line();
      if (this.prog === 0) {
        if (!this.mist2Actors) {
          this.mist2Actors = [];
          for (let i = 0; i < 20; i++) {
            const a = this.addActor("fogDiagonal", 0, Math.floor(i / 5) * 64, (actor) => {
              const m = this.mist2!;
              actor.dy = s16(m.yline);
              actor.x = s16(m.xline + 32 + actor.work[0]! * 64);
              if (actor.x > 271) actor.x = s16(((m.xline + 480) - (4 - actor.work[0]!) * 64) & 511);
            });
            if (a) { a.work[0] = i % 5; a.work[1] = Math.floor(i / 5); this.mist2Actors.push(a); }
          }
        }
        this.prog++;
      } else if (this.prog === 1) { this.blendRequest(12, 8, 8); this.prog++; }
      else if (this.prog === 2 && this.blendProg()) { this.directEnd = true; this.prog++; }
    };
    return {
      init, proc, direct: () => { init(); for (let i = 0; i < 100000 && !this.directEnd; i++) proc(); },
      quit: () => {
        line();
        if (this.quitProg === 0) { this.blendRequest(0, 16, 1); this.quitProg++; return true; }
        if (this.quitProg === 1) { if (this.blendProg()) this.quitProg++; return true; }
        if (this.quitProg === 2) { for (const a of this.mist2Actors ?? []) this.removeActor(a); this.mist2Actors = null; this.quitProg++; return true; }
        return false;
      },
    };
  }

  // ---- 砂嵐（wea_storm.c）----
  private stormProcs(): WeatherProcs {
    const st = this.storm;
    const sin = this.graphics.sine;
    const inc = () => { if (st.sub++ > 4) { st.cnt++; st.sub = 0; } };
    const line = () => {
      st.xofs = (st.xofs - sin[st.cnt]! * 4) >>> 0;
      st.yofs = (st.yofs - sin[st.cnt]!) >>> 0;
      st.xline = u16(this.actOX + (st.xofs >>> 8)) & 255;
      st.yline = u16(this.actOY + (st.yofs >>> 8));
    };
    const init = () => {
      this.prog = 0; this.directEnd = false; this.nextEvy = 0; this.evyWait = CLOUD_CHANGE_WAIT;
      if (!this.stormActors) { st.xofs = 0; st.yofs = 0; st.cnt = 8; st.sub = 0; this.blendInit(0, 16); }
    };
    const add = () => {
      if (!this.stormActors) {
        this.stormActors = [];
        for (let i = 0; i < 20; i++) {
          const a = this.addActor("sandstorm", 0, Math.floor(i / 5) * 64, (actor) => {
            actor.dy = s16(st.yline);
            actor.x = s16(st.xline + 32 + actor.work[0]! * 64);
            if (actor.x > 271) actor.x = s16(((st.xline + 480) - (4 - actor.work[0]!) * 64) & 511);
          });
          if (a) { a.work[0] = i % 5; a.work[1] = Math.floor(i / 5); this.stormActors.push(a); }
        }
      }
      if (!this.storm2Actors) {
        this.storm2Actors = [];
        for (let i = 0; i < 5; i++) {
          const swirl = (actor: WeatherActor) => {
            actor.y = s16(actor.y - 1);
            if (actor.y < -48) { actor.y = 208; actor.work[0] = 4; }
            actor.dx = s16((actor.work[0]! * sin[actor.work[1]!]!) >> 8);
            actor.dy = s16((actor.work[0]! * sin[actor.work[1]! + 64]!) >> 8);
            actor.work[1] = (actor.work[1]! + 10) & 0xff;
            if (++actor.work[2]! > 8) { actor.work[2] = 0; actor.work[0] = actor.work[0]! + 1; }
          };
          const a = this.addActor("sandstorm", 24 + i * 48, 208, (actor) => { if (!(actor.work[3]!--)) actor.move = swirl; });
          if (a) {
            a.width = 32; a.height = 32; a.cx = -16; a.cy = -16;
            a.work[1] = i * 51; a.work[0] = 8; a.work[2] = 0; a.work[4] = 208 * 127; a.work[3] = STORM_WAITS[i]!;
            this.changeAnimation(a, 1);
            this.storm2Actors.push(a);
          }
        }
      }
    };
    const proc = () => {
      line(); inc();
      if (st.cnt >= 96) st.cnt = 32;
      if (this.prog === 0) { add(); this.prog++; }
      else if (this.prog === 1) { this.blendRequest(16, 0, 0); this.prog++; }
      else if (this.prog === 2 && this.blendProg()) { this.directEnd = true; this.prog++; }
    };
    return {
      init, proc, direct: () => { init(); for (let i = 0; i < 100000 && !this.directEnd; i++) proc(); },
      quit: () => {
        line(); inc();
        if (this.quitProg === 0) { this.blendRequest(0, 16, 0); this.quitProg++; return true; }
        if (this.quitProg === 1) { if (this.blendProg()) this.quitProg++; return true; }
        if (this.quitProg === 2) {
          for (const a of [...(this.stormActors ?? []), ...(this.storm2Actors ?? [])]) this.removeActor(a);
          this.stormActors = null; this.storm2Actors = null; this.quitProg++; return true;
        }
        return false;
      },
    };
  }
}
