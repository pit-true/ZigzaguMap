// Bochi 改造版（BochiBochiEditor-cfru）で保存し直したマップの JSON を読み直しても、イベントのラベル
// （maps/BB/scripts_MM.json）の対応が崩れないこと。Bochi そのものは動かさず、Bochi が書く形をまねる:
// - マップの JSON は CfruMapSource の決まった項目だけを、System.Text.Json の WriteIndented（2 空白・CRLF）で書く。
// - Persons などはイベントの構造体を並べたバイト列（base64）。Bochi で順を変える・消すと、この並びが変わる。
// - Bochi が読むのは maps/<数字>/<数字>.json だけで、scripts_MM.json と eventscripts には触らない。
import { describe, expect, it } from "vitest";
import {
  CfruProject,
  CommandBus,
  EventLabelProject,
  MapLabelsJson,
  MemoryProjectFs,
  RealignEventLabelsCommand,
  SetEventLabelCommand,
  createDefaultRegistry,
  mapLabelsPath,
  mapSourcePath,
  withEventLabels,
  type EventPositions,
  type MapDocument,
  type MapId,
} from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

/** Bochi の CfruMapSource の項目（この順で書く）。 */
const BOCHI_KEYS = [
  "Format", "Bank", "Number", "Header", "Footer", "Layout", "Border", "PrimaryTileset", "SecondaryTileset", "MapName",
  "EventHeader", "Persons", "Warps", "Traps", "Signs", "ConnectionsHeader", "Connections", "MapScripts", "MapScriptLists", "ItemBalls", "Wild",
] as const;
/** 人の構造体の大きさ（バイト）。 */
const PERSON_SIZE = 24;

/** フォルダのテキストファイル（無ければ失敗）。 */
function textOf(fs: MemoryProjectFs, path: string): string {
  const v = fs.files.get(path);
  if (typeof v !== "string") throw new Error(`テキストがありません: ${path}`);
  return v;
}

/** Bochi の書き方（WriteIndented、CRLF、最後に改行）で JSON を書く。知らない項目は落とす。 */
function bochiSerialize(source: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const k of BOCHI_KEYS) if (k in source) out[k] = source[k];
  return JSON.stringify(out, null, 2).replace(/\n/g, "\r\n") + "\r\n";
}

/** Bochi でマップの JSON の人の並びを変えたように書き直す（`order[新しい番号] = 古い番号`）。 */
function bochiReorderPersons(fs: MemoryProjectFs, id: MapId, order: readonly number[]): void {
  const path = mapSourcePath(id);
  const source = JSON.parse(textOf(fs, path)) as Record<string, unknown>;
  const bytes = Buffer.from(String(source["Persons"]), "base64");
  const records = Array.from({ length: bytes.length / PERSON_SIZE }, (_, i) => bytes.subarray(i * PERSON_SIZE, (i + 1) * PERSON_SIZE));
  const next = Buffer.concat(order.map((i) => records[i]!));
  // 人の数はイベントのヘッダーの先頭のバイト
  const header = Buffer.from(String(source["EventHeader"]), "base64");
  header[0] = order.length;
  source["Persons"] = next.toString("base64");
  source["EventHeader"] = header.toString("base64");
  fs.files.set(path, bochiSerialize(source));
}

function positionsOf(doc: MapDocument): EventPositions {
  const xy = (list: readonly { x: number; y: number }[] | undefined) => (list ?? []).map((v) => ({ x: v.x, y: v.y }));
  return { person: xy(doc.events?.persons), sign: xy(doc.events?.signs), tile: xy(doc.events?.traps) };
}

/** ZigzaguMap で開く（ProjectSession と同じ順: マップを読んだら座標を覚える）。 */
async function openZigzagu(rom: Uint8Array, fs: MemoryProjectFs, id: MapId) {
  const project = await CfruProject.open(rom, fs);
  const labels = await EventLabelProject.open(fs);
  const doc = await project.load(id);
  const counts = { person: doc.events?.persons.length ?? 0, sign: doc.events?.signs.length ?? 0, tile: doc.events?.traps.length ?? 0 };
  labels.observe(id, counts, positionsOf(doc));
  const positions = (bank: number, map: number) => {
    const d = project.loaded({ bank, map });
    return d ? positionsOf(d) : null;
  };
  const context = withEventLabels(project.editorContext(), () => labels.store, (bank, map) => positions(bank, map) ?? { person: [], sign: [], tile: [] });
  const bus = new CommandBus(context);
  const save = async () => {
    await project.save();
    return labels.save(fs, positions);
  };
  return { project, labels, doc, bus, save, positions };
}

