/**
 * マップを PNG に書く確認用ツール。
 *
 *   pnpm --filter @zigzagumap/core dump-map -- <rom> <bank> <map> <out.png> [--events] [--project <CFRU-JP のフォルダ>]
 *
 * --events  人・ワープ・スクリプトタイル・看板の位置を枠で重ねる。
 * --project maps\ の JSON があればそれを優先して描く（CfruProject を使う）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { CfruProject, RomMapSource, renderMap, requireSupportedGame, Rom } from "@zigzagumap/core";
import type { MapDocument, RgbaImage, Tileset } from "@zigzagumap/core";
import { NodeProjectFs } from "@zigzagumap/core/node";

/** 枠の色（RGB）。 */
const EVENT_COLORS = {
  person: [255, 64, 64],
  warp: [64, 224, 64],
  trap: [255, 224, 0],
  sign: [64, 160, 255],
} as const;
/** 1 ブロックのピクセル数。 */
const BLOCK = 16;

function usage(): never {
  console.error("使い方: dump-map <rom> <bank> <map> <out.png> [--events] [--project <dir>]");
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let events = false;
  let project: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    if (a === "--events") events = true;
    else if (a === "--project") project = argv[++i] ?? usage();
    else positional.push(a);
  }
  if (positional.length !== 4) usage();
  const [rom, bank, map, out] = positional as [string, string, string, string];
  return { rom, bank: Number(bank), map: Number(map), out, events, project };
}

/** 枠を描く（太さ 2 ピクセル）。 */
function drawFrame(image: RgbaImage, x: number, y: number, color: readonly number[]): void {
  const px = x * BLOCK;
  const py = y * BLOCK;
  for (let dy = 0; dy < BLOCK; dy++) {
    for (let dx = 0; dx < BLOCK; dx++) {
      const edge = dx < 2 || dy < 2 || dx >= BLOCK - 2 || dy >= BLOCK - 2;
      if (!edge) continue;
      const ix = px + dx;
      const iy = py + dy;
      if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) continue;
      const o = (iy * image.width + ix) * 4;
      image.data[o] = color[0]!;
      image.data[o + 1] = color[1]!;
      image.data[o + 2] = color[2]!;
      image.data[o + 3] = 255;
    }
  }
}

function drawEvents(image: RgbaImage, doc: MapDocument): void {
  const ev = doc.events;
  if (!ev) return;
  for (const p of ev.persons) drawFrame(image, p.x, p.y, EVENT_COLORS.person);
  for (const w of ev.warps) drawFrame(image, w.x, w.y, EVENT_COLORS.warp);
  for (const t of ev.traps) drawFrame(image, t.x, t.y, EVENT_COLORS.trap);
  for (const s of ev.signs) drawFrame(image, s.x, s.y, EVENT_COLORS.sign);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** RGBA の画像を PNG にする。 */
function encodePng(image: RgbaImage): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, image.width);
  v.setUint32(4, image.height);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 6; // RGBA
  const stride = image.width * 4;
  const raw = new Uint8Array((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const romBytes = new Uint8Array(readFileSync(args.rom));
  const id = { bank: args.bank, map: args.map };
  let doc: MapDocument;
  let tilesets: { primary: Tileset; secondary: Tileset };
  if (args.project) {
    const project = await CfruProject.open(romBytes, new NodeProjectFs(args.project));
    doc = await project.load(id);
    tilesets = await project.loadTilesets(doc);
  } else {
    const rom = new Rom(romBytes);
    const source = new RomMapSource(rom, requireSupportedGame(rom).offsets);
    doc = source.read(id);
    tilesets = { primary: source.readTileset(doc.primaryTileset, false), secondary: source.readTileset(doc.secondaryTileset, true) };
  }
  const image = renderMap(doc.toRenderable(tilesets.primary, tilesets.secondary));
  if (args.events) drawEvents(image, doc);
  writeFileSync(args.out, encodePng(image));
  const name = doc.mapNameText();
  console.log(`マップ ${id.bank}.${id.map}${name ? `（${name}）` : ""} ${doc.width}×${doc.height} → ${args.out}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
