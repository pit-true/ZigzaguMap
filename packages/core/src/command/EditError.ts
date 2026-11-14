import { formatHexBytes } from "../binary/bytes.js";

/**
 * 編集コマンドの入力エラーの種類。文言は画面側が持ち、ここでは ID と引数だけを決める。
 * 括弧内は AdvanceMap 1.92（日本語化版）で同じ場面に出る文言。
 */
export const EditErrorCode = {
  /** 整数として読めない入力（`'abc' is not a valid integer value.`）。引数: text（入力そのもの。16 進欄は `$` 付き）。 */
  InvalidInteger: "invalidInteger",
  /** 値が範囲外。引数: field, value, min, max。 */
  ValueOutOfRange: "valueOutOfRange",
  /** 知らない項目名。引数: field。 */
  UnknownField: "unknownField",
  /** いまの種類では使えない項目（スクリプトの看板に道具番号など）。引数: field。 */
  FieldNotApplicable: "fieldNotApplicable",
  /** イベントの番号が範囲外。引数: kind, index, count。 */
  EventIndexOutOfRange: "eventIndexOutOfRange",
  /** イベントの数の上限（255）を超える。引数: kind, max。 */
  EventLimit: "eventLimit",
  /** マップが大きすぎる（`The max map height at a map width of 200 is: 33`）。引数: width, maxHeight。 */
  MapTooLarge: "mapTooLarge",
  /** 幅・高さが 1 未満など不正。引数: width, height。 */
  InvalidMapSize: "invalidMapSize",
  /** 新規マップの入力が足りない（`すべて記入してください`）。引数: missing（項目名の配列）。 */
  FillAllFields: "fillAllFields",
  /** マップが無い（`指定したマップは存在しません！`）。引数: bank, map。 */
  MapNotFound: "mapNotFound",
  /** 既にあるマップ番号。引数: bank, map。 */
  MapExists: "mapExists",
  /** 新しいマップはバンクの末尾にだけ置ける。引数: bank, map, expected（置ける番号）。 */
  MapSlotNotAppend: "mapSlotNotAppend",
  /** 新しいバンクは最後のバンクの次にだけ作れる。引数: bank, expected。 */
  BankSkip: "bankSkip",
  /** AdvanceMap の `.map` / `.evt` として読めない。引数: reason。 */
  InvalidMapFile: "invalidMapFile",
  /** タイルセットが読めない（`AdvanceMapError(1): Try to read at pos 0!`）。引数: pointer。 */
  InvalidTileset: "invalidTileset",
  /** 地名番号にマップ名が無い。引数: regionId。 */
  NoMapName: "noMapName",
  /** マップ名に使えない文字。引数: char。 */
  MapNameInvalidChar: "mapNameInvalidChar",
  /** マップ名が長すぎる。引数: length（終端込みのバイト数）, max。 */
  MapNameTooLong: "mapNameTooLong",
  /** マップスクリプトの種類 0（`スクリプト未設定`）は一覧の終端と同じなので置けない。 */
  MapScriptTypeUnset: "mapScriptTypeUnset",
  /** マップスクリプトの番号が範囲外。引数: index, count。 */
  MapScriptIndexOutOfRange: "mapScriptIndexOutOfRange",
  /** マップスクリプトの数の上限を超える。引数: max。 */
  MapScriptLimit: "mapScriptLimit",
  /** 条件表を持たない種類のマップスクリプト。引数: index, type。 */
  MapScriptNotTable: "mapScriptNotTable",
  /** 条件表の行の番号が範囲外。引数: index, row, count。 */
  ConditionIndexOutOfRange: "conditionIndexOutOfRange",
  /** 条件表の変数 0 は表の終端と同じなので置けない。 */
  ConditionVariableZero: "conditionVariableZero",
  /** 接続の番号が範囲外。引数: index, count。 */
  ConnectionIndexOutOfRange: "connectionIndexOutOfRange",
  /** 野生の追加で何も選んでいない（`野生ポケモンの出現データの追加/変更を中止しました！`）。 */
  WildAddCanceled: "wildAddCanceled",
  /** 野生のそのエリアにデータが無い。引数: time, area。 */
  WildAreaMissing: "wildAreaMissing",
  /** 落とし物の人の番号が範囲外、または人ではない。引数: personIndex, count。 */
  ItemBallPersonOutOfRange: "itemBallPersonOutOfRange",
  /** フライトポジションの番号が範囲外。引数: index, count。 */
  FlyIndexOutOfRange: "flyIndexOutOfRange",
  /** 生のバイト列の長さ・書き方が違う。引数: field, expected（バイト数）。 */
  InvalidRawBytes: "invalidRawBytes",
  /** ブロック番号が範囲外。引数: index, count。 */
  BlockIndexOutOfRange: "blockIndexOutOfRange",
  /** タイル番号が範囲外。引数: index, count。 */
  TileIndexOutOfRange: "tileIndexOutOfRange",
  /** パレットファイルの形式が違う。引数: length。 */
  InvalidPaletteFile: "invalidPaletteFile",
  /** 同じ色が複数あるパレットは書き出せない（`このパレットはエクスポートできません！`）。 */
  DuplicatePaletteColors: "duplicatePaletteColors",
  /** 画像の形式が違う。引数: reason。 */
  InvalidImage: "invalidImage",
  /** scripts.json の対応表の行の番号が範囲外。引数: index, count。 */
  ScriptsTableIndexOutOfRange: "scriptsTableIndexOutOfRange",
  /** 対応表の `.s` / `.string` のパスが使えない。引数: field（script / strings）, path, reason（empty / absolute / parent / extension / folder / chars）。 */
  InvalidScriptPath: "invalidScriptPath",
} as const;

