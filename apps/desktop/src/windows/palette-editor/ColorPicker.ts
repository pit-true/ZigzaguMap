import { invoke } from "@tauri-apps/api/core";
import { colorFromRgb8, type ColorValue } from "@zigzagumap/core";

/** 拾った色（Rust の cursor_color / window_pixel の返事）。 */
interface PickedColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly pressed: boolean;
}

/** 画面の色を見る間隔（AdvanceMap の Timer_ColorPicker と同じ 100ms）。 */
const INTERVAL = 100;

/**
 * 色の選択（スポイト）。押すと 100ms ごとにマウスカーソルの下の画面の色を拾って `onColor` に渡し、
 * 左ボタンを押したところで止める（その色が残る）。Esc か、もう一度ボタンを押すと止める。
 * 画面全体のどこでも拾える（AdvanceMap と同じ）。
 */
export class ColorPicker {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** ボタンを押した指がまだ離れていないか（離れるまでは左ボタンを止める合図にしない）。 */
  private waitRelease = true;

  constructor(
    private readonly onColor: (color: ColorValue) => void,
    private readonly onStop: () => void,
  ) {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.active) this.stop();
    });
  }

  get active(): boolean {
    return this.timer !== null;
  }

  /** 拾い始める（拾っている最中なら止める）。 */
  toggle(): void {
    if (this.active) {
      this.stop();
      return;
    }
    this.waitRelease = true;
    this.timer = setInterval(() => void this.tick(), INTERVAL);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onStop();
  }

  /** ウィンドウの画像の (x, y) の色を拾う（自動操作用。画面外のウィンドウでも取れる）。 */
  async pickFromWindow(label: string, x: number, y: number): Promise<ColorValue> {
    const c = await invoke<PickedColor>("window_pixel", { label, x, y });
    const color = colorFromRgb8(c.r, c.g, c.b);
    this.onColor(color);
    return color;
  }

  private async tick(): Promise<void> {
    let c: PickedColor;
    try {
      c = await invoke<PickedColor>("cursor_color");
    } catch {
      return;
    }
    if (!this.active) return;
    if (this.waitRelease) {
      if (!c.pressed) this.waitRelease = false;
    } else if (c.pressed) {
      this.stop();
      return;
    }
    this.onColor(colorFromRgb8(c.r, c.g, c.b));
  }
}
