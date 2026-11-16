import { actorImagePosition, defaultFacingOf, PLAYER_GRAPHICS, PLAYER_ID, viewportFrame, type MovementDirection, type PlaybackActorState, type PlaybackState } from "@zigzagumap/core";
import type { Actions } from "./Actions";
import type { EditorState } from "./EditorState";
import type { ViewAids, AidTab } from "./viewAids";
import type { MapView } from "../ui/map/MapView";
import { renderActorScene } from "./ActorScene";
import { jaPreviewPlayer as t } from "../i18n/ja.previewPlayer";
import { jaMapExport } from "../i18n/ja.mapExport";
import { writeFile, type FileDialogs } from "./FileDialogs";
import { errorText } from "../util/errors";
import { sceneNeighborBlocks } from "./SceneNeighbors";

export interface PlayerPlacement {
  readonly x: number;
  readonly y: number;
  readonly gender: "male" | "female";
  readonly facing: MovementDirection;
}
interface Layer { readonly view: MapView; readonly canvas: HTMLCanvasElement; readonly handle: HTMLDivElement }
const PAD = { left: 8, top: 6, right: 8, bottom: 6 };
const NO_PAD = { left: 0, top: 0, right: 0, bottom: 0 };
const DIRECTIONS: readonly MovementDirection[] = ["down", "up", "left", "right"];

/** 保存しない仮の主人公。再生も同じ240×160の描画口を使い、終了時に配置を戻せる。 */
export class PreviewPlayer {
  private active = false;
  private placement: PlayerPlacement | null = null;
  private playback: PlaybackState | null = null;
  private oldFrame = false;
  private missingCount = 0;
  private outside: ((x: number, y: number) => number | null) | undefined;
  private loading = Promise.resolve();
  private token = 0;
  private readonly layers: Record<AidTab, Layer>;
  private readonly controls = document.createElement("div");
  private readonly gender = document.createElement("select");
  private readonly facing = document.createElement("select");
  onStep: ((placement: PlayerPlacement) => void) | null = null;
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
    return this.playback ? viewportFrame(this.playback.camera) : p ? viewportFrame({ target: PLAYER_ID, x: p.x * 16, y: p.y * 16, shakeX: 0, shakeY: 0 }) : null;
  }

  start(): void {
    const map = this.state.map;
    if (this.active || !map || !this.state.session) return;
    this.oldFrame = this.state.settings.data.playerView;
    this.placement = { x: Math.floor(map.doc.width / 2), y: Math.floor(map.doc.height / 2), facing: "down", gender: "male" };
    this.active = true;
    this.state.settings.update({ playerView: true });
    for (const layer of Object.values(this.aids.layers)) layer.setExternalSight(true);
    this.state.setStatus(t.active); this.draw(); this.state.emit("view");
    this.loadNeighbors();
  }

  stop(quiet = false): void {
    if (!this.active) return;
    this.active = false; this.playback = null; this.placement = null; this.missingCount = 0;
    this.token++; this.outside = undefined;
    this.controls.remove();
    for (const layer of Object.values(this.layers)) {
      layer.canvas.hidden = true; layer.handle.hidden = true;
      layer.canvas.width = 0; layer.canvas.height = 0;
      layer.view.setPreviewMargins(NO_PAD);
    }
    for (const layer of Object.values(this.aids.layers)) layer.setExternalSight(false);
    this.state.settings.update({ playerView: this.oldFrame }); this.state.emit("view");
    if (!quiet) this.state.setStatus(t.finished);
  }

  setPlayer(patch: Partial<PlayerPlacement>): void {
    if (!this.placement || !this.state.map || this.playback) return;
    const next = { ...this.placement, ...patch };
    next.x = Math.max(0, Math.min(this.state.map.doc.width - 1, Math.floor(next.x)));
    next.y = Math.max(0, Math.min(this.state.map.doc.height - 1, Math.floor(next.y)));
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !DIRECTIONS.includes(next.facing) || !["male", "female"].includes(next.gender)) return;
    const moved = next.x !== this.placement.x || next.y !== this.placement.y;
    this.placement = next; this.draw();
    if (moved) this.onStep?.({ ...next });
  }

  /** 外から絵だけを描き直す（タイルアニメ・ドアのフレームが変わったとき。#473・#474）。 */
  refresh(): void { this.draw(); }

  /** 再生画面から呼ぶ。nullで、再生前の仮の主人公の配置へ戻る。 */
  setPlayback(state: PlaybackState | null): void { this.playback = state; this.draw(); }

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
        const p = this.placement;
        this.setPlayer({ facing: direction, x: p.x + (direction === "right" ? 1 : direction === "left" ? -1 : 0), y: p.y + (direction === "down" ? 1 : direction === "up" ? -1 : 0) });
      } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); this.onTalk?.({ ...this.placement }); }
    });
    view.stage.append(canvas, handle);
    return { view, canvas, handle };
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
    const player = actor(PLAYER_ID, PLAYER_GRAPHICS[p.gender], p.x, p.y, p.facing, elevation > 0 && elevation < 15 ? elevation : 3);
    const actors = this.playback?.actors ?? [
      ...(map.doc.events?.persons ?? []).map(person => actor(person.localId, person.graphicsId, person.x, person.y, defaultFacingOf(person.movementType), person.elevation)), player,
    ];
    const frame = this.frame!;
    const result = renderActorScene(session, map, frame, actors, undefined, this.outside);
    const missing = result.missing.length + result.unknownBlocks.length;
    if (missing !== this.missingCount) {
      this.missingCount = missing;
      this.state.setStatus(missing ? t.missing(missing) : t.active, undefined, missing > 0);
    }
    const canvas = active.canvas;
    canvas.width = 240; canvas.height = 160;
    canvas.getContext("2d")!.putImageData(new ImageData(result.image.data, 240, 160), 0, 0);
    const scale = active.view.cellSize / 16, origin = active.view.originPx;
    canvas.style.left = `${origin.x + frame.x * scale}px`; canvas.style.top = `${origin.y + frame.y * scale}px`;
    canvas.style.width = `${240 * scale}px`; canvas.style.height = `${160 * scale}px`;
    canvas.classList.toggle("framed", this.state.settings.data.playerView);
    const info = session.overworldSprites?.info(player.graphicsId);
    const position = actorImagePosition(player, info?.width ?? 16, info?.height ?? 32);
    active.handle.style.left = `${origin.x + position.x * scale}px`; active.handle.style.top = `${origin.y + position.y * scale}px`;
    active.handle.style.width = `${(info?.width ?? 16) * scale}px`; active.handle.style.height = `${(info?.height ?? 32) * scale}px`;
  }
}
