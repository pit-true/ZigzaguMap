import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DisasmCommandSet,
  type Disassembly,
  EventReader,
  MapLoader,
  ROM_BASE,
  Rom,
  ScriptCommandTable,
  ScriptTextCodec,
  disassembleScripts,
  movementNamesFromDefines,
  renderDisassembly,
  requireSupportedGame,
} from "../src/index.js";
import { reassemble } from "./helpers/armAssemble.js";

/** 素の BPRJ、ND・Chronos の CFRU のフォルダ、arm-none-eabi-as のパス。無ければ、そのテストは飛ばす。 */
const romPath = process.env.ZIGZAGU_TEST_ROM;
const ndDir = process.env.ZIGZAGU_ND_DIR;
const chronosDir = process.env.ZIGZAGU_CHRONOS_DIR;
const asPath = process.env.ZIGZAGU_ARM_AS;

/** フォルダの xse_commands.s などから命令の一覧を作る。 */
function commandsOf(dir: string): DisasmCommandSet {
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  const defines = ["xse_defines.s", "asm_defines.s"].filter((n) => existsSync(join(dir, n))).map(read);
  const table = ScriptCommandTable.build({ xseCommands: read("xse_commands.s"), defines });
  return DisasmCommandSet.fromCommandTable(table, movementNamesFromDefines(read("xse_defines.s")));
}

/** マップの人・看板のスクリプトの位置。 */
function eventScripts(rom: Rom, bank: number, map: number): number[] {
  const loader = new MapLoader(rom, requireSupportedGame(rom).offsets);
  const header = loader.readHeader({ bank, map });
  const events = new EventReader(rom).read(header.eventsOffset!);
  const out: number[] = [];
  for (const p of events.persons) if (rom.isPointer(p.script)) out.push(p.script - ROM_BASE);
  for (const s of events.signs) if (s.content.type === "script" && rom.isPointer(s.content.script)) out.push(s.content.script - ROM_BASE);
  return out;
}

/** 文字列がすべてバイト列に戻ること。 */
function expectStringsRoundTrip(d: Disassembly): void {
  for (const s of d.strings) expect(ScriptTextCodec.japanese.encode(s.text), s.label).toEqual(s.bytes);
}

describe.skipIf(!romPath)("素の BPRJ の逆アセンブル（ZIGZAGU_TEST_ROM）", () => {
  const load = () => new Rom(new Uint8Array(readFileSync(romPath!)));

  it("マサラタウンの人と看板のスクリプトを、同梱の表で問題なく戻せる", () => {
    const rom = load();
    const entries = eventScripts(rom, 3, 0);
    expect(entries.length).toBe(7);
    const d = disassembleScripts(rom, entries, { commands: DisasmCommandSet.bundled() });
    expect(d.problems).toEqual([]);
    expect(d.entries.map((e) => e.label)).toEqual(entries.map((o) => `ROM_${(o + ROM_BASE).toString(16).toUpperCase().padStart(8, "0")}`));
    expect(d.blocks.length).toBe(14);
    expect(d.movements.length).toBe(5);
    expect(d.strings.length).toBe(13);
    expectStringsRoundTrip(d);
    const text = renderDisassembly(d);
    expect(text.script.text).toContain("ROM_0816F978:\n\tloadpointer 0x0 ROM_0816FAF2\n\tcallstd 0x3\n\tend\n");
    expect(text.strings.text).toContain("#org @ROM_0816FAF2\nここは [PLAYER] のいえ\n");
  });

  it("全マップの人・看板・スクリプトタイルを読んでも、知らない命令は 1 か所だけ", () => {
    const rom = load();
    const loader = new MapLoader(rom, requireSupportedGame(rom).offsets);
    const entries: number[] = [];
    for (const id of loader.bankTable.ids()) {
      const header = loader.readHeader(id);
      if (header.eventsOffset === null) continue;
      const events = new EventReader(rom).read(header.eventsOffset);
      for (const p of events.persons) if (rom.isPointer(p.script)) entries.push(p.script - ROM_BASE);
      for (const t of events.traps) if (rom.isPointer(t.script)) entries.push(t.script - ROM_BASE);
      for (const s of events.signs) if (s.content.type === "script" && rom.isPointer(s.content.script)) entries.push(s.content.script - ROM_BASE);
    }
    const d = disassembleScripts(rom, entries, { commands: DisasmCommandSet.bundled(), maxCommands: 200_000 });
    // 0xD1 は同梱の表（CFRU の xse_commands.s）に無い命令。
    expect(d.problems.map((p) => p.message)).toEqual(["知らない命令 0xD1 です。ここで止めました"]);
    expect(d.marts.length).toBeGreaterThan(10);
    expect(d.movements.length).toBeGreaterThan(100);
    expectStringsRoundTrip(d);
  });

  it.skipIf(!chronosDir)("同梱の表と Chronos の xse_commands.s から作った表で同じ文になる", () => {
    const rom = load();
    const entries = eventScripts(rom, 3, 0);
    const bundled = renderDisassembly(disassembleScripts(rom, entries, { commands: DisasmCommandSet.bundled() }));
    const chronos = renderDisassembly(disassembleScripts(rom, entries, { commands: commandsOf(chronosDir!) }));
    expect(chronos.script.text).toBe(bundled.script.text);
    expect(chronos.strings.text).toBe(bundled.strings.text);
  });

  it.skipIf(!chronosDir || !asPath)("マサラタウンの文をアセンブルし直すと元のバイト列と同じ（arm-none-eabi-as）", () => {
    const rom = load();
    const d = disassembleScripts(rom, eventScripts(rom, 3, 0), { commands: DisasmCommandSet.bundled() });
    const chunks = reassemble(d, rom.bytes, asPath!, chronosDir!);
    expect(chunks.length).toBe(d.blocks.length + d.movements.length + d.marts.length);
    expect(chunks.filter((c) => !c.equal)).toEqual([]);
    // 比べ方の確かめ: 元のバイト列を 1 か所ずつ変えると、そのまとまりだけ合わなくなる。
    const changed = rom.bytes.slice();
    changed[d.blocks[0]!.offset + 1]! ^= 1;
    changed[d.movements[0]!.offset]! ^= 1;
    const bad = reassemble(d, changed, asPath!, chronosDir!).filter((c) => !c.equal);
    expect(bad.map((c) => c.offset)).toEqual([d.blocks[0]!.offset, d.movements[0]!.offset].sort((a, b) => a - b));
  });
});

