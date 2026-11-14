import { describe, expect, it, vi } from "vitest";
import { PERSON_KIND_CLONE, type MapDocument, type MapId, type PersonEvent } from "@zigzagumap/core";
import type { ProjectSession } from "../src/app/ProjectSession";
import { cloneOrigin, personGraphicsId } from "../src/ui/map/cloneLook";
import { placedEvents } from "../src/ui/map/EventLayer";

const person = (fields: Partial<PersonEvent>): PersonEvent => ({
  localId: 1,
  graphicsId: 0,
  kind: 0,
  padding1: 0,
  x: 0,
  y: 0,
  elevation: 0,
  movementType: 0,
  movementRangeX: 0,
  movementRangeY: 0,
  padding2: 0,
  trainerType: 0,
  trainerRangeOrBerryTree: 0,
  script: 0,
  flag: 0,
  padding3: 0,
  ...fields,
});

/** マップ 3.19 の人 2（localId 3、画像 7）を指すクローン（自分の欄の画像は 0）。 */
const clone = person({ kind: PERSON_KIND_CLONE, graphicsId: 0, trainerRangeOrBerryTree: 3, trainerType: 19, elevation: 3 });
const origin = { persons: [person({ localId: 1, graphicsId: 5 }), person({ localId: 2, graphicsId: 6 }), person({ localId: 3, graphicsId: 7 })], warps: [], traps: [], signs: [] };

/** 3.19 を読み込み済みにするか、読み込みを頼まれたら読めるようにした、テスト用のセッション。 */
function session(loadedNow: boolean): { session: ProjectSession; load: ReturnType<typeof vi.fn> } {
  const docs = new Map<string, MapDocument>();
  const doc = { events: origin } as unknown as MapDocument;
  if (loadedNow) docs.set("3.19", doc);
  const load = vi.fn(async (id: MapId) => {
    await Promise.resolve();
    docs.set(`${id.bank}.${id.map}`, doc);
    return doc;
  });
  const s = {
    project: { loaded: (id: MapId) => docs.get(`${id.bank}.${id.map}`), load },
    catalog: { has: (id: MapId) => id.bank === 3 && id.map === 19 },
  } as unknown as ProjectSession;
  return { session: s, load };
}

describe("クローンの見た目（#298）", () => {
  it("元のマップを読んでいれば、元の人の番号と画像番号を引く", () => {
    const { session: s } = session(true);
    expect(cloneOrigin(s, clone)).toMatchObject({ map: { bank: 3, map: 19 }, localId: 3, index: 2 });
    expect(personGraphicsId(s, clone)).toBe(7);
  });
  it("クローンでない人は自分の画像番号", () => {
    const { session: s } = session(true);
    expect(cloneOrigin(s, origin.persons[0]!)).toBeNull();
    expect(personGraphicsId(s, origin.persons[0]!)).toBe(5);
  });
  it("元のマップを読んでいなければ自分の欄の値で描き、読めたら 1 回だけ知らせる", async () => {
    const { session: s, load } = session(false);
    const loaded = vi.fn();
    expect(personGraphicsId(s, clone, loaded)).toBe(0);
    expect(personGraphicsId(s, clone, loaded)).toBe(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(load).toHaveBeenCalledTimes(1);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(personGraphicsId(s, clone, loaded)).toBe(7);
  });
  it("印の並びでは、クローンに印を付けて元の人の画像番号にする", () => {
    const { session: s } = session(true);
    const events = { persons: [origin.persons[0]!, clone], warps: [], traps: [], signs: [] };
    const placed = placedEvents(events, null, (p) => personGraphicsId(s, p));
    expect(placed.map((e) => [e.graphicsId, e.clone ?? false])).toEqual([
      [5, false],
      [7, true],
    ]);
  });
});
