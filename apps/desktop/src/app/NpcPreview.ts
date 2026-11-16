import { ActorAnimator, actorImagePosition, NpcSimulation, type NpcObstacle, type NpcSource, type NpcStatus, type NpcWorld, type PlaybackActorState } from "@zigzagumap/core";
import type { EditorState } from "./EditorState";
import type { ClockSubscription, GameClock } from "./GameClock";
import type { PreviewPlayer } from "./PreviewPlayer";
import type { AidTab } from "./viewAids";
import type { MapView } from "../ui/map/MapView";
import { renderActorScene } from "./ActorScene";
import { npcSourcesOf, npcWorldOf } from "./npcWorld";
import { jaNpcMotion as t } from "../i18n/ja.npcMotion";

/** 自動操作に返す状態。 */
export interface NpcPreviewState {
  readonly enabled: boolean;
  readonly frame: number;
  readonly seed: number;
  /** 動きを止めている相手（`hold`）。 */
  readonly holders: readonly string[];
  readonly clock: GameClock["state"];
  readonly actors: readonly (NpcStatus & { readonly pixelX: number; readonly pixelY: number; readonly movementId: number | null; readonly visible: boolean })[];
  /** 読めなかった画像の数。 */
  readonly missing: number;
  /** 時計から進めた回数と、その計算・描画にかかった時間の合計（ms）。 */
  readonly cost: { readonly ticks: number; readonly ms: number };
}

interface Rect { x: number; y: number; width: number; height: number }

/** 自動操作で一度に進められるフレームの上限。 */
const MAX_ADVANCE = 60 * 60 * 10;
/** マップのタブが見えていないときの止め。 */
const HIDDEN = "hiddenTab";

/**
 * 人物の移動タイプの再生（#471）。表示中のマップの人物を `NpcSimulation` で動かし、マップの画像の上の人物ごとの透明な
 * Canvas に、人物と人物の上に来る前景だけを描く（変わった人物だけ描き直す）。マップの元データは変えない。
 * 止めると Canvas・時計・画像を捨てる。
 */
export class NpcPreview {
  private sim: NpcSimulation | null = null;
  private world: NpcWorld | null = null;
  private subscription: ClockSubscription | null = null;
  private hiddenRelease: (() => void) | null = null;
  private animators = new Map<number, ActorAnimator>();
  private actorsValue: PlaybackActorState[] = [];
  private drawn = new Map<number, { rect: Rect | null; key: string }>();
  /** 人物の Canvas を入れる層（マップの画像の上、重ね描きの下）。 */
  private readonly layer = document.createElement("div");
  private readonly canvases = new Map<number, HTMLCanvasElement>();
  private host: MapView | null = null;
  private signature = "";
  private seed = 0;
  private missingCount = 0;
  private cost = { ticks: 0, ms: 0 };

  constructor(private readonly state: EditorState, private readonly views: Readonly<Record<AidTab, MapView>>, private readonly player: PreviewPlayer, private readonly clock: GameClock) {
    this.layer.className = "npc-layer";
    for (const topic of ["session", "map"] as const) state.on(topic, () => this.stop());
    state.on("cells", () => this.onCells());
    for (const topic of ["tab", "view", "tiles"] as const) state.on(topic, () => { if (this.enabled) this.attach(); });
    for (const view of Object.values(views)) view.wakeListeners.push(() => { if (this.enabled && view === this.host) this.redrawAll(); });
  }

  /** 人物の位置か向きが変わったときに呼ぶ（移動範囲と視界の表示 #472 が使う）。 */
  onChange: (() => void) | null = null;

  get enabled(): boolean { return this.sim !== null; }
  /** 今の計算（止まっていれば null）。 */
  get simulation(): NpcSimulation | null { return this.sim; }
  /** 今のフレームの人物（仮の主人公の枠と共用）。 */
  get actors(): readonly PlaybackActorState[] { return this.actorsValue; }

  start(seed: number): void {
    const map = this.state.map, session = this.state.session;
    if (!map || !session) return;
    this.stop(true);
    this.seed = seed >>> 0;
    const world = npcWorldOf(map);
    const sources = this.sources();
    this.signature = JSON.stringify(sources);
    this.world = world;
    this.sim = new NpcSimulation(world, sources, this.seed);
    this.animators.clear();
    this.cost = { ticks: 0, ms: 0 };
    this.collect();
    this.subscription = this.clock.subscribe("npc", frames => this.advance(frames));
    this.state.movingPersons = true;
    this.player.setNpcActors(() => this.actorsValue);
    this.attach();
    const still = this.sim.status().filter(s => s.reason !== null).length;
    this.state.setStatus(t.started(sources.length - still, still));
    this.onChange?.();
    this.state.emit("view");
  }

