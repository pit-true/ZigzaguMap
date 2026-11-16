import {
  AnimatedTiles,
  BlockRenderer,
  DOOR_CELL_LAYER,
  DOOR_TEMP_TILE,
  doorAt,
  doorStateAt,
  doorWaitResume,
  readDoorTable,
  readTileAnimation,
  tileAnimationBytes,
  type DoorCellLookup,
  type DoorEvent,
  type DoorSceneState,
  type DoorTable,
  type TileAnimationReason,
  type TileAnimationSet,
} from "@zigzagumap/core";
import type { EditorState } from "../EditorState";
import type { OpenMap, ProjectSession } from "../ProjectSession";
import type { ActiveTint } from "../timeOfDay/activeTint";
import { setSceneAnimation, type SceneAnimationFrame, type SceneAnimationSource } from "./sceneAnimation";

interface TilesCache {
  readonly key: string;
  readonly primary: object;
  readonly secondary: object;
  readonly tiles: AnimatedTiles;
}

/**
 * タイルアニメとドアの状態（Phase6 #473・#474）。フレーム番号を受け取って、240×160 の絵の描き手を返す。
 * 既定はオフ（フレームが null）。時計は持たない（再生・NPC と同じ時計から `setFrame` で受け取る）。
 * マップ・セッションを切り替えたら止めて、絵とキャッシュを捨てる。元のタイルセットとマップは変えない。
 */
export class MapAnimations implements SceneAnimationSource {
  private frameValue: number | null = null;
  private events: DoorEvent[] = [];
  private session: ProjectSession | null = null;
  private readonly animations = new Map<number, { readonly set: TileAnimationSet | null; readonly reason: TileAnimationReason | null }>();
  private doorTable: DoorTable | null | undefined;
  private tiles: TilesCache | null = null;
  private renderer: { readonly key: string; readonly renderer: BlockRenderer } | null = null;
  /** 絵が変わったときに呼ぶ（240×160 の表示を描き直す）。 */
  onChange: (() => void) | null = null;

  constructor(private readonly state: EditorState) {
    for (const topic of ["session", "map"] as const) state.on(topic, () => this.stop());
    state.on("tiles", () => { this.tiles = null; this.renderer = null; });
  }

  /** 動かしている（フレームを受け取っている）か。 */
  get enabled(): boolean { return this.frameValue !== null; }
  get frame(): number | null { return this.frameValue; }
  get doorEvents(): readonly DoorEvent[] { return this.events; }

  /** フレーム番号（MapBGanimeMain を呼んだ回数。ドアの命令も同じ数え方）。null で止める。 */
  setFrame(frame: number | null): void {
    if (frame === null) { this.stop(); return; }
    if (!Number.isFinite(frame) || frame < 0) throw new RangeError("frame は 0 以上の数です");
    this.frameValue = Math.floor(frame);
    setSceneAnimation(this);
    this.onChange?.();
  }

  /** ドアの命令を足す（`frame` を省くと今のフレーム）。結果はその命令の受け付けと理由。 */
  door(kind: DoorEvent["kind"], x: number, y: number, frame = this.frameValue ?? 0): { readonly ok: boolean; readonly reason: string | null; readonly lastFrame: number | null } {
    const session = this.state.session, map = this.state.map;
    if (!session || !map) throw new Error("マップが開かれていません");
    const table = this.table(session);
    if (!table) return { ok: false, reason: "table", lastFrame: null };
    if (this.frameValue === null) this.setFrame(frame);
    const event: DoorEvent = { frame: Math.floor(frame), kind, x: Math.floor(x), y: Math.floor(y) };
    this.events = [...this.events, event];
    const state = doorStateAt(table, this.lookup(map), this.events, event.frame);
    const result = state.results[state.results.length - 1]!;
    this.onChange?.();
    return { ok: result.ok, reason: result.reason, lastFrame: result.ok && state.task?.start === event.frame ? state.task.lastFrame : null };
  }

  /** `waitdooranim` を `frame` で実行したときに続けるフレーム。 */
  doorWait(frame: number): number {
    const session = this.state.session, map = this.state.map;
    const table = session ? this.table(session) : null;
    if (!table || !map) return frame + 1;
    return doorWaitResume(table, this.lookup(map), this.events, frame);
  }

  /** マスのドア（自動操作で調べる用）。 */
  doorInfo(x: number, y: number): { readonly blockId: number | null; readonly tall: boolean | null; readonly sound: number | null; readonly reason: string | null } {
    const session = this.state.session, map = this.state.map;
    if (!session || !map) throw new Error("マップが開かれていません");
    const table = this.table(session);
    if (!table) return { blockId: null, tall: null, sound: null, reason: "table" };
    const found = doorAt(table, this.lookup(map), x, y);
    return { blockId: found.door?.blockId ?? null, tall: found.door?.tall ?? null, sound: found.door?.sound ?? null, reason: found.reason };
  }

  /** 表示中のマップのドアのマス（挙動が 0x69 で表にあるもの）。 */
  doorList(): { readonly x: number; readonly y: number; readonly blockId: number; readonly tall: boolean }[] {
    const session = this.state.session, map = this.state.map;
    if (!session || !map) throw new Error("マップが開かれていません");
    const table = this.table(session);
    if (!table) return [];
    const lookup = this.lookup(map);
    const out: { x: number; y: number; blockId: number; tall: boolean }[] = [];
    for (let y = 0; y < map.doc.height; y++) for (let x = 0; x < map.doc.width; x++) {
      const door = doorAt(table, lookup, x, y).door;
      if (door) out.push({ x, y, blockId: door.blockId, tall: door.tall });
    }
    return out;
  }

