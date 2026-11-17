import { describe, expect, it } from "vitest";
import {
  CfruProject,
  CommandBus,
  CommandGroup,
  EventLabelProject,
  EventLabelStore,
  MemoryProjectFs,
  PasteEventCommand,
  createDefaultRegistry,
  pasteItems,
  placePaste,
  withEventLabels,
  type EventPositions,
} from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

const empty = { person: [], warp: [], trap: [], sign: [] };

describe("イベントの貼り付け（#519）", () => {
  it("互いの位置を保ち、押したマスを左上にして置く", () => {
    const { items, left, top } = pasteItems([{ kind: "sign", x: 5, y: 3 }, { kind: "person", x: 7, y: 4 }]);
    expect([left, top]).toEqual([5, 3]);
    expect(placePaste(items, 1, 1, { width: 10, height: 10, occupied: empty })).toEqual({ ok: true, positions: [{ x: 1, y: 1 }, { x: 3, y: 2 }] });
  });

  it("どれかがマップの外になる・同じ種類と重なるときは全部を断る（ほかの種類とは重なってよい）", () => {
    const { items } = pasteItems([{ kind: "sign", x: 0, y: 0 }, { kind: "person", x: 2, y: 1 }]);
    expect(placePaste(items, 8, 0, { width: 10, height: 10, occupied: empty })).toEqual({ ok: false, reason: "outside", item: 1, x: 10, y: 1 });
    expect(placePaste(items, 0, 0, { width: 10, height: 10, occupied: { ...empty, person: [{ x: 2, y: 1 }] } })).toEqual({ ok: false, reason: "overlap", item: 1, x: 2, y: 1 });
    expect(placePaste(items, 0, 0, { width: 10, height: 10, occupied: { ...empty, sign: [{ x: 2, y: 1 }] } }).ok).toBe(true);
    // 写したもの同士で同じ種類が同じマス
    const twin = pasteItems([{ kind: "warp", x: 3, y: 3 }, { kind: "warp", x: 3, y: 3 }]);
    expect(placePaste(twin.items, 0, 0, { width: 10, height: 10, occupied: empty })).toMatchObject({ ok: false, reason: "overlap", item: 1 });
  });

  async function setup() {
    const project = await CfruProject.open(buildSyntheticRom(), new MemoryProjectFs());
    const ids = project.mapIds();
    const labels = EventLabelProject.of(new EventLabelStore(""));
    const docs = new Map<string, Awaited<ReturnType<typeof project.load>>>();
    for (const id of ids.slice(0, 2)) docs.set(`${id.bank}.${id.map}`, await project.load(id));
    const counts = (id: { bank: number; map: number }) => {
      const doc = docs.get(`${id.bank}.${id.map}`);
      return doc ? { person: doc.events?.persons.length ?? 0, sign: doc.events?.signs.length ?? 0, tile: doc.events?.traps.length ?? 0 } : null;
    };
    const pos = (): EventPositions => ({ person: [], sign: [], tile: [] });
    const bus = new CommandBus(withEventLabels(project.editorContext(), () => labels.store, pos));
    for (const id of ids.slice(0, 2)) labels.observe(id, counts(id)!);
    const added: string[] = [];
    labels.track(bus, { counts, added: (e) => added.push(`${e.target}${e.from}`) });
    return { bus, labels, ids, docs, added };
  }

  it("別のマップへ欄を全部写して末尾に足し、人の番号は足した位置の番号。ラベルは同じものを指し、取り消すと消える", async () => {
    const { bus, labels, ids, docs, added } = await setup();
    const [a, b] = ids as [{ bank: number; map: number }, { bank: number; map: number }];
    const src = docs.get(`${a.bank}.${a.map}`)!.events!.persons[0]!;
    const target = docs.get(`${b.bank}.${b.map}`)!;
    const n = target.events?.persons.length ?? 0;
    const first = new PasteEventCommand({ ...b, kind: "person", event: { ...src }, x: 4, y: 5, label: { label: "Shared_Npc", kind: "npc" } });
    const command = CommandGroup.of([
      first,
      new PasteEventCommand({ ...b, kind: "sign", event: { x: 0, y: 0, elevation: 3, kind: 0, padding: 0, content: { type: "script", script: 0x08123456 } }, x: 6, y: 5 }),
    ]);
    bus.execute(command);
    const copy = target.events!.persons[n]!;
    expect(copy).toEqual({ ...src, x: 4, y: 5, localId: (n + 1) & 0xff });
    expect(target.events!.signs.at(-1)).toMatchObject({ x: 6, y: 5, elevation: 3, content: { type: "script", script: 0x08123456 } });
    // ひな形（added）は付けず、写したラベルをそのまま使う。eventscripts に貼った先のマップの行が出る
    expect(added).toEqual([]);
    expect(labels.store.label(b.bank, b.map, "person", n)).toEqual({ label: "Shared_Npc", kind: "npc" });
    const plan = labels.store.planSave(() => ({ person: target.events!.persons.map((p) => ({ x: p.x, y: p.y })), sign: [], tile: [] }));
    expect(plan.eventScripts).toContain(`npc ${b.bank} ${b.map} ${n} Shared_Npc`);
    bus.undo();
    expect(target.events?.persons.length ?? 0).toBe(n);
    expect(labels.store.label(b.bank, b.map, "person", n)).toBeNull();
    // JSON から作り直しても同じ
    const again = createDefaultRegistry().create(JSON.parse(JSON.stringify({ name: "pasteEvent", args: first.args })));
    bus.execute(again);
    expect(target.events!.persons[n]).toEqual(copy);
  });
});
