import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createImage, decodeIndexedPng, FOLLOWER_ID, followerAssets, followerFrame, followerPalette, followerSceneActors, FollowerSheet, FollowerSimulation, followerStatus, parseFollowerIndex,
  type IndexedImage, type MovementDirection,
} from "../src/index.js";

const SPECIES_H = `
#define SPECIES_NONE 0x0
#define SPECIES_BULBASAUR 0x1
#define SPECIES_IVYSAUR 0x2
#define SPECIES_HIPPOPOTAS 0x10
#define SPECIES_HIPPOPOTAS_F 0x20
#define SPECIES_LAST 0x30
#define NUM_SPECIES (SPECIES_LAST + 1)
`;

/** size×(size×6) のシート。コマ k の右上の点を色 k+1 にし、横向きのコマは左端から left 画素に点を打つ。 */
function sheet(size: number, left = (size - 16) / 2): IndexedImage {
  const pixels = new Uint8Array(size * size * 6);
  for (let k = 0; k < 6; k++) pixels[k * size * size + size - 2] = k + 1;
  for (const k of [4, 5]) pixels[(k * size + size - 1) * size + left] = 7;
  const palette = new Uint8Array(48);
  for (let i = 0; i < 16; i++) palette.set([i * 16, 255 - i * 16, 8 * i], i * 3);
  return { width: size, height: size * 6, pixels, palette };
}

describe("連れ歩きの絵の一覧", () => {
  const index = parseFollowerIndex({
    ow32: ["owm0001.png", "owm0001.s", "owm0002.png", "owm0002_F.png", "owm0010.png", "owm0020.png", "bad.png", "owm0031.png"],
    ow64: ["owm0003.png"],
    pal: ["owm0001_S.png", "owm0002_FS.png", "owm0020_S.png"],
  }, SPECIES_H);

  it("NUM_SPECIES と、名前の形・範囲外のファイル", () => {
    expect(index.numSpecies).toBe(0x31);
    expect([...index.entries.keys()]).toEqual([1, 2, 3, 0x10, 0x20]);
    expect(index.ignored).toEqual(["ow/32/bad.png"]);
    expect(index.outOfRange).toEqual(["ow/32/owm0031.png"]);
    expect(index.entries.get(3)!.big).toBe(true);
  });

  it("メス・色違いの代わりの規則と、別の番号のメス（ヒポポタス）", () => {
    expect(followerAssets(index, 1, { female: true, shiny: true })).toMatchObject({ sheet: "ow/32/owm0001.png", palette: "ow/pal/owm0001_S.png", fallback: false });
    expect(followerAssets(index, 2, { female: true, shiny: false })!.sheet).toBe("ow/32/owm0002_F.png");
    expect(followerAssets(index, 2, { female: true, shiny: true })!.palette).toBe("ow/pal/owm0002_FS.png");
    // オスの色違いのパレットが無ければ、そのシートのパレット
    expect(followerAssets(index, 2, { female: false, shiny: true })!.palette).toBe("ow/32/owm0002.png");
    const hippo = followerAssets(index, 0x10, { female: true, shiny: true })!;
    expect([hippo.sheet, hippo.palette]).toEqual(["ow/32/owm0020.png", "ow/pal/owm0020_S.png"]);
    // 絵の無い種族はフシギダネ
    expect(followerAssets(index, 0x2f, { female: false, shiny: false })).toMatchObject({ sheet: "ow/32/owm0001.png", fallback: true });
    expect(followerAssets(parseFollowerIndex({ ow32: [], ow64: [], pal: [] }, SPECIES_H), 1, { female: false, shiny: false })).toBeNull();
  });
});

describe("シート", () => {
  it("コマ・左右反転・色 0 の透明・パレットの丸め", () => {
    const image = sheet(32);
    const s = FollowerSheet.from(image, false);
    const palette = followerPalette(image);
    expect(palette[1]).toBe((16 >> 3) | ((239 >> 3) << 5) | ((8 >> 3) << 10));
    const f3 = s.frame(3, false, palette);
    expect([...f3.data.slice(30 * 4, 31 * 4)]).toEqual([66, 189, 33, 255]);
    expect(f3.data[3]).toBe(0);
    const flipped = s.frame(3, true, palette);
    expect(flipped.data[1 * 4 + 3]).toBe(255);
    expect(() => FollowerSheet.from(sheet(32), true)).toThrow();
  });

  it("横向きのはみ出し", () => {
    expect(FollowerSheet.from(sheet(32), false).sideOffset()).toBe(0);
    expect(FollowerSheet.from(sheet(32, 3), false).sideOffset()).toBe(5);
    expect(FollowerSheet.from(sheet(64, 10), true).sideOffset()).toBe(14);
  });
});

