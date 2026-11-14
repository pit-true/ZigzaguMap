import { describe, expect, it } from "vitest";
import {
  CfruProject,
  CommandBus,
  EventLabelProject,
  EventLabelStore,
  MapLabelsJson,
  MemoryProjectFs,
  RemoveEventCommand,
  SetEventCountsCommand,
  SetEventLabelCommand,
  SetMapScriptTableCommand,
  RenameEventLabelCommand,
  RealignEventLabelsCommand,
  AssignEventLabelsCommand,
  createDefaultRegistry,
  mapLabelsPath,
  parseMapLabelsPath,
  tableArgs,
  withEventLabels,
  type EventPositions,
} from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

const SCRIPTS = ["##----", "npc 3 0 0 EventScript_Old0", "sign 3 0 1 Sign_A", "#ifdef X", "npc 3 0 2 InIfdef", "#endif", "trainer 3 0 1 Gym", "map 3 1 MapScripts_X", ""].join("\n");

const pos = (person: [number, number][], sign: [number, number][] = [], tile: [number, number][] = []): EventPositions => ({
  person: person.map(([x, y]) => ({ x, y })),
  sign: sign.map(([x, y]) => ({ x, y })),
  tile: tile.map(([x, y]) => ({ x, y })),
});

describe("マップのラベルのファイル", () => {
  it("パスは maps/BB/scripts_MM.json（map_project.py の [0-9]*.json に当たらない）", () => {
    expect(mapLabelsPath(3, 0)).toBe("maps/03/scripts_00.json");
    expect(parseMapLabelsPath("maps/03/scripts_19.json")).toEqual({ bank: 3, map: 19 });
    expect(parseMapLabelsPath("maps/03/19.json")).toBeNull();
  });

  it("書いて読むと同じになる（Bochi と同じ整形）", () => {
    const file = {
      bank: 3,
      map: 0,
      mapScripts: "T",
      table: { label: "T", items: [{ type: 1, script: "A", conditions: [] }, { type: 4, script: "", conditions: [{ variable: 0x4001, value: 2, script: "B" }] }] },
      persons: [{ index: 1, x: 4, y: 5, kind: "npc" as const, label: "N" }],
      signs: [],
      traps: [{ index: 0, x: 1, y: 2, kind: "tile" as const, label: "Tl" }],
    };
    const text = MapLabelsJson.stringify(file);
    expect(text).toContain('\r\n  "Persons": [\r\n');
    expect(MapLabelsJson.parse(text)).toEqual(file);
  });
});

