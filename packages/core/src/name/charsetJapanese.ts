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

/** 書くときだけ受け付ける別表記 → バイト。 */
export const JP_ALIASES: Readonly<Record<string, number>> = {
  " ": 0x00,
  "０": 0xa1,
  "１": 0xa2,
  "２": 0xa3,
  "３": 0xa4,
  "４": 0xa5,
  "５": 0xa6,
  "６": 0xa7,
  "７": 0xa8,
  "８": 0xa9,
  "９": 0xaa,
  "！": 0xab,
  "？": 0xac,
  "･": 0xaf,
  "＞": 0xef,
};
