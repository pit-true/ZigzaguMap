import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPlaybackStart,
  bundledPlaybackTable,
  DisasmCommandSet,
  EventReader,
  MapLoader,
  PLAYER_ID,
  planScriptImport,
  requireSupportedGame,
  Rom,
  romScriptPlayback,
  ScriptIndex,
  segmentLockReasons,
  simulatePlayback,
  type MapEvents,
  type PlaybackProject,
  type PlaybackTrigger,
  type Timeline,
} from "../src/index.js";

/** 素の BPRJ。無ければ飛ばす。 */
const romPath = process.env.ZIGZAGU_TEST_ROM;

/** 並びを比べる形（ラベルの名前は ROM と取り込み後で違うので、命令と動きだけ）。 */
function shape(t: Timeline) {
  return {
    commands: t.commands.map((c) => [c.frame, c.command.opcode, c.command.macro]),
    segments: t.segments.map((s) => [s.actor, s.start, s.end, s.movementId, s.fromX, s.fromY, s.toX, s.toY]),
    markers: t.markers.filter((m) => m.kind !== "stop").map((m) => [m.frame, m.kind]),
    last: t.lastFrame,
  };
}

describe.skipIf(!romPath)("素の ROM のスクリプトの再生（ZIGZAGU_TEST_ROM、#459）", () => {
  const rom = () => new Rom(new Uint8Array(readFileSync(romPath!)));
  const events = (r: Rom): MapEvents => {
    const header = new MapLoader(r, requireSupportedGame(r).offsets).readHeader({ bank: 3, map: 0 });
    return new EventReader(r).read(header.eventsOffset!);
  };
  const commands = DisasmCommandSet.bundled();
  const table = bundledPlaybackTable(commands);

  function play(r: Rom, ev: MapEvents, pointer: number, trigger: PlaybackTrigger) {
    const p = romScriptPlayback({ rom: r, pointer, commands, table, path: "ROM:test" });
    const start = buildPlaybackStart({ events: ev, trigger, gender: "male" });
    return { p, t: simulatePlayback({ project: p.project, entry: p.entry, start }), start };
  }

  function imported(r: Rom, pointer: number): { project: PlaybackProject; entry: string } {
    const plan = planScriptImport(r, pointer - 0x08000000, { commands, dialect: "nd", useGlobal: false, label: "Pallet_Test" });
    const text = `${plan.asm.join("\n")}\n`;
    const index = new ScriptIndex();
    index.updateFile("a.s", text);
    return { project: { index, commands: table, text: (path) => (path === "a.s" ? text : null) }, entry: plan.entryLabel };
  }

  it("マサラタウンの人物のスクリプトを最後までたどり、.s に取り込んだ後と同じ並びになる", () => {
    const r = rom();
    const ev = events(r);
    const persons = ev.persons.map((p, i) => ({ p, i })).filter(({ p }) => r.isPointer(p.script));
    expect(persons.length).toBeGreaterThan(0);
    for (const { p } of persons) {
      const trigger: PlaybackTrigger = { kind: "person", localId: p.localId };
      const { p: rp, t, start } = play(r, ev, p.script, trigger);
      expect(t.markers.some((m) => m.kind === "limit"), `0x${p.script.toString(16)}`).toBe(false);
      expect(t.markers.some((m) => m.kind === "stop" && m.detail.startsWith("end"))).toBe(true);
      const after = imported(r, p.script);
      const t2 = simulatePlayback({ project: after.project, entry: after.entry, start });
      expect(shape(t2), `0x${p.script.toString(16)}`).toEqual(shape(t));
      // ROM の本文の箱は編集できない
      expect(segmentLockReasons(rp.project, t.segments).every((reason) => reason === "rom")).toBe(true);
    }
  });

  it("オーキドが出てくる踏むスクリプトを最後まで再生し、主人公とオーキドが動く。取り込んだ後と同じ並び", () => {
    const r = rom();
    const ev = events(r);
    const traps = ev.traps.map((tr, index) => ({ tr, index })).filter(({ tr }) => r.isPointer(tr.script));
    expect(traps.length).toBeGreaterThan(0);
    let moved = 0;
    for (const { tr, index } of traps) {
      const { t, start } = play(r, ev, tr.script, { kind: "trap", index });
      expect(t.markers.some((m) => m.kind === "limit")).toBe(false);
      const after = imported(r, tr.script);
      expect(shape(simulatePlayback({ project: after.project, entry: after.entry, start }))).toEqual(shape(t));
      const actors = new Set(t.segments.map((s) => s.actor));
      console.log(`踏むスクリプト ${index}（0x${tr.script.toString(16)}）: 人物 ${[...actors].join(",")}、箱 ${t.segments.length}、最後 ${t.lastFrame} フレーム、印 ${t.markers.map((m) => m.kind).join(",")}`);
      if (actors.has(PLAYER_ID) && actors.size > 1) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });
});