describe("有効かの判定", () => {
  const guarded = "#ifdef POKEMON_FOLLOWERS\nvoid f(void){}\n#endif\n";
  it("ND の作り（囲まない）は定義が無くても有効、Chronos の作りは定義が要る", () => {
    expect(followerStatus({ project: true, followerSource: "void f(void){}", configH: "", dpe: true, sheets: 10 })).toEqual({ enabled: true });
    expect(followerStatus({ project: true, followerSource: guarded, configH: "//#define POKEMON_FOLLOWERS\n", dpe: true, sheets: 10 })).toEqual({ enabled: false, reason: "disabled" });
    expect(followerStatus({ project: true, followerSource: guarded, configH: "#define POKEMON_FOLLOWERS\n", dpe: true, sheets: 10 })).toEqual({ enabled: true });
    expect(followerStatus({ project: true, followerSource: null, configH: "", dpe: true, sheets: 10 })).toMatchObject({ reason: "noSource" });
    expect(followerStatus({ project: true, followerSource: "x", configH: "", dpe: false, sheets: 0 })).toMatchObject({ reason: "noDpe" });
    expect(followerStatus({ project: true, followerSource: "x", configH: "", dpe: true, sheets: 0 })).toMatchObject({ reason: "noSheets" });
    expect(followerStatus({ project: false, followerSource: null, configH: null, dpe: false, sheets: 0 })).toMatchObject({ reason: "noProject" });
  });

  const nd = process.env.ZIGZAGU_ND_DIR, chronos = process.env.ZIGZAGU_CHRONOS_DIR;
  it.skipIf(!nd)("ND の写しは有効で、DPE の 32・64 のシートを読める", () => {
    const dpe = join(dirname(nd!), "NeoDark-DPE-main");
    const list = (f: string) => existsSync(join(dpe, "graphics", f)) ? readdirSync(join(dpe, "graphics", f)) : [];
    const index = parseFollowerIndex({ ow32: list("ow/32"), ow64: list("ow/64"), pal: list("ow/pal") }, readFileSync(join(dpe, "include/species.h"), "utf8"));
    expect(index.entries.size).toBeGreaterThan(700);
    const status = followerStatus({ project: true, followerSource: readFileSync(join(nd!, "src/follower_mon.c"), "utf8"), configH: readFileSync(join(nd!, "src/config.h"), "utf8"), dpe: true, sheets: index.entries.size });
    expect(status).toEqual({ enabled: true });
    for (const big of [false, true]) {
      const entry = [...index.entries.values()].find(e => e.big === big)!;
      const image = decodeIndexedPng(readFileSync(join(dpe, "graphics", entry.sheet)));
      const s = FollowerSheet.from(image, big);
      const f = s.frame(4, true, followerPalette(image));
      expect(f.width).toBe(big ? 64 : 32);
      expect(f.data.some((v, i) => i % 4 === 3 && v === 255)).toBe(true);
    }
  });
  it.skipIf(!chronos)("Chronos の写しは無効（POKEMON_FOLLOWERS が無い）", () => {
    const root = existsSync(join(chronos!, "src/config.h")) ? chronos! : join(chronos!, "cfru");
    const source = existsSync(join(root, "src/follower_mon.c")) ? readFileSync(join(root, "src/follower_mon.c"), "utf8") : null;
    expect(followerStatus({ project: true, followerSource: source, configH: readFileSync(join(root, "src/config.h"), "utf8"), dpe: true, sheets: 1 }).enabled).toBe(false);
  });
});

