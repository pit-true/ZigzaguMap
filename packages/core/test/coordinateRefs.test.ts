import { describe, expect, it } from "vitest";
import { findCoordinateRefs } from "../src/index.js";

describe("findCoordinateRefs（#231）", () => {
  it("このマップへ座標つきで来るワープと、このマップのラベルの中の人の座標の指定", () => {
    const text = [
      "EventScript_Other:",
      "\twarp 0x3 0x0 0xFF 0x5 0x6 @ 来る",
      "\twarp 3 1 0xFF 5 6",
      "\twarp 3 0 0x1",
      "\tsetobjectxy 0x1 0x2 0x3",
      "EventScript_Pallet_Mom:",
      "\tsetobjectxyperm 0x1 0x4 0x5",
      "\t@ setobjectxy 1 2 3",
      "\tend",
    ].join("\r\n");
    const refs = findCoordinateRefs("a.s", text, { bank: 3, map: 0 }, new Set(["EventScript_Pallet_Mom"]));
    expect(refs).toEqual([
      { path: "a.s", line: 2, text: "warp 0x3 0x0 0xFF 0x5 0x6 @ 来る", kind: "warp" },
      { path: "a.s", line: 7, text: "setobjectxyperm 0x1 0x4 0x5", kind: "object" },
    ]);
  });
});
