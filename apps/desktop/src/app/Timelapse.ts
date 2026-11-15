import { GifWriter, affectedMaps, type CommandRecord, type MapId } from "@zigzagumap/core";
import { scheduleIdleGc } from "../util/idleGc";
import type { CompositeImage, CompositeOptions } from "./CompositeImage";
import type { EditorState } from "./EditorState";

/** タイムラプスの作り方。 */
export interface TimelapseOptions {
  /** コマの間（ミリ秒）。 */
  readonly delayMs: number;
  /** 変更のコマを何コマおきに使うか（0 なら全部、1 なら 1 コマとばし）。 */
  readonly skip: number;
}

/**
 * 履歴（古い順）から、`map` を変えた操作の後の位置を選ぶ（Phase5 #403）。最初のコマは最初の変更の前の位置。
 * `skip` コマずつとばし、最後の変更の後（今の状態）は必ず入れる。変更が無ければ空。
 */
export function timelapsePositions(history: readonly CommandRecord[], map: MapId, skip: number): number[] {
  const changed: number[] = [];
  history.forEach((record, i) => {
    if (affectedMaps(record).some((id) => id.bank === map.bank && id.map === map.map)) changed.push(i + 1);
  });
  if (changed.length === 0) return [];
  const step = Math.max(0, Math.floor(skip)) + 1;
  const picked = changed.filter((_, i) => i % step === step - 1);
  if (picked[picked.length - 1] !== changed[changed.length - 1]) picked.push(changed[changed.length - 1]!);
  return [changed[0]! - 1, ...picked];
}

/**
 * タイムラプスの GIF（#403）。開いているマップの、起動してからの履歴をたどってコマを作る。
 * 履歴を最初の変更の前まで戻し、変更の後の位置へ 1 つずつ進めながら画像を作り、作ったコマはすぐ GIF に書いて捨てる
 * （全部のコマを同時に持たない）。終わったら（失敗しても）元の位置へ戻す。大きさは今の状態に合わせる。
 */
export class Timelapse {
  constructor(
    private readonly state: EditorState,
    private readonly composite: CompositeImage,
  ) {}

  /** 作れるコマの位置（変更が無ければ空）。 */
  positions(skip: number): number[] {
    const session = this.state.session;
    const map = this.state.map;
    if (!session || !map) return [];
    return timelapsePositions(session.bus.history(), map.id, skip);
  }

  /** GIF を作る。変更が無ければ null。 */
  async render(image: Omit<CompositeOptions, "ask" | "scale">, options: TimelapseOptions): Promise<{ gif: Uint8Array; frames: number; width: number; height: number } | null> {
    const session = this.state.session;
    if (!session) return null;
    const positions = this.positions(options.skip);
    if (positions.length === 0) return null;
    const bus = session.bus;
    const start = bus.position;
    // 大きさと縮める割合は今の状態に合わせる（途中で大きさを変えていても、コマはこの大きさの左上にそろえる）
    const now = await this.composite.render({ ...image, ask: false });
    if (!now) return null;
    const scale = now.scale;
    const frame = document.createElement("canvas");
    frame.width = now.canvas.width;
    frame.height = now.canvas.height;
    now.canvas.width = 0;
    now.canvas.height = 0;
    const gif = new GifWriter(frame.width, frame.height);
    try {
      for (const position of positions) {
        bus.goTo(position);
        const r = await this.composite.render({ ...image, ask: false, scale });
        if (!r) continue;
        const c = frame.getContext("2d", { willReadFrequently: true })!;
        c.fillStyle = "#000";
        c.fillRect(0, 0, frame.width, frame.height);
        c.drawImage(r.canvas, 0, 0);
        r.canvas.width = 0;
        r.canvas.height = 0;
        gif.addFrame(c.getImageData(0, 0, frame.width, frame.height).data, options.delayMs);
      }
    } finally {
      bus.goTo(start);
      frame.width = 0;
      frame.height = 0;
      scheduleIdleGc(true);
    }
    const frames = gif.frameCount;
    return { gif: gif.finish(), frames, width: gif.width, height: gif.height };
  }
}