describe("付いてくる動き", () => {
  const noLedge = () => false;
  function run(sim: FollowerSimulation, frames = 200) { const out = []; for (let i = 0; i < frames; i++) { sim.step(); out.push(sim.actor(3)); } return out; }

  it("直線: 主人公が居たマスへ 16 フレームで歩く", () => {
    const sim = new FollowerSimulation({ x: 5, y: 4, facing: "down" });
    sim.playerMoved({ x: 5, y: 5 }, { x: 5, y: 6 }, noLedge);
    const states = run(sim, 17);
    expect(states[0]!.movementId).toBe(0x10);
    expect(states[0]!.pixelY).toBe(4 * 16 + 1);
    expect(states[15]!).toMatchObject({ tileX: 5, tileY: 5, pixelY: 80 });
    expect(states[16]!.movementId).toBeNull();
    expect(sim.busy).toBe(false);
  });

  it("曲がり角と戻る動き", () => {
    const sim = new FollowerSimulation({ x: 5, y: 4, facing: "down" });
    sim.playerMoved({ x: 5, y: 5 }, { x: 6, y: 5 }, noLedge);
    run(sim, 20);
    expect([sim.tileX, sim.tileY, sim.facing]).toEqual([5, 5, "down"]);
    sim.playerMoved({ x: 6, y: 5 }, { x: 5, y: 5 }, noLedge);
    const s = run(sim, 20);
    expect([sim.tileX, sim.tileY, sim.facing]).toEqual([6, 5, "right"]);
    expect(s[0]!.movementId).toBe(0x13);
  });

  it("歩いている間の続けての移動と、素早いドラッグは速い歩きで道を追う", () => {
    const sim = new FollowerSimulation({ x: 0, y: 0, facing: "right" });
    sim.playerMoved({ x: 1, y: 0 }, { x: 2, y: 0 }, noLedge);
    sim.step();
    sim.playerMoved({ x: 2, y: 0 }, { x: 4, y: 2 }, noLedge);
    const s = run(sim, 100);
    expect([sim.tileX, sim.tileY]).toEqual([4, 1]);
    expect(s.some(a => a.movementId === 0x35 + 3)).toBe(true);
    // 最後の 1 歩は追いついているので普通の歩き
    expect(s.some(a => a.movementId === 0x10)).toBe(true);
  });

  it("覚える歩数を越えても主人公の後ろに着く", () => {
    const sim = new FollowerSimulation({ x: 0, y: 0, facing: "right" });
    sim.playerMoved({ x: 1, y: 0 }, { x: 9, y: 0 }, noLedge);
    run(sim, 200);
    expect([sim.tileX, sim.tileY]).toEqual([8, 0]);
  });

  it("遠くへ置き直したら後ろへ移る", () => {
    const sim = new FollowerSimulation({ x: 0, y: 0, facing: "right" });
    sim.playerMoved({ x: 1, y: 0 }, { x: 30, y: 0 }, noLedge);
    expect([sim.tileX, sim.tileY, sim.busy]).toEqual([29, 0, false]);
  });

  it("段差は 2 マスのジャンプで越える", () => {
    const ledge = (x: number, y: number, d: MovementDirection) => x === 5 && y === 6 && d === "down";
    const sim = new FollowerSimulation({ x: 5, y: 4, facing: "down" });
    sim.playerMoved({ x: 5, y: 5 }, { x: 5, y: 8 }, ledge);
    const s = run(sim, 80);
    expect([sim.tileX, sim.tileY]).toEqual([5, 7]);
    expect(s.some(a => a.movementId === 0x14 && a.height < 0)).toBe(true);
  });

  it("歩きのコマ: 歩き・立ち・反転した歩き・立ち、東は西の反転", () => {
    expect([0, 8, 16, 24].map(t => followerFrame("down", true, t))).toEqual([{ index: 1, hFlip: false }, { index: 0, hFlip: false }, { index: 1, hFlip: true }, { index: 0, hFlip: false }]);
    expect(followerFrame("right", true, 0)).toEqual({ index: 5, hFlip: true });
    expect(followerFrame("up", false, 99)).toEqual({ index: 2, hFlip: false });
  });

  it("64×64 は 8 枚。外の列は前景の上、真ん中は主人公との位置で変わる", () => {
    const state = { ...new FollowerSimulation({ x: 5, y: 5, facing: "down" }).actor(3) };
    const image = createImage(64, 64);
    const pieces = followerSceneActors({ state, image, sideOffset: 0, player: { x: 5, y: 6 }, covered: () => true, viewY: 0 });
    expect(pieces).toHaveLength(8);
    expect(pieces.map(p => p.priority)).toEqual([1, 1, 1, 1, 1, 2, 2, 1]);
    expect(pieces[0]!.state.pixelX).toBe(5 * 16 + 8 - 32);
    const behind = followerSceneActors({ state, image, sideOffset: 0, player: { x: 5, y: 4 }, covered: () => false, viewY: 0 });
    expect(behind.map(p => p.priority)).toEqual([1, 2, 2, 1, 2, 2, 2, 2]);
    expect(state.id).toBe(FOLLOWER_ID);
    const side = followerSceneActors({ state: { ...state, facing: "left" }, image: createImage(32, 32), sideOffset: 3, player: { x: 7, y: 5 }, covered: () => true, viewY: 0 });
    expect(side[0]!.state.pixelX).toBe(state.pixelX - 3);
  });
});
