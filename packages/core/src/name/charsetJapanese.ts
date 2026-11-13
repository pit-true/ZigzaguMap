/**
 * ファイアレッド日本語版の文字コード表（1 バイト文字）。
 * AdvanceMap 1.92 の Table_jap.ini と NeoDark-CFRU の charmap.tbl を元にした。
 * 表に無いバイト（制御文字 0xF7〜0xFD など）は TextCodec がエスケープで扱う。
 */

const HIRAGANA =
  "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん" +
  "ぁぃぅぇぉゃゅょがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽっ";
const KATAKANA =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン" +
  "ァィゥェォャュョガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポッ";
const SYMBOLS = "0123456789!?。ー・…『』「」♂♀円.*/";
const LATIN = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const EXTRA = "▶:ÄÖÜäöü";

/** 0x00 の文字（全角の空白）。 */
export const JP_SPACE = "　";
/** 改行（0xFE）。 */
export const JP_NEWLINE_CODE = 0xfe;
/** 文字列の終端（0xFF）。 */
export const JP_TERMINATOR = 0xff;

function buildTable(): (string | null)[] {
  const table: (string | null)[] = new Array(256).fill(null);
  table[0x00] = JP_SPACE;
  let code = 0x01;
  for (const c of HIRAGANA + KATAKANA + SYMBOLS + LATIN + EXTRA) table[code++] = c;
  table[JP_NEWLINE_CODE] = "\n";
  return table;
}

/** バイト → 文字。null は表に無いバイト。 */
export const JP_CHARSET: readonly (string | null)[] = buildTable();