describe("Bochi で保存し直したマップとラベルの対応", () => {
  const rom = buildSyntheticRom();

  async function prepare() {
    const fs = new MemoryProjectFs();
    fs.files.set("eventscripts", "##----\n");
    const z = await openZigzagu(rom, fs, (await CfruProject.open(rom, fs)).mapIds()[0]!);
    const id = z.doc.id;
    const registry = createDefaultRegistry();
    const base = z.doc.events!.persons.length;
    z.bus.execute(registry.create({ name: "addEvent", args: { ...id, kind: "person", x: 2, y: 3 } }));
    z.bus.execute(registry.create({ name: "addEvent", args: { ...id, kind: "person", x: 6, y: 7 } }));
    z.bus.execute(new SetEventLabelCommand({ ...id, target: "person", index: base, label: "Zz_NpcA" }));
    z.bus.execute(new SetEventLabelCommand({ ...id, target: "person", index: base + 1, label: "Zz_NpcB" }));
    await z.save();
    return { fs, id, base };
  }

  it("ZigzaguMap の出力をそのまま Bochi で書き直しても、ラベルと座標は変わらない", async () => {
    const { fs, id, base } = await prepare();
    const labelsPath = mapLabelsPath(id.bank, id.map);
    const labelsText = fs.files.get(labelsPath)!;
    const scripts = textOf(fs, "eventscripts");
    expect(scripts).toContain(`npc ${id.bank} ${id.map} ${base} Zz_NpcA`);
    // Bochi で開いて保存（並びは変えない。決まった項目だけで書き直す）
    const total = base + 2;
    bochiReorderPersons(fs, id, Array.from({ length: total }, (_, i) => i));
    const z = await openZigzagu(rom, fs, id);
    expect(z.labels.store.label(id.bank, id.map, "person", base)?.label).toBe("Zz_NpcA");
    expect(z.labels.store.mismatches(id.bank, id.map, positionsOf(z.doc))).toEqual([]);
    await z.save();
    expect(fs.files.get(labelsPath)).toBe(labelsText);
    expect(fs.files.get("eventscripts")).toBe(scripts);
  });

  it("Bochi で人の順を入れ替えると知らせが出て、付け直さずに出力してもずれの情報（ファイルの座標）は残る", async () => {
    const { fs, id, base } = await prepare();
    const labelsPath = mapLabelsPath(id.bank, id.map);
    const labelsText = fs.files.get(labelsPath)!;
    const scripts = textOf(fs, "eventscripts");
    const order = Array.from({ length: base + 2 }, (_, i) => i);
    [order[base], order[base + 1]] = [order[base + 1]!, order[base]!];
    bochiReorderPersons(fs, id, order);

    const z = await openZigzagu(rom, fs, id);
    expect(fs.files.has(labelsPath)).toBe(true); // Bochi は scripts_MM.json を消さない
    const found = z.labels.store.mismatches(id.bank, id.map, positionsOf(z.doc));
    expect(found.map((x) => [x.label, x.index, x.candidate])).toEqual([
      ["Zz_NpcA", base, base + 1],
      ["Zz_NpcB", base + 1, base],
    ]);
    // 付け直さずに出力: ファイルの座標と eventscripts はそのまま（知らせは次に開いたときも出る）
    await z.save();
    expect(fs.files.get(labelsPath)).toBe(labelsText);
    expect(fs.files.get("eventscripts")).toBe(scripts);
    const again = await openZigzagu(rom, fs, id);
    expect(again.labels.store.mismatches(id.bank, id.map, positionsOf(again.doc))).toHaveLength(2);

    // 座標で付け直して出力すると、ラベルが入れ替わった人へ付き、eventscripts の番号も入れ替わる
    again.bus.execute(new RealignEventLabelsCommand({ ...id }));
    expect(again.labels.store.label(id.bank, id.map, "person", base)?.label).toBe("Zz_NpcB");
    await again.save();
    const file = MapLabelsJson.parse(textOf(fs, labelsPath));
    expect(file.persons.map((p) => [p.index, p.x, p.y, p.label])).toEqual([
      [base, 6, 7, "Zz_NpcB"],
      [base + 1, 2, 3, "Zz_NpcA"],
    ]);
    const es = textOf(fs, "eventscripts");
    expect(es).toContain(`npc ${id.bank} ${id.map} ${base} Zz_NpcB`);
    expect(es).toContain(`npc ${id.bank} ${id.map} ${base + 1} Zz_NpcA`);
    const last = await openZigzagu(rom, fs, id);
    expect(last.labels.store.mismatches(id.bank, id.map, positionsOf(last.doc))).toEqual([]);
  });

  it("ZigzaguMap で動かした人は、出力でファイルの座標も新しくなる（ずれの知らせにしない）", async () => {
    const { fs, id, base } = await prepare();
    const z = await openZigzagu(rom, fs, id);
    z.bus.execute(createDefaultRegistry().create({ name: "moveEvent", args: { ...id, kind: "person", index: base, x: 9, y: 9 } }));
    await z.save();
    const file = MapLabelsJson.parse(textOf(fs, mapLabelsPath(id.bank, id.map)));
    expect(file.persons.find((p) => p.label === "Zz_NpcA")).toMatchObject({ x: 9, y: 9 });
    const again = await openZigzagu(rom, fs, id);
    expect(again.labels.store.mismatches(id.bank, id.map, positionsOf(again.doc))).toEqual([]);
  });

  it("Bochi で人を減らしても読み直せ、いなくなった人のラベルはずれとして知らせる", async () => {
    const { fs, id, base } = await prepare();
    bochiReorderPersons(fs, id, Array.from({ length: base + 1 }, (_, i) => i));
    const z = await openZigzagu(rom, fs, id);
    const found = z.labels.store.mismatches(id.bank, id.map, positionsOf(z.doc));
    expect(found.map((x) => [x.label, x.actual, x.candidate])).toEqual([["Zz_NpcB", null, null]]);
    await z.save();
    // ずれのある項目はそのまま残し、eventscripts も壊さない
    expect(MapLabelsJson.parse(textOf(fs, mapLabelsPath(id.bank, id.map))).persons.map((p) => p.label)).toEqual(["Zz_NpcA", "Zz_NpcB"]);
    expect(fs.files.get("eventscripts")).toContain(`npc ${id.bank} ${id.map} ${base} Zz_NpcA`);
  });
});