describe.skipIf(!ndDir)("ND のベース ROM の逆アセンブル（ZIGZAGU_ND_DIR）", () => {
  /** ベース ROM に入っている、いあいぎり・なみのりのスクリプト（2 ポインタの 0F を使う）。 */
  const ENTRIES = [0x800300, 0x800400, 0x8004a0];
  const load = () => new Rom(new Uint8Array(readFileSync(join(ndDir!, "BPRJ0.gba"))));

  it("0F を 2 ポインタ（10 バイト）で読み、ひらがなと漢字の文字列を戻す", () => {
    const rom = load();
    const d = disassembleScripts(rom, ENTRIES, { commands: commandsOf(ndDir!) });
    expect(d.problems).toEqual([]);
    const loads = d.blocks.flatMap((b) => b.lines).filter((l) => l.bytes[0] === 0x0f);
    expect(loads.length).toBeGreaterThanOrEqual(4);
    for (const l of loads) {
      expect(l.size).toBe(10);
      expect(l.args.map((a) => a.name)).toEqual(["destination", "value", "value_kanji"]);
    }
    const text = renderDisassembly(d);
    expect(text.script.text).toMatch(/\tloadpointer 0x0 ROM_088004AD ROM_088004CC\n\tcallstd 0x3\n\tend\n/);
    expect(text.strings.text).toContain("#org @ROM_088004CC\n水の");
    expectStringsRoundTrip(d);
  });

  it("同梱の表（1 ポインタ）で読むと 0F の長さが合わない", () => {
    const rom = load();
    const d = disassembleScripts(rom, [0x8004a0], { commands: DisasmCommandSet.bundled() });
    expect(d.blocks[0]!.lines[0]!.size).toBe(6);
    expect(renderDisassembly(d).script.text).not.toContain("callstd 0x3");
  });

  it.skipIf(!asPath)("アセンブルし直すと元のバイト列と同じ（arm-none-eabi-as）", () => {
    const rom = load();
    const d = disassembleScripts(rom, ENTRIES, { commands: commandsOf(ndDir!) });
    const chunks = reassemble(d, rom.bytes, asPath!, ndDir!);
    expect(chunks.filter((c) => !c.equal)).toEqual([]);
  });
});
