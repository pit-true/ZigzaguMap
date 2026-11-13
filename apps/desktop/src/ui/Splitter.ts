/** 左の欄の幅を変える分割バー（ドラッグで幅を変え、離したら `onDone` で知らせる）。 */
export class Splitter {
  readonly element: HTMLElement;

  constructor(
    private readonly target: HTMLElement,
    private readonly min: number,
    private readonly onDone: (width: number) => void,
  ) {
    this.element = document.createElement("div");
    this.element.className = "splitter";
    this.element.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.element.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = target.offsetWidth;
      const move = (ev: PointerEvent): void => this.resize(startWidth + ev.clientX - startX);
      const up = (): void => {
        this.element.removeEventListener("pointermove", move);
        this.element.removeEventListener("pointerup", up);
        onDone(target.offsetWidth);
      };
      this.element.addEventListener("pointermove", move);
      this.element.addEventListener("pointerup", up);
    });
  }

  /** 幅を変えて知らせる（ドラッグして離したときと同じ。自動操作から使う）。決まった幅を返す。 */
  setWidth(width: number): number {
    this.resize(width);
    this.onDone(this.target.offsetWidth);
    return this.target.offsetWidth;
  }

  /** 幅を変える（`min` 以上、ウィンドウの幅 - 300 以下）。 */
  private resize(width: number): void {
    const max = Math.max(this.min, window.innerWidth - 300);
    this.target.style.width = `${Math.min(max, Math.max(this.min, width))}px`;
  }
}
