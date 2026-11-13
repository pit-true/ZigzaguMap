import { BLOCK_ID_MASK, MOVEMENT_MASK, MOVEMENT_MAX, MOVEMENT_SHIFT } from "./constants.js";

/**
 * 編集できるブロック配置。1 マスは u16（下位 10 ビットがブロック番号、上位 6 ビットが移動許可）。
 * ROM のデータはコピーして持ち、ROM 自体は変えない。
 */
export class BlockGrid {
  readonly width: number;
  readonly height: number;
  /** マスの値（幅×高さ）。 */
  readonly cells: Uint16Array;

  constructor(width: number, height: number, cells?: Uint16Array) {
    if (cells && cells.length !== width * height) throw new RangeError("配置の大きさが合いません");
    this.width = width;
    this.height = height;
    this.cells = cells ? cells.slice() : new Uint16Array(width * height);
  }

  /** (x, y) がマップ内か。 */
  inBounds(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** マスの値（ブロック番号と移動許可の両方）。 */
  getCell(x: number, y: number): number {
    this.assertInBounds(x, y);
    return this.cells[y * this.width + x]!;
  }

  /** マスの値を書く。 */
  setCell(x: number, y: number, value: number): void {
    this.assertInBounds(x, y);
    this.cells[y * this.width + x] = value & 0xffff;
  }

  /** ブロック番号。 */
  getBlock(x: number, y: number): number {
    return this.getCell(x, y) & BLOCK_ID_MASK;
  }

  /** ブロック番号を書く（移動許可はそのまま）。 */
  setBlock(x: number, y: number, block: number): void {
    if (!Number.isInteger(block) || block < 0 || block > BLOCK_ID_MASK) throw new RangeError(`ブロック番号が範囲外です: ${block}`);
    this.setCell(x, y, (this.getCell(x, y) & MOVEMENT_MASK) | block);
  }

  /** 移動許可（0〜0x3F）。 */
  getMovement(x: number, y: number): number {
    return this.getCell(x, y) >> MOVEMENT_SHIFT;
  }

  /** 移動許可を書く（ブロック番号はそのまま）。 */
  setMovement(x: number, y: number, movement: number): void {
    if (!Number.isInteger(movement) || movement < 0 || movement > MOVEMENT_MAX) {
      throw new RangeError(`移動許可が範囲外です: ${movement}`);
    }
    this.setCell(x, y, (this.getCell(x, y) & BLOCK_ID_MASK) | (movement << MOVEMENT_SHIFT));
  }

  private assertInBounds(x: number, y: number): void {
    if (!this.inBounds(x, y)) throw new RangeError(`マップの外です: (${x}, ${y})`);
  }
}
