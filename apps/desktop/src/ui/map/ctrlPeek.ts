type Listener = (held: boolean) => void;

/**
 * Ctrl を押しているか（#238。押している間、イベントの箱と移動許可の重ね描きを隠す）。キーの押下・離すで変え、
 * ウィンドウからフォーカスが外れたとき・画面が隠れたときは離したことにする。キーの離すを取りこぼしたときのため、
 * マウスの出来事の Ctrl の状態にも合わせる（自動操作の `mouse` の `ctrl` も同じ）。
 */
class CtrlPeek {
  private value = false;
  private readonly listeners = new Set<Listener>();
  private installed = false;

  get held(): boolean {
    return this.value;
  }

  /** 変わったときに呼ぶ。外す関数を返す。 */
  on(listener: Listener): () => void {
    this.install();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 状態を変える（自動操作・テスト用にも使う）。 */
  set(held: boolean): void {
    if (held === this.value) return;
    this.value = held;
    for (const l of this.listeners) l(held);
  }

  private install(): void {
    if (this.installed) return;
    this.installed = true;
    window.addEventListener("keydown", (e) => {
      if (e.key === "Control") this.set(true);
      else if (!e.ctrlKey && this.value) this.set(false);
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === "Control") this.set(false);
    });
    const fromPointer = (e: PointerEvent | MouseEvent): void => {
      if (e.ctrlKey !== this.value) this.set(e.ctrlKey);
    };
    window.addEventListener("pointerdown", fromPointer, true);
    window.addEventListener("pointermove", fromPointer, true);
    window.addEventListener("contextmenu", fromPointer, true);
    window.addEventListener("blur", () => this.set(false));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.set(false);
    });
  }
}

/** 画面全体で 1 つ。 */
export const ctrlPeek = new CtrlPeek();
