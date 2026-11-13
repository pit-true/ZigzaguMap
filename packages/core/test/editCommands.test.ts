import { describe, expect, it } from "vitest";
import {
  AddConnectionCommand,
  AddEventCommand,
  AddMapScriptCommand,
  AddMapScriptConditionCommand,
  CommandBus,
  CreateMapCommand,
  EditErrorCode,
  MoveEventCommand,
  NEW_MAP_CELL,
  RemapBlockPalettesCommand,
  RemoveConnectionCommand,
  RemoveEventCommand,
  RemoveMapScriptCommand,
  RemoveMapScriptConditionCommand,
  ResizeMapCommand,
  SetBlockCommand,
  SetBlockCountCommand,
  SetBlockDataCommand,
  SetBorderCommand,
  SetConnectionCommand,
  SetEventCountsCommand,
  SetEventFieldsCommand,
  SetHeaderFieldsCommand,
  SetItemBallCommand,
  SetMapNameCommand,
  SetMapScriptCommand,
  SetMapScriptConditionCommand,
  SetPaletteColorsCommand,
  SetRawFooterCommand,
  SetRawHeaderCommand,
  SetTilesCommand,
  SetTilesetHeaderCommand,
  SetTilesetsCommand,
  SetWildAreasCommand,
  SetWildRateCommand,
  SetWildSlotCommand,
  createDefaultRegistry,
  encodeBase64,
  eventsOutsideMap,
  maxMapHeight,
  packTileRef,
  parseHexInput,
  parseIntInput,
  toHexBytes,
  EditError,
  type TilesetRef,
} from "../src/index.js";
import { M00, M01, expectEditError, fingerprint, openLoaded, roundTrip, tilesetPrint } from "./helpers/editHarness.js";
import { SYN, buildSyntheticRom } from "./helpers/syntheticRom.js";

const rom = buildSyntheticRom();
const PRIMARY: TilesetRef = { pointer: 0x08000000 + SYN.primaryHeader, secondary: false };
const SECONDARY: TilesetRef = { pointer: 0x08000000 + SYN.secondaryHeader, secondary: true };
const open = () => openLoaded(rom, undefined, [PRIMARY, SECONDARY]);
const tilesets = (p: Awaited<ReturnType<typeof open>>) => tilesetPrint(p.editorContext(), [PRIMARY, SECONDARY]);

describe("入力の読み取り（AdvanceMap の欄と同じ規則）", () => {
  it("16 進欄: $ を前に付けて読む。空欄は 0。読めなければ '$ZZ' の整数エラー", () => {
    expect(parseHexInput("ff")).toBe(0xff);
    expect(parseHexInput("16F884")).toBe(0x16f884);
    expect(parseHexInput("")).toBe(0);
    expect(() => parseHexInput("ZZ")).toThrow(EditError);
    try {
      parseHexInput("ZZ");
    } catch (e) {
      expect((e as EditError).code).toBe(EditErrorCode.InvalidInteger);
      expect((e as EditError).params).toEqual({ text: "$ZZ" });
    }
    // `$` で始まる入力は `$` を重ねない（AdvanceMap と同じ「'$GGGGGG' is not a valid integer value.」）
    expect(parseHexInput("$16F884")).toBe(0x16f884);
    try {
      parseHexInput("$GGGGGG");
    } catch (e) {
      expect((e as EditError).params).toEqual({ text: "$GGGGGG" });
    }
  });

  it("10 進欄: Delphi の StrToInt と同じく空白・符号・$・0x を受け付ける", () => {
    expect(parseIntInput(" 7")).toBe(7);
    expect(parseIntInput("0x10")).toBe(16);
    expect(parseIntInput("$10")).toBe(16);
    expect(parseIntInput("-5")).toBe(-5);
    for (const bad of ["abc", "12.5", "", "3,0"]) expect(() => parseIntInput(bad)).toThrow(EditError);
  });
});

