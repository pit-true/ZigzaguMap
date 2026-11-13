import { invoke } from "@tauri-apps/api/core";
import {
  BvdFile,
  PaletteFile,
  TILE_BYTES,
  decodeTileImage,
  encodeBase64,
  encodeTilesDib,
} from "@zigzagumap/core";
import { FileDialogs, folderOf, writeFile, type FileFilter } from "../../app/FileDialogs";
import { ja } from "../../i18n/ja";
import { jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { inputDialog } from "../../ui/InputDialog";
import { showError, showInfo } from "../../ui/MessageBox";
import type { ToolClient } from "../ToolClient";
import type { TilesetModel } from "../TilesetModel";
import type { TilesetData } from "../protocol";
import { errorText } from "../../util/errors";

/** 入出力が使う、ウィンドウの今の状態。 */
export interface TilesetIoHost {
  readonly client: ToolClient;
  readonly model: TilesetModel;
  /** 選んでいるパレット（Palette0〜12）。 */
  readonly palette: number;
}

/**
 * ブロックエディタのファイルの入出力（メニューの「マップチップ」「ブロック」「パレット」の保存・開く・ブロック量）。
 * 読み込んだ内容はコマンドにしてメインの CommandBus で実行する（Ctrl+Z で戻せる）。
 * パレットファイルを開いたときは、AdvanceMap と同じく一時適用の色に入れる（「パレットの変更を反映する」で確定）。
 */
export class TilesetIo {
  readonly files = new FileDialogs();
  /** 前に選んだフォルダ（このウィンドウを開いている間だけ覚える）。 */
  private directory: string | null = null;

  constructor(private readonly host: TilesetIoHost) {}

  // ---- マップチップ（タイルセットの画像） ----

  /** タイルセット 1/2 の保存（24 ビットの DIB と、同じ名前の .pal）。 */
  async saveTilesetImage(secondary: boolean): Promise<void> {
    const data = this.tileset(secondary);
    const colors = this.host.model.colors(this.host.palette);
    try {
      PaletteFile.write(colors, true);
    } catch {
      await showError(t.duplicateColors);
      return;
    }
    let path = await this.files.saveFile({
      title: t.saveAs,
      filters: [filter(t.dibFilter, "dib"), filter(ja.allFiles, "*")],
      directory: this.directory,
      fileName: `Tileset${data.index ?? ""}.dib`,
    });
    if (!path) return;
    if (!/\.[^\\/.]+$/.test(path)) path += ".dib";
    await writeFile(path, encodeTilesDib(this.host.model.tilesOf(secondary), colors, data.tileCapacity));
    await writeFile(path.replace(/\.[^\\/.]+$/, ".pal"), PaletteFile.write(colors));
    this.directory = folderOf(path);
  }

  /**
   * タイルセット 1/2 を開く（DIB・BMP・インデックス PNG）。24 ビットの画像は選んでいるパレットの色から番号を決める。
   * 上限を超える分は捨てる。今のタイル数より後ろの空のタイルは足さない。
   */
  async openTilesetImage(secondary: boolean): Promise<void> {
    const data = this.tileset(secondary);
    const path = await this.files.openFile({
      title: t.open,
      filters: [filter(t.dibFilter, "dib"), filter(t.bmpFilter, "bmp"), filter(t.pngFilter, "png"), filter(ja.allFiles, "*")],
      directory: this.directory,
      fileName: `Tileset${data.index ?? ""}`,
    });
    if (!path) {
      await showInfo(t.tilesetImageCanceled);
      return;
    }
    this.directory = folderOf(path);
    let decoded: { tiles: Uint8Array; tileCount: number };
    try {
      decoded = decodeTileImage(await readBytes(path), this.host.model.colors(this.host.palette));
    } catch (e) {
      await showError(errorText(e));
      return;
    }
    const current = this.host.model.tilesOf(secondary).length / TILE_BYTES;
    let used = 0;
    for (let i = 0; i < decoded.tileCount; i++) {
      if (decoded.tiles.subarray(i * TILE_BYTES, (i + 1) * TILE_BYTES).some((b) => b !== 0)) used = i + 1;
    }
    const count = Math.min(data.tileCapacity, Math.max(current, used));
    if (used > data.tileCapacity) await showInfo(t.tilesTooMany(used, data.tileCapacity));
    const tiles = new Uint8Array(count * TILE_BYTES);
    tiles.set(decoded.tiles.subarray(0, Math.min(decoded.tiles.length, tiles.length)));
    await this.execute("setTiles", { tileset: data.pointer, secondary, start: 0, data: encodeBase64(tiles) });
  }

  // ---- ブロック（.bvd） ----

  /** ブロックデータの保存（.bvd）。 */
  async saveBlocks(secondary: boolean): Promise<void> {
    const data = this.tileset(secondary);
    let path = await this.files.saveFile({
      title: t.saveAs,
      filters: [filter(t.bvdFilter, "bvd"), filter(ja.allFiles, "*")],
      directory: this.directory,
      fileName: `Tileset${data.index ?? ""}.bvd`,
    });
    if (!path) {
      await showInfo(t.blockSaveCanceled);
      return;
    }
    if (!/\.[^\\/.]+$/.test(path)) path += ".bvd";
    const { blocks, attributes } = this.host.model.blockData(secondary);
    await writeFile(path, BvdFile.write(blocks, attributes));
    this.directory = folderOf(path);
  }

  /** ブロックデータを開く（.bvd。ブロック数も .bvd の数になる）。 */
  async openBlocks(secondary: boolean): Promise<void> {
    const data = this.tileset(secondary);
    const path = await this.files.openFile({
      title: t.blockData,
      filters: [filter(t.bvdFilter, "bvd"), filter(ja.allFiles, "*")],
      directory: this.directory,
      fileName: `Tileset${data.index ?? ""}`,
    });
    if (!path) {
      await showInfo(t.bvdLoadCanceled);
      return;
    }
    this.directory = folderOf(path);
    let bvd;
    try {
      bvd = BvdFile.read(await readBytes(path), data.blockCapacity);
    } catch (e) {
      await showError(errorText(e));
      return;
    }
    await this.execute("setBlockData", { tileset: data.pointer, secondary, blocks: [...bvd.blocks], attributes: [...bvd.attributes] });
  }

  /** ブロック量の追加/変更（タイルセット 2。上限を超える値は上限に丸める）。 */
  async changeBlockAmount(): Promise<void> {
    const data = this.tileset(true);
    const text = await inputDialog(t.blockAmount, t.blockAmountPrompt(data.blockCapacity), String(data.attributes.length));
    if (text === null) {
      await showInfo(t.blockAmountCanceled);
      return;
    }
    if (!/^\s*[+-]?\d+\s*$/.test(text)) {
      await showError(ja.invalidInteger(text), ja.appTitle);
      return;
    }
    const count = Math.max(1, Math.min(data.blockCapacity, Number(text)));
    // AdvanceMap と同じく、数が変わらないときは「中止しました」と出す
    if (count === data.attributes.length) {
      await showInfo(t.blockAmountCanceled);
      return;
    }
    await this.execute("setBlockCount", { tileset: data.pointer, secondary: true, count });
  }

  // ---- パレットファイル ----

  /** パレットファイルの保存（選んでいるパレットの 16 色。一時適用した色を含む）。 */
  async savePalette(): Promise<void> {
    const palette = this.host.palette;
    let path = await this.files.saveFile({
      title: t.saveAs,
      filters: [filter(t.palFilter, "pal"), filter(ja.allFiles, "*")],
      directory: this.directory,
      fileName: `Pal${palette}.pal`,
    });
    if (!path) return;
    if (!/\.[^\\/.]+$/.test(path)) path += ".pal";
    await writeFile(path, PaletteFile.write(this.host.model.colors(palette)));
    this.directory = folderOf(path);
  }

  /** パレットファイルを開く（選んでいるパレットの一時適用の色にする）。 */
  async openPalette(): Promise<void> {
    const palette = this.host.palette;
    const path = await this.files.openFile({
      title: t.open,
      filters: [filter(t.palFilter, "pal"), filter(ja.allFiles, "*")],
      directory: this.directory,
      fileName: `Pal${palette}`,
    });
    if (!path) return;
    this.directory = folderOf(path);
    let bytes: Uint8Array;
    try {
      bytes = await readBytes(path);
    } catch {
      await showError(t.paletteFileMissing);
      return;
    }
    let colors: number[];
    try {
      colors = PaletteFile.read(bytes);
    } catch {
      await showError(t.paletteFileSize(bytes.length));
      return;
    }
    await this.host.client.setUi({ preview: { [palette]: colors } });
  }

  // ---- 内部 ----

  private tileset(secondary: boolean): TilesetData {
    const data = secondary ? this.host.model.secondary : this.host.model.primary;
    if (!data) throw new Error(t.notOpen);
    return data;
  }

  private async execute(name: string, args: Record<string, unknown>): Promise<void> {
    try {
      await this.host.client.execute(name, args);
    } catch (e) {
      await showError(errorText(e));
    }
  }
}

function filter(name: string, extension: string): FileFilter {
  return { name, extensions: [extension] };
}

async function readBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("read_rom", { path }));
}

