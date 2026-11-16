import { actorImagePosition, defaultFacingOf, MOVEMENT_DELTA, PLAYER_GRAPHICS, PLAYER_ID, viewportFrame, type MovementDirection, type PlaybackActorState, type PlaybackState, type SceneActor, type SceneView } from "@zigzagumap/core";
import type { Actions } from "./Actions";
import type { EditorState } from "./EditorState";
import type { ViewAids, AidTab } from "./viewAids";
import type { MapView } from "../ui/map/MapView";
import { releaseActorScene, renderActorScene } from "./ActorScene";
import { jaPreviewPlayer as t } from "../i18n/ja.previewPlayer";
import { jaMapExport } from "../i18n/ja.mapExport";
import { writeFile, type FileDialogs } from "./FileDialogs";
import { errorText } from "../util/errors";
import { sceneNeighborBlocks } from "./SceneNeighbors";
import { scheduleIdleGc } from "../util/idleGc";

export interface PlayerPlacement {
  readonly x: number;
  readonly y: number;
  readonly gender: "male" | "female";
  readonly facing: MovementDirection;
}
/** shade は枠と外側の暗さ（Canvas と別の要素にし、Canvas を描き直しても大きな影を描き直さない。#471）。 */
interface Layer { readonly view: MapView; readonly canvas: HTMLCanvasElement; readonly shade: HTMLDivElement; readonly handle: HTMLDivElement }
const PAD = { left: 8, top: 6, right: 8, bottom: 6 };
const NO_PAD = { left: 0, top: 0, right: 0, bottom: 0 };
const DIRECTIONS: readonly MovementDirection[] = ["down", "up", "left", "right"];
/** 1 マス歩く長さ（ゲームの歩き 16 フレーム）。 */
const WALK_FRAMES = 16;
/** 歩きの移動コマンドの番号（walk_down〜walk_right）。絵のコマは共通の部品が選ぶ。 */
const WALK_ID: Readonly<Record<MovementDirection, number>> = { down: 0x10, up: 0x11, left: 0x12, right: 0x13 };

/** 保存しない仮の主人公。再生も同じ240×160の描画口を使い、終了時に配置を戻せる。 */
export class PreviewPlayer {
  private active = false;
  private placement: PlayerPlacement | null = null;
  private playback: PlaybackState | null = null;
  /** 人物を動かしている間（#471）の人物。null ならイベントの位置に止めて描く。 */
  private npcActors: (() => readonly PlaybackActorState[]) | null = null;
  private oldFrame = false;
  private missingCount = 0;
  private outside: ((x: number, y: number) => number | null) | undefined;
  private loading = Promise.resolve();
  private token = 0;
  private readonly layers: Record<AidTab, Layer>;
  private readonly controls = document.createElement("div");
  private readonly gender = document.createElement("select");
  private readonly facing = document.createElement("select");
  /** 矢印キーで 1 マス歩き終えたとき（ドラッグや置き直しでは呼ばない。踏むスクリプトの再生 #457）。 */
  onStep: ((placement: PlayerPlacement) => void) | null = null;
  /** 歩いている途中。`manual` は自動操作で 1 フレームずつ進めるときのフレーム（時計を使わない）。 */
  private walking: { from: PlayerPlacement; start: number; raf: number; done: () => void; manual: number | null } | null = null;
  onTalk: ((placement: PlayerPlacement) => void) | null = null;

