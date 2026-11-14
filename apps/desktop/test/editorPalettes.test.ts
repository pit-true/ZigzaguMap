import { describe, expect, it } from "vitest";
import { EDITOR_THEMES, PALETTES, contrastRatio, uiVariables } from "../src/windows/script-editor/extensions/palettes";

/** テーマのウィンドウの部品の色（#218）。 */
describe("スクリプトエディタのテーマの色の表", () => {
  const ids = EDITOR_THEMES;
  const hex = /^#[0-9a-f]{6}$/;

  it("4 つのテーマが本文と部品の色を同じ項目でそろえて持つ", () => {
    expect(ids).toHaveLength(4);
    const codeKeys = Object.keys(PALETTES[ids[0]!].code).sort();
    const uiKeys = Object.keys(PALETTES[ids[0]!].ui).sort();
    for (const id of ids) {
      expect(Object.keys(PALETTES[id].code).sort()).toEqual(codeKeys);
      expect(Object.keys(PALETTES[id].ui).sort()).toEqual(uiKeys);
      for (const [key, value] of Object.entries(PALETTES[id].ui)) expect(value, `${id}.${key}`).toMatch(hex);
    }
  });

  it("CSS 変数は全テーマで同じ名前を出し、共通の部品の変数を上書きする", () => {
    const names = Object.keys(uiVariables(PALETTES[ids[0]!])).sort();
    for (const id of ids) expect(Object.keys(uiVariables(PALETTES[id])).sort()).toEqual(names);
    for (const name of ["--face", "--window", "--text", "--border", "--select", "--hot", "--error-text", "--dialog-border"]) {
      expect(names).toContain(name);
    }
  });

  it("部品の文字と地のコントラストが読める大きさ（本文 4.5、控えめな文字 3 以上）", () => {
    for (const id of ids) {
      const u = PALETTES[id].ui;
      const c = PALETTES[id].code;
      const pairs: [string, string, string, number][] = [
        ["文字/帯", u.text, u.face, 4.5],
        ["文字/一覧", u.text, u.window, 4.5],
        ["文字/表示中のタブ", u.text, u.tabActive, 4.5],
        ["文字/ほかのタブ", u.text, u.tabInactive, 4.5],
        ["下の帯", u.statusText, u.status, 4.5],
        ["選んだ行", u.selectText, u.select, 4.5],
        ["ボタン", u.buttonText, u.button, 4.5],
        ["入力欄", u.fieldText, u.field, 4.5],
        ["知らせ", u.warnText, u.warnBg, 4.5],
        ["控えめな文字/帯", u.muted, u.face, 3],
        ["控えめな文字/一覧", u.muted, u.window, 3],
        ["誤り/一覧", u.error, u.window, 3],
        ["誤り/誤りの地", u.error, u.errorBg, 3],
        ["リンク/一覧", u.link, u.window, 3],
        ["本文/本文の地", c.fg, c.bg, 4.5],
        ["吹き出し", c.fg, c.panel, 4.5],
      ];
      for (const [what, fg, bg, min] of pairs) expect(contrastRatio(fg, bg), `${id} ${what} ${fg} / ${bg}`).toBeGreaterThanOrEqual(min);
    }
  });

  it("暗いテーマでは部品の地も暗く、明るいテーマでは明るい（明るいまま残る部品が無い）", () => {
    for (const id of ids) {
      const p = PALETTES[id];
      for (const key of ["face", "window", "tabActive", "tabInactive", "button", "field", "scrollTrack"] as const) {
        const dark = contrastRatio(p.ui[key], "#000000") < contrastRatio(p.ui[key], "#ffffff");
        expect(dark, `${id}.${key} ${p.ui[key]}`).toBe(p.code.dark);
      }
    }
  });

  it("コントラスト比の計算", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });
});
