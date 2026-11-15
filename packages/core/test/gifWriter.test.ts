import { describe, expect, it } from "vitest";
import { GifWriter, quantizeRgba } from "../src/image/GifWriter.js";

interface DecodedFrame {
  delay: number;
  rgb: number[];
}

/** 確認用の GIF の読み取り（GIF89a の仕様どおりの LZW の伸張）。 */
function readGif(bytes: Uint8Array): { width: number; height: number; loop: number | null; frames: DecodedFrame[] } {
  let p = 0;
  const u8 = (): number => bytes[p++]!;
  const u16 = (): number => u8() | (u8() << 8);
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== "GIF89a") throw new Error(header);
  p = 6;
  const width = u16();
  const height = u16();
  const flags = u8();
  p += 2;
  if (flags & 0x80) p += (1 << ((flags & 7) + 1)) * 3;
  let loop: number | null = null;
  let delay = 0;
  const frames: DecodedFrame[] = [];
  for (;;) {
    const kind = u8();
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = u8();
      const blocks: number[][] = [];
      for (let n = u8(); n > 0; n = u8()) {
        blocks.push([...bytes.subarray(p, p + n)]);
        p += n;
      }
      if (label === 0xf9) delay = blocks[0]![1]! | (blocks[0]![2]! << 8);
      if (label === 0xff && blocks[1]) loop = blocks[1][1]! | (blocks[1][2]! << 8);
      continue;
    }
    if (kind !== 0x2c) throw new Error(`知らないブロック ${kind}`);
    p += 8;
    const f = u8();
    const size = 1 << ((f & 7) + 1);
    const palette = bytes.subarray(p, p + size * 3);
    p += size * 3;
    const min = u8();
    const data: number[] = [];
    for (let n = u8(); n > 0; n = u8()) {
      data.push(...bytes.subarray(p, p + n));
      p += n;
    }
    const clear = 1 << min;
    const end = clear + 1;
    let codeSize = min + 1;
    let table: number[][] = [];
    const reset = (): void => {
      table = [];
      for (let i = 0; i < clear; i++) table.push([i]);
      table.push([], []);
      codeSize = min + 1;
    };
    reset();
    const out: number[] = [];
    let bit = 0;
    let old: number[] | null = null;
    for (;;) {
      let code = 0;
      for (let i = 0; i < codeSize; i++, bit++) code |= ((data[bit >> 3]! >> (bit & 7)) & 1) << i;
      if (code === clear) {
        reset();
        old = null;
        continue;
      }
      if (code === end) break;
      let entry: number[];
      if (old === null) entry = table[code]!;
      else {
        entry = code < table.length ? table[code]! : [...old, old[0]!];
        if (table.length < 4096) table.push([...old, entry[0]!]);
        if (table.length === 1 << codeSize && codeSize < 12) codeSize++;
      }
      out.push(...entry);
      old = entry;
    }
    const rgb: number[] = [];
    for (const i of out) rgb.push(palette[i * 3]!, palette[i * 3 + 1]!, palette[i * 3 + 2]!);
    frames.push({ delay, rgb });
  }
  return { width, height, loop, frames };
}

function rgbOf(rgba: Uint8ClampedArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) out.push(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
  return out;
}

describe("GIF の書き出し（#403）", () => {
  it("256 色以下のコマは色が変わらずに読み直せる", () => {
    const w = 64;
    const h = 48;
    const gif = new GifWriter(w, h);
    const frames: Uint8ClampedArray[] = [];
    for (let f = 0; f < 3; f++) {
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        // 200 色ほどの並び（LZW の表が 4096 まで埋まって作り直すように、ばらけた並びにする）
        const c = ((i * 7919 + f * 31) % 200) + 1;
        rgba.set([c, (c * 3) & 0xff, (c * 5) & 0xff, 255], i * 4);
      }
      frames.push(rgba);
      gif.addFrame(rgba, 120);
    }
    const r = readGif(gif.finish());
    expect([r.width, r.height, r.loop]).toEqual([w, h, 0]);
    expect(r.frames.length).toBe(3);
    r.frames.forEach((f, i) => {
      expect(f.delay).toBe(12);
      expect(f.rgb).toEqual(rgbOf(frames[i]!));
    });
  });

  it("同じ色が続く大きなコマ（表が長い並びで埋まる）", () => {
    const w = 300;
    const h = 200;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set(i % 1000 < 900 ? [10, 20, 30, 255] : [200, 100, 0, 255], i * 4);
    const gif = new GifWriter(w, h, { loop: 3 });
    gif.addFrame(rgba, 50);
    const r = readGif(gif.finish());
    expect(r.loop).toBe(3);
    expect(r.frames[0]!.rgb).toEqual(rgbOf(rgba));
  });

  it("色が 256 を超えると固定の色に寄せる", () => {
    const rgba = new Uint8ClampedArray(1024 * 4);
    for (let i = 0; i < 1024; i++) rgba.set([i & 0xff, (i >> 2) & 0xff, 255 - (i & 0xff), 255], i * 4);
    const q = quantizeRgba(rgba, 1024);
    expect(q.colors).toBe(252);
    for (let i = 0; i < 1024; i++) {
      const c = q.indices[i]!;
      expect(Math.abs(q.palette[c * 3]! - rgba[i * 4]!)).toBeLessThanOrEqual(26);
    }
  });

  it("1 色のコマ・1 画素の GIF", () => {
    const gif = new GifWriter(1, 1);
    gif.addFrame(new Uint8ClampedArray([5, 6, 7, 255]), 0);
    expect(readGif(gif.finish()).frames[0]!.rgb).toEqual([5, 6, 7]);
  });
});
