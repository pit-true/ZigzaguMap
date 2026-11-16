import {
  BEHAVIOR_MASK, decodeIndexedPng, followerAssets, followerFrame, followerPalette, followerSceneActors, FollowerSheet, FollowerSimulation, followerStatus, parseFollowerIndex,
  type FollowerIndex, type FollowerStatus, type MovementDirection, type RgbaImage, type SceneActor, type SceneView,
} from "@zigzagumap/core";
import type { EditorState } from "./EditorState";
import type { ClockSubscription, GameClock } from "./GameClock";
import type { PlayerPlacement, PreviewPlayer } from "./PreviewPlayer";
import { dpeDirectoryOf, loadDpeSpecies } from "./DpeSpeciesLoader";
import type { ProjectSession } from "./ProjectSession";
import { activeTint } from "./timeOfDay/activeTint";
import { ProcessRunner } from "../util/processRunner";
import { jaFollower as t } from "../i18n/ja.follower";

/** プロジェクトごとに 1 回だけ読む材料。 */
interface Project {
  readonly status: FollowerStatus;
  readonly index: FollowerIndex | null;
  readonly dpe: string | null;
  readonly names: ReadonlyMap<number, string>;
}
const projects = new WeakMap<ProjectSession, Promise<Project>>();

/** 段差の挙動（`MB_JUMP_*`）と、跳び越える向き。 */
const LEDGES: Readonly<Record<number, MovementDirection>> = { 0x38: "right", 0x39: "left", 0x3a: "up", 0x3b: "down" };

/** 自動操作に返す状態。 */
export interface FollowerState {
  readonly status: FollowerStatus;
  readonly enabled: boolean;
  readonly species: number | null;
  readonly shiny: boolean;
  readonly female: boolean;
  readonly speciesCount: number;
  readonly position: { readonly x: number; readonly y: number; readonly facing: MovementDirection } | null;
  readonly busy: boolean;
  readonly sheet: { readonly path: string; readonly big: boolean; readonly fallback: boolean; readonly sideOffset: number } | null;
}

/**
 * 仮の主人公の連れ歩き（#476・#477）。DPE の絵を読み、主人公の歩いた道を追って描く。位置は保存しない。
 * 有効でないプロジェクトでは、選ぶ欄を出さずに理由を出す。歩いている間だけ時計を回す。
 */
export class FollowerPreview {
  private project: Project | null = null;
  private sim: FollowerSimulation | null = null;
  private subscription: ClockSubscription | null = null;
  private enabledValue = false;
  private species: number | null = null;
  private shiny = false;
  private female = false;
  private sheet: { path: string; sheet: FollowerSheet; palette: Uint16Array; big: boolean; fallback: boolean; side: number } | null = null;
  private images = new Map<string, RgbaImage>();
  private token = 0;
  private readonly controls = document.createElement("span");
  private readonly toggle = document.createElement("input");
  private readonly select = document.createElement("select");
  private readonly shinyBox = document.createElement("input");
  private readonly femaleBox = document.createElement("input");
  private readonly note = document.createElement("span");

  constructor(private readonly state: EditorState, private readonly player: PreviewPlayer, private readonly clock: GameClock) {
    this.controls.className = "follower-controls";
    const label = (input: HTMLInputElement, text: string, id: string): HTMLLabelElement => {
      input.type = "checkbox"; input.dataset["autoId"] = id;
      const l = document.createElement("label"); l.append(input, text); return l;
    };
    this.select.dataset["autoId"] = "follower.species";
    this.note.dataset["autoId"] = "follower.note";
    this.controls.append(label(this.toggle, t.toggle, "follower.enabled"), this.select, label(this.shinyBox, t.shiny, "follower.shiny"), label(this.femaleBox, t.female, "follower.female"), this.note);
    this.toggle.addEventListener("change", () => void this.set({ enabled: this.toggle.checked }));
    this.select.addEventListener("change", () => void this.set({ species: Number(this.select.value) }));
    this.shinyBox.addEventListener("change", () => void this.set({ shiny: this.shinyBox.checked }));
    this.femaleBox.addEventListener("change", () => void this.set({ female: this.femaleBox.checked }));
  }