  /** 今のフレームのドアの見た目。 */
  doorState(frame = this.frameValue ?? 0): DoorSceneState | null {
    const session = this.state.session, map = this.state.map;
    const table = session ? this.table(session) : null;
    return table && map ? doorStateAt(table, this.lookup(map), this.events, frame) : null;
  }

  /** ドアの命令を消す。 */
  clearDoors(): void {
    this.events = [];
    this.onChange?.();
  }

  /** 止めて、元の絵へ戻す。読んだ絵と写しも捨てる。 */
  stop(): void {
    const was = this.frameValue !== null || this.events.length > 0;
    this.frameValue = null;
    this.events = [];
    this.tiles = null;
    this.renderer = null;
    this.animations.clear();
    this.doorTable = undefined;
    this.session = null;
    setSceneAnimation(null);
    if (was) this.onChange?.();
  }

  /** 表示中のマップのアニメの読み取り結果。 */
  info(): { readonly primary: AnimationInfo; readonly secondary: AnimationInfo; readonly bytes: { readonly frames: number; readonly copies: number } } {
    const session = this.state.session, map = this.state.map;
    if (!session || !map) throw new Error("マップが開かれていません");
    const read = (callback: number): AnimationInfo => {
      const result = this.animation(session, callback);
      return {
        callback,
        reason: result.reason,
        counterMax: result.set?.counterMax ?? null,
        tracks: (result.set?.tracks ?? []).map((t) => ({ name: t.name, tileStart: t.tileStart, tileCount: t.tileCount, period: t.period, phase: t.phase, frames: t.frames.length })),
      };
    };
    let frames = 0;
    for (const value of this.animations.values()) frames += tileAnimationBytes(value.set);
    return { primary: read(map.tiles.primary.header.callback), secondary: read(map.tiles.secondary.header.callback), bytes: { frames, copies: this.tiles?.tiles.copyBytes ?? 0 } };
  }

  /** 表示中のコマ（自動操作の確かめ用）。 */
  shownFrames(): readonly { readonly name: string; readonly frame: number | null }[] {
    const session = this.state.session, map = this.state.map;
    if (!session || !map || this.frameValue === null) return [];
    return this.animatedTiles(session, map).at(this.frameValue).frames;
  }

  forScene(session: ProjectSession, map: OpenMap, tint: ActiveTint | null): SceneAnimationFrame | null {
    if (this.frameValue === null) return null;
    const frame = this.frameValue;
    const tiles = this.animatedTiles(session, map);
    const doors = this.events.length ? this.doorState(frame) : null;
    tiles.setOverlay(DOOR_TEMP_TILE, doors?.tiles ?? null);
    const shown = tiles.at(frame);
    const useTint = tint?.tintsMapType(map.doc.header.mapType) ? tint : null;
    const key = `${map.tiles.key}:${shown.key}:${useTint?.generation ?? 0}`;
    if (this.renderer?.key !== key) {
      let tinted: Uint16Array | undefined;
      if (useTint) {
        const [primaryPointer, secondaryPointer] = map.tiles.key.split(":").map(Number) as [number, number];
        tinted = useTint.palettes(primaryPointer, secondaryPointer, map.tiles.primary, map.tiles.secondary);
      }
      this.renderer = { key, renderer: new BlockRenderer(shown.primary, shown.secondary, tinted) };
    }
    const cells = doors?.cells;
    return {
      renderer: this.renderer.renderer,
      cellAt: cells && cells.size ? (x, y) => { const entries = cells.get(`${x},${y}`); return entries ? { entries, mode: DOOR_CELL_LAYER } : null; } : undefined,
    };
  }

  private animatedTiles(session: ProjectSession, map: OpenMap): AnimatedTiles {
    const view = map.tiles;
    if (this.tiles && this.tiles.key === view.key && this.tiles.primary === view.primary && this.tiles.secondary === view.secondary) return this.tiles.tiles;
    const primary = this.animation(session, view.primary.header.callback).set;
    const secondary = this.animation(session, view.secondary.header.callback).set;
    const tiles = new AnimatedTiles(view.primary, view.secondary, primary, secondary);
    this.tiles = { key: view.key, primary: view.primary, secondary: view.secondary, tiles };
    this.renderer = null;
    return tiles;
  }

  private animation(session: ProjectSession, callback: number): { readonly set: TileAnimationSet | null; readonly reason: TileAnimationReason | null } {
    this.useSession(session);
    let result = this.animations.get(callback);
    if (!result) {
      result = readTileAnimation(session.project.rom, callback);
      this.animations.set(callback, result);
    }
    return result;
  }

  private table(session: ProjectSession): DoorTable | null {
    this.useSession(session);
    if (this.doorTable === undefined) {
      try { this.doorTable = readDoorTable(session.project.rom, session.project.game.offsets); }
      catch { this.doorTable = null; }
    }
    return this.doorTable;
  }

  private useSession(session: ProjectSession): void {
    if (this.session === session) return;
    this.session = session;
    this.animations.clear();
    this.doorTable = undefined;
    this.tiles = null;
    this.renderer = null;
  }

  private lookup(map: OpenMap): DoorCellLookup {
    const doc = map.doc, view = map.tiles;
    return (x, y) => {
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
      const block = doc.grid.getBlock(x, y);
      const primary = block < 640;
      const attributes = (primary ? view.primary : view.secondary).attributes;
      return { block, attribute: attributes[primary ? block : block - 640] ?? 0 };
    };
  }
}

export interface AnimationInfo {
  readonly callback: number;
  readonly reason: TileAnimationReason | null;
  readonly counterMax: number | null;
  readonly tracks: readonly { readonly name: string; readonly tileStart: number; readonly tileCount: number; readonly period: number; readonly phase: number; readonly frames: number }[];
}