  constructor(private readonly state: EditorState, private readonly aids: ViewAids, views: Readonly<Record<AidTab, MapView>>, actions: Actions, private readonly files: FileDialogs) {
    this.controls.className = "actor-preview-controls";
    this.gender.dataset["autoId"] = "preview.gender";
    for (const gender of ["male", "female"] as const) this.gender.add(new Option(t[gender], gender));
    this.facing.dataset["autoId"] = "preview.facing";
    for (const direction of DIRECTIONS) this.facing.add(new Option(t[direction], direction));
    this.gender.addEventListener("change", () => this.setPlayer({ gender: this.gender.value as PlayerPlacement["gender"] }));
    this.facing.addEventListener("change", () => this.setPlayer({ facing: this.facing.value as MovementDirection }));
    const close = document.createElement("button");
    close.textContent = t.stop; close.dataset["autoId"] = "preview.stop";
    close.addEventListener("click", () => this.stop());
    const save = document.createElement("button");
    save.textContent = t.save; save.dataset["autoId"] = "preview.save";
    save.addEventListener("click", () => { void this.save().catch(error => this.state.setStatus(errorText(error), undefined, true)); });
    this.controls.append(this.gender, this.facing, save, close);
    this.layers = { map: this.makeLayer(views.map, "map"), movement: this.makeLayer(views.movement, "movement"), event: this.makeLayer(views.event, "event") };
    actions.register("view.previewPlayer", () => this.enabled ? this.stop() : this.start());
    actions.registerCheck("view.previewPlayer", () => this.enabled);
    actions.register("preview.save", () => this.save());
    for (const topic of ["session", "map"] as const) state.on(topic, () => this.stop(true));
    for (const topic of ["view", "cells", "tiles"] as const) state.on(topic, () => this.draw());
    state.on("tab", () => { this.draw(); if (this.active) state.emit("view"); });
    for (const topic of ["neighbors", "otherMaps"] as const) state.on(topic, () => { if (this.active) this.loadNeighbors(); });
    const resize = new ResizeObserver(() => this.draw());
    for (const layer of Object.values(this.layers)) resize.observe(layer.view.stage);
  }

  get enabled(): boolean { return this.active; }
  get player(): PlayerPlacement | null { return this.placement ? { ...this.placement } : null; }
  get frame(): ReturnType<typeof viewportFrame> | null {
    const p = this.placement;
    if (this.playback) return viewportFrame(this.playback.camera);
    if (!p) return null;
    const at = this.walkPixel();
    return viewportFrame({ target: PLAYER_ID, x: at?.x ?? p.x * 16, y: at?.y ?? p.y * 16, shakeX: 0, shakeY: 0 });
  }

  start(): void {
    const map = this.state.map;
    if (this.active || !map || !this.state.session) return;
    this.oldFrame = this.state.settings.data.playerView;
    // 男女は再生の帯と同じ個人設定（#457）。
    const gender = this.state.settings.data.playbackGender === "female" ? "female" : "male";
    this.placement = { x: Math.floor(map.doc.width / 2), y: Math.floor(map.doc.height / 2), facing: "down", gender };
    this.active = true;
    this.state.settings.update({ playerView: true });
    for (const layer of Object.values(this.aids.layers)) layer.setExternalSight(true);
    this.state.setStatus(t.active); this.draw(); this.state.emit("view");
    this.loadNeighbors();
    for (const l of this.activeListeners) l(true);
  }

  /** 始めた・終えたときに呼ぶ（連れ歩きの読み込みと後始末。#476・#477）。 */
  readonly activeListeners = new Set<(active: boolean) => void>();

  stop(quiet = false): void {
    if (!this.active) return;
    this.endWalk();
    if (this.playback) this.onPlayback?.(null);
    this.active = false; this.playback = null; this.placement = null; this.missingCount = 0;
    releaseActorScene(this.state.session);
    scheduleIdleGc(true); // 240×160 の絵と隣のマップの読み込みを手放したので、落ち着いたら GC して空いた領域を OS へ返す（#496）
    this.token++; this.outside = undefined;
    for (const l of this.activeListeners) l(false);
    this.controls.remove();
    for (const layer of Object.values(this.layers)) {
      layer.canvas.hidden = true; layer.handle.hidden = true; layer.shade.hidden = true;
      layer.canvas.width = 0; layer.canvas.height = 0;
      layer.view.setPreviewMargins(NO_PAD);
    }
    for (const layer of Object.values(this.aids.layers)) layer.setExternalSight(false);
    this.state.settings.update({ playerView: this.oldFrame }); this.state.emit("view");
    if (!quiet) this.state.setStatus(t.finished);
  }

