import { decodeBase64 } from "../binary/base64.js";
import { ProjectFormatError } from "./ProjectFormatError.js";

/** JSON を読んだ値（オブジェクト）。 */
export type JsonRecord = Record<string, unknown>;

/** JSON の文字列を読み、オブジェクトでなければ ProjectFormatError。 */
export function parseJsonObject(text: string, path: string | null): JsonRecord {
  let value: unknown;
  try {
    // UTF-8 の BOM があれば外す。
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    throw new ProjectFormatError(`JSON として読めません: ${(e as Error).message}`, path);
  }
  return asRecord(value, "ルート", path);
}

/** オブジェクトか確かめる。 */
export function asRecord(value: unknown, key: string, path: string | null): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProjectFormatError(`${key} はオブジェクトでなければなりません`, path);
  }
  return value as JsonRecord;
}

/** 整数を取り出す。無ければ `fallback`（省略時はエラー）。 */
export function readInt(obj: JsonRecord, key: string, path: string | null, fallback?: number): number {
  const value = obj[key];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ProjectFormatError(`${key} は整数でなければなりません`, path);
  }
  return value;
}

/** 真偽値を取り出す。無ければ `fallback`。 */
export function readBool(obj: JsonRecord, key: string, path: string | null, fallback = false): boolean {
  const value = obj[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new ProjectFormatError(`${key} は true か false でなければなりません`, path);
  return value;
}

/** 文字列を取り出す。無ければ `fallback`。 */
export function readString(obj: JsonRecord, key: string, path: string | null, fallback = ""): string {
  const value = obj[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new ProjectFormatError(`${key} は文字列でなければなりません`, path);
  return value;
}

/** base64 のバイト列を取り出す。無ければ空。 */
export function readBytes(obj: JsonRecord, key: string, path: string | null): Uint8Array {
  const text = readString(obj, key, path);
  try {
    return decodeBase64(text);
  } catch (e) {
    throw new ProjectFormatError(`${key} の base64 が不正です: ${(e as Error).message}`, path);
  }
}

/** 配列を取り出す。無ければ空。 */
export function readArray(obj: JsonRecord, key: string, path: string | null): unknown[] {
  const value = obj[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ProjectFormatError(`${key} は配列でなければなりません`, path);
  return value;
}
