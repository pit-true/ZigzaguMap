/**
 * AdvanceMap の「マップ画像の保存」で書いた DIB と、core の描画を全マップで画素比較する確認用ツール。
 *
 *   pnpm --filter @zigzagumap/core compare-map-images -- <rom> <DIB のフォルダ> [--json <out.json>]
 *
 * DIB は `m<バンク>_<マップ>.DIB`（tools/am-harness/export_map_images.py が書く名前）。
 * 色は各成分を 5 ビットに落として比べる（AdvanceMap と 8 ビットへの広げ方が違うため）。
 * 違うマップは、違う画素の数と違うマス（16×16）の先頭 8 個を出す。
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RomMapSource, renderMap, requireSupportedGame, Rom } from "@zigzagumap/core";

interface Bitmap {
  readonly width: number;
  readonly height: number;
  /** RGB を 1 画素 3 バイトで上の行から。 */
  readonly rgb: Uint8Array;
}

/** 24 ビットの DIB（BMP）を読む。 */
function readDib(bytes: Uint8Array): Bitmap | null {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataOffset = v.getUint32(10, true);
  const width = v.getInt32(18, true);
  const rawHeight = v.getInt32(22, true);
  if (v.getUint16(28, true) !== 24) return null;
  const height = Math.abs(rawHeight);
  const stride = (width * 3 + 3) & ~3;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const srcRow = rawHeight > 0 ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const s = dataOffset + srcRow * stride + x * 3;
      const d = (y * width + x) * 3;
      rgb[d] = bytes[s + 2]!;
      rgb[d + 1] = bytes[s + 1]!;
      rgb[d + 2] = bytes[s]!;
    }
  }
  return { width, height, rgb };
}

interface MapResult {
  readonly id: string;
  readonly status: "same" | "diff" | "size" | "error";
  readonly pixels?: number;
  readonly cells?: string[];
  readonly detail?: string;
}

function main(): void {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const jsonAt = argv.indexOf("--json");
  const jsonOut = jsonAt >= 0 ? argv.splice(jsonAt, 2)[1] : undefined;
  const [romPath, dibDir] = argv;
  if (!romPath || !dibDir) {
    console.error("使い方: compare-map-images <rom> <DIB のフォルダ> [--json <out.json>]");
    process.exit(2);
  }
  const rom = new Rom(new Uint8Array(readFileSync(romPath)));
  const source = new RomMapSource(rom, requireSupportedGame(rom).offsets);
  const files = readdirSync(dibDir)
    .map((f) => /^m(\d+)_(\d+)\.DIB$/i.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ file: m[0], bank: Number(m[1]), map: Number(m[2]) }))
    .sort((a, b) => a.bank - b.bank || a.map - b.map);

  const results: MapResult[] = [];
  for (const f of files) {
    const id = `${f.bank}.${f.map}`;
    const bytes = new Uint8Array(readFileSync(join(dibDir, f.file)));
    const am = readDib(bytes);
    if (!am) {
      results.push({ id, status: "error", detail: `DIB を読めない（${bytes.length} バイト）` });
      continue;
    }
    let image;
    try {
      const doc = source.read({ bank: f.bank, map: f.map });
      const primary = source.readTileset(doc.primaryTileset, false);
      const secondary = source.readTileset(doc.secondaryTileset, true);
      image = renderMap(doc.toRenderable(primary, secondary));
    } catch (e) {
      results.push({ id, status: "error", detail: e instanceof Error ? e.message : String(e) });
      continue;
    }
    if (image.width !== am.width || image.height !== am.height) {
      results.push({ id, status: "size", detail: `AdvanceMap ${am.width}x${am.height}、core ${image.width}x${image.height}` });
      continue;
    }
    let pixels = 0;
    const cells = new Set<string>();
    for (let y = 0; y < am.height; y++) {
      for (let x = 0; x < am.width; x++) {
        const a = (y * am.width + x) * 3;
        const z = (y * am.width + x) * 4;
        if (am.rgb[a]! >> 3 !== image.data[z]! >> 3 || am.rgb[a + 1]! >> 3 !== image.data[z + 1]! >> 3 || am.rgb[a + 2]! >> 3 !== image.data[z + 2]! >> 3) {
          pixels++;
          cells.add(`(${x >> 4},${y >> 4})`);
        }
      }
    }
    results.push(pixels === 0 ? { id, status: "same" } : { id, status: "diff", pixels, cells: [...cells] });
  }

  const count = (s: MapResult["status"]) => results.filter((r) => r.status === s).length;
  console.log(`マップ ${results.length} 枚: 一致 ${count("same")}、画素の違い ${count("diff")}、大きさの違い ${count("size")}、エラー ${count("error")}`);
  for (const r of results) {
    if (r.status === "same") continue;
    const cells = r.cells ? ` ${r.cells.length} マス: ${r.cells.slice(0, 8).join(" ")}${r.cells.length > 8 ? " …" : ""}` : "";
    console.log(`  ${r.id} ${r.status}${r.pixels ? ` ${r.pixels} 画素` : ""}${cells}${r.detail ? ` ${r.detail}` : ""}`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  if (count("same") !== results.length) process.exitCode = 1;
}

main();
