import { describe, expect, it } from "vitest";
import {
  decodeScriptText,
  detectLineEnding,
  encodeScriptText,
  isEditableScriptPath,
  normalizeScriptPath,
  scriptFileKind,
} from "../src/windows/script-editor/fileText";

describe("スクリプトエディタで開けるパス", () => {
  it("assembly/overworld_scripts と strings の中だけ", () => {
    expect(isEditableScriptPath("assembly/overworld_scripts/01_moegi.s")).toBe(true);
    expect(isEditableScriptPath("strings/overworld_strings_01_moegi.string")).toBe(true);
    expect(isEditableScriptPath("strings/sub/a.string")).toBe(true);
    expect(isEditableScriptPath("Assembly\\Overworld_Scripts\\x.s")).toBe(true);
    expect(isEditableScriptPath("./strings/a.string")).toBe(true);
    for (const bad of ["assembly/other.s", "xse_commands.s", "eventscripts", "strings/", "strings/../eventscripts", "/strings/a.string", "C:/x/strings/a.string", "strings//a"]) {
      expect(isEditableScriptPath(bad), bad).toBe(false);
    }
  });

  it("区切りをそろえ、種類を見分ける", () => {
    expect(normalizeScriptPath(".\\strings\\a.string")).toBe("strings/a.string");
    expect(scriptFileKind("strings/a.STRING")).toBe("string");
    expect(scriptFileKind("assembly/overworld_scripts/a.s")).toBe("asm");
  });
});

describe("改行と BOM", () => {
  it("いちばん多い改行の形を選ぶ", () => {
    expect(detectLineEnding("a\nb\n")).toBe("\n");
    expect(detectLineEnding("a\r\nb\r\n")).toBe("\r\n");
    expect(detectLineEnding("a\rb\r")).toBe("\r");
    expect(detectLineEnding("a\r\nb\r\nc\n")).toBe("\r\n");
    expect(detectLineEnding("abc")).toBe("\n");
  });

  it("読んで書き戻すと同じになる（改行がそろっているとき）", () => {
    for (const raw of ["a\nb\n", "a\r\nb\r\n\r\n", "\uFEFF.text\r\n.thumb", "x\ry", "", "\uFEFF"]) {
      const d = decodeScriptText(raw);
      expect(d.text.includes("\r")).toBe(false);
      expect(encodeScriptText(d.text, d.lineEnding, d.bom)).toBe(raw);
    }
  });

  it("BOM を外して覚え、混ざった改行は多いほうにそろえる", () => {
    const d = decodeScriptText("\uFEFFa\r\nb\r\nc\n");
    expect(d).toEqual({ text: "a\nb\nc\n", lineEnding: "\r\n", bom: true });
    expect(encodeScriptText(d.text, d.lineEnding, d.bom)).toBe("\uFEFFa\r\nb\r\nc\r\n");
  });
});
