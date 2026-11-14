import { describe, expect, it } from "vitest";
import {
  MemoryProjectFs,
  RemoveTrainerCommand,
  Rom,
  SetTrainerCommand,
  TRAINERS_JSON_PATH,
  TRAINER_SIZE,
  TextCodec,
  TrainerTable,
  TrainersProject,
  generateTeam,
  parseTrainersJson,
  stringifyTrainersJson,
  wildCandidates,
  withTrainers,
  type EditorContext,
  type TrainerEntry,
} from "../src/index.js";

const TABLE = 0x1000;
const PARTY = 0x2000;
const COUNT = 4;

/** トレーナーの表（4 件）と手持ちを置いた小さな ROM。 */
function trainerRom(): Rom {
  const rom = new Uint8Array(0x120000).fill(0xff);
  const dv = new DataView(rom.buffer);
  dv.setUint32(0xf5c0, 0x08000000 + TABLE, true);
  dv.setUint32(0x11bcf0, 0x08000000 + 0x2800, true);
  for (let i = 0; i < COUNT; i++) rom.fill(0, TABLE + i * TRAINER_SIZE, TABLE + (i + 1) * TRAINER_SIZE);
  // 1 番: 技あり、クラス 2、女性、BGM 6、名前「あい」、手持ち 2 匹
  const e = TABLE + 1 * TRAINER_SIZE;
  rom[e] = 1;
  rom[e + 1] = 2;
  rom[e + 2] = 0x86;
  rom[e + 3] = 7;
  rom.set([0x01, 0x02, 0xff, 0, 0, 0], e + 4);
  dv.setUint16(e + 0x0a, 13, true);
  rom[e + 0x12] = 1;
  dv.setUint32(e + 0x14, 7, true);
  rom[e + 0x18] = 2;
  dv.setUint32(e + 0x1c, 0x08000000 + PARTY, true);
  const mon = (o: number, lv: number, sp: number, moves: number[]) => {
    dv.setUint16(o, 0, true);
    dv.setUint16(o + 2, lv, true);
    dv.setUint16(o + 4, sp, true);
    dv.setUint16(o + 6, 0, true);
    moves.forEach((m, i) => dv.setUint16(o + 8 + i * 2, m, true));
  };
  mon(PARTY, 5, 10, [33, 0, 0, 0]);
  mon(PARTY + 16, 7, 13, [40, 81, 0, 0]);
  // クラス名（11 バイト）。2 番に「う」
  rom.fill(0xff, 0x2800, 0x2800 + 11 * 107);
  rom[0x2800 + 2 * 11] = 0x03;
  return new Rom(rom);
}

const codec = TextCodec.fromCharmap(["00= ", "01=あ", "02=い", "03=う", "FF=$", "/FF", ""].join("\n"));

const sample: TrainerEntry = {
  id: 700,
  label: "EventScript_A_Trainer1",
  partyFlags: 0,
  trainerClass: 3,
  music: 4,
  female: false,
  pic: 12,
  name: "あい",
  items: [0, 0, 0, 0],
  doubleBattle: false,
  aiFlags: 1,
  party: [{ iv: 0, level: 9, species: 10 }],
};

describe("トレーナーの表", () => {
  it("*(0x0800F5C0) の表と手持ち、クラス名を読む", () => {
    const t = TrainerTable.read(trainerRom(), codec, COUNT);
    const one = t.get(1)!;
    expect(one).toMatchObject({ partyFlags: 1, trainerClass: 2, music: 6, female: true, pic: 7, name: "あい", doubleBattle: true, aiFlags: 7 });
    expect(one.items).toEqual([13, 0, 0, 0]);
    expect(one.party).toEqual([
      { iv: 0, level: 5, species: 10, moves: [33, 0, 0, 0] },
      { iv: 0, level: 7, species: 13, moves: [40, 81, 0, 0] },
    ]);
    expect(t.className(2)).toBe("う");
    expect(t.list().map((s) => [s.id, s.partySize])).toEqual([
      [1, 2],
      [2, 0],
      [3, 0],
    ]);
    expect(t.get(COUNT)).toBeNull();
  });
});

