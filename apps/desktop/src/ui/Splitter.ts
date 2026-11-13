/** 左の欄の幅を変える分割バー（ドラッグで幅を変え、離したら `onDone` で知らせる）。 */
export class Splitter {
  readonly element: HTMLElement;

  constructor(target: HTMLElement, min: number, onDone: (width: number) => void) {
    this.element = document.createElement("div");
    this.element.className = "splitter";
    this.element.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.element.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = target.offsetWidth;
      const move = (ev: PointerEvent): void => {
        const max = Math.max(min, window.innerWidth - 300);
        target.style.width = `${Math.min(max, Math.max(min, startWidth + ev.clientX - startX))}px`;
      };
      const up = (): void => {
        this.element.removeEventListener("pointermove", move);
        this.element.removeEventListener("pointerup", up);
        onDone(target.offsetWidth);
      };
      this.element.addEventListener("pointermove", move);
      this.element.addEventListener("pointerup", up);
    });
  }
}
