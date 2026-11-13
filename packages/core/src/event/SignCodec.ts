import { StructCodec } from "../binary/StructCodec.js";
import { readU16, readU32, readU8, writeU16, writeU32, writeU8 } from "../binary/bytes.js";
import { SIGN, SIGN_HIDDEN_ITEM_KINDS, SIGN_SIZE } from "./layout.js";
import type { SignEvent } from "./types.js";

/** 隠しアイテムの個数のビット。 */
const AMOUNT_MASK = 0x7f;
/** 隠しアイテムの足元フラグのビット。 */
const UNDERFOOT_BIT = 0x80;

/** 看板の種別が隠しアイテムか。 */
export function isHiddenItemKind(kind: number): boolean {
  return SIGN_HIDDEN_ITEM_KINDS.includes(kind);
}

/** 看板（12 バイト）の相互変換。中身は種別で読み分け、書くときは中身の型に従う。 */
export class SignCodec extends StructCodec<SignEvent> {
  readonly size = SIGN_SIZE;
  readonly label = "看板";

  protected read(b: Uint8Array, o: number): SignEvent {
    const kind = readU8(b, o + SIGN.kind);
    const amount = readU8(b, o + SIGN.hiddenAmount);
    return {
      x: readU16(b, o + SIGN.x),
      y: readU16(b, o + SIGN.y),
      elevation: readU8(b, o + SIGN.elevation),
      kind,
      padding: readU16(b, o + SIGN.padding),
      content: isHiddenItemKind(kind)
        ? {
            type: "hiddenItem",
            item: readU16(b, o + SIGN.hiddenItem),
            flag: readU8(b, o + SIGN.hiddenFlag),
            amount: amount & AMOUNT_MASK,
            underfoot: (amount & UNDERFOOT_BIT) !== 0,
          }
        : { type: "script", script: readU32(b, o + SIGN.data) },
    };
  }

  protected write(v: SignEvent, b: Uint8Array, o: number): void {
    writeU16(b, o + SIGN.x, v.x);
    writeU16(b, o + SIGN.y, v.y);
    writeU8(b, o + SIGN.elevation, v.elevation);
    writeU8(b, o + SIGN.kind, v.kind);
    writeU16(b, o + SIGN.padding, v.padding);
    const c = v.content;
    if (c.type === "script") {
      writeU32(b, o + SIGN.data, c.script);
    } else {
      writeU16(b, o + SIGN.hiddenItem, c.item);
      writeU8(b, o + SIGN.hiddenFlag, c.flag);
      writeU8(b, o + SIGN.hiddenAmount, (c.amount & AMOUNT_MASK) | (c.underfoot ? UNDERFOOT_BIT : 0));
    }
  }
}

/** 看板の変換器。 */
export const signCodec = new SignCodec();
