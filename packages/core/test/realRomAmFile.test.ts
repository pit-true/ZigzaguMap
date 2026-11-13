import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CfruProject,
  CommandBus,
  InsertMapCommand,
  MemoryProjectFs,
  OpenMapFileCommand,
  WORK_MAP_BANK,
  encodeBase64,
  toAmMapFiles,
  type MapId,
} from "../src/index.js";

/** 素の BPRJ のパス。 */
const romPath = process.env.ZIGZAGU_TEST_ROM;
/**
 * AdvanceMap 1.92 が「名前をつけて作成したマップを保存」で書いたファイルのフォルダ（任意）。
 * `export_3_0.map/.evt` のように `export_<バンク>_<マップ>` の名前で置く（ROM の中身を含むのでリポジトリには入れない）。
 */
const amDir = process.env.ZIGZAGU_TEST_AM_EXPORT;
/** 指定すると、書いた .map / .evt をこのフォルダの `amfile\` に残す（AdvanceMap で開いて確かめる用）。 */
const keepDir = process.env.ZIGZAGU_KEEP_OUTPUT;

const MAPS: MapId[] = [
  { bank: 3, map: 0 },
  { bank: 1, map: 1 },
  { bank: 3, map: 37 },
];

describe.skipIf(!romPath)("実 ROM の .map / .evt", () => {
  const rom = () => new Uint8Array(readFileSync(romPath!));

  it("ROM のマップを .map / .evt にして開き直すと、配置・ボーダー・タイルセット・イベントが同じ", async () => {
    const project = await CfruProject.open(rom(), new MemoryProjectFs());
    const ctx = project.editorContext();
    const bus = new CommandBus(ctx);
    for (const [i, id] of MAPS.entries()) {
      const doc = await project.load(id);
      const files = toAmMapFiles(doc, (p) => ctx.tilesetIndex(p));
      if (keepDir) {
        mkdirSync(join(keepDir, "amfile"), { recursive: true });
        writeFileSync(join(keepDir, "amfile", `zz_${id.bank}_${id.map}.map`), files.map);
        writeFileSync(join(keepDir, "amfile", `zz_${id.bank}_${id.map}.evt`), files.events);
      }
      expect(files.map.length).toBe(20 + (doc.border.cells.length + doc.grid.cells.length) * 2);
      bus.execute(new OpenMapFileCommand({ map: i, name: `${id.bank}.${id.map}`, data: encodeBase64(files.map), events: encodeBase64(files.events), templateBank: id.bank, templateMap: id.map }));
      const back = project.loaded({ bank: WORK_MAP_BANK, map: i })!;
      expect(back.grid.cells).toEqual(doc.grid.cells);
      expect(back.border.cells).toEqual(doc.border.cells);
      expect([back.primaryTileset, back.secondaryTileset]).toEqual([doc.primaryTileset, doc.secondaryTileset]);
      expect(back.events).toEqual(doc.events);
    }
  });

  it.skipIf(!amDir)("AdvanceMap が書いたファイルと同じバイト列になり、読み込める", async () => {
    const project = await CfruProject.open(rom(), new MemoryProjectFs());
    const ctx = project.editorContext();
    for (const id of MAPS) {
      const base = join(amDir!, `export_${id.bank}_${id.map}`);
      if (!existsSync(`${base}.map`)) continue;
      const files = toAmMapFiles(await project.load(id), (p) => ctx.tilesetIndex(p));
      expect(files.map).toEqual(new Uint8Array(readFileSync(`${base}.map`)));
      expect(files.events).toEqual(new Uint8Array(readFileSync(`${base}.evt`)));
    }
  });

  it("開いた .map をプロジェクトに加えて出力し、開き直すと同じ", async () => {
    const fs = new MemoryProjectFs();
    const project = await CfruProject.open(rom(), fs);
    const ctx = project.editorContext();
    const bus = new CommandBus(ctx);
    const files = toAmMapFiles(await project.load({ bank: 3, map: 0 }), (p) => ctx.tilesetIndex(p));
    bus.execute(new OpenMapFileCommand({ map: 0, name: "pallet", data: encodeBase64(files.map), events: encodeBase64(files.events), templateBank: 3, templateMap: 0 }));
    const counts = project.bankCounts();
    const targets = [{ bank: 3, map: counts[3]! }, { bank: counts.length, map: 0 }];
    for (const t of targets) bus.execute(new InsertMapCommand({ ...t, sourceBank: WORK_MAP_BANK, sourceMap: 0 }));
    await project.save();
    const again = await CfruProject.open(rom(), fs);
    for (const t of targets) {
      const doc = await again.load(t);
      expect(doc.grid.cells).toEqual(project.loaded(t)!.grid.cells);
      expect(doc.events).toEqual(project.loaded(t)!.events);
    }
  });
});