/** 編集コマンドの入力エラーの種類。 */
export type EditErrorCode = (typeof EditErrorCode)[keyof typeof EditErrorCode];

/** 入力エラーの引数。 */
export type EditErrorParams = Readonly<Record<string, string | number | boolean | readonly (string | number)[]>>;

/**
 * 編集コマンドの入力エラー。コマンドは状態を変える前にこれを投げる（投げたときは何も変わらない）。
 * 画面は `code` と `params` から文言を作る。
 */
export class EditError extends Error {
  constructor(
    readonly code: EditErrorCode,
    readonly params: EditErrorParams = {},
  ) {
    super(`${code} ${JSON.stringify(params)}`);
    this.name = "EditError";
  }
}

/** 値が `min`〜`max` の整数か確かめ、違えば EditError（valueOutOfRange）。 */
export function checkRange(field: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new EditError(EditErrorCode.ValueOutOfRange, { field, value, min, max });
  }
  return value;
}

/**
 * Delphi の StrToInt と同じ規則で整数を読む（AdvanceMap の 10 進欄）。
 * 先頭の空白、符号、`$` か `0x` の 16 進を受け付ける。読めなければ EditError（invalidInteger）。
 */
export function parseIntInput(text: string): number {
  const m = /^\s*([+-]?)(?:(\$|0[xX])([0-9A-Fa-f]+)|([0-9]+))$/.exec(text);
  if (!m) throw new EditError(EditErrorCode.InvalidInteger, { text });
  const value = m[2] ? parseInt(m[3]!, 16) : parseInt(m[4]!, 10);
  if (!Number.isSafeInteger(value) || value > 0xffffffff) throw new EditError(EditErrorCode.InvalidInteger, { text });
  return m[1] === "-" ? -value : value;
}

/**
 * AdvanceMap の 16 進欄と同じ規則で読む（`$` で始まらなければ前に付けて StrToInt）。空欄は 0。
 * 読めなければ EditError（invalidInteger、text は `$` 付き。`$GGGGGG` と入れたときは `$` を重ねない）。
 */
export function parseHexInput(text: string): number {
  if (text === "") return 0;
  const withPrefix = text.startsWith("$") ? text : "$" + text;
  const m = /^\$([0-9A-Fa-f]+)$/.exec(withPrefix);
  if (!m) throw new EditError(EditErrorCode.InvalidInteger, { text: withPrefix });
  const value = parseInt(m[1]!, 16);
  if (!Number.isSafeInteger(value) || value > 0xffffffff) throw new EditError(EditErrorCode.InvalidInteger, { text: withPrefix });
  return value;
}

/**
 * 16 進の文字列（空白は無視）をバイト列にする（高度なヘッダーの欄）。
 * 長さが `expected` バイトでない、16 進でない文字があるときは EditError（invalidRawBytes）。
 */
export function parseHexBytes(field: string, text: string, expected: number): Uint8Array {
  const hex = text.replace(/\s+/g, "");
  if (!/^(?:[0-9A-Fa-f]{2})*$/.test(hex) || hex.length !== expected * 2) {
    throw new EditError(EditErrorCode.InvalidRawBytes, { field, expected });
  }
  const out = new Uint8Array(expected);
  for (let i = 0; i < expected; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** バイト列を 16 進の大文字にする（高度なヘッダーの欄の表示用）。 */
export function toHexBytes(bytes: Uint8Array): string {
  return formatHexBytes(bytes);
}