describe("イベントの編集コマンド", () => {
  it("追加: 末尾に初期値（全部 0）。人の番号は添字 + 1", async () => {
    await roundTrip(
      open,
      () => new AddEventCommand({ ...M00, kind: "person", x: 1, y: 1 }),
      (p) => {
        const persons = p.loaded(M00)!.events!.persons;
        expect(persons).toHaveLength(2);
        expect(persons[1]).toMatchObject({ localId: 2, graphicsId: 0, x: 1, y: 1, movementType: 0, script: 0 });
      },
    );
  });

  it("イベントの無いマップに追加すると表を作る", async () => {
    await roundTrip(
      open,
      () => new AddEventCommand({ ...M01, kind: "sign" }),
      (p) => expect(p.loaded(M01)!.events).toEqual({ persons: [], warps: [], traps: [], signs: [{ x: 0, y: 0, elevation: 0, kind: 0, padding: 0, content: { type: "script", script: 0 } }] }),
    );
  });

  it("削除: 後ろが前に詰まる", async () => {
    await roundTrip(
      open,
      () => new RemoveEventCommand({ ...M00, kind: "sign", index: 0 }),
      (p) => {
        const signs = p.loaded(M00)!.events!.signs;
        expect(signs).toHaveLength(1);
        expect(signs[0]!.content.type).toBe("hiddenItem");
      },
    );
  });

  it("移動: 座標を変える。マップの外にも置け、eventsOutsideMap で分かる", async () => {
    await roundTrip(
      open,
      () => new MoveEventCommand({ ...M00, kind: "warp", index: 0, x: 0x1e, y: 0x19 }),
      (p) => {
        expect(p.loaded(M00)!.events!.warps[0]).toMatchObject({ x: 0x1e, y: 0x19 });
        expect(eventsOutsideMap(p.loaded(M00)!)).toContainEqual({ kind: "warp", index: 0 });
      },
    );
  });

  it("各項目の変更（人・ワープ・スクリプトタイル）", async () => {
    await roundTrip(
      open,
      () => new SetEventFieldsCommand({ ...M00, kind: "person", index: 0, fields: { graphicsId: 77, movementType: 2, trainerType: 1, script: 0x0816f884, flag: 0x10 } }),
      (p) => expect(p.loaded(M00)!.events!.persons[0]).toMatchObject({ graphicsId: 77, movementType: 2, trainerType: 1, script: 0x0816f884 }),
    );
    await roundTrip(open, () => new SetEventFieldsCommand({ ...M00, kind: "warp", index: 0, fields: { warpId: 1, bank: 4, map: 0 } }));
    const withTrap = async () => {
      const p = await open();
      new CommandBus(p.editorContext()).execute(new AddEventCommand({ ...M00, kind: "trap" }));
      return p;
    };
    await roundTrip(withTrap, () => new SetEventFieldsCommand({ ...M00, kind: "trap", index: 0, fields: { variable: 0x4050, value: 3, script: 0x0816f715 } }));
  });

  it("看板の種別を変えると中身の 4 バイトを読み直す（スクリプト ⇔ 隠しアイテム）", async () => {
    const p = await roundTrip(
      open,
      () => new SetEventFieldsCommand({ ...M00, kind: "sign", index: 0, fields: { kind: 5 } }),
      (p) => expect(p.loaded(M00)!.events!.signs[0]!.content).toEqual({ type: "hiddenItem", item: 0x2211, flag: 0x33, amount: 8, underfoot: false }),
    );
    // 種別を戻すと元のポインタに戻る。
    new CommandBus(p.editorContext()).execute(new SetEventFieldsCommand({ ...M00, kind: "sign", index: 0, fields: { kind: 0 } }));
    expect(p.loaded(M00)!.events!.signs[0]!.content).toEqual({ type: "script", script: 0x08332211 });
    // 種別と中身を同時に渡すと、種別を先に変える。
    await roundTrip(
      open,
      () => new SetEventFieldsCommand({ ...M00, kind: "sign", index: 1, fields: { amount: 3, underfoot: false, item: 0x44 } }),
      (p) => expect(p.loaded(M00)!.events!.signs[1]!.content).toMatchObject({ item: 0x44, amount: 3, underfoot: false }),
    );
    await roundTrip(
      open,
      () => new SetEventFieldsCommand({ ...M00, kind: "sign", index: 0, fields: { kind: 7, item: 13, flag: 0x16, amount: 1 } }),
      (p) => expect(p.loaded(M00)!.events!.signs[0]!.content).toEqual({ type: "hiddenItem", item: 13, flag: 0x16, amount: 1, underfoot: false }),
    );
  });

  it("イベントの数の変更（イベントマネージャー）: 増やすと末尾に 0、減らすと末尾から消える", async () => {
    await roundTrip(
      open,
      () => new SetEventCountsCommand({ ...M00, persons: 3, signs: 1 }),
      (p) => {
        const e = p.loaded(M00)!.events!;
        expect(e.persons).toHaveLength(3);
        expect(e.persons[2]).toMatchObject({ localId: 3, x: 0, y: 0 });
        expect(e.signs).toHaveLength(1);
        expect(e.signs[0]!.content.type).toBe("script");
        expect(e.warps).toHaveLength(1);
      },
    );
    // イベントの無いマップでも作れる（AdvanceMap の 3.50 の例: 人 2・看板 1）。
    await roundTrip(
      open,
      () => new SetEventCountsCommand({ ...M01, persons: 2, signs: 1 }),
      (p) => expect(p.loaded(M01)!.events!.persons).toHaveLength(2),
    );
  });

  it("落とし物: 人のスクリプトを 0 にして ItemBalls に加える。人を消すと番号が詰まる", async () => {
    const id = "0123456789abcdef0123456789abcdef";
    const p = await roundTrip(
      open,
      () => new SetItemBallCommand({ ...M00, personIndex: 0, itemId: 13, id }),
      (p) => {
        const doc = p.loaded(M00)!;
        expect(doc.itemBalls).toEqual([{ id, personIndex: 0, itemId: 13, label: `HiddenItem_00_00_${id}` }]);
        expect(doc.events!.persons[0]!.script).toBe(0);
      },
    );
    const bus = new CommandBus(p.editorContext());
    bus.execute(new AddEventCommand({ ...M00, kind: "person" }));
    bus.execute(new SetItemBallCommand({ ...M00, personIndex: 1, itemId: 4, id: "f".repeat(32) }));
    bus.execute(new RemoveEventCommand({ ...M00, kind: "person", index: 0 }));
    expect(p.loaded(M00)!.itemBalls).toEqual([{ id: "f".repeat(32), personIndex: 0, itemId: 4, label: `HiddenItem_00_00_${"f".repeat(32)}` }]);
    bus.execute(new SetEventCountsCommand({ ...M00, persons: 0 }));
    expect(p.loaded(M00)!.itemBalls).toEqual([]);
    // 識別子を省略すると作ったときに決めて引数に残す。
    const auto = new SetItemBallCommand({ ...M00, personIndex: 0, itemId: 1 });
    expect(auto.args.id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("入力の検証", async () => {
    const p = await open();
    expectEditError(p, new MoveEventCommand({ ...M00, kind: "person", index: 0, x: 0x10000, y: 0 }), EditErrorCode.ValueOutOfRange, { field: "x" });
    expectEditError(p, new RemoveEventCommand({ ...M00, kind: "sign", index: 5 }), EditErrorCode.EventIndexOutOfRange, { kind: "sign", index: 5, count: 2 });
    expectEditError(p, new RemoveEventCommand({ ...M01, kind: "person", index: 0 }), EditErrorCode.EventIndexOutOfRange, { count: 0 });
    expectEditError(p, new SetEventFieldsCommand({ ...M00, kind: "person", index: 0, fields: { nope: 1 } }), EditErrorCode.UnknownField);
    expectEditError(p, new SetEventFieldsCommand({ ...M00, kind: "person", index: 0, fields: { graphicsId: 256 } }), EditErrorCode.ValueOutOfRange, { max: 255 });
    expectEditError(p, new SetEventFieldsCommand({ ...M00, kind: "sign", index: 0, fields: { item: 1 } }), EditErrorCode.FieldNotApplicable);
    expectEditError(p, new SetEventFieldsCommand({ ...M00, kind: "sign", index: 1, fields: { script: 1 } }), EditErrorCode.FieldNotApplicable);
    // 途中の項目で失敗しても、前の項目も書かない。
    expectEditError(p, new SetEventFieldsCommand({ ...M00, kind: "person", index: 0, fields: { graphicsId: 3, movementRangeX: 16 } }), EditErrorCode.ValueOutOfRange);
    expectEditError(p, new SetEventCountsCommand({ ...M00, persons: 256 }), EditErrorCode.ValueOutOfRange);
    expectEditError(p, new SetItemBallCommand({ ...M00, personIndex: 3, itemId: 1 }), EditErrorCode.ItemBallPersonOutOfRange);
    const full = await open();
    new CommandBus(full.editorContext()).execute(new SetEventCountsCommand({ ...M00, warps: 255 }));
    expectEditError(full, new AddEventCommand({ ...M00, kind: "warp" }), EditErrorCode.EventLimit, { max: 255 });
  });
});

describe("ヘッダーの編集コマンド", () => {
  it("各項目（音楽・天候・マップタイプ・戦闘背景・明るさ・名前表示・走行・自転車・穴抜け）", async () => {
    await roundTrip(
      open,
      () =>
        new SetHeaderFieldsCommand({
          ...M00,
          fields: { music: 0x12c, weather: 3, mapType: 8, battleType: 1, cave: 1, bikingAllowed: 1, floorNum: -2, allowRunning: true, allowEscaping: true, showMapName: 1 },
        }),
      (p) => expect(p.loaded(M00)!.header).toMatchObject({ music: 0x12c, weather: 3, mapType: 8, battleType: 1, cave: 1, bikingAllowed: 1, floorNum: -2, flags: 0x07 }),
    );
    await roundTrip(open, () => new SetHeaderFieldsCommand({ ...M00, fields: { flags: 0x06 } }), (p) => expect(p.loaded(M00)!.header.flags).toBe(6));
  });

  it("マップ名 ID を変えるとマップ名もその番号の名前になる", async () => {
    await roundTrip(open, () => new SetHeaderFieldsCommand({ ...M00, fields: { regionMapSectionId: 0x10 } }), (p) => expect(p.loaded(M00)!.mapName).toBeNull());
  });

  it("生のバイト（高度なヘッダー）: ポインタは読み捨てる", async () => {
    const header = "70152A08808E370882F516081C68310823014E005800020101060000";
    await roundTrip(
      open,
      () => new SetRawHeaderCommand({ ...M00, header }),
      (p) => {
        expect(p.loaded(M00)!.header).toMatchObject({ music: 0x123, layoutId: 0x4e, regionMapSectionId: 0x58, weather: 2, mapType: 1, bikingAllowed: 1, flags: 6 });
        expect(toHexBytes(Uint8Array.from([0x0a, 0xff]))).toBe("0AFF");
      },
    );
    const p = await open();
    expectEditError(p, new SetRawHeaderCommand({ ...M00, header: "0011" }), EditErrorCode.InvalidRawBytes, { expected: 28 });
  });

  it("マップ名の変更: 同じ地名番号の全マップの名前が変わる", async () => {
    await roundTrip(
      open,
      () => new SetMapNameCommand({ regionId: 0x58, text: "トキワ" }),
      (p) => {
        expect(p.loaded(M00)!.mapNameText()).toBe("トキワ");
        expect(p.loaded(M01)!.mapNameText()).toBe("トキワ");
      },
    );
    const p = await open();
    expectEditError(p, new SetMapNameCommand({ regionId: 0x10, text: "あ" }), EditErrorCode.NoMapName);
    expectEditError(p, new SetMapNameCommand({ regionId: 0x58, text: "あ☃" }), EditErrorCode.MapNameInvalidChar, { char: "☃" });
    expectEditError(p, new SetMapNameCommand({ regionId: 0x58, text: "あ".repeat(64) }), EditErrorCode.MapNameTooLong, { max: 64 });
  });

  it("タイルセットの変更", async () => {
    await roundTrip(open, () => new SetTilesetsCommand({ ...M00, primary: SECONDARY.pointer }), (p) => expect(p.loaded(M00)!.primaryTileset).toBe(SECONDARY.pointer));
    const p = await open();
    expectEditError(p, new SetTilesetsCommand({ ...M00, primary: 0x08000000 + SYN.events }), EditErrorCode.InvalidTileset);
    expectEditError(p, new SetTilesetsCommand({ ...M00, secondary: -1 }), EditErrorCode.InvalidTileset);
  });
});

describe("マップの大きさ・ボーダー", () => {
  it("上限 (幅+15)×(高さ+14) ≤ 10240（AdvanceMap の実測と同じ最大の高さ）", () => {
    expect(maxMapHeight(200)).toBe(33);
    expect(maxMapHeight(100)).toBe(75);
    expect(maxMapHeight(215)).toBe(30);
    expect(maxMapHeight(255)).toBe(23);
  });

  it("右と下へ伸縮し、増えたマスは 0（黒）", async () => {
    await roundTrip(
      open,
      () => new ResizeMapCommand({ ...M00, width: 3, height: 4 }),
      (p) => {
        const doc = p.loaded(M00)!;
        expect([doc.width, doc.height]).toEqual([3, 4]);
        expect([...doc.grid.cells]).toEqual([1, 2, 0, 640, (1 << 10) | 1, 0, 0, 0, 0, 0, 0, 0]);
      },
    );
    await roundTrip(open, () => new ResizeMapCommand({ ...M00, width: 1, height: 1 }), (p) => expect([...p.loaded(M00)!.grid.cells]).toEqual([1]));
  });

  it("大きさの検証", async () => {
    const p = await open();
    expectEditError(p, new ResizeMapCommand({ ...M00, width: 200, height: 34 }), EditErrorCode.MapTooLarge, { width: 200, maxHeight: 33 });
    expectEditError(p, new ResizeMapCommand({ ...M00, width: 100, height: 76 }), EditErrorCode.MapTooLarge, { maxHeight: 75 });
    expectEditError(p, new ResizeMapCommand({ ...M00, width: 0, height: 5 }), EditErrorCode.InvalidMapSize);
    expectEditError(p, new ResizeMapCommand({ ...M00, width: -1, height: 5 }), EditErrorCode.InvalidMapSize);
    new CommandBus(p.editorContext()).execute(new ResizeMapCommand({ ...M00, width: 100, height: 75 }));
    expect(p.loaded(M00)!.height).toBe(75);
  });

  it("ボーダーの大きさと中身、生のフッター", async () => {
    await roundTrip(open, () => new SetBorderCommand({ ...M00, width: 1, height: 1, cells: [5] }), (p) => expect([...p.loaded(M00)!.border.cells]).toEqual([5]));
    const footer = toHexBytes(Uint8Array.from([3, 0, 0, 0, 2, 0, 0, 0, ...new Array(8).fill(0), ...le32(PRIMARY.pointer), ...le32(SECONDARY.pointer), 1, 1, 0, 0]));
    await roundTrip(
      open,
      () => new SetRawFooterCommand({ ...M00, footer }),
      (p) => {
        const doc = p.loaded(M00)!;
        expect([doc.width, doc.height, doc.border.width, doc.border.height]).toEqual([3, 2, 1, 1]);
      },
    );
    // 幅・高さを変えると、配置は同じ並びのまま新しい幅で折り返す（AdvanceMap と同じ。足りないマスは 0）
    const q = await open();
    const before = [...q.loaded(M00)!.grid.cells];
    new CommandBus(q.editorContext()).execute(new SetRawFooterCommand({ ...M00, footer }));
    expect([...q.loaded(M00)!.grid.cells]).toEqual(Array.from({ length: 6 }, (_, i) => before[i] ?? 0));
    const p = await open();
    expectEditError(p, new SetBorderCommand({ ...M00, width: 2, height: 1, cells: [1] }), EditErrorCode.InvalidRawBytes);
  });
});

describe("マップスクリプトの編集コマンド", () => {
  it("追加・削除・種類とポインタの変更", async () => {
    await roundTrip(open, () => new AddMapScriptCommand({ ...M00, type: 3, pointer: 0x0816f58d }), (p) => expect(p.loaded(M00)!.mapScripts![2]).toEqual({ type: 3, pointer: 0x0816f58d, table: null }));
    await roundTrip(open, () => new AddMapScriptCommand({ ...M01, type: 4 }), (p) => expect(p.loaded(M01)!.mapScripts![0]!.table!.entries).toEqual([]));
    await roundTrip(open, () => new RemoveMapScriptCommand({ ...M00, index: 0 }), (p) => expect(p.loaded(M00)!.mapScripts!.map((e) => e.type)).toEqual([2]));
    await roundTrip(open, () => new SetMapScriptCommand({ ...M00, index: 0, pointer: 0x08000001 }));
    // 条件表の種類にすると空の表を持ち、戻すとオフセットが戻る（AdvanceMap と同じ）。
    const p = await roundTrip(open, () => new SetMapScriptCommand({ ...M00, index: 0, type: 2 }), (p) => expect(p.loaded(M00)!.mapScripts![0]!.table).not.toBeNull());
    new CommandBus(p.editorContext()).execute(new SetMapScriptCommand({ ...M00, index: 0, type: 5 }));
    expect(p.loaded(M00)!.mapScripts![0]).toEqual({ type: 5, pointer: 0x08123456, table: null });
  });

  it("条件表の行の追加・削除・変更", async () => {
    await roundTrip(open, () => new AddMapScriptConditionCommand({ ...M00, index: 1, variable: 0x4050, value: 2, script: 0x0816f600 }), (p) =>
      expect(p.loaded(M00)!.mapScripts![1]!.table!.entries).toHaveLength(2),
    );
    await roundTrip(open, () => new RemoveMapScriptConditionCommand({ ...M00, index: 1, row: 0 }), (p) => expect(p.loaded(M00)!.mapScripts![1]!.table!.entries).toEqual([]));
    await roundTrip(open, () => new SetMapScriptConditionCommand({ ...M00, index: 1, row: 0, value: 9 }), (p) =>
      expect(p.loaded(M00)!.mapScripts![1]!.table!.entries[0]).toEqual({ variable: 0x4001, value: 9, script: 0x08654321 }),
    );
  });

  it("入力の検証", async () => {
    const p = await open();
    expectEditError(p, new AddMapScriptCommand({ ...M00, type: 0 }), EditErrorCode.MapScriptTypeUnset);
    expectEditError(p, new SetMapScriptCommand({ ...M00, index: 9, type: 1 }), EditErrorCode.MapScriptIndexOutOfRange, { count: 2 });
    expectEditError(p, new AddMapScriptConditionCommand({ ...M00, index: 0, variable: 1, value: 0, script: 0 }), EditErrorCode.MapScriptNotTable);
    expectEditError(p, new AddMapScriptConditionCommand({ ...M00, index: 1, variable: 0, value: 0, script: 0 }), EditErrorCode.ConditionVariableZero);
    expectEditError(p, new RemoveMapScriptConditionCommand({ ...M00, index: 1, row: 1 }), EditErrorCode.ConditionIndexOutOfRange);
  });
});

describe("接続の編集コマンド", () => {
  it("追加（初期値は方向 無し・0・0.0）・削除・変更", async () => {
    await roundTrip(open, () => new AddConnectionCommand({ ...M00 }), (p) => expect(p.loaded(M00)!.connections![1]).toEqual({ direction: 0, offset: 0, bank: 0, map: 0, padding: 0 }));
    await roundTrip(open, () => new AddConnectionCommand({ ...M01, direction: 1, targetBank: 0, targetMap: 0 }), (p) => expect(p.loaded(M01)!.connections).toHaveLength(1));
    await roundTrip(open, () => new RemoveConnectionCommand({ ...M00, index: 0 }), (p) => expect(p.loaded(M00)!.connections).toEqual([]));
    await roundTrip(open, () => new SetConnectionCommand({ ...M00, index: 0, direction: 3, offset: 5, targetBank: 1, targetMap: 1 }), (p) =>
      expect(p.loaded(M00)!.connections![0]).toEqual({ direction: 3, offset: 5, bank: 1, map: 1, padding: 0 }),
    );
  });

  it("入力の検証", async () => {
    const p = await open();
    expectEditError(p, new SetConnectionCommand({ ...M00, index: 3, direction: 1 }), EditErrorCode.ConnectionIndexOutOfRange);
    expectEditError(p, new SetConnectionCommand({ ...M00, index: 0, direction: 7 }), EditErrorCode.ValueOutOfRange);
    expectEditError(p, new SetConnectionCommand({ ...M00, index: 0, targetBank: 256 }), EditErrorCode.ValueOutOfRange);
  });
});

describe("野生の編集コマンド", () => {
  it("出現率・スロット", async () => {
    await roundTrip(open, () => new SetWildRateCommand({ ...M00, area: 1, rate: 30 }), (p) => expect(p.loaded(M00)!.wild[0]!.areas[1]!.rate).toBe(30));
    await roundTrip(open, () => new SetWildSlotCommand({ ...M00, area: 1, slot: 0, minLevel: 7, maxLevel: 9, species: 0x1a }), (p) =>
      expect(p.loaded(M00)!.wild[0]!.areas[1]!.slots[0]).toEqual({ minLevel: 7, maxLevel: 9, species: 0x1a }),
    );
  });

  it("エリアの追加と削除（追加ダイアログ）: 追加したエリアは出現率 0・Lv 1〜1・種族 0", async () => {
    await roundTrip(open, () => new SetWildAreasCommand({ ...M00, areas: [true, false, false, true] }), (p) => {
      const areas = p.loaded(M00)!.wild[0]!.areas;
      expect(areas[0]!.slots).toHaveLength(12);
      expect(areas[0]!.slots[0]).toEqual({ minLevel: 1, maxLevel: 1, species: 0 });
      expect(areas[1]!.slots).toEqual([]);
      expect(areas[3]!.slots).toHaveLength(10);
    });
    await roundTrip(open, () => new SetWildAreasCommand({ ...M01, areas: [true, false, false, false] }), (p) => expect(p.loaded(M01)!.wild).toHaveLength(1));
  });

  it("入力の検証", async () => {
    const p = await open();
    expectEditError(p, new SetWildAreasCommand({ ...M00, areas: [false, false, false, false] }), EditErrorCode.WildAddCanceled);
    expectEditError(p, new SetWildRateCommand({ ...M00, area: 0, rate: 1 }), EditErrorCode.WildAreaMissing, { area: 0 });
    expectEditError(p, new SetWildRateCommand({ ...M00, area: 1, rate: 300 }), EditErrorCode.ValueOutOfRange);
    expectEditError(p, new SetWildSlotCommand({ ...M00, area: 1, slot: 5, minLevel: 1 }), EditErrorCode.ValueOutOfRange, { field: "slot" });
  });
});

describe("新規マップとバンク", () => {
  it("既存バンクの末尾と新しいバンク（全マス 0x3001、ボーダー 2×2 の 0、イベントなし）", async () => {
    await roundTrip(
      open,
      () => new CreateMapCommand({ bank: 0, map: 2, width: 12, height: 10, primaryTileset: PRIMARY.pointer, secondaryTileset: SECONDARY.pointer, templateBank: 0, templateMap: 0 }),
      (p) => {
        const doc = p.loaded({ bank: 0, map: 2 })!;
        expect([doc.width, doc.height]).toEqual([12, 10]);
        expect(doc.grid.cells.every((c) => c === NEW_MAP_CELL)).toBe(true);
        expect([...doc.border.cells]).toEqual([0, 0, 0, 0]);
        expect(doc.events).toBeNull();
        expect(doc.header.music).toBe(0x100);
        expect(doc.mapNameText()).toBe("マサラ");
        expect(p.bankCounts()).toEqual([3, 1]);
      },
    );
    await roundTrip(
      open,
      () => new CreateMapCommand({ bank: 2, map: 0, width: 4, height: 4, primaryTileset: PRIMARY.pointer, secondaryTileset: SECONDARY.pointer }),
      (p) => expect(p.bankCounts()).toEqual([2, 1, 1]),
    );
  });

  it("入力の検証（すべて記入、末尾だけ、新しいバンクはマップ 0 から）", async () => {
    const p = await open();
    const base = { width: 4, height: 4, primaryTileset: PRIMARY.pointer, secondaryTileset: SECONDARY.pointer };
    expectEditError(p, new CreateMapCommand({ ...base, bank: 0, map: 2, width: null }), EditErrorCode.FillAllFields, { missing: ["width"] });
    expectEditError(p, new CreateMapCommand({ ...base, bank: 0, map: 3 }), EditErrorCode.MapSlotNotAppend, { expected: 2 });
    expectEditError(p, new CreateMapCommand({ ...base, bank: 0, map: 1 }), EditErrorCode.MapExists);
    expectEditError(p, new CreateMapCommand({ ...base, bank: 2, map: 1 }), EditErrorCode.MapSlotNotAppend, { expected: 0 });
    expectEditError(p, new CreateMapCommand({ ...base, bank: 3, map: 0 }), EditErrorCode.BankSkip, { expected: 2 });
    expectEditError(p, new CreateMapCommand({ ...base, bank: 0, map: 2, primaryTileset: 0 }), EditErrorCode.InvalidTileset);
    expectEditError(p, new CreateMapCommand({ ...base, bank: 0, map: 2, width: 200, height: 40 }), EditErrorCode.MapTooLarge);
    expect(CreateMapCommand.nextSlots(p.editorContext())).toEqual({ appendTo: [{ bank: 0, map: 2 }, { bank: 1, map: 1 }], newBank: { bank: 2, map: 0 } });
  });
});

describe("ブロックとパレットの編集コマンド", () => {
  const t = { tileset: PRIMARY.pointer, secondary: false };
  it("ブロック定義と属性", async () => {
    const tiles = [packTileRef({ tile: 0x12, hflip: true, vflip: true, palette: 3 }), 1, 1, 1, 0, 0, 0, 0];
    expect(tiles[0]).toBe(0x3c12);
    await roundTrip(open, () => new SetBlockCommand({ ...t, block: 2, tiles, attribute: 0x20000084 }), (p) => {
      const ts = p.editorContext().tileset(PRIMARY);
      expect([...ts.blocks.subarray(16, 24)]).toEqual(tiles);
      expect(ts.attributes[2]).toBe(0x20000084);
    }, tilesets);
    await roundTrip(open, () => new SetBlockCountCommand({ tileset: SECONDARY.pointer, secondary: true, count: 90 }), (p) =>
      expect(p.editorContext().tileset(SECONDARY).blockCount).toBe(90), tilesets);
    await roundTrip(open, () => new SetBlockDataCommand({ tileset: SECONDARY.pointer, secondary: true, blocks: Array.from({ length: 16 }, (_, i) => i), attributes: [0x20000084, 1] }), (p) => {
      const ts = p.editorContext().tileset(SECONDARY);
      expect(ts.blockCount).toBe(2);
      expect([...ts.blocks]).toEqual(Array.from({ length: 16 }, (_, i) => i));
      expect([...ts.attributes]).toEqual([0x20000084, 1]);
    }, tilesets);
    await roundTrip(open, () => new RemapBlockPalettesCommand({ ...t, mapping: [3, ...Array.from({ length: 14 }, (_, i) => i + 1)] }), (p) =>
      expect(p.editorContext().tileset(PRIMARY).blocks[8]).toBe(0x3001), tilesets);
  });

  it("パレットの色・タイル画像・ヘッダー", async () => {
    await roundTrip(open, () => new SetPaletteColorsCommand({ ...t, palette: 0, start: 9, colors: [0x001f] }), (p) =>
      expect(p.editorContext().tileset(PRIMARY).palettes[9]).toBe(0x1f), tilesets);
    const tile = new Uint8Array(32).fill(0x22);
    await roundTrip(open, () => new SetTilesCommand({ ...t, start: 20, data: encodeBase64(tile) }), (p) => {
      const ts = p.editorContext().tileset(PRIMARY);
      expect(ts.tileCount).toBe(32);
      expect(ts.tiles.subarray(20 * 32, 21 * 32).every((b) => b === 0x22)).toBe(true);
    }, tilesets);
    await roundTrip(open, () => new SetTilesetHeaderCommand({ ...t, header: "0100000011111111222222220000000044444444333333FF" }), (p) => {
      const ts = p.editorContext().tileset(PRIMARY);
      expect(toHexBytes(ts.header)).toBe("010000000000000000000000000000004444444400000000");
    }, tilesets);
  });

  it("入力の検証", async () => {
    const p = await open();
    const bus = new CommandBus(p.editorContext());
    const expectCode = (cmd: Parameters<typeof bus.execute>[0], code: string) => {
      const before = tilesets(p);
      expect(() => bus.execute(cmd)).toThrow(EditError);
      try {
        bus.execute(cmd);
      } catch (e) {
        expect((e as EditError).code).toBe(code);
      }
      expect(tilesets(p)).toBe(before);
    };
    expectCode(new SetBlockCommand({ ...t, block: 640, attribute: 0 }), EditErrorCode.BlockIndexOutOfRange);
    expectCode(new SetBlockCommand({ ...t, block: 0, tiles: [1, 2] }), EditErrorCode.InvalidRawBytes);
    expectCode(new SetPaletteColorsCommand({ ...t, palette: 0, colors: [0x8000] }), EditErrorCode.ValueOutOfRange);
    expectCode(new SetBlockCountCommand({ tileset: SECONDARY.pointer, secondary: true, count: 385 }), EditErrorCode.ValueOutOfRange);
    expectCode(new SetBlockDataCommand({ ...t, blocks: [1, 2], attributes: [0] }), EditErrorCode.InvalidRawBytes);
    expectCode(new SetBlockDataCommand({ ...t, blocks: [], attributes: [] }), EditErrorCode.ValueOutOfRange);
    expectCode(new SetTilesCommand({ ...t, start: 639, data: encodeBase64(new Uint8Array(64)) }), EditErrorCode.TileIndexOutOfRange);
  });
});

describe("登録と再生", () => {
  it("全コマンドが登録され、JSON の操作列を再生できる", async () => {
    const registry = createDefaultRegistry();
    for (const name of ["addEvent", "setEventCounts", "setHeaderFields", "setMapName", "resizeMap", "addMapScriptCondition", "setConnection", "setWildAreas", "createMap", "setBlock", "setBlockData", "setPaletteColors"]) {
      expect(registry.names()).toContain(name);
    }
    const ops = [
      { name: "addEvent", args: { bank: 0, map: 0, kind: "person" } },
      { name: "moveEvent", args: { bank: 0, map: 0, kind: "person", index: 1, x: 3, y: 4 } },
      { name: "setHeaderFields", args: { bank: 0, map: 0, fields: { music: 300 } } },
      { name: "resizeMap", args: { bank: 0, map: 0, width: 4, height: 4 } },
      { name: "setWildAreas", args: { bank: 0, map: 1, areas: [true, true, false, false] } },
    ];
    const p = await open();
    const bus = new CommandBus(p.editorContext());
    for (const op of ops) bus.execute(registry.create(op));
    expect(bus.history()).toEqual(ops);
    expect(p.loaded(M00)!.events!.persons[1]).toMatchObject({ x: 3, y: 4 });
    const before = fingerprint(await open());
    while (bus.undo());
    expect(fingerprint(p)).toBe(before);
  });

  it("引数の形が違えば TypeError", () => {
    const registry = createDefaultRegistry();
    expect(() => registry.create({ name: "addEvent", args: { bank: 0, map: 0, kind: "cat" } })).toThrow(TypeError);
    expect(() => registry.create({ name: "setEventFields", args: { bank: 0, map: 0, kind: "person", index: 0, fields: { x: "1" } } })).toThrow(TypeError);
  });
});

function le32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}
