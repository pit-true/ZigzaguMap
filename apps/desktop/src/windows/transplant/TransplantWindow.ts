import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  BLOCK_PIXELS,
  BlockRenderer,
  ROM_BASE,
  TransplantSource,
  addTilesetArgs,
  convertTilesets,
  decodeBase64,
  encodeBase64,
  type ConvertedTileset,
  type SourceMapInfo,
  type Tileset,
  type TransplantConversion,
  type TransplantParts,
} from "@zigzagumap/core";
import { FileDialogs, readFile } from "../../app/FileDialogs";
import { jaTransplant as t } from "../../i18n/ja.transplant";
import { autoId, button, check, combo, label, memo, place } from "../../ui/form/controls";
import { showError } from "../../ui/MessageBox";
import { errorText } from "../../util/errors";
import { pixelCanvas, putRgba, resizePixelCanvas } from "../block-editor/pixelCanvas";
import type { TilesetData, TransplantProbeResult } from "../protocol";
import { installToolAutomation } from "../toolAutomation";
import type { ToolClient } from "../ToolClient";

/** アニメ処理を比べる機械語の長さ（バイト）。 */
const CALLBACK_CODE_BYTES = 64;
/** 「取り込む側」のコンボの並び。 */
const PARTS: readonly TransplantParts[] = ["both", "primary", "secondary"];

/** 選んだマップの変換の結果（表示と取り込みに使う）。 */
interface Prepared {
  readonly map: SourceMapInfo;
  readonly parts: TransplantParts;
  readonly conversion: TransplantConversion;
}

/**
 * 別の ROM からタイルセットを取り込む窓（#314。別ウィンドウ）。
 *
 * - ROM を選ぶと、この窓の中だけで読むだけで開き（TransplantSource）、マップの一覧を出す。窓を閉じると WebView ごと消えるので、
 *   もう 1 つの ROM の中身はメインに残らない。
 * - マップを選ぶと、取り込む側（両方・主だけ・副だけ）で変換し、取り込んだ後の色とタイルで絵を描き、変わることを一覧で出す。
 * - 「取り込む」で、新しいタイルセットを加えて今のマップの組を付け替えるコマンド（配置も写すなら setLayout）を
 *   1 つの group にしてメインで実行する（1 回の「元に戻す」で全部戻る）。
 */
export class TransplantWindow {
  private source: TransplantSource | null = null;
  private romPath: string | null = null;
  private maps: SourceMapInfo[] = [];
  private prepared: Prepared | null = null;
  /** アニメ処理の比べた結果（アドレス → 同じか）。 */
  private readonly callbackMatches = new Map<number, boolean>();
  private readonly files = new FileDialogs();
  private readonly romLabel: HTMLElement;
  private readonly list: HTMLSelectElement;
  private readonly preview: HTMLCanvasElement;
  private readonly primaryInfo: HTMLElement;
  private readonly secondaryInfo: HTMLElement;
  private readonly parts: HTMLSelectElement;
  private readonly copyLayout: HTMLInputElement;
  private readonly report: HTMLTextAreaElement;
  private readonly importButton: HTMLButtonElement;
  private status = "";

  static start(root: HTMLElement, client: ToolClient): TransplantWindow {
    return new TransplantWindow(root, client);
  }