  stop(quiet = false): void {
    if (!this.sim) return;
    this.sim = null; this.world = null;
    this.subscription?.dispose(); this.subscription = null;
    this.hiddenRelease = null;
    this.animators.clear(); this.actorsValue = []; this.drawn.clear(); this.missingCount = 0;
    this.layer.remove(); this.host = null;
    for (const canvas of this.canvases.values()) { canvas.width = 0; canvas.height = 0; canvas.remove(); }
    this.canvases.clear();
    this.state.movingPersons = false;
    this.player.setNpcActors(null);
    if (!quiet) this.state.emit("view");
    this.onChange?.();
  }

  /** owner の名前で止める。 */
  hold(owner: string): () => void {
    return this.subscription?.hold(owner) ?? (() => undefined);
  }

  /** frames だけ進めて描く（時計から、または自動操作から）。 */
  advance(frames: number): void {
    const sim = this.sim;
    if (!sim) return;
    const begin = performance.now();
    const count = Math.max(0, Math.min(MAX_ADVANCE, Math.floor(frames)));
    for (let i = 0; i < count; i++) {
      sim.step(this.obstacles());
      this.collect();
    }
    // 仮の主人公の画面は、画面の中の人物の絵か位置が変わったときだけ描き直す
    const frame = this.player.frame;
    const changed = count > 0 ? this.draw() : [];
    if (changed.some(r => frame && overlaps(r, frame))) this.player.refresh();
    if (changed.length) this.onChange?.();
    this.cost.ticks++; this.cost.ms += performance.now() - begin;
  }

  get snapshot(): NpcPreviewState {
    const sim = this.sim;
    const byId = new Map(this.actorsValue.map(a => [a.id, a]));
    return {
      enabled: !!sim, frame: sim?.frame ?? 0, seed: this.seed, holders: this.subscription?.holders ?? [], clock: this.clock.state, missing: this.missingCount, cost: { ...this.cost },
      actors: (sim?.status() ?? []).map(s => {
        const a = byId.get(s.localId);
        return { ...s, pixelX: a?.pixelX ?? s.x * 16, pixelY: a?.pixelY ?? s.y * 16, movementId: a?.movementId ?? null, visible: a?.visible ?? true };
      }),
    };
  }

  private sources(): NpcSource[] { return npcSourcesOf(this.state.map); }

  /** 仮の主人公を、人物の通れないマスとして渡す。 */
  private obstacles(): NpcObstacle[] {
    const p = this.player.player, doc = this.state.map?.doc;
    if (!p || !doc) return [];
    const h = doc.grid.getMovement(p.x, p.y) >> 2;
    return [{ x: p.x, y: p.y, elevation: h === 15 ? 3 : h }];
  }

  /** 人物の状態と絵のコマ（ActorAnimator は 1 フレームに 1 回進める）。 */
  private collect(): void {
    const sprites = this.state.session?.overworldSprites ?? null;
    this.actorsValue = this.sim!.actors().map(actor => {
      if (!sprites) return actor;
      let animator = this.animators.get(actor.id);
      if (!animator) { animator = new ActorAnimator(sprites); this.animators.set(actor.id, animator); }
      return { ...actor, animationFrame: animator.advance(actor) };
    });
  }

  /** 人物を編集したら最初からやり直す。ブロックだけなら描き直す。 */
  private onCells(): void {
    if (!this.sim) return;
    const sources = this.sources();
    const signature = JSON.stringify(sources);
    if (signature !== this.signature) {
      this.signature = signature;
      this.sim = new NpcSimulation(this.world!, sources, this.seed);
      this.animators.clear();
      this.collect();
      this.player.refresh();
    }
    this.redrawAll();
  }

  /** 見えているタブのマップに人物の層を付ける。マップのタブでなければ時計を止める。 */
  private attach(): void {
    const tab = this.state.tab;
    const view = tab === "map" || tab === "movement" || tab === "event" ? this.views[tab] : null;
    if (!view) {
      this.layer.remove(); this.host = null;
      this.hiddenRelease ??= this.subscription?.hold(HIDDEN) ?? null;
      return;
    }
    this.hiddenRelease?.(); this.hiddenRelease = null;
    const doc = this.state.map!.doc;
    if (view !== this.host) { this.host = view; view.stage.insertBefore(this.layer, view.layer); }
    const origin = view.originPx, scale = view.cellSize / 16;
    Object.assign(this.layer.style, { left: `${origin.x}px`, top: `${origin.y}px`, width: `${doc.width * 16}px`, height: `${doc.height * 16}px`, transform: scale === 1 ? "" : `scale(${scale})` });
    this.redrawAll();
  }

