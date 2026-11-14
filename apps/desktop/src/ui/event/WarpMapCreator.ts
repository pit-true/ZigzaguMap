import { BlockRenderer, MAX_MAPS_PER_BANK, createMapForWarp, findWarpSamples, renderBlocks, type MapId, type WarpSample } from "@zigzagumap/core";
import type { App } from "../../app/App";
import { ja } from "../../i18n/ja";
import { jaNeighbors } from "../../i18n/ja.neighbors";
import { jaWarpMap as t } from "../../i18n/ja.warpMap";
import "../../styles/warpMap.css";
import { canvasOf } from "../canvas";
import { createDialog, dialogButton, handleDialogKeys, pressable } from "../Dialog";
import { showEditError } from "../form/inputErrors";
import { inputDialog } from "../InputDialog";
import { showError } from "../MessageBox";

/** サムネイルの 1 辺の上限（画素）。 */
const THUMB_MAX = 96;

/** 選んだもの（見本の番号か、使わないなら null）。 */
export interface WarpMapChoice {
  readonly sample: number | null;
  readonly copyLayout: boolean;
}

/** 自動操作から渡す指定（`sample` を渡すと見本の窓を出さない。`bank` を渡すとバンクを聞かない）。 */
export interface WarpMapOptions extends Partial<WarpMapChoice> {
  readonly bank?: number;
}

/**
 * ワープの右クリックの「行き先のマップを作る」（#241）。見本を探して選ばせ、バンクを聞いて、新しいマップと両側のワープを
 * 1 回の操作で作り、新しいマップを開く。
 */
export class WarpMapCreator {
  constructor(private readonly app: App) {}

  /** 見本を探す（表示中のマップのワープ `index`）。 */
  async samples(index: number): Promise<WarpSample[]> {
    const session = this.app.state.session;
    const map = this.app.state.map;
    if (!session || !map) return [];
    return findWarpSamples(session.project, map.id, index);
  }

  /** 作る。作ったマップ（取り消し・失敗なら null）。 */
  async run(index: number, options: WarpMapOptions = {}): Promise<MapId | null> {
    const state = this.app.state;
    const session = state.session;
    const map = state.map;
    if (!session || !map) return null;
    if (!map.doc.events?.warps[index]) {
      await showError(t.noWarp);
      return null;
    }
    state.setStatus(t.searching);
    const samples = await this.samples(index);
    const choice = options.sample !== undefined ? { sample: options.sample ?? null, copyLayout: options.copyLayout ?? true } : await this.choose(samples);
    if (!choice) return null;
    const sample = choice.sample === null ? null : (samples[choice.sample] ?? null);
    const target = await this.askSlot(options.bank);
    if (!target) return null;
    try {
      const sampleDoc = sample ? await session.project.load(sample.map) : null;
      session.bus.execute(
        createMapForWarp(session.project.editorContext(), { from: map.id, warpIndex: index, target, sample, copyLayout: choice.copyLayout }, sampleDoc),
      );
    } catch (e) {
      await showEditError(e);
      return null;
    }
    await this.app.openMap(target);
    const made = session.project.loaded(target);
    if (made) state.setStatus(t.created(target.bank, target.map, made.width, made.height));
    return target;
  }

  /** 新しいマップを置くバンクを聞く（既定は今のマップのバンク。満杯なら新しいバンク）。 */
  private async askSlot(given?: number): Promise<MapId | null> {
    const session = this.app.state.session!;
    const counts = session.project.bankCounts();
    const current = this.app.state.map!.id.bank;
    const initial = (counts[current] ?? MAX_MAPS_PER_BANK) < MAX_MAPS_PER_BANK ? current : counts.length;
    let bank = given;
    if (bank === undefined) {
      const text = await inputDialog(jaNeighbors.bankTitle, jaNeighbors.bankPrompt(counts.length), String(initial));
      if (text === null) return null;
      bank = Number(text.trim());
    }
    if (!Number.isInteger(bank) || bank < 0 || bank > counts.length) {
      await showError(jaNeighbors.bankInvalid(counts.length));
      return null;
    }
    if (bank < counts.length && counts[bank]! >= MAX_MAPS_PER_BANK) {
      await showError(jaNeighbors.bankFull(bank));
      return null;
    }
    return { bank, map: bank < counts.length ? counts[bank]! : 0 };
  }

