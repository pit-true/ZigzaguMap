import { describe, expect, it } from "vitest";
import {
  ScriptConfigJson,
  parseWidthCheckOutput,
  parseWidthRegistryListing,
  planWidthRegistry,
  resolveScriptConfig,
} from "../src/index.js";

describe("check_text_width.py の出力", () => {
  it("ファイル・行・ラベルを拾い、configured と widest の同じ誤りは 1 つにする", () => {
    const errors = parseWidthCheckOutput([
      "gText_A                            field configured [[99, 131]]  widest [[108, 142]]  (limit 208 px)",
      "TEXT WIDTH ERROR: cfru/strings/debug_famicom.string:21 gText_X (configured) page 1 line 2: 212 px > 208 px (field message box)",
      "TEXT WIDTH ERROR: cfru/strings/debug_famicom.string:21 gText_X (widest) page 1 line 2: 212 px > 208 px (field message box)",
      "TEXT WIDTH ERROR: cfru/strings/x.string:30: gText_Y is not registered in tools/check_text_width.py (window ...)",
      "   TEXT WIDTH: cfru/strings/x.string:16: text line without its own #org (a real line break? use \\n)",
      "TEXT WIDTH ERROR: cfru/strings/text_width_registry.json: gText_Z of cfru/strings/x.string: unknown window 'nope'",
      "TEXT WIDTH ERROR: something without a place",
      "source mode: kanji 10 px; FAILED",
    ]);
    expect(errors.map((e) => [e.path, e.line, e.label])).toEqual([
      ["cfru/strings/debug_famicom.string", 21, "gText_X"],
      ["cfru/strings/x.string", 30, "gText_Y"],
      ["cfru/strings/x.string", 16, null],
      ["cfru/strings/text_width_registry.json", null, "gText_Z"],
      [null, null, null],
    ]);
  });
});

describe("追加の登録ファイル", () => {
  const listing = parseWidthRegistryListing(
    'noise\n{"extra": "cfru/strings/text_width_registry.json", "errors": [], "files": {"cfru/strings/a.string": ["gText_Old", "gText_Json"]}}\n',
  );
  const reason = (b: string) => `値が分からない: ${b}`;

  it("登録のあるファイルの新しい #org を足し、[BUFFER] を使うものは unresolved にする", () => {
    const text = "#org @gText_Old\nあ\n#org @gText_New\nい\n#org @gText_Buf\n[BUFFER1]を　もらった\n#org @gText_NoBody\n#org @gText_Json\nう\n";
    const plan = planWidthRegistry({ registryText: null, listing, fileKey: "cfru/strings/a.string", stringText: text, unresolvedReason: reason });
    expect(plan.added).toEqual(["gText_New", "gText_Buf"]);
    expect(plan.unresolved).toEqual(["gText_Buf"]);
    expect(JSON.parse(plan.text!)).toEqual({
      format: 1,
      files: { "cfru/strings/a.string": { gText_New: { window: "field" }, gText_Buf: { unresolved: "値が分からない: [BUFFER1]" } } },
    });
  });

  it("JSON に書いた名前が .string から消えたら消し、登録の無いファイルは何もしない", () => {
    const registryText = JSON.stringify({ format: 1, note: "keep", files: { "cfru/strings/a.string": { gText_Json: { window: "field" }, gText_Gone: { window: "bag" } } } });
    const plan = planWidthRegistry({ registryText, listing, fileKey: "cfru/strings/a.string", stringText: "#org @gText_Json\nう\n#org @gText_Old\nあ\n", unresolvedReason: reason });
    expect(plan.removed).toEqual(["gText_Gone"]);
    expect(JSON.parse(plan.text!)).toEqual({ format: 1, note: "keep", files: { "cfru/strings/a.string": { gText_Json: { window: "field" } } } });
    const same = planWidthRegistry({ registryText, listing, fileKey: "cfru/strings/b.string", stringText: "#org @gText_X\nx\n", unresolvedReason: reason });
    expect(same).toMatchObject({ text: null, notChecked: true });
  });

  it("設定の widthRegistry は Chronos だけ既定で入り、zigzagumap.json で変えられる", () => {
    expect(resolveScriptConfig({}, "nd").widthRegistry).toBeNull();
    expect(resolveScriptConfig({}, "chronos").widthRegistry).toEqual({ path: "strings/text_width_registry.json", prefix: "cfru/", window: "field" });
    const doc = ScriptConfigJson.parse('{"script": {"widthRegistry": {"path": "strings\\\\r.json", "prefix": "x/"}}}');
    expect(doc.settings.widthRegistry).toEqual({ path: "strings/r.json", prefix: "x/", window: "field" });
    expect(JSON.parse(ScriptConfigJson.stringify(doc.settings, doc)).script.widthRegistry).toEqual({ path: "strings/r.json", prefix: "x/", window: "field" });
  });
});
