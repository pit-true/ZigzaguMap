import { WildAreaKind, levelDistribution, speciesTotals, type WildArea } from "@zigzagumap/core";
import { jaWildTools as wt } from "../../i18n/ja.wildTools";
import { createDialog, dialogButton, dialogButtonRow, handleDialogKeys, pressable } from "../Dialog";

/** グラフの窓に渡すもの。 */
export interface WildChartInput {
  /** エリアの番号（0 陸・1 水・2 岩砕き・3 釣り）と名前。 */
  readonly kind: number;
  readonly areaName: string;
  readonly area: WildArea;
  /** 種族の名前。 */
  speciesName(species: number): string;
}

const WIDTH = 480;
const TOTALS_HEIGHT = 170;
const LEVELS_HEIGHT = 130;
const BAR_COLOR = "#4a7fd0";

/** 1 本の棒（マウスを乗せたときの値）。 */
interface Bar {
  readonly x: number;
  readonly w: number;
  readonly text: string;
}

/**
 * 出現の割合のグラフ（#398）。種族ごとの合計の割合（棒）と、レベルの分布（全部か、選んだ種族だけ）を Canvas で描く。
 * 釣りは竿ごとに 100% なので、竿を選んで描く。棒にマウスを乗せると値を下の行に出す。開いたときの表で描き、閉じたら捨てる。
 */
export function openWildChart(input: WildChartInput): void {
  const finish = (): void => frame.remove();
  const frame = createDialog({ title: wt.chartTitle(input.areaName), width: WIDTH + 24, className: "wild-chart", onClose: finish });
  const fishing = input.kind === WildAreaKind.Fishing;
  const rod = document.createElement("select");
  rod.dataset["autoId"] = "wild.chart.rod";
  for (const r of wt.rods) rod.append(new Option(r));
  const species = document.createElement("select");
  species.dataset["autoId"] = "wild.chart.species";
  const hover = document.createElement("div");
  hover.className = "wild-chart-hover";
  hover.dataset["autoId"] = "wild.chart.hover";
  hover.textContent = wt.chartHover;
  const totalsCanvas = canvas("wild.chart.totals", TOTALS_HEIGHT);
  const levelsCanvas = canvas("wild.chart.levels", LEVELS_HEIGHT);
  const totalsHead = heading(wt.chartTotals);
  const levelsHead = heading("");
  let totalBars: Bar[] = [];
  let levelBars: Bar[] = [];

  const group = (): number | null => (fishing ? rod.selectedIndex : null);
  const fillSpecies = (): void => {
    const keep = species.value;
    species.replaceChildren(new Option(wt.chartAllSpecies, ""));
    for (const t of speciesTotals(input.kind, input.area, group())) species.append(new Option(input.speciesName(t.species), String(t.species)));
    species.value = [...species.options].some((o) => o.value === keep) ? keep : "";
  };
  const draw = (): void => {
    const totals = speciesTotals(input.kind, input.area, group());
    totalBars = drawBars(
      totalsCanvas,
      totals.map((t) => ({ label: input.speciesName(t.species), value: t.rate, text: wt.chartBar(input.speciesName(t.species), t.rate) })),
      true,
    );
    const chosen = species.value === "" ? null : Number(species.value);
    levelsHead.textContent = wt.chartLevels(chosen === null ? null : input.speciesName(chosen));
    const levels = levelDistribution(input.kind, input.area, chosen, group());
    levelBars = drawBars(
      levelsCanvas,
      [...levels].map(([lv, rate]) => ({ label: String(lv), value: rate, text: wt.chartLevel(lv, rate) })),
      false,
    );
  };
  const onMove = (c: HTMLCanvasElement, bars: () => Bar[]) => (e: MouseEvent) => {
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) * c.width) / r.width;
    const hit = bars().find((b) => x >= b.x && x < b.x + b.w);
    hover.textContent = hit ? hit.text : wt.chartHover;
  };
  totalsCanvas.addEventListener("mousemove", onMove(totalsCanvas, () => totalBars));
  levelsCanvas.addEventListener("mousemove", onMove(levelsCanvas, () => levelBars));
  rod.addEventListener("change", () => {
    fillSpecies();
    draw();
  });
  species.addEventListener("change", draw);
  fillSpecies();
  draw();

  const controls = document.createElement("div");
  controls.className = "wild-chart-controls";
  if (fishing) controls.append(label(wt.chartRod), rod);
  controls.append(label(wt.chartSpecies), species);
  const buttons = dialogButtonRow(dialogButton(wt.close, finish));
  frame.body.append(controls, totalsHead, totalsCanvas, levelsHead, levelsCanvas, hover, buttons);
  handleDialogKeys(frame, finish);
  frame.register({
    title: wt.chartTitle(input.areaName),
    text: "",
    ...pressable([{ label: wt.close, aliases: ["close", "cancel", "ok"], run: finish }]),
  });
}

/** 棒グラフを描き、棒の位置を返す。`names` なら棒の下に名前を斜めに書く（種族）。 */
function drawBars(c: HTMLCanvasElement, items: readonly { label: string; value: number; text: string }[], names: boolean): Bar[] {
  const g = c.getContext("2d")!;
  const css = getComputedStyle(c);
  const text = css.color || "#000";
  g.clearRect(0, 0, c.width, c.height);
  const bottom = c.height - (names ? 44 : 16);
  const top = 14;
  const max = Math.max(1, ...items.map((i) => i.value));
  const slot = Math.min(48, Math.floor((c.width - 8) / Math.max(1, items.length)));
  const w = Math.max(2, slot - 4);
  g.font = "10px sans-serif";
  g.fillStyle = text;
  g.strokeStyle = text;
  g.beginPath();
  g.moveTo(4, bottom + 0.5);
  g.lineTo(c.width - 4, bottom + 0.5);
  g.stroke();
  const bars: Bar[] = [];
  items.forEach((item, i) => {
    const x = 6 + i * slot;
    const h = Math.round(((bottom - top) * item.value) / max);
    g.fillStyle = BAR_COLOR;
    g.fillRect(x, bottom - h, w, h);
    g.fillStyle = text;
    g.textAlign = "center";
    const value = Number.isInteger(item.value) ? String(item.value) : item.value.toFixed(1);
    if (slot >= 18) g.fillText(value, x + w / 2, bottom - h - 3);
    if (names) {
      g.save();
      g.translate(x + w / 2, bottom + 4);
      g.rotate(Math.PI / 6);
      g.textAlign = "left";
      g.fillText(item.label.slice(0, 8), 0, 8);
      g.restore();
    } else if (slot >= 14 || i % 5 === 0) {
      g.fillText(item.label, x + w / 2, bottom + 12);
    }
    bars.push({ x, w: slot, text: item.text });
  });
  return bars;
}

function canvas(id: string, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.dataset["autoId"] = id;
  c.className = "wild-chart-canvas";
  c.width = WIDTH;
  c.height = height;
  return c;
}

function heading(text: string): HTMLElement {
  const h = document.createElement("div");
  h.className = "wild-chart-head";
  h.textContent = text;
  return h;
}

function label(text: string): HTMLElement {
  const l = document.createElement("span");
  l.className = "wild-chart-label";
  l.textContent = text;
  return l;
}
