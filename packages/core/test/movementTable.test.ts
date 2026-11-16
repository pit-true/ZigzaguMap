import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  JUMP_HEIGHTS_HIGH,
  JUMP_HEIGHTS_MID,
  knownMovementIds,
  movementAction,
  movementIdByName,
  movementName,
  movementPixelTotal,
  movementWithDirection,
} from "../src/index.js";

describe("移動コマンドの表（#448）", () => {
  const frames = (id: number) => movementAction(id).frames;

  it("命令ごとのフレーム数", () => {
    const expected: [number, number][] = [
      [0x08, 31], // very_slow
      [0x0c, 23], // slow
      [0x10, 16], // walk
      [0x1d, 8], // run（2 倍の歩き）
      [0x31, 6], // slide_slow（3 倍）
      [0x35, 4], // slide（4 倍）
      [0x39, 2], // slide_fast（8 倍）
      [0x3d, 8], // slide_right_foot（走り 2 倍）
      [0x41, 11], // slide_left_foot（走り 1.5 倍）
      [0x9b, 160],
      [0x21, 32],
      [0x25, 16],
      [0x29, 8],
      [0x2d, 4],
      [0x4e, 16],
      [0x14, 32],
      [0x52, 16],
      [0x56, 16],
      [0x46, 32],
      [0x18, 1],
      [0x19, 2],
      [0x1a, 4],
      [0x1b, 8],
      [0x1c, 16],
      [0x00, 1],
      [0x4a, 1],
      [0x62, 1],
      [0xaa, 1],
      [0xa4, 22],
    ];
    for (const [id, n] of expected) expect(frames(id), `0x${id.toString(16)}`).toBe(n);
  });

  it("歩きと走りの画素の合計は 1 マス（16）、2 マスのジャンプは 32", () => {
    for (const id of knownMovementIds()) {
      const a = movementAction(id);
      if (a.pixels) expect(a.pixels.length, `0x${id.toString(16)}`).toBe(a.frames);
      if (a.heights) expect(a.heights.length, `0x${id.toString(16)}`).toBe(a.frames);
      if (a.kind === "walk") expect(movementPixelTotal(a), `0x${id.toString(16)}`).toBe(16);
    }
    expect(movementPixelTotal(movementAction(0x14))).toBe(32);
    expect(movementPixelTotal(movementAction(0x4e))).toBe(16);
    expect(movementPixelTotal(movementAction(0x46))).toBe(16);
    expect(movementPixelTotal(movementAction(0x52))).toBe(0);
    expect(movementAction(0x31).pixels).toEqual([2, 3, 3, 2, 3, 3]);
  });

  it("ジャンプの高さと、マスが進むフレーム", () => {
    const j1 = movementAction(0x4e);
    expect(j1.heights!.slice(0, 15)).toEqual(JUMP_HEIGHTS_MID.slice(0, 15));
    expect(j1.heights![15]).toBe(0);
    const j2 = movementAction(0x14);
    expect(j2.heights![0]).toBe(JUMP_HEIGHTS_HIGH[0]);
    expect(j2.heights![1]).toBe(JUMP_HEIGHTS_HIGH[0]);
    expect(j2.heights![2]).toBe(JUMP_HEIGHTS_HIGH[1]);
    expect(j2.tileSteps).toEqual([0, 15]);
    expect(movementAction(0x56).turnAt).toBe(7);
    expect(movementAction(0x52).tileSteps).toEqual([]);
  });

  it("向きと、向きだけ違う命令", () => {
    expect(movementAction(0x10).direction).toBe("down");
    expect(movementAction(0x11).direction).toBe("up");
    expect(movementAction(0x12).direction).toBe("left");
    expect(movementAction(0x13).direction).toBe("right");
    expect(movementWithDirection(0x10, "right")).toBe(0x13);
    expect(movementWithDirection(0x1f, "up")).toBe(0x1e);
    expect(movementWithDirection(0x6e, "up")).toBeNull();
    expect(movementWithDirection(0x18, "up")).toBeNull();
  });

  it("名前と中身のずれ、効き目、知らない命令", () => {
    expect(movementAction(0x1d).nameMismatch).toBe(true);
    expect(movementAction(0x35).nameMismatch).toBe(true);
    expect(movementAction(0x10).nameMismatch).toBe(false);
    expect(movementAction(0x60).effect).toEqual({ type: "visible", on: false });
    expect(movementAction(0x62).effect).toMatchObject({ type: "mark", frames: 60 });
    expect(movementAction(0x70).kind).toBe("unknown");
    expect(movementAction(0xba).kind).toBe("unknown");
    expect(movementAction(0xfe).kind).toBe("end");
    expect(movementAction(0x45).framesKnown).toBe(false);
  });

  it("名前（プロジェクトを先に、無ければ同梱）", () => {
    expect(movementName(0x10)).toBe("walk_down");
    expect(movementName(0x1b)).toBe("0x1B");
    const project = new Map([[0x1b, "pause_8"]]);
    expect(movementName(0x1b, project)).toBe("pause_8");
    expect(movementIdByName("pause_8", project)).toBe(0x1b);
    expect(movementIdByName("walk_up")).toBe(0x11);
    expect(movementIdByName("nothing")).toBeNull();
  });
});

/** 素の ROM（FR(J)）。設定されていなければ飛ばす。 */
const romPath = process.env.ZIGZAGU_TEST_ROM;

describe.skipIf(!romPath || !existsSync(romPath))("移動コマンドの表と ROM の表（#448）", () => {
  it("1 マスの歩数の表（16・8・6・4・2）とジャンプの高さの表が ROM にある", () => {
    const rom = readFileSync(romPath!);
    const find = (bytes: number[]) => {
      const needle = Buffer.from(bytes);
      return rom.indexOf(needle);
    };
    const s16 = (vals: number[]) => vals.flatMap((v) => [v & 0xff, (v >> 8) & 0xff]);
    expect(find(s16([16, 8, 6, 4, 2]))).toBeGreaterThan(0);
    const s8 = (vals: readonly number[]) => vals.map((v) => v & 0xff);
    expect(find(s8(JUMP_HEIGHTS_HIGH))).toBeGreaterThan(0);
    expect(find(s8(JUMP_HEIGHTS_MID))).toBeGreaterThan(0);
  });
});