describe("maps\\trainers.json", () => {
  it("読み書き（Bochi と同じ整形、番号の順、知らない項目を残す）", () => {
    const text = stringifyTrainersJson([{ ...sample, id: 701 }, sample], { Note: "x" });
    expect(text).toContain("\r\n");
    expect(text).toContain('"Name": "\\u3042\\u3044"');
    const back = parseTrainersJson(text);
    expect(back.trainers.map((t) => t.id)).toEqual([700, 701]);
    expect(back.trainers[0]).toEqual(sample);
    expect(back.extra).toEqual({ Note: "x" });
  });

  it("形の確かめ（番号の範囲・同じ番号・名前の長さ・手持ちの数）", () => {
    const bad = (t: Partial<TrainerEntry>) => () => parseTrainersJson(stringifyTrainersJson([{ ...sample, ...t }]));
    expect(bad({ id: 768 })).toThrow();
    expect(bad({ name: "あいあいあい" })).toThrow();
    expect(bad({ party: [] })).toThrow();
    expect(() => parseTrainersJson(stringifyTrainersJson([sample, sample]))).toThrow();
  });

  it("コマンドで足す・変える・消す（元に戻せる）、空になったらファイルを消す", async () => {
    const fs = new MemoryProjectFs();
    const p = await TrainersProject.open(fs);
    const ctx = withTrainers({} as EditorContext, () => p);
    const add = new SetTrainerCommand({ trainer: sample });
    add.do(ctx);
    expect(p.isModified()).toBe(true);
    expect((await p.save(fs)).written).toEqual([TRAINERS_JSON_PATH]);
    const change = new SetTrainerCommand({ trainer: { ...sample, name: "い" } });
    change.do(ctx);
    expect(p.get(700)?.name).toBe("い");
    change.undo(ctx);
    expect(p.get(700)?.name).toBe("あい");
    const remove = new RemoveTrainerCommand({ id: 700 });
    remove.do(ctx);
    expect((await p.save(fs)).removed).toEqual([TRAINERS_JSON_PATH]);
    remove.undo(ctx);
    expect(p.get(700)).toBeDefined();
    add.undo(ctx);
    expect(p.trainers).toEqual([]);
    expect(SetTrainerCommand.fromJson(JSON.parse(JSON.stringify(add.args))).args).toEqual(add.args);
  });
});

describe("チームの自動生成", () => {
  const wild = [
    { time: 0, areas: [{ rate: 20, slots: [{ minLevel: 2, maxLevel: 4, species: 16 }, { minLevel: 3, maxLevel: 5, species: 19 }, { minLevel: 1, maxLevel: 1, species: 0 }] }] },
    { time: 1, areas: [{ rate: 20, slots: [{ minLevel: 6, maxLevel: 6, species: 16 }] }] },
  ];

  it("野生の種族ごとの最高のレベル", () => {
    expect(wildCandidates(wild)).toEqual([
      { species: 16, maxLevel: 6 },
      { species: 19, maxLevel: 5 },
    ]);
  });

  it("同じ種なら同じ結果。数は 1〜3、レベルは野生の最高 +0〜2、技と持ち物は書かない", () => {
    const c = wildCandidates(wild);
    for (let seed = 1; seed < 50; seed++) {
      const a = generateTeam(c, seed);
      expect(generateTeam(c, seed)).toEqual(a);
      expect(a.party.length).toBeGreaterThanOrEqual(1);
      expect(a.party.length).toBeLessThanOrEqual(3);
      for (const m of a.party) {
        expect([16, 19]).toContain(m.species);
        expect(m.level).toBeGreaterThanOrEqual(6);
        expect(m.level).toBeLessThanOrEqual(8);
        expect(m.moves).toBeUndefined();
        expect(m.heldItem).toBeUndefined();
      }
    }
    expect(generateTeam([], 1).party).toEqual([]);
  });
});
