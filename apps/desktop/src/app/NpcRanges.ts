import { nonTrainerSpottingEnabled, npcSpotter, NpcSimulation, ROM_BASE, type NpcSightRay, type NpcSpotter, type NpcSpottingRules, type PersonEvent } from "@zigzagumap/core";
import type { EditorState } from "./EditorState";
import type { AidTab } from "./viewAids";
import type { MapView } from "../ui/map/MapView";
import { npcSourcesOf, npcWorldOf } from "./npcWorld";
import { jaNpcMotion as t } from "../i18n/ja.npcMotion";

/** 1 人分の表示（自動操作にも返す）。 */
export interface NpcRangeInfo {
  readonly localId: number;
  /** 移動範囲（マス。元の位置が中心）。範囲の無い人物は null。 */
  readonly range: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null;
  readonly spotter: NpcSpotter | null;
  readonly rays: readonly NpcSightRay[];
}

/** 表示の色（トレーナーと、NON_TRAINER_SPOTTING で見つける普通の人物を分ける）。 */
const COLORS = {
  range: { fill: "rgba(0, 170, 255, 0.10)", stroke: "rgba(0, 120, 220, 0.9)" },
  trainer: { fill: "rgba(255, 40, 40, 0.35)", stroke: "rgba(200, 0, 0, 0.95)" },
  npc: { fill: "rgba(255, 170, 0, 0.35)", stroke: "rgba(200, 110, 0, 0.95)" },
} as const;

/**
 * 表示 > 人物の移動範囲と視界（#472）。移動範囲は元のイベントの位置が中心。視界は今の位置と向き（人物を動かしている間は
 * 動いた後の位置）から、主人公が立つと見つかるマスを塗る。トレーナーは赤、普通の人物（CFRU の NON_TRAINER_SPOTTING）は
 * 橙の点線。視界を遮ったマスには×を描く。マップの元データは変えない。
 */
export class NpcRanges {
  private readonly canvas = document.createElement("canvas");
  private host: MapView | null = null;
  private active = false;
  private rules: NpcSpottingRules = { cfru: false, nonTrainerSpotting: false };
  private infoValue: NpcRangeInfo[] = [];
  private drawnKey = "";
  private token = 0;

  constructor(
    private readonly state: EditorState,
    private readonly views: Readonly<Record<AidTab, MapView>>,
    /** 人物を動かしているときの計算（止まっていれば null）。 */
    private readonly running: () => NpcSimulation | null,
    /** イベントタブで選んでいる人物の localId。 */
    private readonly selected: () => number | null,
  ) {
    this.canvas.className = "npc-ranges";
    this.canvas.dataset["autoId"] = "npc.ranges";
    state.on("session", () => this.stop());
    state.on("map", () => { if (this.active) void this.start(); });
    for (const topic of ["tab", "view", "cells", "tiles"] as const) state.on(topic, () => this.update(true));
    for (const view of Object.values(views)) view.wakeListeners.push(() => this.update(true));
  }

  get enabled(): boolean { return this.active; }
  get info(): readonly NpcRangeInfo[] { return this.infoValue; }
  get spottingRules(): NpcSpottingRules { return this.rules; }

  async start(): Promise<void> {
    const session = this.state.session;
    if (!session || !this.state.map) return;
    const token = ++this.token;
    let configH: string | null = null;
    if (session.projectDir) {
      try { configH = (await session.files.exists("src/config.h")) ? await session.files.readText("src/config.h") : null; }
      catch { configH = null; }
    }
    if (token !== this.token) return;
    this.rules = { cfru: session.projectDir !== null, nonTrainerSpotting: nonTrainerSpottingEnabled(configH) };
    this.active = true;
    this.update(true);
    this.state.setStatus(t.rangesOn(this.rules.nonTrainerSpotting));
  }

  stop(): void {
    if (!this.active) return;
    this.active = false; this.token++;
    this.canvas.remove(); this.canvas.width = 0; this.canvas.height = 0;
    this.host = null; this.infoValue = []; this.drawnKey = "";
  }

