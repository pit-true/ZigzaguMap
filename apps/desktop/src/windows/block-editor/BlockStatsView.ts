import { autoId } from "../../ui/form/controls";

/** ブロック一覧の 1 ブロックの表示の大きさ（16 × 2 倍）と列の数。 */
const BLOCK = 32;
const BLOCK_COLUMNS = 8;
/** タイル一覧の 1 タイルの表示の大きさ（8 × 2 倍）と列の数。 */
const TILE = 16;
const TILE_COLUMNS = 16;

/** 表示 メニューの 3 つの切り替え。 */
export interface BlockStatsFlags {
  usage: boolean;
  unusedBlocks: boolean;
  unusedTiles: boolean;
}

/**
 * 使用回数・未使用のブロック・未使用のタイルの印（#395）。ブロック一覧とタイル一覧の絵の上に、別の Canvas を重ねて描く
 * （下の絵は AdvanceMap と同じまま。どれも既定はオフ）。
 * - 使用回数: 各ブロックの右下に数。
 * - 未使用のブロック（使用回数 0）: 赤い枠と斜線。
 * - 未使用のタイル: 赤い枠と斜線。
 */
export class BlockStatsView {
  readonly blockLayer: HTMLCanvasElement;
  readonly tileLayer: HTMLCanvasElement;
  readonly flags: BlockStatsFlags = { usage: false, unusedBlocks: false, unusedTiles: false };
  private counts: number[] | null = null;
  private unused: number[] | null = null;

  constructor(blockList: HTMLElement, tileSheet: HTMLElement) {
    this.blockLayer = overlay("be.blocksOverlay");
    this.tileLayer = overlay("be.tilesOverlay");
    blockList.append(this.blockLayer);
    tileSheet.append(this.tileLayer);
  }

  /** どれかがオンか（数える必要があるか）。 */
  get active(): boolean {
    return this.flags.usage || this.flags.unusedBlocks || this.flags.unusedTiles;
  }

  /** 数えた結果を捨てる（窓を閉じる・タイルセットが変わる）。 */
  clear(): void {
    this.counts = null;
    this.unused = null;
    this.render(0);
  }

  /** 数えた結果を入れる。 */
  set(counts: number[] | null, unusedTiles: number[] | null): void {
    this.counts = counts;
    this.unused = unusedTiles;
  }

  /** 自動操作の `state` に出す値。 */
  describe(): unknown {
    const counts = this.counts;
    return {
      flags: { ...this.flags },
      counted: counts !== null,
      unusedBlocks: counts ? counts.flatMap((n, i) => (n === 0 ? [i] : [])) : null,
      unusedTiles: this.unused,
      counts,
    };
  }

  /** 描き直す（`listed` は一覧に並べるブロックの数）。 */
  render(listed: number): void {
    const rows = Math.ceil(listed / BLOCK_COLUMNS);
    const showBlocks = (this.flags.usage || this.flags.unusedBlocks) && this.counts !== null;
    resize(this.blockLayer, BLOCK_COLUMNS * BLOCK, showBlocks ? rows * BLOCK : 0);
    if (showBlocks) {
      const g = this.blockLayer.getContext("2d")!;
      g.clearRect(0, 0, this.blockLayer.width, this.blockLayer.height);
      g.font = "bold 10px sans-serif";
      g.textAlign = "right";
      g.textBaseline = "bottom";
      this.counts!.forEach((n, block) => {
        if (n < 0 || block >= listed) return;
        const x = (block % BLOCK_COLUMNS) * BLOCK;
        const y = Math.floor(block / BLOCK_COLUMNS) * BLOCK;
        if (this.flags.unusedBlocks && n === 0) cross(g, x, y, BLOCK);
        if (this.flags.usage) {
          const text = n > 9999 ? "9999+" : String(n);
          const w = g.measureText(text).width + 4;
          g.fillStyle = "rgba(0,0,0,0.7)";
          g.fillRect(x + BLOCK - w, y + BLOCK - 11, w, 11);
          g.fillStyle = n === 0 ? "#ff8080" : "#ffffff";
          g.fillText(text, x + BLOCK - 2, y + BLOCK);
        }
      });
    }
    const showTiles = this.flags.unusedTiles && this.unused !== null;
    resize(this.tileLayer, TILE_COLUMNS * TILE, showTiles ? (1024 / TILE_COLUMNS) * TILE : 0);
    if (showTiles) {
      const g = this.tileLayer.getContext("2d")!;
      g.clearRect(0, 0, this.tileLayer.width, this.tileLayer.height);
      for (const tile of this.unused!) cross(g, (tile % TILE_COLUMNS) * TILE, Math.floor(tile / TILE_COLUMNS) * TILE, TILE);
    }
  }
}

/** 未使用の印（赤い枠と斜線）。 */
function cross(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  g.strokeStyle = "rgba(255,40,40,0.9)";
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  g.beginPath();
  g.moveTo(x + 1, y + 1);
  g.lineTo(x + size - 1, y + size - 1);
  g.stroke();
}

function overlay(id: string): HTMLCanvasElement {
  const c = autoId(document.createElement("canvas"), id);
  c.className = "be-overlay";
  c.width = 0;
  c.height = 0;
  return c;
}

function resize(c: HTMLCanvasElement, width: number, height: number): void {
  if (c.width !== width) c.width = width;
  if (c.height !== height) c.height = height;
  c.hidden = height === 0;
}