  private constructor(
    root: HTMLElement,
    private readonly client: ToolClient,
  ) {
    root.classList.add("transplant");
    this.romLabel = autoId(label(t.noRom, 116, 12, 636), "tp.romLabel");
    this.romLabel.classList.add("tp-path");
    this.list = combo("tp.maps", [], 8, 58, 250);
    this.list.size = 2;
    this.list.classList.add("tp-list");
    place(this.list, 8, 58, 250, 404);
    const frame = place(document.createElement("div"), 266, 58, 330, 250);
    frame.className += " tp-preview";
    this.preview = pixelCanvas("tp.preview", 16, 16, 1);
    frame.append(this.preview);
    this.primaryInfo = autoId(label("", 604, 76, 148), "tp.primaryInfo");
    this.secondaryInfo = autoId(label("", 604, 152, 148), "tp.secondaryInfo");
    for (const el of [this.primaryInfo, this.secondaryInfo]) el.classList.add("tp-info");
    this.parts = combo("tp.parts", [...t.partNames], 340, 316, 100);
    const layout = check("tp.copyLayout", t.copyLayout, 450, 318, 300);
    this.copyLayout = layout.input;
    this.report = memo("tp.report", 266, 362, 486, 68);
    this.report.readOnly = true;
    this.report.classList.add("tp-report");
    this.importButton = button("tp.import", t.importButton, 586, 438, 80, 25, () => void this.doImport());
    const heading = (text: string, x: number, y: number) => {
      const el = label(text, x, y);
      el.classList.add("tp-heading");
      return el;
    };
    root.append(
      button("tp.pickRom", t.pickRom, 8, 8, 100, 25, () => void this.pickRom()),
      this.romLabel,
      heading(t.maps, 8, 40),
      this.list,
      heading(t.preview, 266, 40),
      frame,
      heading(t.primary, 604, 58),
      this.primaryInfo,
      heading(t.secondary, 604, 134),
      this.secondaryInfo,
      label(t.parts, 266, 319),
      this.parts,
      layout.root,
      heading(t.report, 266, 344),
      this.report,
      this.importButton,
      button("tp.close", t.close, 672, 438, 80, 25, () => void getCurrentWindow().close()),
    );
    this.list.addEventListener("change", () => void this.prepare());
    this.parts.addEventListener("change", () => void this.prepare());
    this.copyLayout.addEventListener("change", () => this.showReport());
    this.importButton.disabled = true;
    void getCurrentWindow()
      .setTitle(t.title)
      .catch(() => undefined);
    void installToolAutomation(client, {
      files: this.files,
      actions: {},
      describe: () => this.describe(),
      // 一覧の番号を探さずに、元の ROM のマップを番号で選ぶ（`transplant.select`、引数 bank・map）
      extra: (req) => (req["cmd"] === "transplant.select" ? this.selectSource(Number(req["bank"]), Number(req["map"])) : undefined),
    });
  }

  // ---- ROM とマップ ----

  /** 取り込む元の ROM を選んで開く。 */
  private async pickRom(): Promise<void> {
    const path = await this.files.rom();
    if (!path) return;
    try {
      const source = TransplantSource.open(await readFile(path));
      this.source = source;
      this.romPath = path;
      this.maps = source.maps();
      this.callbackMatches.clear();
      this.romLabel.textContent = t.romInfo(source.game.code, this.maps.length, path);
      this.list.replaceChildren(
        ...this.maps.map((m) => {
          const o = document.createElement("option");
          o.textContent = t.mapItem(m.id.bank, m.id.map, m.name, m.regionMapSectionId, m.width, m.height);
          return o;
        }),
      );
      this.list.selectedIndex = this.maps.length > 0 ? 0 : -1;
      await this.prepare();
    } catch (e) {
      await showError(t.openFailed(errorText(e)));
    }
  }

  /** 選んだマップを変換し、絵・情報・一覧を出し直す。 */
  private async prepare(): Promise<void> {
    const source = this.source;
    const map = this.maps[this.list.selectedIndex];
    this.status = "";
    if (!source || !map) {
      this.prepared = null;
      this.render();
      return;
    }
    try {
      const parts = PARTS[this.parts.selectedIndex] ?? "both";
      const primary = source.tileset(map.primary, false);
      const secondary = source.tileset(map.secondary, true);
      await this.checkCallbacks([primary.callback, secondary.callback]);
      const conversion = convertTilesets({
        spec: source.game.spec,
        primary,
        secondary,
        parts,
        layout: source.layout(map.id),
        keepCallback: (callback) => this.callbackMatches.get(callback) === true,
      });
      this.prepared = { map, parts, conversion };
    } catch (e) {
      this.prepared = null;
      this.status = t.openFailed(errorText(e));
    }
    this.render();
  }

