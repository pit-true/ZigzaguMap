import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { normalizeStringInput, stringEnterInsert } from "../src/windows/script-editor/extensions/stringInput";

// #221: 複数行の本文の入力。

describe("本文の入力欄の文字列", () => {
  it.each([
    ["1 行のまま", "あいう", "あいう"],
    ["制御記号のあとの改行はそのまま", "あ\\n\nい\\p\nう", "あ\\n\nい\\p\nう"],
    ["制御記号の無い改行には \\n を補う", "あ\nい", "あ\\n\nい"],
    ["CRLF も同じ", "あ\r\nい\\p\r\nう", "あ\\n\nい\\p\nう"],
    ["最後の改行は除く", "あ\\n\nい\n\n", "あ\\n\nい"],
  ])("%s", (_name, input, expected) => {
    expect(normalizeStringInput(input)).toBe(expected);
  });
});

describe(".string の Enter", () => {
  const press = (doc: string, pos: number): string | null =>
    stringEnterInsert(EditorState.create({ doc, selection: { anchor: pos } }));

  it("本文の途中で、前が制御記号でなければ \\n を補う", () => {
    expect(press("#org @A\nあいう", "#org @A\nあ".length)).toBe("\\n\n");
  });

  it("前が制御記号ならそのまま改行する", () => {
    expect(press("#org @A\nあ\\nいう", "#org @A\nあ\\n".length)).toBe("\n");
    expect(press("#org @A\nあ\\p", "#org @A\nあ\\p".length)).toBe("\n");
  });

  it("行の終わり・行の頭・#org・コメントではふつうの改行に任せる", () => {
    expect(press("#org @A\nあいう", "#org @A\nあいう".length)).toBeNull();
    expect(press("#org @A\nあいう", "#org @A\n".length)).toBeNull();
    expect(press("#org @A\nあ", 3)).toBeNull();
    expect(press("// コメント", 2)).toBeNull();
  });
});