  private redrawAll(): void {
    if (!this.sim || !this.host) return;
    this.drawn.clear();
    this.draw();
  }

  /**
   * 前と変わった人物を描き直す。人物ごとに絵の大きさの Canvas を持ち（大きな Canvas を毎フレーム描き直さないため）、
   * 人物と、範囲が重なるほかの人物、人物の上に来る前景を描く。重なった所はどちらの Canvas も同じ画素になる。
   * 変わった範囲（前と今の絵の範囲）を返す。描けないときは全員の範囲。
   */
  private draw(): Rect[] {
    const session = this.state.session, map = this.state.map, view = this.host;
    if (!session || !map || !view || view.dormant) return [{ x: -1e6, y: -1e6, width: 2e6, height: 2e6 }];
    const sprites = session.overworldSprites;
    const bounds = { x: 0, y: 0, width: map.doc.width * 16, height: map.doc.height * 16 };
    const current = new Map<number, { rect: Rect | null; key: string }>();
    const changed: Rect[] = [];
    const redo = new Set<number>();
    for (const actor of this.actorsValue) {
      const info = sprites?.info(actor.graphicsId);
      const rect = actor.present && actor.visible && info ? clip(imageRect(actor, info.width, info.height), bounds) : null;
      const f = actor.animationFrame;
      const key = rect ? `${rect.x},${rect.y},${rect.width},${rect.height},${f?.index},${f?.hFlip},${f?.vFlip}` : "";
      current.set(actor.id, { rect, key });
      const old = this.drawn.get(actor.id);
      if (old && old.key === key) continue;
      redo.add(actor.id);
      if (old?.rect) changed.push(old.rect);
      if (rect) changed.push(rect);
    }
    for (const [id, old] of this.drawn) if (!current.has(id) && old.rect) changed.push(old.rect);
    // 動いた人物と重なる（重なっていた）人物の Canvas も描き直す
    for (const [id, { rect }] of current) if (rect && changed.some(r => overlaps(r, rect))) redo.add(id);
    for (const [id, canvas] of this.canvases) if (!current.get(id)?.rect) { canvas.remove(); this.canvases.delete(id); }
    this.drawn = current;
    let missing = 0;
    for (const id of redo) {
      const rect = current.get(id)?.rect;
      if (!rect) continue;
      const inside = this.actorsValue.filter(a => { const r = current.get(a.id)?.rect; return r && overlaps(r, rect); });
      const scene = renderActorScene(session, map, rect, inside, undefined, undefined, { overlay: true });
      missing += scene.missing.length;
      let canvas = this.canvases.get(id);
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.className = "npc-actor";
        this.canvases.set(id, canvas);
        this.layer.append(canvas);
      }
      if (canvas.width !== rect.width || canvas.height !== rect.height) { canvas.width = rect.width; canvas.height = rect.height; }
      canvas.style.left = `${rect.x}px`; canvas.style.top = `${rect.y}px`;
      canvas.getContext("2d")!.putImageData(new ImageData(scene.image.data, rect.width, rect.height), 0, 0);
    }
    if (missing !== this.missingCount && missing > 0) this.state.setStatus(t.missing(missing), undefined, true);
    if (redo.size) this.missingCount = missing;
    return changed;
  }

  /** 人物の層を 1 枚の画像にする（自動操作の確認用。マップと同じ等倍の大きさ）。 */
  image(): HTMLCanvasElement {
    const doc = this.state.map?.doc;
    const out = document.createElement("canvas");
    out.width = (doc?.width ?? 0) * 16; out.height = (doc?.height ?? 0) * 16;
    const context = out.getContext("2d")!;
    for (const canvas of this.canvases.values()) context.drawImage(canvas, parseFloat(canvas.style.left), parseFloat(canvas.style.top));
    return out;
  }
}

function imageRect(actor: PlaybackActorState, width: number, height: number): Rect {
  const at = actorImagePosition(actor, width, height);
  return { x: Math.round(at.x), y: Math.round(at.y), width, height };
}
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
function clip(r: Rect, b: Rect): Rect | null {
  const x = Math.max(r.x, b.x), y = Math.max(r.y, b.y);
  const right = Math.min(r.x + r.width, b.x + b.width), bottom = Math.min(r.y + r.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
