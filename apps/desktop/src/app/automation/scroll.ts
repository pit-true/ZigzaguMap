import { nextFrame } from "./registry";

/**
 * スクロールの読み書き（メインの `scroll` / `view.scroll` と、別ウィンドウの `scroll` が使う）。
 * 部品から親へたどり、スクロールできる枠（overflow が auto / scroll）を探して扱う。
 */

/** `el` かその親のうち、スクロールの枠になるもの（無ければ文書全体）。 */
export function scrollContainerOf(el: HTMLElement): HTMLElement {
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (/(auto|scroll)/.test(s.overflowX) || /(auto|scroll)/.test(s.overflowY)) return e;
  }
  return document.scrollingElement as HTMLElement;
}

/**
 * 枠のスクロールの状態。`h`・`v` は横・縦のスクロールバーが出ていて使えるか
 * （中身が枠より大きく、枠がウィンドウの中に収まっている）。`inside` は枠がウィンドウの中に収まっているか
 * （収まっていないと、はみ出した右・下が見えず、スクロールもできない）。
 */
export function describeScroll(container: HTMLElement): Record<string, unknown> {
  const r = container.getBoundingClientRect();
  const inside = r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5;
  const s = getComputedStyle(container);
  const canH = /(auto|scroll)/.test(s.overflowX) && container.scrollWidth > container.clientWidth;
  const canV = /(auto|scroll)/.test(s.overflowY) && container.scrollHeight > container.clientHeight;
  return {
    h: canH && inside,
    v: canV && inside,
    inside,
    scrollLeft: container.scrollLeft,
    scrollTop: container.scrollTop,
    scrollWidth: container.scrollWidth,
    scrollHeight: container.scrollHeight,
    clientWidth: container.clientWidth,
    clientHeight: container.clientHeight,
    rect: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) },
    window: { width: window.innerWidth, height: window.innerHeight },
  };
}

/**
 * スクロールする。`x`・`y` は位置（px、絶対）、`dx`・`dy` は今の位置からの量、`to` は `"end"`（右下の端）か `"start"`（左上）。
 * スクロールバーを動かしたときと同じく `scroll` の出来事を起こし、描き直しを待ってから状態を返す。
 */
export async function scrollBy(container: HTMLElement, req: Record<string, unknown>): Promise<Record<string, unknown>> {
  const n = (k: string): number | null => (typeof req[k] === "number" && Number.isFinite(req[k]) ? (req[k] as number) : null);
  let left = container.scrollLeft;
  let top = container.scrollTop;
  if (req["to"] === "end") {
    left = container.scrollWidth;
    top = container.scrollHeight;
  } else if (req["to"] === "start") {
    left = 0;
    top = 0;
  }
  left = n("x") ?? left + (n("dx") ?? 0);
  top = n("y") ?? top + (n("dy") ?? 0);
  container.scrollLeft = left;
  container.scrollTop = top;
  container.dispatchEvent(new Event("scroll"));
  await nextFrame();
  return describeScroll(container);
}
