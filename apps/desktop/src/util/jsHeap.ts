/** JavaScript のヒープの使用量（バイト。WebView2（Chromium）の performance.memory。無ければ null）。メモリの計測用。 */
export function jsHeapBytes(): { used: number; total: number } | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  return m ? { used: m.usedJSHeapSize, total: m.totalJSHeapSize } : null;
}