describe("イベントのラベル", () => {
  it("ファイルの無いマップは eventscripts の #ifdef の外の行を読む", () => {
    const s = new EventLabelStore(SCRIPTS);
    const m = s.get(3, 0);
    expect(m.person.map((l) => l?.label ?? null)).toEqual(["EventScript_Old0", "EventScript_Gym"]);
    expect(m.person[1]!.kind).toBe("trainer");
    expect(m.sign[1]!.label).toBe("Sign_A");
    expect(s.get(3, 1).mapScripts).toBe("MapScripts_X");
    expect(s.conditionalEntries(3, 0, "person", 2)[0]!.symbol).toBe("InIfdef");
    expect(s.isModified()).toBe(false);
  });

  it("変えたマップだけファイルを作り、eventscripts の行を合わせる（#ifdef の中は残す）", () => {
    const s = new EventLabelStore(SCRIPTS);
    s.set(3, 0, "person", 0, { label: "Moegi_Npc0", kind: "npc" });
    s.set(3, 0, "tile", 2, { label: "Moegi_Tile2", kind: "tile" });
    s.set(3, 0, "sign", 1, null);
    expect(s.isModified()).toBe(true);
    const plan = s.planSave(() => pos([[1, 2], [3, 4]], [], [[0, 0], [0, 0], [7, 8]]));
    expect(plan.files.map((f) => f.path)).toEqual(["maps/03/scripts_00.json"]);
    const file = MapLabelsJson.parse(plan.files[0]!.text!);
    expect(file.persons).toEqual([
      { index: 0, x: 1, y: 2, kind: "npc", label: "Moegi_Npc0" },
      { index: 1, x: 3, y: 4, kind: "trainer", label: "EventScript_Gym" },
    ]);
    expect(file.traps).toEqual([{ index: 2, x: 7, y: 8, kind: "tile", label: "Moegi_Tile2" }]);
    expect(plan.eventScripts).toBe(
      ["##----", "npc 3 0 0 Moegi_Npc0", "#ifdef X", "npc 3 0 2 InIfdef", "#endif", "trainer 3 0 1 Gym", "tile 3 0 2 Moegi_Tile2", "map 3 1 MapScripts_X", ""].join("\n"),
    );
    s.markSaved(plan);
    expect(s.isModified()).toBe(false);
    // 2 回目は何も書かない
    const again = s.planSave(() => pos([[1, 2], [3, 4]], [], [[0, 0], [0, 0], [7, 8]]));
    expect(again.files).toEqual([]);
    expect(again.eventScripts).toBeNull();
    // 動かしたイベントの座標は書き直す
    expect(s.planSave(() => pos([[9, 9], [3, 4]], [], [[0, 0], [0, 0], [7, 8]])).files).toHaveLength(1);
  });

  it("ラベルを全部外すとファイルを消し、行も消す", () => {
    const text = MapLabelsJson.stringify({ bank: 3, map: 0, mapScripts: null, table: null, persons: [{ index: 0, x: 0, y: 0, kind: "npc", label: "A" }], signs: [], traps: [] });
    const s = new EventLabelStore("npc 3 0 0 A\n", [{ path: "maps/03/scripts_00.json", text }]);
    s.set(3, 0, "person", 0, null);
    const plan = s.planSave(() => null);
    expect(plan.files).toEqual([{ path: "maps/03/scripts_00.json", text: null }]);
    expect(plan.eventScripts).toBe("");
  });

  it("座標が合わないラベルを見つけ、付け替えられる", () => {
    const text = MapLabelsJson.stringify({
      bank: 3,
      map: 0,
      mapScripts: null,
      table: null,
      persons: [
        { index: 0, x: 1, y: 1, kind: "npc", label: "A" },
        { index: 1, x: 2, y: 2, kind: "npc", label: "B" },
      ],
      signs: [],
      traps: [],
    });
    const s = new EventLabelStore("", [{ path: "maps/03/scripts_00.json", text }]);
    // Bochi で 2 人の順を入れ替えた
    const now = pos([[2, 2], [1, 1]]);
    const found = s.mismatches(3, 0, now);
    expect(found.map((x) => [x.label, x.candidate])).toEqual([["A", 1], ["B", 0]]);
    expect(s.realign(3, 0, now)).toBe(2);
    expect(s.get(3, 0).person.map((l) => l?.label)).toEqual(["B", "A"]);
    expect(s.mismatches(3, 0, now)).toEqual([]);
  });

  it("マップを左・上へ広げたら照合用の座標もずらす（#231。逆にずらせば戻る）", () => {
    const text = MapLabelsJson.stringify({
      bank: 3,
      map: 0,
      mapScripts: null,
      table: null,
      persons: [{ index: 0, x: 1, y: 1, kind: "npc", label: "A" }],
      signs: [],
      traps: [],
    });
    const s = new EventLabelStore("", [{ path: "maps/03/scripts_00.json", text }]);
    s.shiftPositions(3, 0, 3, 0);
    // イベントも 3 右へずれたので、ずれの知らせは出ない
    expect(s.mismatches(3, 0, pos([[4, 1]]))).toEqual([]);
    expect(s.mismatches(3, 0, pos([[1, 1]]))).toHaveLength(1);
    s.shiftPositions(3, 0, -3, 0);
    expect(s.mismatches(3, 0, pos([[1, 1]]))).toEqual([]);
  });

  it("ラベル名の変更はすべてのマップと表に反映する", () => {
    const s = new EventLabelStore(SCRIPTS);
    s.setTable(3, 2, { label: "T", items: [{ type: 1, script: "Sign_A", conditions: [] }] });
    expect(s.rename("Sign_A", "Sign_B")).toBe(2);
    expect(s.get(3, 0).sign[1]!.label).toBe("Sign_B");
    expect(s.get(3, 2).table!.items[0]!.script).toBe("Sign_B");
    expect(s.usesOf("Sign_B")).toEqual([{ bank: 3, map: 0, target: "sign", index: 1 }]);
  });
});

