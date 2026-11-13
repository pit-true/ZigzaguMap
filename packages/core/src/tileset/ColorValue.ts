import { EditError, EditErrorCode } from "../command/EditError.js";

/** パレットエディタの 1 色（赤・緑・青の 0〜31 と、15 ビットの値）。 */
export interface ColorValue {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  /** BGR555（`青<<10 | 緑<<5 | 赤`）。 */
  readonly value: number;
}

/** BGR555 の値を赤・緑・青（0〜31）に分ける（最上位ビットは捨てる）。 */
export function colorFromBgr555(value: number): ColorValue {
  const v = value & 0x7fff;
  return { red: v & 0x1f, green: (v >> 5) & 0x1f, blue: (v >> 10) & 0x1f, value: v };
}

/** 赤・緑・青（0〜31）から作る。 */
export function colorFromChannels(red: number, green: number, blue: number): ColorValue {
  const r = clamp5(red);
  const g = clamp5(green);
  const b = clamp5(blue);
  return { red: r, green: g, blue: b, value: r | (g << 5) | (b << 10) };
}

/** 画面の色（8 ビットの RGB）から作る（スポイト。下位 3 ビットは捨てる）。 */
export function colorFromRgb8(r: number, g: number, b: number): ColorValue {
  return colorFromChannels((r & 0xff) >> 3, (g & 0xff) >> 3, (b & 0xff) >> 3);
}

/** 15 ビットの値の表記（16 進 4 桁、大文字）。 */
export function formatColorHex(value: number): string {
  return (value & 0x7fff).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * 「15bit GBAカラーの値」欄の文字を読む（AdvanceMap の「15bit to RGB」）。16 進として読み、最上位ビットは無視する。
 * 16 進でなければ EditError（invalidInteger、text は `$` 付き。`'$ZZZZ' is not a valid integer value.`）。
 */
export function parseColorHex(text: string): ColorValue {
  const t = text.trim();
  if (!/^[0-9a-fA-F]{1,8}$/.test(t)) throw new EditError(EditErrorCode.InvalidInteger, { text: `$${text}` });
  return colorFromBgr555(parseInt(t, 16));
}

function clamp5(n: number): number {
  return Math.max(0, Math.min(31, Math.trunc(n)));
}