  /** 仮の主人公を始めたとき。プロジェクトの判定を読み、欄を付ける。 */
  async attach(): Promise<void> {
    const session = this.state.session;
    const token = ++this.token;
    this.player.controlBar.append(this.controls);
    if (!session) return;
    const project = await loadProject(session);
    if (token !== this.token) return;
    this.project = project;
    const ok = project.status.enabled && project.index !== null;
    this.toggle.disabled = !ok;
    this.select.hidden = this.shinyBox.parentElement!.hidden = this.femaleBox.parentElement!.hidden = !ok;
    this.note.textContent = project.status.enabled ? "" : t.reasons[project.status.reason];
    this.controls.title = this.note.textContent;
    this.select.replaceChildren();
    for (const species of project.index?.entries.keys() ?? []) this.select.add(new Option(`${species.toString(16).toUpperCase().padStart(4, "0")} ${project.names.get(species) ?? ""}`.trim(), String(species)));
    if (ok && (this.species === null || !project.index!.entries.has(this.species))) this.species = project.index!.entries.keys().next().value ?? null;
    if (this.species !== null) this.select.value = String(this.species);
    this.toggle.checked = this.enabledValue && ok;
    if (this.enabledValue && ok) await this.set({});
  }

  /** 仮の主人公を終えたとき。絵と時計を捨てる。選んだ種族は覚えておく。 */
  detach(): void {
    this.token++;
    this.controls.remove();
    this.subscription?.dispose(); this.subscription = null;
    this.sim = null; this.sheet = null; this.images.clear();
    this.player.setFollower(null);
  }

  get snapshot(): FollowerState {
    const status = this.project?.status ?? { enabled: false as const, reason: "noProject" as const };
    return {
      status, enabled: this.enabledValue && !!this.sim, species: this.species, shiny: this.shiny, female: this.female,
      speciesCount: this.project?.index?.entries.size ?? 0,
      position: this.sim ? { x: this.sim.tileX, y: this.sim.tileY, facing: this.sim.facing } : null, busy: this.sim?.busy ?? false,
      sheet: this.sheet ? { path: this.sheet.path, big: this.sheet.big, fallback: this.sheet.fallback, sideOffset: this.sheet.side } : null,
    };
  }

  /** 表示と見た目を変える。 */
  async set(patch: { enabled?: boolean; species?: number; shiny?: boolean; female?: boolean }): Promise<void> {
    if (patch.enabled !== undefined) this.enabledValue = patch.enabled;
    if (patch.species !== undefined) this.species = patch.species;
    if (patch.shiny !== undefined) this.shiny = patch.shiny;
    if (patch.female !== undefined) this.female = patch.female;
    this.toggle.checked = this.enabledValue; this.shinyBox.checked = this.shiny; this.femaleBox.checked = this.female;
    if (this.species !== null) this.select.value = String(this.species);
    const project = this.project, p = this.player.player, map = this.state.map;
    if (!this.enabledValue || !project?.index || !project.status.enabled || !p || !map || this.species === null) {
      this.subscription?.dispose(); this.subscription = null; this.sim = null;
      this.player.setFollower(null);
      return;
    }
    const token = this.token;
    const assets = followerAssets(project.index, this.species, { female: this.female, shiny: this.shiny });
    if (!assets) { this.player.setFollower(null); return; }
    const read = async (path: string) => decodeIndexedPng(await ProcessRunner.readBytes(`graphics/${path}`, project.dpe));
    const image = await read(assets.sheet);
    const palette = followerPalette(assets.palette === assets.sheet ? image : await read(assets.palette));
    if (token !== this.token) return;
    const sheet = FollowerSheet.from(image, assets.entry.big);
    this.sheet = { path: assets.sheet, sheet, palette, big: assets.entry.big, fallback: assets.fallback, side: sheet.sideOffset() };
    this.images.clear();
    this.sim ??= FollowerSimulation.behind(p, (x, y) => x >= 0 && y >= 0 && x < map.doc.width && y < map.doc.height);
    this.player.setFollower({ stepped: (from, to) => this.stepped(from, to), actors: (view, player) => this.actors(view, player) });
  }