describe("ラベルのコマンドと、イベントの付け直し", () => {
  async function setup() {
    const project = await CfruProject.open(buildSyntheticRom(), new MemoryProjectFs());
    const labels = EventLabelProject.of(new EventLabelStore(""));
    const context = withEventLabels(project.editorContext(), () => labels.store, () => pos([]));
    const bus = new CommandBus(context);
    const id = project.mapIds()[0]!;
    const doc = await project.load(id);
    const counts = () => ({ person: doc.events?.persons.length ?? 0, sign: doc.events?.signs.length ?? 0, tile: doc.events?.traps.length ?? 0 });
    const added: string[] = [];
    labels.observe(id, counts());
    labels.track(bus, {
      counts: () => counts(),
      added: (e) => {
        for (let i = e.from; i < e.to; i++) {
          labels.store.set(e.map.bank, e.map.map, e.target, i, { label: `New_${e.target}${i}`, kind: e.target === "person" ? "npc" : e.target });
          added.push(`${e.target}${i}`);
        }
      },
    });
    return { bus, labels, id, counts, added };
  }

  it("ラベルの変更・ラベル名の変更・表の変更は取り消せる", async () => {
    const { bus, labels, id } = await setup();
    const registry = createDefaultRegistry();
    bus.execute(registry.create({ name: "setEventLabel", args: { ...id, target: "person", index: 0, label: "Moegi_Npc0" } }));
    expect(labels.store.label(id.bank, id.map, "person", 0)?.label).toBe("Moegi_Npc0");
    bus.execute(new RenameEventLabelCommand({ from: "Moegi_Npc0", to: "Moegi_Hero" }));
    expect(labels.store.label(id.bank, id.map, "person", 0)?.label).toBe("Moegi_Hero");
    bus.execute(new SetMapScriptTableCommand({ ...id, table: tableArgs({ label: "M", items: [{ type: 1, script: "X", conditions: [] }] }) }));
    expect(labels.store.get(id.bank, id.map).mapScripts).toBe("M");
    bus.undo();
    expect(labels.store.get(id.bank, id.map).mapScripts).toBeNull();
    bus.undo();
    expect(labels.store.label(id.bank, id.map, "person", 0)?.label).toBe("Moegi_Npc0");
    bus.undo();
    expect(labels.store.label(id.bank, id.map, "person", 0)).toBeNull();
    expect(() => bus.execute(new SetEventLabelCommand({ ...id, target: "person", index: 0, label: "3bad" }))).toThrow();
    expect(() => new AssignEventLabelsCommand({ ...id, events: [{ target: "sign", index: 0, label: "S" }] })).not.toThrow();
  });

  it("イベントを消すと後ろのラベルが詰まり、数を増やすと新しいイベントにラベルを付ける（取り消すと戻る）", async () => {
    const { bus, labels, id, counts, added } = await setup();
    const before = counts();
    bus.execute(new SetEventCountsCommand({ ...id, persons: before.person + 2 }));
    expect(added).toEqual([`person${before.person}`, `person${before.person + 1}`]);
    expect(labels.store.label(id.bank, id.map, "person", before.person)?.label).toBe(`New_person${before.person}`);
    bus.execute(new RemoveEventCommand({ ...id, kind: "person", index: before.person }));
    expect(labels.store.label(id.bank, id.map, "person", before.person)?.label).toBe(`New_person${before.person + 1}`);
    bus.undo();
    expect(labels.store.label(id.bank, id.map, "person", before.person)?.label).toBe(`New_person${before.person}`);
    bus.undo();
    expect(labels.store.get(id.bank, id.map).person.filter(Boolean)).toHaveLength(0);
    bus.redo();
    expect(labels.store.label(id.bank, id.map, "person", before.person + 1)?.label).toBe(`New_person${before.person + 1}`);
  });

  it("座標で付け直すコマンド", async () => {
    const project = await CfruProject.open(buildSyntheticRom(), new MemoryProjectFs());
    const text = MapLabelsJson.stringify({ bank: 3, map: 0, mapScripts: null, table: null, persons: [{ index: 0, x: 5, y: 5, kind: "npc", label: "A" }], signs: [], traps: [] });
    const store = new EventLabelStore("", [{ path: "maps/03/scripts_00.json", text }]);
    const bus = new CommandBus(withEventLabels(project.editorContext(), () => store, () => pos([[0, 0], [5, 5]])));
    bus.execute(new RealignEventLabelsCommand({ bank: 3, map: 0 }));
    expect(store.get(3, 0).person.map((l) => l?.label ?? null)).toEqual([null, "A"]);
    bus.undo();
    expect(store.get(3, 0).person[0]!.label).toBe("A");
  });

  it("プロジェクトの読み書き", async () => {
    const fs = new MemoryProjectFs();
    fs.files.set("eventscripts", "##----");
    const labels = await EventLabelProject.open(fs);
    labels.store.set(3, 0, "sign", 0, { label: "S0", kind: "sign" });
    const out = await labels.save(fs, () => null);
    expect(out.written).toEqual(["maps/03/scripts_00.json", "eventscripts"]);
    expect(fs.files.get("eventscripts")).toBe("##----\nsign 3 0 0 S0");
    const again = await EventLabelProject.open(fs);
    expect(again.store.label(3, 0, "sign", 0)?.label).toBe("S0");
    expect(again.store.hasFile(3, 0)).toBe(true);
  });
});