  /** アニメ処理の機械語が、取り込み先のベース ROM の同じアドレスにあるかをメインに聞く（FR・LG のときだけ）。 */
  private async checkCallbacks(callbacks: readonly number[]): Promise<void> {
    const source = this.source;
    if (!source || source.game.spec.family !== "frlg") return;
    const ask = [...new Set(callbacks.filter((c) => c !== 0 && !this.callbackMatches.has(c)))];
    const probes = ask.flatMap((address) => {
      const bytes = source.code(address, CALLBACK_CODE_BYTES);
      return bytes ? [{ address, bytes: encodeBase64(bytes) }] : [];
    });
    for (const c of ask) this.callbackMatches.set(c, false);
    if (probes.length === 0) return;
    const r = (await this.client.request({ op: "probe", newTilesets: 0, code: probes })) as TransplantProbeResult;
    probes.forEach((p, i) => this.callbackMatches.set(p.address, r.codeMatches[i] === true));
  }

  /** 元の ROM のマップを番号で選ぶ（自動操作用）。 */
  private async selectSource(bank: number, map: number): Promise<unknown> {
    const index = this.maps.findIndex((m) => m.id.bank === bank && m.id.map === map);
    if (index < 0) throw new Error(`元の ROM にマップ ${bank}.${map} がありません`);
    this.list.selectedIndex = index;
    await this.prepare();
    return this.describe();
  }

  // ---- 取り込み ----

  private async doImport(): Promise<void> {
    const p = this.prepared;
    const source = this.source;
    const target = this.client.snapshot.map;
    if (!p || !source) return;
    if (!target) {
      await showError(t.noMap);
      return;
    }
    const tilesets = [p.conversion.primary, p.conversion.secondary].filter((x): x is ConvertedTileset => x !== null);
    try {
      const probe = (await this.client.request({ op: "probe", newTilesets: tilesets.length, code: [] })) as TransplantProbeResult;
      const commands: { name: string; args: Record<string, unknown> }[] = [];
      const pointers: { primary?: number; secondary?: number } = {};
      tilesets.forEach((ts, i) => {
        const at = probe.addresses[i]!;
        commands.push({ name: "addTileset", args: addTilesetArgs(at, ts) });
        pointers[ts.secondary ? "secondary" : "primary"] = (ROM_BASE + at) >>> 0;
      });
      const mapArgs = { bank: target.bank, map: target.map };
      if (this.copyLayout.checked) {
        const layout = source.layout(p.map.id);
        commands.push({
          name: "setLayout",
          args: {
            ...mapArgs,
            width: layout.width,
            height: layout.height,
            cells: [...layout.blocks].map(p.conversion.cell),
            borderWidth: layout.borderWidth,
            borderHeight: layout.borderHeight,
            border: [...layout.border].map(p.conversion.cell),
            ...pointers,
          },
        });
      } else {
        commands.push({ name: "setTilesets", args: { ...mapArgs, ...pointers } });
      }
      await this.client.execute("group", { commands });
      this.status = t.imported(target.bank, target.map);
    } catch (e) {
      await showError(errorText(e));
    }
    this.showReport();
  }

  // ---- 表示 ----

  private render(): void {
    const p = this.prepared;
    this.importButton.disabled = p === null;
    this.drawPreview();
    this.primaryInfo.textContent = p ? this.infoText(p.conversion.primary, p.conversion.report.callbackKept.primary) : "";
    this.secondaryInfo.textContent = p ? this.infoText(p.conversion.secondary, p.conversion.report.callbackKept.secondary) : "";
    this.showReport();
  }

  private infoText(ts: ConvertedTileset | null, kept: boolean | null): string {
    if (!ts) return t.notImported;
    const anime = kept === null ? t.animeNone : kept ? t.animeKept : t.animeDropped;
    return t.tilesetInfo(ts.tiles.length / 32, ts.attributes.length, anime);
  }

