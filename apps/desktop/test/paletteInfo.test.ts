import { describe, expect, it } from "vitest";
import { movementInfo } from "../src/app/data/movementInfo";
import { blockInfoText } from "../src/ui/map/blockInfo";
import { RecentBlockList } from "../src/ui/map/RecentBlocks";

describe("移動許可の説明（#308）", () => {
  it("高さと通行から説明を作る", () => {
    expect(movementInfo(0x0c)).toBe("通れる・高さ 3");
    expect(movementInfo(0x0d)).toBe("通れない（高さ 3）");
    expect(movementInfo(0x00)).toContain("高さの切り替え");
    expect(movementInfo(0x04)).toContain("水面");
    expect(movementInfo(0x3c)).toContain("橋");
  });

  it("通行 2・3 には奇数を使うよう注意を足す", () => {
    expect(movementInfo(0x0e)).toContain("ゲームでは通れない。奇数を使う");
    expect(movementInfo(0x0f)).toContain("通行の値 3");
    expect(movementInfo(0x0d)).not.toContain("奇数");
  });
});

describe("ブロックの情報（#308）", () => {
  const source = (attr: number, info: Partial<{ triple: boolean; tripleChild: boolean; unresolved: boolean; undrawn: boolean }> = {}) => ({
    attribute: () => attr,
    info: () => ({ triple: false, tripleChild: false, unresolved: false, undrawn: false, ...info }),
    thirdOf: (b: number) => (info.triple ? b + 1 : null),
  });

  it("番号・タイルセット・挙動・重ね方・野生", () => {
    const text = blockInfoText(source(0x01000002), 0x0d);
    expect(text).toContain("ブロック 0x00D タイルセット1");
    expect(text).toContain("挙動: 02-");
    expect(text).toContain("重ね方: 00-");
    expect(text).toContain("野生: 草むら");
    expect(blockInfoText(source(0x02000000), 0x280)).toContain("タイルセット2");
    expect(blockInfoText(source(0x02000000), 0x280)).toContain("野生: 水上");
  });

  it("3 層は「重ね方: 30-トリプルレイヤー」と 3 枚目の番号、次の番号はその旨", () => {
    const text = blockInfoText(source(0x30000000, { triple: true }), 0x10);
    expect(text).toContain("重ね方: 30-トリプルレイヤー");
    expect(text).toContain("3 枚目はブロック 0x011");
    expect(blockInfoText(source(0, { tripleChild: true }), 0x11)).toContain("0x010 の 3 枚目に使われる");
  });
});

describe("最近使ったブロック（#308）", () => {
  it("新しい順に 8 件、同じものは前から消す", () => {
    const r = new RecentBlockList();
    for (let b = 0; b < 10; b++) r.push({ block: b, tileset: 1 });
    expect(r.list.map((i) => i.block)).toEqual([9, 8, 7, 6, 5, 4, 3, 2]);
    r.push({ block: 5, tileset: 1 });
    expect(r.list.map((i) => i.block)).toEqual([5, 9, 8, 7, 6, 4, 3, 2]);
  });

  it("組が変わったら、持ち主のタイルセットが違うもの・表の外・3 層の次の番号を消す", () => {
    const r = new RecentBlockList();
    r.push({ block: 1, tileset: 100 });
    r.push({ block: 0x281, tileset: 200 });
    r.push({ block: 0x290, tileset: 300 });
    r.push({ block: 5, tileset: 100 });
    r.keepUsable(100, 300, 0x2a0, (b) => b === 5);
    expect(r.list.map((i) => i.block)).toEqual([0x290, 1]);
  });
});
