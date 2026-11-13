import { BLOCK_PIXELS, type RgbaImage } from "@zigzagumap/core";
import { ja } from "../i18n/ja";
import { drawEventsOn, placedEvents } from "../ui/map/EventLayer";
import { spriteSourceFor } from "../ui/map/spriteCanvases";
import type { EditorState } from "./EditorState";
import { folderOf, writeFile, type FileDialogs, type FileFilter } from "./FileDialogs";

/** 画像の種類（ツール > マップ画像の保存 / マップ&イベント画像の保存 / パレット画像の保存）。 */
export type ImageKind = "map" | "mapEvent" | "palette";

/**
 * 画像の保存（AdvanceMap と同じく、24 ビットの DIB（BMP と同じ形式）で書く）。
 * - マップ画像: マップのブロックだけ（1 ブロック 16px、境界ブロックとイベントは含まない）
 * - マップ&イベント画像: マップにイベントの印を重ねたもの（オブジェクトの表示がオンなら OW 画像）
 * - パレット画像: ブロックパレット全体（今の横幅、等倍）
 * 保存ダイアログの初期フォルダは前回保存したフォルダ。拡張子が無ければ .DIB を付ける。
 */
export class ImageExport {
  constructor(
    private readonly state: EditorState,
    private readonly files: FileDialogs,
  ) {}

  /** 保存ダイアログを出して保存する。保存したパス（キャンセルなら null）。 */
  async save(kind: ImageKind): Promise<string | null> {
    const image = this.render(kind);
    if (!image) return null;
    const filters: FileFilter[] = [
      { name: ja.dibFilter, extensions: ["DIB"] },
      { name: kind === "palette" ? ja.allFilesGerman : ja.allFiles, extensions: ["*"] },
    ];
    const settings = this.state.settings;
    let path = await this.files.saveFile({ title: ja.saveAsTitle, filters, directory: settings.data.imageDir, fileName: "" });
    if (!path) return null;
    if (!/\.[^\\/.]+$/.test(path)) path += ".DIB";
    await writeFile(path, encodeDib(image));
    settings.update({ imageDir: folderOf(path) });
    return path;
  }

  /** 画像を作る。マップを開いていなければ null。 */
  render(kind: ImageKind): RgbaImage | null {
    const map = this.state.map;
    const mapImage = this.state.mapImage;
    if (!map || !mapImage) return null;
    if (kind === "map") return mapImage.image;
    if (kind === "palette") return map.tiles.paletteImage(this.state.settings.data.paletteWidth);
    const { width, height } = mapImage.image;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d")!;
    c.putImageData(new ImageData(mapImage.image.data, width, height), 0, 0);
    const sprites = this.state.settings.data.showObjects ? spriteSourceFor(this.state.session) : null;
    drawEventsOn(c, placedEvents(map.doc.events), BLOCK_PIXELS, null, sprites);
    const data = c.getImageData(0, 0, width, height);
    return { width, height, data: data.data };
  }
}

/** RGBA を 24 ビットの DIB（BMP。下の行から、1 行を 4 バイト境界にそろえる）にする。 */
export function encodeDib(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const stride = (width * 3 + 3) & ~3;
  const size = 54 + stride * height;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, stride * height, true);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = row + x * 3;
      out[d] = data[s + 2]!;
      out[d + 1] = data[s + 1]!;
      out[d + 2] = data[s]!;
    }
  }
  return out;
}
