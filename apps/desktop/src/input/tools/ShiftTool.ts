import { LineLock, ShiftMapCommand } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaPaint } from "../../i18n/ja.paint";
import { jaTools } from "../../i18n/ja.tools";
import type { Cell, MapView } from "../../ui/map/MapView";
import type { PreviewCanvas } from "../PreviewCanvas";

/**
 * マップシフト（Phase5 #390。Porymap の Map Shift）。道具がシフトのとき、左ドラッグした量だけ主マップの配置全体（ブロックと移動許可）を
 * ずらす。はみ出た行と列は反対側に出る。ドラッグ中は、ずらした絵を下見に描き、離したら 1 回のコマンド（ShiftMapCommand）にする。
 * Shift を押している間は横か縦だけ（直線と同じく、動き始めの向きで決める）。Esc でやめる。イベント・接続は動かさない（Q5）。
 * マップタブと移動エリアタブで使う（隣のマップの帯の上で押しても、主マップをずらす）。
 */
export class ShiftTool {
  private drag: { anchor: Cell; dx: number; dy: number; cancelled: boolean } | null = null;
  private readonly lock = new LineLock();

  constructor(
    private readonly view: MapView,
    private readonly state: EditorState,
    private readonly preview: PreviewCanvas,
  ) {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.drag || this.drag.cancelled) return;
      e.preventDefault();
      this.drag.cancelled = true;
      this.preview.end();
      this.state.setStatus(jaPaint.dragCancelled);
    });
  }

  /** ドラッグ中か。 */
  get active(): boolean {
    return this.drag !== null;
  }

  /** 押した。 */
  begin(cell: Cell, shift: boolean): void {
    if (!this.state.map) return;
    this.drag = { anchor: cell, dx: 0, dy: 0, cancelled: false };
    if (shift) this.lock.start(cell.x, cell.y);
    else this.lock.stop();
    this.draw();
  }

  /** 動かした（`shift` は今 Shift を押しているか）。 */
  move(cell: Cell, shift: boolean): void {
    const d = this.drag;
    if (!d || d.cancelled) return;
    if (!shift) this.lock.stop();
    else if (!this.lock.active) this.lock.start(d.anchor.x, d.anchor.y);
    const c = this.lock.constrain(cell.x, cell.y);
    d.dx = c.x - d.anchor.x;
    d.dy = c.y - d.anchor.y;
    this.draw();
  }

  /** 離した。ドラッグ中だったら true（ずらす量が 0 でなければ 1 回のコマンドで実行する）。 */
  end(): boolean {
    const d = this.drag;
    this.drag = null;
    this.lock.stop();
    if (!d) return false;
    this.preview.end();
    if (d.cancelled) return true;
    this.run(d.dx, d.dy);
    return true;
  }

  /** ずらす（自動操作からも使う）。ずらす量が 0 なら何もしない。 */
  run(dx: number, dy: number): void {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session || (dx === 0 && dy === 0)) return;
    const w = map.doc.width;
    const h = map.doc.height;
    // 1 周したものは 0 と同じ
    if (dx % w === 0 && dy % h === 0) return;
    session.bus.execute(new ShiftMapCommand({ bank: map.id.bank, map: map.id.map, dx, dy }));
    this.state.setStatus(jaTools.shifted(dx, dy));
  }

  /** 下見: 主マップの絵（と重ね描き）を回り込みつきでずらして描く。 */
  private draw(): void {
    const d = this.drag;
    const map = this.state.map;
    if (!d || !map) return;
    const p = this.preview.begin();
    const size = p.size;
    const W = map.doc.width * size;
    const H = map.doc.height * size;
    const sx = mod(d.dx, map.doc.width) * size;
    const sy = mod(d.dy, map.doc.height) * size;
    const base = this.view.stage.querySelector<HTMLCanvasElement>("canvas.map-base");
    const c = p.c;
    c.save();
    c.beginPath();
    c.rect(p.ox, p.oy, W, H);
    c.clip();
    c.imageSmoothingEnabled = false;
    for (const src of [base, this.view.overlayHidden ? null : this.view.layer]) {
      if (!src || src.width === 0) continue;
      for (const ox of [sx - W, sx]) for (const oy of [sy - H, sy]) c.drawImage(src, p.ox + ox, p.oy + oy, W, H);
    }
    c.restore();
    c.strokeStyle = "#ff0000";
    c.lineWidth = 1;
    c.strokeRect(p.ox + 0.5, p.oy + 0.5, W - 1, H - 1);
    this.state.setStatus(jaTools.shifting(d.dx, d.dy));
  }
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