  /** 変わることの一覧。 */
  private reportLines(): string[] {
    const p = this.prepared;
    const target = this.client.snapshot.map;
    if (!p) return this.status ? [this.status] : [];
    const r = p.conversion.report;
    const lines: string[] = [];
    if (target) lines.push(t.addAs(target.bank, target.map));
    lines.push(r.family === "emerald" ? t.fromEmerald : t.asIs);
    if (r.packedBlocks > 0) lines.push(t.packedBlocks(r.packedBlocks, r.droppedBlocks));
    if (r.packedTiles > 0) lines.push(t.packedTiles(r.packedTiles, r.droppedTiles));
    if (r.unknownBehaviors.length > 0) lines.push(t.unknownBehaviors(r.unknownBehaviors));
    for (const m of r.movedPalettes) lines.push(t.movedPalette(m.from, m.to));
    for (const m of r.mergedPalettes) lines.push(t.mergedPalette(m.from, m.to));
    if (this.copyLayout.checked) lines.push(t.layout(p.map.width, p.map.height));
    if (this.status) lines.push(this.status);
    return lines;
  }

  private showReport(): void {
    this.report.value = this.reportLines().join("\n");
  }

  /** 取り込んだ後の色とタイルで、選んだマップの配置を描く（取り込まない側は今のマップのタイルセット）。 */
  private drawPreview(): void {
    const p = this.prepared;
    const source = this.source;
    const snap = this.client.snapshot;
    const primary = p?.conversion.primary ? fromConverted(p.conversion.primary) : snap.primary ? fromData(snap.primary) : null;
    const secondary = p?.conversion.secondary ? fromConverted(p.conversion.secondary) : snap.secondary ? fromData(snap.secondary) : null;
    if (!p || !source || !primary || !secondary) {
      resizePixelCanvas(this.preview, 16, 16, 1);
      return;
    }
    const layout = source.layout(p.map.id);
    const renderer = new BlockRenderer(primary, secondary);
    const w = layout.width * BLOCK_PIXELS;
    const h = layout.height * BLOCK_PIXELS;
    resizePixelCanvas(this.preview, w, h, 1);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < layout.height; y++) {
      for (let x = 0; x < layout.width; x++) {
        const cell = p.conversion.cell(layout.blocks[y * layout.width + x]!);
        renderer.blit(cell & 0x3ff, data, w, x * BLOCK_PIXELS, y * BLOCK_PIXELS);
      }
    }
    putRgba(this.preview, data);
  }

  private describe(): unknown {
    const p = this.prepared;
    return {
      rom: this.romPath,
      game: this.source?.game.code ?? null,
      mapCount: this.maps.length,
      selected: p ? p.map.id : null,
      selectedSize: p ? [p.map.width, p.map.height] : null,
      parts: PARTS[this.parts.selectedIndex] ?? "both",
      copyLayout: this.copyLayout.checked,
      report: this.reportLines(),
      conversion: p
        ? {
            primary: p.conversion.primary ? { tiles: p.conversion.primary.tiles.length / 32, blocks: p.conversion.primary.attributes.length } : null,
            secondary: p.conversion.secondary ? { tiles: p.conversion.secondary.tiles.length / 32, blocks: p.conversion.secondary.attributes.length } : null,
            report: p.conversion.report,
          }
        : null,
      target: this.client.snapshot.map,
      jsHeap: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
    };
  }
}

function fromConverted(c: ConvertedTileset): Tileset {
  return tileset(c.secondary, c.tiles, c.palettes, c.blocks, c.attributes);
}

function fromData(d: TilesetData): Tileset {
  const bytes = decodeBase64(d.blocks);
  const blocks = new Uint16Array(bytes.length >> 1);
  for (let i = 0; i < blocks.length; i++) blocks[i] = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8);
  return tileset(d.secondary, decodeBase64(d.tiles), Uint16Array.from(d.palettes), blocks, Uint32Array.from(d.attributes));
}

function tileset(secondary: boolean, tiles: Uint8Array, palettes: Uint16Array, blocks: Uint16Array, attributes: Uint32Array): Tileset {
  return {
    header: { offset: 0, isCompressed: false, isSecondary: secondary, tilesOffset: 0, palettesOffset: 0, blocksOffset: 0, callback: 0, attributesOffset: 0 },
    tiles,
    palettes,
    blocks,
    attributes,
  };
}
