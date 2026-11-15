import { describe, expect, it } from "vitest";
import { copyNameOf, treeMark } from "../src/app/MapTreeModel";
import { mapIdText } from "../src/app/MapTreeMenu";
import { ja } from "../src/i18n/ja";

describe("マップ一覧の状態の印（#401）", () => {
  it("読み込めなかった > 未出力 > 開いている の順に 1 つ", () => {
    expect(treeMark({ failed: false, dirty: false, opened: false })).toBeNull();
    expect(treeMark({ failed: false, dirty: false, opened: true })).toBe("open");
    expect(treeMark({ failed: false, dirty: true, opened: true })).toBe("dirty");
    expect(treeMark({ failed: true, dirty: true, opened: true })).toBe("error");
  });
});

describe("右クリックのコピー（#401）", () => {
  it("番号は B.M", () => {
    expect(mapIdText({ bank: 3, map: 0 })).toBe("3.0");
  });

  it("名前は一覧と同じ書き方で、番号と補足を付けない", () => {
    const info = { id: { bank: 3, map: 0 }, region: 0x58, name: "サント・アンヌごう", layoutId: 1, primaryNumber: 0, secondaryNumber: 1 };
    expect(copyNameOf(info)).toBe("サント･アンヌごう");
    expect(copyNameOf({ ...info, name: null })).toBe(ja.noName);
    expect(copyNameOf(undefined)).toBe(ja.noName);
  });
});
