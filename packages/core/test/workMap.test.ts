import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BlockGrid,
  CfruProject,
  CommandBus,
  CreateWorkMapCommand,
  DataError,
  DocumentStore,
  EditErrorCode,
  InsertMapCommand,
  MapDocument,
  MapSourceConverter,
  MapSourceJson,
  MemoryProjectFs,
  NEW_MAP_CELL,
  OpenMapFileCommand,
  ReplaceMapCommand,
  WORK_MAP_BANK,
  createDefaultRegistry,
  decodeAmMap,
  encodeAmMap,
  encodeBase64,
  toAmMapFiles,
  type CfruProject as Project,
  type Command,
  type TilesetRef,
} from "../src/index.js";
import { M00, M01, expectEditError, fingerprint, openLoaded, roundTrip } from "./helpers/editHarness.js";
import { SYN, buildSyntheticRom } from "./helpers/syntheticRom.js";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/am/${name}`, import.meta.url)));
const rom = buildSyntheticRom();
const PRIMARY: TilesetRef = { pointer: 0x08000000 + SYN.primaryHeader, secondary: false };
const SECONDARY: TilesetRef = { pointer: 0x08000000 + SYN.secondaryHeader, secondary: true };
const open = () => openLoaded(rom, undefined, [PRIMARY, SECONDARY]);
const W0 = { bank: WORK_MAP_BANK, map: 0 };

/** 作業用のマップの状態（fingerprint はプロジェクトのマップだけなので足す）。 */
function workPrint(project: Project): string {
  const ctx = project.editorContext();
  const doc = project.loaded(W0);
  return doc ? `\nwork:${JSON.stringify(ctx.workMapInfo(W0))}:${MapSourceJson.stringify(MapSourceConverter.toSource(doc))}` : "\nwork:none";
}

/** タイルセット番号 0・1 を合成 ROM のタイルセットに当てた DocumentStore（ベース ROM の表の代わり）。 */
function storeWithTable(project: Project): DocumentStore {
  const pointers = [PRIMARY.pointer, SECONDARY.pointer];
  const store = new DocumentStore({
    tilesetExists: (p) => pointers.includes(p),
    tilesetPointer: (i) => pointers[i] ?? null,
    tilesetIndex: (p) => (pointers.includes(p) ? pointers.indexOf(p) : null),
  });
  store.put(project.loaded(M00)!.clone());
  return store;
}

describe("作業用のマップ（新規マップの作成・作成したマップを開く）", () => {
  it("新規マップの作成: バンク -1 に作り、プロジェクトのマップ一覧・出力には入らない", async () => {
    const fs = new MemoryProjectFs();
    const p = await roundTrip(
      open,
      () => new CreateWorkMapCommand({ map: 0, name: "TESTMAP", width: 12, height: 10, primaryTileset: PRIMARY.pointer, secondaryTileset: SECONDARY.pointer, templateBank: 0, templateMap: 0 }),
      (project) => {
        const doc = project.loaded(W0)!;
        expect([doc.width, doc.height]).toEqual([12, 10]);
        expect(doc.grid.cells.every((c) => c === NEW_MAP_CELL)).toBe(true);
        expect([...doc.border.cells]).toEqual([0, 0, 0, 0]);
        expect(doc.events).toBeNull();
        expect(doc.header.music).toBe(0x100);
        expect(project.editorContext().workMapInfo(W0)).toEqual({ name: "TESTMAP", path: null });
        expect(project.mapIds()).not.toContainEqual(W0);
        expect(project.bankCounts()).toEqual([2, 1]);
        expect(project.isModified(W0)).toBe(false);
        expect(project.hasUnsavedChanges()).toBe(false);
        expect(project.editorContext().nextWorkMapNumber()).toBe(1);
      },
      workPrint,
    );
    const project = await CfruProject.open(rom, fs);
    await project.load(M00);
    new CommandBus(project.editorContext()).execute(
      new CreateWorkMapCommand({ map: 0, name: "X", width: 2, height: 2, primaryTileset: PRIMARY.pointer, secondaryTileset: SECONDARY.pointer }),
    );
    expect(await project.save()).toEqual({ written: [], removed: [] });
    expect(p.loaded(W0)).toBeDefined();
  });

  it("入力の検証（AdvanceMap と同じく、空・0 以下・未選択は「すべて記入してください」、次に大きさ、タイルセット）", async () => {
    const p = await open();
    const base = { map: 0, name: "T", width: 4, height: 4, primaryTileset: PRIMARY.pointer, secondaryTileset: SECONDARY.pointer };
    expectEditError(p, new CreateWorkMapCommand({ ...base, name: "" }), EditErrorCode.FillAllFields, { missing: ["name"] });
    expectEditError(p, new CreateWorkMapCommand({ ...base, width: 0 }), EditErrorCode.FillAllFields, { missing: ["width"] });
    expectEditError(p, new CreateWorkMapCommand({ ...base, height: -1 }), EditErrorCode.FillAllFields, { missing: ["height"] });
    expectEditError(p, new CreateWorkMapCommand({ ...base, secondaryTileset: null }), EditErrorCode.FillAllFields, { missing: ["secondaryTileset"] });
    expectEditError(p, new CreateWorkMapCommand({ ...base, width: 200, height: 40 }), EditErrorCode.MapTooLarge, { maxHeight: 33 });
    expectEditError(p, new CreateWorkMapCommand({ ...base, primaryTileset: 0 }), EditErrorCode.InvalidTileset);
    expect(p.loaded(W0)).toBeUndefined();
  });

  it("作成したマップを開く: .map と .evt から作り、取り消すと消える。JSON の引数から同じものを作れる", async () => {
    const project = await open();
    const store = storeWithTable(project);
    const bus = new CommandBus(store);
    const command = new OpenMapFileCommand({
      map: 0,
      name: "current",
      path: "C:\\maps\\current.map",
      data: encodeBase64(fixture("current.map")),
      events: encodeBase64(fixture("current.evt")),
      templateBank: 0,
      templateMap: 0,
    });
    bus.execute(command);
    const doc = store.document(W0);
    expect([doc.width, doc.height, doc.primaryTileset, doc.secondaryTileset]).toEqual([5, 4, PRIMARY.pointer, SECONDARY.pointer]);
    expect(doc.events?.persons).toHaveLength(1);
    expect(store.workMapInfo(W0)).toEqual({ name: "current", path: "C:\\maps\\current.map" });
    const saved = toAmMapFiles(doc, (pointer) => store.tilesetIndex(pointer));
    expect(saved.map).toEqual(fixture("current.map"));
    expect(saved.events).toEqual(fixture("current.evt"));

    const replay = storeWithTable(project);
    new CommandBus(replay).execute(createDefaultRegistry().create(JSON.parse(JSON.stringify({ name: command.name, args: command.args }))));
    expect(MapSourceJson.stringify(MapSourceConverter.toSource(replay.document(W0)))).toBe(MapSourceJson.stringify(MapSourceConverter.toSource(doc)));

    bus.undo();
    expect(store.find(W0)).toBeUndefined();
    bus.redo();
    expect(store.find(W0)).toBeDefined();
  });

  it("作成したマップを開く: .evt が無ければイベント無し。壊れたファイル・表に無いタイルセットはエラーで何も変えない", async () => {
    const project = await open();
    const store = storeWithTable(project);
    const bus = new CommandBus(store);
    bus.execute(new OpenMapFileCommand({ map: 0, name: "old", data: encodeBase64(fixture("old.map")) }));
    expect(store.document(W0).events).toBeNull();
    const fail = (command: Command, code: string): void => {
      expect(() => bus.execute(command)).toThrow(expect.objectContaining({ code }) as Error);
    };
    fail(new OpenMapFileCommand({ map: 1, name: "x", data: encodeBase64(new Uint8Array(5)) }), EditErrorCode.InvalidMapFile);
    fail(new OpenMapFileCommand({ map: 1, name: "x", data: encodeBase64(fixture("current.map")), events: encodeBase64(new Uint8Array(3)) }), EditErrorCode.InvalidMapFile);
    const bad = encodeAmMap({ ...decodeAmMap(fixture("current.map")), primaryTileset: 9 });
    fail(new OpenMapFileCommand({ map: 1, name: "x", data: encodeBase64(bad) }), EditErrorCode.InvalidTileset);
    expect(store.find({ bank: WORK_MAP_BANK, map: 1 })).toBeUndefined();
  });

  it("表に無いタイルセットのマップは .map に書けない", async () => {
    const project = await open();
    expect(() => toAmMapFiles(project.loaded(M00)!, () => null)).toThrow(DataError);
  });
});

/** 作業用のマップを作っておいたプロジェクト。 */
async function openWithWork(): Promise<Project> {
  const p = await open();
  new CommandBus(p.editorContext()).execute(
    new CreateWorkMapCommand({ map: 0, name: "TESTMAP", width: 3, height: 2, primaryTileset: PRIMARY.pointer, secondaryTileset: SECONDARY.pointer, templateBank: 0, templateMap: 1 }),
  );
  return p;
}

describe("マップの追加/挿入", () => {
  it("バンクの末尾と新しいバンクに写して加え、出力 → 開き直しで同じ内容になる。取り消すと JSON も消える", async () => {
    await roundTrip(openWithWork, () => new InsertMapCommand({ bank: 0, map: 2, sourceBank: WORK_MAP_BANK, sourceMap: 0 }), (p) => {
      const doc = p.loaded({ bank: 0, map: 2 })!;
      expect([doc.width, doc.height]).toEqual([3, 2]);
      expect(p.bankCounts()).toEqual([3, 1]);
      expect(p.isModified({ bank: 0, map: 2 })).toBe(true);
    });
    await roundTrip(open, () => new InsertMapCommand({ bank: 2, map: 0, sourceBank: 0, sourceMap: 0 }), (p) => {
      const copy = p.loaded({ bank: 2, map: 0 })!;
      const source = p.loaded(M00)!;
      expect(copy.events).toEqual(source.events);
      expect(copy.connections).toEqual(source.connections);
      expect(copy.wild).toEqual([]);
      expect(p.bankCounts()).toEqual([2, 1, 1]);
    });

    const fs = new MemoryProjectFs();
    const p = await CfruProject.open(rom, fs);
    await p.load(M00);
    const bus = new CommandBus(p.editorContext());
    bus.execute(new InsertMapCommand({ bank: 2, map: 0, sourceBank: 0, sourceMap: 0 }));
    bus.execute(new InsertMapCommand({ bank: 0, map: 2, sourceBank: 2, sourceMap: 0 }));
    expect((await p.save()).written).toEqual(["maps/project.json", "maps/00/02.json", "maps/02/00.json"]);
    const again = await CfruProject.open(rom, fs);
    expect(again.bankCounts()).toEqual([3, 1, 1]);
    for (const id of [{ bank: 0, map: 2 }, { bank: 2, map: 0 }]) {
      expect(MapSourceJson.stringify(MapSourceConverter.toSource(await again.load(id)))).toBe(MapSourceJson.stringify(MapSourceConverter.toSource(p.loaded(id)!)));
    }
    bus.undo();
    bus.undo();
    expect(await p.save()).toEqual({ written: [], removed: ["maps/00/02.json", "maps/02/00.json"] });
  });

  it("途中の番号・飛ばしたバンク・既にある番号・無い写し元はエラー", async () => {
    const p = await openWithWork();
    const src = { sourceBank: WORK_MAP_BANK, sourceMap: 0 };
    expectEditError(p, new InsertMapCommand({ bank: 0, map: 3, ...src }), EditErrorCode.MapSlotNotAppend, { expected: 2 });
    expectEditError(p, new InsertMapCommand({ bank: 0, map: 1, ...src }), EditErrorCode.MapExists);
    expectEditError(p, new InsertMapCommand({ bank: 3, map: 0, ...src }), EditErrorCode.BankSkip, { expected: 2 });
    expectEditError(p, new InsertMapCommand({ bank: 0, map: 2, sourceBank: WORK_MAP_BANK, sourceMap: 5 }), EditErrorCode.MapNotFound);
  });

  it("指定先にインポート: 番号はそのままで中身を差し替える（野生は残し、落とし物は消える）", async () => {
    const p = await roundTrip(openWithWork, () => new ReplaceMapCommand({ bank: 0, map: 0, sourceBank: WORK_MAP_BANK, sourceMap: 0 }), (project) => {
      const doc = project.loaded(M00)!;
      expect([doc.width, doc.height]).toEqual([3, 2]);
      expect(doc.events).toBeNull();
      expect(doc.wild.length).toBeGreaterThan(0);
      expect(doc.header.music).toBe(project.loaded(M01)!.header.music);
    });
    expect(fingerprint(p)).toContain("0.0:");
    expectEditError(p, new ReplaceMapCommand({ bank: 0, map: 7, sourceBank: WORK_MAP_BANK, sourceMap: 0 }), EditErrorCode.MapNotFound);
  });
});

describe("作業用のマップの番号", () => {
  it("DocumentStore の bankCounts には入らない", () => {
    const store = new DocumentStore();
    const doc = new MapDocument({
      id: W0,
      header: { music: 0, layoutId: 0, regionMapSectionId: 0, cave: 0, weather: 0, mapType: 0, bikingAllowed: 0, flags: 0, floorNum: 0, battleType: 0 },
      grid: new BlockGrid(1, 1),
      border: new BlockGrid(2, 2),
      primaryTileset: 1,
      secondaryTileset: 2,
    });
    store.putWorkMap(doc, { name: "a", path: null });
    expect(store.bankCounts()).toEqual([]);
    expect(() => store.putWorkMap(doc, { name: "a", path: null })).toThrow();
    expect(store.nextWorkMapNumber()).toBe(1);
  });
});
