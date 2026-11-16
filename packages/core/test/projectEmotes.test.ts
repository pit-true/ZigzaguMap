import { expect, it } from "vitest";
import { ProjectEmotes, type IndexedImage } from "../src/index.js";
import { NodeProjectFs } from "../src/node/index.js";

function fixture() {
  const palette = new Uint8Array(48); palette.set([255, 0, 0], 3); palette.set([0, 255, 0], 6);
  const human: IndexedImage = { width: 16, height: 80, palette: new Uint8Array(48), pixels: new Uint8Array(16 * 80).fill(1) };
  const mon: IndexedImage = { width: 16, height: 352, palette, pixels: new Uint8Array(16 * 352).fill(1) };
  mon.pixels.fill(2, 256, 512); human.pixels[0] = 0;
  return new ProjectEmotes(human, mon);
}

it("人用にもポケモン用のパレットを使い、色0を透かす", () => {
  const emotes = fixture(), image = emotes.frame("emote_exclaim", 0)!;
  expect([...image.data.slice(0, 8)]).toEqual([0, 0, 0, 0, 255, 0, 0, 255]);
  expect(emotes.frame("emote_exclaim", 0)).toEqual(emotes.frame("emote_exclaim", 59));
});

it("ポケモン用は24フレームで2枚目へ替え、60フレームで終わる", () => {
  const emotes = fixture();
  expect([...emotes.frame("emote_mon_exclaim", 23)!.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  expect([...emotes.frame("emote_mon_exclaim", 24)!.data.slice(0, 4)]).toEqual([0, 255, 0, 255]);
  expect(emotes.frame("emote_mon_exclaim", 60)).toBeNull(); expect(emotes.frame("unknown", 0)).toBeNull();
});

it("全OBJの色が同じなら時間帯を反映し、割り当てが必要なら診断用にnullを返す", () => {
  const emotes = fixture();
  expect(emotes.frame("emote_music", 0, colors => { const copy = Uint16Array.from(colors); copy[1] = 31 << 10; return copy; })!.data.slice(0, 4)).toEqual(new Uint8ClampedArray([0, 0, 255, 255]));
  expect(emotes.frame("emote_music", 0, (colors, slot) => { const copy = Uint16Array.from(colors); if (slot) copy[1] = 0; return copy; })).toBeNull();
});

it.skipIf(!process.env.ZIGZAGU_ND_DIR)("実プロジェクトのPNGと設定を読み、16種類を描く", async () => {
  const emotes = await ProjectEmotes.read(new NodeProjectFs(process.env.ZIGZAGU_ND_DIR!));
  expect(emotes).not.toBeNull();
  for (const name of ["exclaim", "question", "ellipsis", "double_exclaim", "music", "mon_exclaim", "mon_question", "mon_ellipsis", "mon_music", "mon_heart", "mon_poison", "mon_happy", "mon_very_happy", "mon_sad", "mon_upset", "mon_angry"]) {
    for (const f of [0, 24, 59]) expect(emotes!.frame(`emote_${name}`, f)?.data.some(value => value > 0)).toBe(true);
  }
});
