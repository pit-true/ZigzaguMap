import { describe, expect, it } from "vitest";
import { exportBaseName } from "../src/app/ImageExport";

describe("書き出しの名前の既定（#514）", () => {
  it("マップの番号と日時（ゼロ埋め）", () => {
    expect(exportBaseName({ bank: 3, map: 0 }, new Date(2026, 10, 17, 18, 30, 45))).toBe("3.0_2026-11-17_18-30-45");
    expect(exportBaseName({ bank: 12, map: 104 }, new Date(2026, 0, 2, 3, 4, 5))).toBe("12.104_2026-01-02_03-04-05");
    expect(exportBaseName(null, new Date(2026, 0, 2, 3, 4, 5))).toBe("map_2026-01-02_03-04-05");
  });
});