  /** 見本のサムネイル（マップ全体を 96 画素に縮め、戻りのワープを置く位置を赤い枠で示す）。 */
  private async thumbnail(sample: WarpSample): Promise<HTMLCanvasElement | null> {
    const project = this.app.state.session?.project;
    const doc = project ? await project.peek(sample.map) : null;
    if (!project || !doc) return null;
    const { primary, secondary } = await project.peekTilesets(doc);
    const image = renderBlocks(new BlockRenderer(primary, secondary), doc.width, doc.height, (x, y) => doc.grid.getBlock(x, y));
    const canvas = canvasOf(image);
    const scale = Math.min(1, THUMB_MAX / Math.max(image.width, image.height));
    canvas.style.width = `${Math.round(image.width * scale)}px`;
    canvas.style.height = `${Math.round(image.height * scale)}px`;
    const c = canvas.getContext("2d")!;
    c.strokeStyle = "#ff0000";
    c.lineWidth = 2;
    c.strokeRect(sample.entry.x * 16 + 1, sample.entry.y * 16 + 1, 14, 14);
    return canvas;
  }

  /** 見本を選ぶ窓。キャンセルなら null。 */
  private choose(samples: readonly WarpSample[]): Promise<WarpMapChoice | null> {
    return new Promise((resolve) => {
      let picked: number | null = samples.length > 0 ? 0 : null;
      const copy = document.createElement("input");
      const finish = (value: WarpMapChoice | null): void => {
        frame.remove();
        resolve(value);
      };
      const ok = (): void => finish({ sample: picked, copyLayout: copy.checked });
      const frame = createDialog({ title: t.title, width: 460, className: "warp-map-dialog", onClose: () => finish(null) });
      const intro = document.createElement("p");
      intro.textContent = t.intro(samples.length);
      const list = document.createElement("div");
      list.className = "warp-map-list";
      list.dataset["autoId"] = "warpMap.list";
      const option = (label: string, value: number | null, id: string): HTMLLabelElement => {
        const row = document.createElement("label");
        row.className = "warp-map-item";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "warp-map-sample";
        radio.checked = value === picked;
        radio.dataset["autoId"] = id;
        radio.addEventListener("change", () => {
          if (radio.checked) picked = value;
          copy.disabled = picked === null;
        });
        const text = document.createElement("span");
        text.textContent = label;
        row.append(radio, text);
        return row;
      };
      const name = (id: MapId) => this.app.state.session?.catalog.get(id)?.name ?? null;
      samples.forEach((s, i) => {
        const row = option(t.sample(s.map.bank, s.map.map, name(s.map), s.width, s.height), i, `warpMap.sample:${i}`);
        void this.thumbnail(s).then((c) => c && row.append(c));
        list.append(row);
      });
      list.append(option(t.noSample, null, "warpMap.noSample"));
      const copyRow = document.createElement("label");
      copyRow.className = "warp-map-copy";
      copy.type = "checkbox";
      copy.checked = true;
      copy.disabled = picked === null;
      copy.dataset["autoId"] = "warpMap.copyLayout";
      copyRow.append(copy, t.copyLayout);
      const buttons = document.createElement("div");
      buttons.className = "dialog-buttons";
      buttons.append(dialogButton(ja.ok, ok), dialogButton(ja.cancel, () => finish(null)));
      frame.body.append(intro, list, copyRow, buttons);
      handleDialogKeys(frame, () => finish(null), (e) => {
        if (e.key === "Enter") ok();
      });
      frame.register({
        title: t.title,
        text: intro.textContent ?? "",
        ...pressable([
          { label: ja.ok, aliases: ["ok"], run: ok },
          { label: ja.cancel, aliases: ["cancel"], run: () => finish(null) },
        ]),
      });
    });
  }
}