  setPlayer(patch: Partial<PlayerPlacement>): void {
    if (!this.placement || !this.state.map || this.playback) return;
    const previous = { ...this.placement };
    this.endWalk();
    const next = { ...this.placement, ...patch };
    next.x = Math.max(0, Math.min(this.state.map.doc.width - 1, Math.floor(next.x)));
    next.y = Math.max(0, Math.min(this.state.map.doc.height - 1, Math.floor(next.y)));
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !DIRECTIONS.includes(next.facing) || !["male", "female"].includes(next.gender)) return;
    this.placement = next; this.draw();
    if (next.x !== previous.x || next.y !== previous.y) this.follower?.stepped(previous, { ...next });
    if (patch.gender && patch.gender !== this.state.settings.data.playbackGender) this.state.settings.update({ playbackGender: patch.gender });
  }

  /**
   * 1 マス歩く（向きを変えて、16 フレームで隣のマスへ）。歩き終えたら onStep を呼ぶ。マップの外へは向きだけ変える。
   * 歩いている間の矢印キーは無視する。戻り値は歩き終えたとき（歩かなければすぐ）に決まる。
   */
  walk(direction: MovementDirection, manual = false): Promise<void> {
    const p = this.placement, map = this.state.map;
    if (!p || !map || this.playback || this.walking || !DIRECTIONS.includes(direction)) return Promise.resolve();
    const d = MOVEMENT_DELTA[direction];
    const x = p.x + d.x, y = p.y + d.y;
    if (x < 0 || y < 0 || x >= map.doc.width || y >= map.doc.height) { this.setPlayer({ facing: direction }); return Promise.resolve(); }
    return new Promise(resolve => {
      const from = { ...p, facing: direction };
      this.placement = { ...p, x, y, facing: direction };
      this.follower?.stepped(from, { ...this.placement });
      const tick = (): void => {
        if (!this.walking) return;
        if (this.walkFrame() >= WALK_FRAMES - 1) {
          const w = this.walking;
          this.walking = null; this.draw();
          // 踏むスクリプトの再生を始めてから、歩き終えたことにする（自動操作が再生の状態を読めるように）。
          this.onStep?.({ ...this.placement! }); w.done();
          return;
        }
        this.draw(); this.walking.raf = requestAnimationFrame(tick);
      };
      this.walking = { from, start: performance.now(), raf: manual ? 0 : requestAnimationFrame(tick), done: resolve, manual: manual ? 0 : null };
      this.draw();
    });
  }

  /**
   * `walk(direction, true)` で始めた歩きを frames だけ進める（自動操作で歩きのコマを 1 フレームずつ確かめる用）。
   * 最後のフレームを過ぎると、画面の歩きと同じく歩き終えたことにする。返事は今のフレーム（歩いていなければ null）。
   */
  stepWalk(frames = 1): number | null {
    const w = this.walking;
    if (!w || w.manual === null) return null;
    w.manual += Math.max(0, Math.floor(frames));
    if (w.manual > WALK_FRAMES - 1) {
      this.walking = null; this.draw();
      this.onStep?.({ ...this.placement! }); w.done();
      return null;
    }
    this.draw();
    return w.manual;
  }

  /** 歩きの様子（自動操作の確かめ用）。 */
  get walkState(): { readonly frame: number; readonly pixel: { x: number; y: number }; readonly manual: boolean } | null {
    const w = this.walking, at = this.walkPixel();
    return w && at ? { frame: this.walkFrame(), pixel: at, manual: w.manual !== null } : null;
  }

  /** 向いている方のマスを調べる（Enter・Space。人物・看板のスクリプトの再生 #457）。 */
  talk(): void { if (this.placement && !this.playback && !this.walking) this.onTalk?.({ ...this.placement }); }

  private walkFrame(): number {
    const w = this.walking;
    if (!w) return 0;
    return w.manual !== null ? w.manual : Math.min(WALK_FRAMES - 1, Math.floor((performance.now() - w.start) * 60 / 1000));
  }
  /** 歩いている途中の画素の位置（歩いていなければ null）。 */
  private walkPixel(): { x: number; y: number } | null {
    const w = this.walking;
    if (!w) return null;
    const d = MOVEMENT_DELTA[w.from.facing], step = this.walkFrame() + 1;
    return { x: w.from.x * 16 + d.x * step, y: w.from.y * 16 + d.y * step };
  }
  private endWalk(): void {
    const w = this.walking;
    if (!w) return;
    if (w.manual === null) cancelAnimationFrame(w.raf);
    this.walking = null; this.draw(); w.done();
  }

  /**
   * 連れ歩き（#477）。主人公の 1 歩ごとに `stepped(from, to)` を呼び、描くときに `actors(view, player)` の人物を足す。
   * 再生の状態を描いている間は足さない（再生は自分で連れ歩きを持つ）。
   */
  private follower: { stepped(from: PlayerPlacement, to: PlayerPlacement): void; actors(view: SceneView, player: PlayerPlacement): readonly SceneActor[] } | null = null;
  setFollower(source: typeof this.follower): void { this.follower = source; this.draw(); }
  /** 仮の主人公の操作の欄（連れ歩きの選択を足す）。 */
  get controlBar(): HTMLElement { return this.controls; }

  /** 人物を動かす（#471）から呼ぶ。null でイベントの位置の止め絵へ戻る。 */
  setNpcActors(source: (() => readonly PlaybackActorState[]) | null): void { this.npcActors = source; this.draw(); }

  /** 外から絵だけを描き直す（人物が動いたとき #471、タイルアニメ・ドアのフレームが変わったとき #473・#474）。 */
  refresh(): void { this.draw(); }

  /** 再生の状態を受け取ったとき（描く前）に呼ぶ（タイルアニメとドアを再生のフレームに合わせる。#474）。 */
  onPlayback: ((state: PlaybackState | null) => void) | null = null;

  /** 再生画面から呼ぶ。nullで、再生前の仮の主人公の配置へ戻る。 */
  setPlayback(state: PlaybackState | null): void { this.playback = state; this.onPlayback?.(state); this.draw(); }

  async ready(): Promise<void> {
    let pending: Promise<void>;
    do { pending = this.loading; await pending; } while (pending !== this.loading);
  }

  private loadNeighbors(): void {
    const session = this.state.session, map = this.state.map;
    if (!session || !map) return;
    const token = ++this.token;
    this.loading = sceneNeighborBlocks(session, map).then(blocks => {
      if (token !== this.token || !this.active) return;
      this.outside = blocks; this.draw();
    });
  }

  /** 表示と同じ240×160の合成結果を保存する（枠・暗幕・操作の部品は含めない）。 */
  async save(): Promise<string | null> {
    await this.ready();
    const layer = this.state.tab in this.layers ? this.layers[this.state.tab as AidTab] : null;
    if (!this.active || !layer || !layer.canvas.width) return null;
    const blob = await new Promise<Blob>((resolve, reject) => layer.canvas.toBlob(value => value ? resolve(value) : reject(new Error(t.saveFailed)), "image/png"));
    let path = await this.files.saveFile({ title: t.save, filters: [{ name: jaMapExport.pngFilter, extensions: ["png"] }], fileName: "preview.png" });
    if (!path) return null;
    if (!/\.[^\\/.]+$/.test(path)) path += ".png";
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return path;
  }

  private makeLayer(view: MapView, tab: AidTab): Layer {
    const canvas = document.createElement("canvas");
    canvas.className = "actor-preview-image"; canvas.hidden = true; canvas.width = 0; canvas.height = 0;
    const shade = document.createElement("div");
    shade.className = "actor-preview-shade"; shade.hidden = true;
    canvas.dataset["autoId"] = `preview.${tab}.frame`;
    const handle = document.createElement("div");
    handle.className = "actor-preview-handle"; handle.hidden = true; handle.tabIndex = 0; handle.title = t.hint;
    handle.dataset["autoId"] = `preview.${tab}.player`;
    let dragging = false;
    handle.addEventListener("pointerdown", e => {
      if (!this.active || this.playback) return;
      if (e.button === 2) {
        e.preventDefault(); e.stopPropagation();
        const p = this.placement!; this.setPlayer({ facing: DIRECTIONS[(DIRECTIONS.indexOf(p.facing) + 1) % 4]! }); return;
      }
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation(); handle.focus({ preventScroll: true });
      dragging = true;
      try { handle.setPointerCapture(e.pointerId); } catch { /* 自動操作のPointerEventは捕まえられない場合がある。 */ }
    });
    handle.addEventListener("pointermove", e => {
      if (!dragging) return;
      e.preventDefault(); e.stopPropagation();
      this.setPlayer(view.rawCellAt(e));
    });
    const release = (): void => { dragging = false; };
    handle.addEventListener("pointerup", release); handle.addEventListener("pointercancel", release);
    handle.addEventListener("contextmenu", e => { e.preventDefault(); e.stopPropagation(); });
    handle.addEventListener("keydown", e => {
      if (!this.placement || this.playback) return;
      const directions: Record<string, MovementDirection> = { ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" };
      const direction = directions[e.key];
      if (direction) {
        e.preventDefault(); e.stopPropagation();
        void this.walk(direction);
      } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); this.talk(); }
    });
    view.stage.append(shade, canvas, handle);
    return { view, canvas, shade, handle };
  }

  private draw(): void {
    if (!this.active || !this.placement) return;
    const session = this.state.session, map = this.state.map;
    if (!session || !map) return;
    const active = this.state.tab in this.layers ? this.layers[this.state.tab as AidTab] : null;
    for (const layer of Object.values(this.layers)) {
      const on = layer === active;
      layer.view.setPreviewMargins(on ? PAD : NO_PAD);
      layer.canvas.hidden = !on; layer.handle.hidden = !on || !!this.playback;
      layer.shade.hidden = !on || !this.state.settings.data.playerView;
      if (!on) { layer.canvas.width = 0; layer.canvas.height = 0; }
    }
    if (!active) { this.controls.remove(); return; }
    if (this.controls.parentElement !== active.view.element) active.view.element.prepend(this.controls);
    this.controls.hidden = !!this.playback;
    const p = this.placement;
    this.gender.value = p.gender; this.facing.value = p.facing;
    const actor = (id: number, graphicsId: number, x: number, y: number, facing: MovementDirection, elevation: number): PlaybackActorState => ({
      id, graphicsId, tileX: x, tileY: y, pixelX: x * 16, pixelY: y * 16, height: 0, facing,
      sprite: "stand", actionFrame: 0, movementId: null, present: true, visible: true, shadow: false, mark: null, elevation, fixedPriority: false, animHold: false,
    });
    const elevation = map.doc.grid.getMovement(p.x, p.y) >> 2;
    const standing = actor(PLAYER_ID, PLAYER_GRAPHICS[p.gender], p.x, p.y, p.facing, elevation > 0 && elevation < 15 ? elevation : 3);
    const at = this.walkPixel();
    const player: PlaybackActorState = at ? { ...standing, pixelX: at.x, pixelY: at.y, sprite: "walk", movementId: WALK_ID[p.facing], actionFrame: this.walkFrame() } : standing;
    const actors = this.playback?.actors ?? [
      ...(this.npcActors?.() ?? (map.doc.events?.persons ?? []).map(person => actor(person.localId, person.graphicsId, person.x, person.y, defaultFacingOf(person.movementType), person.elevation))), player,
    ];
    const frame = this.frame!;
    const follower = this.playback ? null : this.follower;
    const result = renderActorScene(session, map, frame, actors, undefined, this.outside, undefined, follower ? view => follower.actors(view, p) : undefined);
    const missing = result.missing.length + result.unknownBlocks.length;
    if (missing !== this.missingCount) {
      this.missingCount = missing;
      this.state.setStatus(missing ? t.missing(missing) : t.active, undefined, missing > 0);
    }
    const canvas = active.canvas;
    // 大きさを入れ直すと Canvas の領域を作り直すので、変わるときだけ（人物を動かす間は毎フレーム描くため。#471）
    if (canvas.width !== 240 || canvas.height !== 160) { canvas.width = 240; canvas.height = 160; }
    canvas.getContext("2d")!.putImageData(new ImageData(result.image.data, 240, 160), 0, 0);
    const scale = active.view.cellSize / 16, origin = active.view.originPx;
    canvas.style.left = `${origin.x + frame.x * scale}px`; canvas.style.top = `${origin.y + frame.y * scale}px`;
    canvas.style.width = `${240 * scale}px`; canvas.style.height = `${160 * scale}px`;
    canvas.classList.toggle("framed", this.state.settings.data.playerView);
    Object.assign(active.shade.style, { left: canvas.style.left, top: canvas.style.top, width: canvas.style.width, height: canvas.style.height });
    const info = session.overworldSprites?.info(player.graphicsId);
    const position = actorImagePosition(player, info?.width ?? 16, info?.height ?? 32);
    active.handle.style.left = `${origin.x + position.x * scale}px`; active.handle.style.top = `${origin.y + position.y * scale}px`;
    active.handle.style.width = `${(info?.width ?? 16) * scale}px`; active.handle.style.height = `${(info?.height ?? 32) * scale}px`;
  }
}
