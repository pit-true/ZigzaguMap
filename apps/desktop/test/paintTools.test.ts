import { describe, expect, it } from "vitest";
import { PAINT_TOOLS, pressKind, toPaintTool } from "../src/app/paintTool";
import { keyText } from "../src/app/keymap";
import { LineGuide } from "../src/input/tools/LineGuide";

describe("道具の切り替え（#388）", () => {
  it("個人設定の値を道具にする（知らない値は鉛筆）", () => {
    expect(toPaintTool("fill")).toBe("fill");
    expect(toPaintTool("shift")).toBe("shift");
    expect(toPaintTool("pencil")).toBe("pencil");
    expect(toPaintTool("eraser")).toBe("pencil");
    expect(toPaintTool(undefined)).toBe("pencil");
  });

  it("既定のキーは N・B・S（キーの表は app/keymap.ts。#392）", () => {
    expect(PAINT_TOOLS.map((t) => keyText(t.keyAction))).toEqual(["N", "B", "S"]);
  });
});

describe("押したときの振り分け（pressKind。#406 で 2 つのタブから 1 か所にまとめた）", () => {
  const g = (button: number, ctrl = false, alt = false) => ({ button, ctrl, alt });

  it("鉛筆: 修飾キーなしで描き、Ctrl で矩形塗り、Alt で入れ替え（マップタブだけ）", () => {
    expect(pressKind("pencil", g(0), true)).toBe("pencil");
    expect(pressKind("pencil", g(0, true), true)).toBe("rect");
    expect(pressKind("pencil", g(0, false, true), true)).toBe("swap");
    expect(pressKind("pencil", g(0, true, true), true)).toBe("rect");
    expect(pressKind("pencil", g(0, false, true), false)).toBe("pencil");
  });

  it("塗りつぶし: Ctrl もそのまま塗りつぶし（マジック塗り）。Alt はマップタブなら入れ替え", () => {
    expect(pressKind("fill", g(0), true)).toBe("fill");
    expect(pressKind("fill", g(0, true), true)).toBe("fill");
    expect(pressKind("fill", g(0, false, true), true)).toBe("swap");
    expect(pressKind("fill", g(0, false, true), false)).toBe("fill");
  });

  it("シフト: Ctrl なら矩形塗り、Alt はマップタブなら入れ替え", () => {
    expect(pressKind("shift", g(0), true)).toBe("shift");
    expect(pressKind("shift", g(0, true), true)).toBe("rect");
    expect(pressKind("shift", g(0, false, true), true)).toBe("swap");
    expect(pressKind("shift", g(0, false, true), false)).toBe("shift");
  });

  it("右ボタンは道具に関係なく、Ctrl なら矩形の選択、そうでなければ離したときに拾う", () => {
    for (const tool of PAINT_TOOLS) {
      expect(pressKind(tool.id, g(2, true), true)).toBe("pick");
      expect(pressKind(tool.id, g(2), true)).toBeNull();
    }
  });
});

describe("直線（LineGuide。#389）", () => {
  it("Shift なしは通ったマスだけ（補間しない）", () => {
    const g = new LineGuide();
    g.begin({ x: 0, y: 0 }, false);
    expect(g.next({ x: 3, y: 2 }, false)).toEqual([{ x: 3, y: 2 }]);
  });

  it("Shift を押すと軸に寄せ、飛んだマスは軸の上でつなぐ", () => {
    const g = new LineGuide();
    g.begin({ x: 2, y: 2 }, true);
    expect(g.next({ x: 5, y: 3 }, true)).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
    ]);
    // 軸の上で同じマスなら何も描かない
    expect(g.next({ x: 5, y: 6 }, true)).toEqual([]);
    // Shift を離すとふつうに戻り、押し直すとその位置から続ける
    expect(g.next({ x: 6, y: 7 }, false)).toEqual([{ x: 6, y: 7 }]);
    expect(g.next({ x: 6, y: 9 }, true)).toEqual([
      { x: 6, y: 8 },
      { x: 6, y: 9 },
    ]);
    expect(g.next({ x: 1, y: 10 }, true)).toEqual([{ x: 6, y: 10 }]);
  });
});