  /** 人物が動いたとき・選んだ人物が変わったときに呼ぶ。表示が変わらなければ描き直さない。 */
  update(force = false): void {
    if (!this.active) return;
    const map = this.state.map, session = this.state.session;
    if (!map || !session) return;
    const tab = this.state.tab;
    const view = tab === "map" || tab === "movement" || tab === "event" ? this.views[tab] : null;
    if (!view) { this.canvas.remove(); this.host = null; return; }
    const sim = this.running() ?? new NpcSimulation(npcWorldOf(map), npcSourcesOf(map), 0);
    const persons = new Map((map.doc.events?.persons ?? []).map(p => [p.localId, p] as const));
    const rom = session.project.rom;
    const scriptByte = (p: PersonEvent): number | null => {
      const offset = (p.script >>> 0) - ROM_BASE;
      return offset >= 0 && offset < rom.size ? rom.u8(offset) : null;
    };
    this.infoValue = sim.status().map(s => {
      const person = persons.get(s.localId);
      const spotter = person ? npcSpotter(person, scriptByte(person), this.rules) : null;
      return { localId: s.localId, range: sim.rangeOf(s.localId), spotter, rays: spotter ? sim.sight(s.localId, spotter.range, spotter.allDirections) : [] };
    });
    const selected = this.selected();
    const key = JSON.stringify([this.infoValue, selected, view.cellSize]);
    const size = view.cellSize, width = map.doc.width * size, height = map.doc.height * size;
    if (view !== this.host) { this.host = view; view.stage.insertBefore(this.canvas, view.layer); force = true; }
    const origin = view.originPx;
    Object.assign(this.canvas.style, { left: `${origin.x}px`, top: `${origin.y}px`, width: `${width}px`, height: `${height}px` });
    if (!force && key === this.drawnKey) return;
    if (view.dormant) { this.drawnKey = ""; return; }
    this.drawnKey = key;
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    this.draw(size, map.doc.width, map.doc.height, selected);
  }

  private draw(size: number, mapWidth: number, mapHeight: number, selected: number | null): void {
    const c = this.canvas.getContext("2d")!;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const line = Math.max(1, size / 16);
    for (const info of this.infoValue) {
      const r = info.range;
      if (!r) continue;
      const x0 = Math.max(0, r.x0), y0 = Math.max(0, r.y0), x1 = Math.min(mapWidth - 1, r.x1), y1 = Math.min(mapHeight - 1, r.y1);
      c.fillStyle = COLORS.range.fill;
      c.fillRect(x0 * size, y0 * size, (x1 - x0 + 1) * size, (y1 - y0 + 1) * size);
      c.strokeStyle = COLORS.range.stroke; c.lineWidth = line * (info.localId === selected ? 2 : 1);
      c.setLineDash(info.localId === selected ? [] : [4 * line, 3 * line]);
      c.strokeRect(x0 * size + line / 2, y0 * size + line / 2, (x1 - x0 + 1) * size - line, (y1 - y0 + 1) * size - line);
    }
    for (const info of this.infoValue) {
      if (!info.spotter) continue;
      const color = COLORS[info.spotter.kind];
      const strong = info.localId === selected;
      for (const ray of info.rays) {
        c.fillStyle = color.fill;
        for (const tile of ray.tiles) c.fillRect(tile.x * size, tile.y * size, size, size);
        c.strokeStyle = color.stroke; c.lineWidth = line * (strong ? 2 : 1);
        c.setLineDash(info.spotter.kind === "npc" ? [2 * line, 2 * line] : []);
        for (const tile of ray.tiles) c.strokeRect(tile.x * size + line / 2, tile.y * size + line / 2, size - line, size - line);
        const b = ray.blocked;
        if (b && b.x >= 0 && b.y >= 0 && b.x < mapWidth && b.y < mapHeight) {
          c.setLineDash([]);
          const m = size / 4;
          c.beginPath();
          c.moveTo(b.x * size + m, b.y * size + m); c.lineTo((b.x + 1) * size - m, (b.y + 1) * size - m);
          c.moveTo((b.x + 1) * size - m, b.y * size + m); c.lineTo(b.x * size + m, (b.y + 1) * size - m);
          c.stroke();
        }
      }
    }
    c.setLineDash([]);
  }
}
