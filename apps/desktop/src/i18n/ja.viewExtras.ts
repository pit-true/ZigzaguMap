import { hex } from "./ja";

/** 表示の補助（#238。Ctrl で隠す、座標と選択範囲、隣のマップの帯の座標、ブロックの情報）の文言（ZigzaguMap 独自）。 */
export const jaViewExtras = {
  /** 矩形を選んでいる・塗っているときの大きさ。 */
  rect: (x: number, y: number, w: number, h: number) => `X: ${hex(x, 2)} Y: ${hex(y, 2)}    ${w}×${h}`,
  /** 隣のマップの帯の上。 */
  neighborCell: (bank: number, map: number, name: string | null, x: number, y: number) =>
    `${bank}.${map}${name ? ` ${name}` : ""} (X: ${hex(x, 2)} Y: ${hex(y, 2)})`,
  /** マップタブのブロックの上（Q8: 番号・移動許可・挙動）。 */
  blockCell: (block: number, movement: number, movementName: string, behavior: number | null) =>
    `ブロック ${hex(block, 4)}  移動許可 ${hex(movement, 2)}（${movementName}）${behavior === null ? "" : `  挙動 ${hex(behavior, 2)}`}`,
};
