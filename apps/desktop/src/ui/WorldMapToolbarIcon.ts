import { readRegionMapIcon } from "@zigzagumap/core";
import type { EditorState } from "../app/EditorState";
import { worldMapIconFromTownMap } from "./toolbarPixelArt";

/** 差し替える相手（ツールバー）。 */
export interface IconTarget {
  setIcon(icon: string, html: string | null): void;
}

/** ツールバーのワールドマップエディタのアイコンが今どの絵か（`rom` = ROM のタウンマップから切り出した絵、`fallback` = 自作の絵）。 */
export type WorldMapIconSource = "rom" | "fallback";

/**
 * ツールバーのワールドマップエディタのアイコン（#541）。ROM を開いたら、その ROM のタウンマップ（カントーの面）から
 * マサラタウンのあたりを切り出した絵に差し替え、閉じたり読めなかったりしたら自作の絵に戻す。
 * - ROM を開く処理を待たせないよう、読むのは手の空いたとき。切り出した絵は SVG の文字列としてツールバーに持つだけで、ファイルには書かない。
 */
export class WorldMapToolbarIcon {
  private current: WorldMapIconSource = "fallback";
  private pending: Promise<void> | null = null;

  constructor(
    private readonly state: EditorState,
    private readonly target: IconTarget,
  ) {
    state.on("session", () => this.update());
  }

  /** 今の絵。 */
  get source(): WorldMapIconSource {
    return this.current;
  }

  /** 差し替えを終えるまで待つ（自動操作用）。 */
  async settle(): Promise<void> {
    while (this.pending) await this.pending;
  }

  private update(): void {
    const session = this.state.session;
    if (!session) {
      this.show(null);
      return;
    }
    const run = this.idle().then(() => {
      if (this.state.session !== session) return;
      const image = readRegionMapIcon(session.project.rom, session.project.game.code);
      this.show(image ? worldMapIconFromTownMap(image) : null);
    });
    this.pending = run;
    void run.finally(() => {
      if (this.pending === run) this.pending = null;
    });
  }

  private show(html: string | null): void {
    this.current = html ? "rom" : "fallback";
    this.target.setIcon("worldMap", html);
  }

  private idle(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 1000 });
      else setTimeout(resolve, 0);
    });
  }
}
