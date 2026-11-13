import { EditError, EditErrorCode, parseHexInput, parseIntInput } from "@zigzagumap/core";
import { ja } from "../../i18n/ja";
import { messageBox } from "../MessageBox";

/**
 * 入力の読み取りと、AdvanceMap と同じ文言のエラー表示。
 * 整数でない入力は「'abc' is not a valid integer value.」（題名はアプリ名、OK だけ）。
 */

/** EditError を画面の文言（題名と本文）にする。 */
export function editErrorMessage(e: EditError): { title: string; text: string } {
  const p = e.params;
  const h = ja.header;
  switch (e.code) {
    case EditErrorCode.InvalidInteger:
      return { title: ja.appTitle, text: ja.invalidInteger(String(p["text"] ?? "")) };
    case EditErrorCode.MapTooLarge:
      return { title: ja.errorTitle, text: h.mapTooLarge(Number(p["width"]), Number(p["maxHeight"])) };
    case EditErrorCode.InvalidTileset:
      return { title: ja.errorTitle, text: h.readAtZero };
    case EditErrorCode.InvalidMapSize:
      return { title: ja.errorTitle, text: h.invalidMapSize };
    case EditErrorCode.WildAddCanceled:
      return { title: ja.information, text: ja.wild.canceled };
    case EditErrorCode.MapNameInvalidChar:
      return { title: ja.errorTitle, text: h.mapNameInvalidChar(String(p["char"])) };
    case EditErrorCode.MapNameTooLong:
      return { title: ja.errorTitle, text: h.mapNameTooLong(Number(p["length"]), Number(p["max"])) };
    case EditErrorCode.InvalidRawBytes:
      return { title: ja.errorTitle, text: p["field"] === "footer" ? h.invalidFooter : h.invalidRawBytes(Number(p["expected"])) };
    case EditErrorCode.ValueOutOfRange:
      return { title: ja.errorTitle, text: h.valueOutOfRange(String(p["field"]), Number(p["min"]), Number(p["max"])) };
    default:
      return { title: ja.errorTitle, text: ja.error(e.message) };
  }
}

/** 例外をダイアログで出す（EditError 以外はそのままの文）。 */
export async function showEditError(e: unknown): Promise<void> {
  if (e instanceof EditError) {
    const m = editErrorMessage(e);
    await messageBox(m.title, m.text, m.title === ja.information ? "info" : "error");
  } else {
    await messageBox(ja.errorTitle, e instanceof Error ? e.message : String(e), "error");
  }
}

/** 10 進欄（`$`・`0x` の 16 進も可）を読む。読めなければエラーを出して null。 */
export function readInt(text: string): number | null {
  try {
    return parseIntInput(text);
  } catch (e) {
    void showEditError(e);
    return null;
  }
}

/** 16 進欄（`$` を付けて読む。空欄は 0）を読む。読めなければエラーを出して null。 */
export function readHex(text: string): number | null {
  try {
    return parseHexInput(text.replace(/^\$/, ""));
  } catch (e) {
    void showEditError(e);
    return null;
  }
}

/** 黙って読む（入力中の連動用）。読めなければ null。 */
export function tryInt(text: string): number | null {
  try {
    return parseIntInput(text);
  } catch {
    return null;
  }
}

/** 0〜255 に丸める（AdvanceMap の出現確率の欄）。 */
export function clampByte(value: number): number {
  return Math.min(255, Math.max(0, value));
}

/** 1 バイトに切り詰める（AdvanceMap が Lv などを書くときと同じ。300 → 44、-1 → 255）。 */
export function toByte(value: number): number {
  return ((value % 256) + 256) % 256;
}

/** `$` 付き 6 桁の 16 進（AdvanceMap のオフセット欄の書式）。 */
export function offsetText(offset: number): string {
  return "$" + (offset >>> 0).toString(16).toUpperCase().padStart(6, "0");
}
