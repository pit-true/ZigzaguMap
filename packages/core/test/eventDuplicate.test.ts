import { describe, expect, it } from "vitest";
import { CfruProject, CommandBus, CommandGroup, DuplicateEventCommand, MAX_EVENTS_PER_KIND, MemoryProjectFs, MoveEventCommand, createDefaultRegistry } from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

async function setup() {
  const project = await CfruProject.open(buildSyntheticRom(), new MemoryProjectFs());
  const id = project.mapIds()[0]!;
  const doc = await project.load(id);
  const bus = new CommandBus(project.editorContext());
  return { project, id, doc, bus };
}

describe("イベントの複製（Phase5 #399）", () => {
  it("欄を全部写して末尾に足し、人の番号だけ足した位置の番号にする。取り消すと消える", async () => {
    const { id, doc, bus } = await setup();
    const persons = doc.events!.persons;
    const n = persons.length;
    const src = { ...persons[0]! };
    bus.execute(new DuplicateEventCommand({ ...id, kind: "person", index: 0, x: 7, y: 8 }));
    const copy = doc.events!.persons[n]!;
    expect(copy).toEqual({ ...src, x: 7, y: 8, localId: (n + 1) & 0xff });
    expect(copy.flag).toBe(src.flag);
    expect(copy.script).toBe(src.script);
    bus.undo();
    expect(doc.events!.persons).toHaveLength(n);
  });

  it("看板の中身は別のオブジェクトに写す（写しを変えても元は変わらない）", async () => {
    const { id, doc, bus } = await setup();
    const signs = doc.events!.signs;
    if (signs.length === 0) return;
    bus.execute(new DuplicateEventCommand({ ...id, kind: "sign", index: 0, x: 1, y: 1 }));
    const copy = doc.events!.signs.at(-1)!;
    expect(copy.content).toEqual(signs[0]!.content);
    expect(copy.content).not.toBe(signs[0]!.content);
  });

  it("3 種類を混ぜた複製と移動を 1 つにまとめ、1 回で戻せる。JSON から作り直しても同じ", async () => {
    const { id, doc, bus } = await setup();
    const before = JSON.stringify(doc.events);
    const kinds = (["person", "warp", "sign"] as const).filter((k) => (k === "person" ? doc.events!.persons : k === "warp" ? doc.events!.warps : doc.events!.signs).length > 0);
    expect(kinds.length).toBeGreaterThanOrEqual(2);
    const group = CommandGroup.of([
      ...kinds.map((kind) => new DuplicateEventCommand({ ...id, kind, index: 0, x: 3, y: 4 })),
      ...kinds.map((kind) => new MoveEventCommand({ ...id, kind, index: 0, x: 2, y: 2 })),
    ]);
    bus.execute(group);
    const after = JSON.stringify(doc.events);
    bus.undo();
    expect(JSON.stringify(doc.events)).toBe(before);
    const again = createDefaultRegistry().create({ name: group.name, args: group.args });
    bus.execute(again);
    expect(JSON.stringify(doc.events)).toBe(after);
  });

  it("上限（255）を超えると EditError で、何も変わらない", async () => {
    const { id, doc, bus } = await setup();
    const persons = doc.events!.persons;
    while (persons.length < MAX_EVENTS_PER_KIND) persons.push({ ...persons[0]! });
    expect(() => bus.execute(new DuplicateEventCommand({ ...id, kind: "person", index: 0, x: 0, y: 0 }))).toThrow();
    expect(persons).toHaveLength(MAX_EVENTS_PER_KIND);
  });

  it("無い番号は EditError", async () => {
    const { id, bus } = await setup();
    expect(() => bus.execute(new DuplicateEventCommand({ ...id, kind: "trap", index: 99, x: 0, y: 0 }))).toThrow();
  });
});
