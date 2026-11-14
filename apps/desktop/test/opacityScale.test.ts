import { describe, expect, it } from "vitest";
import { opacityFromSlider, opacityText, sliderFromOpacity } from "../src/ui/view/opacityScale";

describe("移動エリアの透明度のスライダー", () => {
  it("設定の値とスライダーの位置を行き来する", () => {
    expect(sliderFromOpacity(0.3)).toBe(30);
    expect(opacityFromSlider(30)).toBe(0.3);
    expect(opacityText(0.3)).toBe("30%");
    for (let i = 0; i <= 100; i++) expect(sliderFromOpacity(opacityFromSlider(i))).toBe(i);
  });

  it("範囲外と数でない値は端か 0 に丸める", () => {
    expect(sliderFromOpacity(-1)).toBe(0);
    expect(sliderFromOpacity(2)).toBe(100);
    expect(sliderFromOpacity(Number.NaN)).toBe(0);
    expect(opacityFromSlider(150)).toBe(1);
    expect(opacityFromSlider(-3)).toBe(0);
    expect(opacityFromSlider(Number.NaN)).toBe(0);
    expect(opacityFromSlider(33.4)).toBe(0.33);
  });
});