  /** 時計を使わずに進める（自動操作のテスト用）。 */
  advance(frames: number): void {
    for (let i = 0; i < frames && this.sim; i++) this.sim.step();
    this.player.refresh();
  }

  private stepped(from: PlayerPlacement, to: PlayerPlacement): void {
    const map = this.state.map, sim = this.sim;
    if (!sim || !map) return;
    const doc = map.doc;
    sim.playerMoved(from, to, (x, y, direction) => {
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return false;
      return LEDGES[map.tiles.triple.attribute(doc.grid.getBlock(x, y)) & BEHAVIOR_MASK] === direction;
    });
    if (sim.busy && !this.subscription) {
      this.subscription = this.clock.subscribe("follower", frames => {
        let changed = false;
        for (let i = 0; i < frames; i++) changed = this.sim!.step() || changed;
        if (changed) this.player.refresh();
        if (!this.sim?.busy && changed === false) { this.subscription?.dispose(); this.subscription = null; }
      });
    }
  }

  private actors(view: SceneView, player: PlayerPlacement): readonly SceneActor[] {
    const sim = this.sim, sheet = this.sheet, map = this.state.map;
    if (!sim || !sheet || !map) return [];
    const doc = map.doc;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < doc.width && y < doc.height;
    const h = inside(sim.tileX, sim.tileY) ? doc.grid.getMovement(sim.tileX, sim.tileY) >> 2 : 3;
    const state = sim.actor(h > 0 && h < 15 ? h : 3);
    const frame = followerFrame(state.facing, state.movementId !== null || sim.busy, state.animIndex);
    const tint = activeTint();
    const useTint = tint?.tintsMapType(doc.header.mapType) ? tint : null;
    const key = `${frame.index}:${+frame.hFlip}:${useTint?.generation ?? 0}`;
    let image = this.images.get(key);
    if (!image) { image = sheet.sheet.frame(frame.index, frame.hFlip, sheet.palette, useTint?.sprite ?? null); this.images.set(key, image); }
    return followerSceneActors({
      state, image, sideOffset: sheet.side, player, viewY: view.y,
      covered: (x, y) => inside(x, y) && ((map.tiles.triple.attribute(doc.grid.getBlock(x, y)) >>> 29) & 3) === 1,
    });
  }
}

async function loadProject(session: ProjectSession): Promise<Project> {
  let promise = projects.get(session);
  if (!promise) {
    promise = (async (): Promise<Project> => {
      const fs = session.files;
      const read = async (path: string) => { try { return (await fs.exists(path)) ? await fs.readText(path) : null; } catch { return null; } };
      const [source, configH] = await Promise.all([read("src/follower_mon.c"), read("src/config.h")]);
      let dpe: string | null = null, index: FollowerIndex | null = null;
      try { dpe = session.projectDir ? await dpeDirectoryOf(fs) : null; } catch { dpe = null; }
      if (dpe !== null) {
        try {
          const [ow32, ow64, pal, header] = await Promise.all([
            ProcessRunner.list("graphics/ow/32", dpe), ProcessRunner.list("graphics/ow/64", dpe), ProcessRunner.list("graphics/ow/pal", dpe),
            ProcessRunner.readText("include/species.h", dpe),
          ]);
          index = parseFollowerIndex({ ow32, ow64, pal }, header);
        } catch { index = null; }
      }
      const status = followerStatus({ project: session.projectDir !== null, followerSource: source, configH, dpe: index !== null, sheets: index?.entries.size ?? 0 });
      const names = new Map<number, string>();
      if (status.enabled) {
        const species = await loadDpeSpecies(fs);
        if (species) for (const code of index!.entries.keys()) { const n = species.name(code); if (n) names.set(code, n); }
      }
      return { status, index, dpe, names };
    })();
    projects.set(session, promise);
  }
  return promise;
}
