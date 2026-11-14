/**
 * マウスのサイドボタン（戻る・進む。button 3・4）で、マップの履歴を戻る・進む（#237）。
 * WebView2 がページの戻る・進むに使わないよう、押したときの既定の動きを止め、離したときに動かす。
 */
export function installHistoryMouse(target: { openPreviousMap(): Promise<void>; openNextMap(): Promise<void> }): void {
  const side = (e: MouseEvent): boolean => e.button === 3 || e.button === 4;
  window.addEventListener("mousedown", (e) => {
    if (side(e)) e.preventDefault();
  });
  window.addEventListener("mouseup", (e) => {
    if (!side(e)) return;
    e.preventDefault();
    void (e.button === 3 ? target.openPreviousMap() : target.openNextMap());
  });
}
