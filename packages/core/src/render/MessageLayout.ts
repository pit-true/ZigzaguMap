// メッセージの窓に並ぶ字（実機の文字の描き方をなぞる）。
//
// 窓の中（208×32）の x 6・y 2 から、字の幅 + 字間 1 で右へ、行の送りは 12 + 行間 3 = 15（AddTextPrinterParameterized2 の定数）。
// 制御は元のソースの pmfprint.c と ROM の 0x5874 の表に合わせる。
// - FE 改行。FA ボタン待ちのあと 1 行ぶん上へ送り、行の頭へ（y はそのまま）。FB ボタン待ちのあと窓を消して始めへ。FC 09 ボタン待ち。
// - FC 01 文字の色、02 背景の色、03 影の色、04 3 つ、06 フォント（2・3 だけ描ける）、0C 次のバイトをそのまま字に、0D 横の位置、
//   0E 縦の位置、0F 窓を消す。ほかは引数を読み飛ばす（音・待ち・海外版用）。
// - FC の次が漢字の上位バイト（漢字対応パッチの範囲）で、フォントが 2・4・5 なら次の 2 バイトで漢字 1 字。
// - FD xx・F7 xx は名前やバッファ（プレースホルダ）。F8 xx はボタンの絵。F9 xx は 0x100 + xx 番の字。

import type { ScriptTextPart } from "../script/disasm/scriptText.js";
import { createImage, writeBgr555, type RgbaImage } from "./color.js";
import { KANJI_FONTS, MESSAGE_GLYPH_HEIGHT, MessageFont, type MessageGlyph } from "./MessageFont.js";

/** 窓の中の大きさ（26×4 タイル）。 */
export const MESSAGE_AREA = { width: 208, height: 32 } as const;
/** 文字の始まり・字間・行間。 */
export const MESSAGE_TEXT = { x: 6, y: 2, letterSpacing: 1, lineSpacing: 3 } as const;
const LINE_STEP = MESSAGE_GLYPH_HEIGHT + MESSAGE_TEXT.lineSpacing;

/** 色の番号（窓のパレットの番号）。 */
export interface MessageColors {
  readonly fg: number;
  readonly bg: number;
  readonly shadow: number;
}

/** 補った字の理由。 */
export type MessageFallbackReason =
  /** charmap.tbl に無い字（書けない字）。 */
  | "charmap"
  /** ROM に絵が無い字（幅 0、背景だけの絵、漢字の絵が無い）。 */
  | "missing"
  /** ボタンの絵（F8）。 */
  | "icon"
  /** 描けないフォント（0・1）への切り替えのあとの字。 */
  | "font";

export type MessageItem =
  | { readonly kind: "glyph"; readonly x: number; readonly y: number; readonly width: number; readonly glyph: MessageGlyph; readonly colors: MessageColors; readonly source: "font" | "kanji"; readonly text: string; /** フォント 2 の字の番号か、漢字の (上位 << 8) | 下位。 */ readonly code: number; /** フォントの番号。 */ readonly font: number }
  | { readonly kind: "fallback"; readonly x: number; readonly y: number; readonly width: number; readonly text: string; readonly colors: MessageColors; readonly reason: MessageFallbackReason }
  | { readonly kind: "placeholder"; readonly x: number; readonly y: number; readonly width: number; readonly name: string; readonly colors: MessageColors };

/** ボタンを待つところ（ページ）で窓に見えている字。 */
export interface MessageStop {
  readonly items: readonly MessageItem[];
  /** 止まる理由（`end` は文の終わり）。 */
  readonly reason: "page" | "scroll" | "wait" | "end";
  /** 窓の右・下からはみ出した字がある（実機では描かれない）。 */
  readonly overflowRight: boolean;
  readonly overflowBelow: boolean;
}

/** プレースホルダ（FD xx）の名前と、入りうる一番長い値の字数（全角）。 */
const PLACEHOLDERS: ReadonlyMap<number, readonly [string, number]> = new Map([
  [0x01, ["PLAYER", 5]], [0x02, ["BUFFER1", 8]], [0x03, ["BUFFER2", 8]], [0x04, ["BUFFER3", 8]], [0x06, ["RIVAL", 5]],
  [0x0f, ["ATTACKER", 11]], [0x10, ["TARGET", 11]], [0x11, ["EFFECT_BANK", 11]], [0x13, ["SCRIPTING_BANK", 11]],
  [0x14, ["CURRENT_MOVE", 8]], [0x16, ["LAST_ITEM", 8]], [0x17, ["LAST_ABILITY", 8]], [0x18, ["ATTACKER_ABILITY", 8]],
  [0x19, ["TARGET_ABILITY", 8]], [0x1a, ["SCRIPTING_BANK_ABILITY", 8]], [0x1c, ["TRAINER1_CLASS", 6]], [0x1d, ["TRAINER1_NAME", 5]],
  [0x23, ["PLAYER_NAME", 5]], [0x3b, ["TARGET_NAME", 6]], [0x3c, ["TARGET_PARTNER_NAME", 6]],
]);
/** 表に無いプレースホルダの字数。 */
const PLACEHOLDER_DEFAULT_CHARS = 8;
/** ボタンの絵（F8 xx）の名前。 */
const ICONS = ["A", "B", "L", "R", "START", "SELECT", "↑", "↓", "←", "→", "↑↓", "←→", "+"];

/** FC xx の引数の数（xx = 1〜0x18）。 */
const CONTROL_ARGS = [0, 1, 1, 1, 3, 1, 1, 0, 1, 0, 0, 2, 1, 1, 1, 0, 2, 1, 1, 1, 1, 0, 0, 0, 0];

/** プレースホルダの名前と、箱の幅（px）。 */
export function placeholderInfo(code: number): { name: string; width: number } {
  const [name, chars] = PLACEHOLDERS.get(code) ?? [`FD ${code.toString(16).toUpperCase().padStart(2, "0")}`, PLACEHOLDER_DEFAULT_CHARS];
  return { name, width: chars * (10 + MESSAGE_TEXT.letterSpacing) - MESSAGE_TEXT.letterSpacing };
}

const isWide = (text: string) => !/^[\x20-\x7e｡-ﾟ]$/.test(text);

/** 本文（{@link ScriptTextCodec.encodeParts} の結果）を、ボタンを待つところごとの窓の中の字に並べる。 */
export function layoutMessage(
  parts: readonly ScriptTextPart[],
  font: MessageFont,
  start: MessageColors = { fg: 2, bg: 1, shadow: 3 },
  /** 始めのフォント（人物の台詞は MessageFont.speakerFont）。 */
  startFont = 2,
): MessageStop[] {
  // バイトの並びと、そのバイトを書いた本文。書けない字は -1。
  const stream: number[] = [], owner: number[] = [], partStart: number[] = [];
  for (const [index, part] of parts.entries()) {
    partStart.push(stream.length);
    for (const b of part.bytes ?? [-1]) { stream.push(b); owner.push(index); }
  }
  const textAt = (at: number, length: number): string => {
    const index = owner[at]!, part = parts[index]!;
    return partStart[index] === at && (part.bytes?.length ?? 1) === length ? part.text : stream.slice(at, at + length).map((b) => `[${b.toString(16).toUpperCase().padStart(2, "0")}]`).join("");
  };

  const stops: MessageStop[] = [];
  let items: MessageItem[] = [];
  let x: number = MESSAGE_TEXT.x, y: number = MESSAGE_TEXT.y, fontId = startFont;
  let colors: MessageColors = start;
  const stop = (reason: MessageStop["reason"]) => {
    const visible = items.filter((item) => item.y + MESSAGE_GLYPH_HEIGHT > 0);
    stops.push({
      items: visible,
      reason,
      overflowRight: visible.some((item) => item.x + item.width > MESSAGE_AREA.width),
      overflowBelow: visible.some((item) => item.y + MESSAGE_GLYPH_HEIGHT > MESSAGE_AREA.height),
    });
  };
  const advance = (width: number) => { x += width + MESSAGE_TEXT.letterSpacing; };
  const fallback = (text: string, width: number, reason: MessageFallbackReason) => {
    items.push({ kind: "fallback", x, y, width, text, colors, reason });
    advance(width);
  };
  const drawCode = (code: number, at: number, length: number) => {
    const text = textAt(at, length);
    if (!font.hasFace(fontId)) { fallback(text, isWide(text) ? 10 : 6, "font"); return; }
    const glyph = font.glyph(code, fontId);
    if (!glyph || glyph.blank) fallback(text, glyph && glyph.width > 0 ? glyph.width : isWide(text) ? 10 : 6, "missing");
    else { items.push({ kind: "glyph", x, y, width: glyph.width, glyph, colors, source: "font", text, code, font: fontId }); advance(glyph.width); }
  };

  let i = 0;
  const next = () => (i < stream.length ? stream[i++]! : 0xff);
  while (i < stream.length) {
    const at = i, b = next();
    if (b < 0) { const text = parts[owner[at]!]!.text; fallback(text, isWide(text) ? 10 : 6, "charmap"); continue; }
    if (b === 0xff) break;
    if (b === 0xfe) { x = MESSAGE_TEXT.x; y += LINE_STEP; continue; }
    if (b === 0xfa) {
      stop("scroll");
      items = items.map((item) => ({ ...item, y: item.y - LINE_STEP })).filter((item) => item.y + MESSAGE_GLYPH_HEIGHT > 0);
      x = MESSAGE_TEXT.x;
      continue;
    }
    if (b === 0xfb) { stop("page"); items = []; x = MESSAGE_TEXT.x; y = MESSAGE_TEXT.y; continue; }
    if (b === 0xfd || b === 0xf7) {
      const code = next();
      const info = b === 0xfd ? placeholderInfo(code) : { ...placeholderInfo(-1), name: `F7 ${code.toString(16).toUpperCase().padStart(2, "0")}` };
      items.push({ kind: "placeholder", x, y, width: info.width, name: info.name, colors });
      advance(info.width);
      continue;
    }
    if (b === 0xf8) { fallback(ICONS[next()] ?? "?", 10, "icon"); continue; }
    if (b === 0xf9) { const code = 0x100 | next(); drawCode(code, at, i - at); continue; }
    if (b === 0xfc) {
      const sub = next();
      if (sub >= 1 && sub <= 0x18) {
        const args = Array.from({ length: CONTROL_ARGS[sub]! }, next);
        if (sub === 0x01) colors = { ...colors, fg: args[0]! & 15 };
        else if (sub === 0x02) colors = { ...colors, bg: args[0]! & 15 };
        else if (sub === 0x03) colors = { ...colors, shadow: args[0]! & 15 };
        else if (sub === 0x04) colors = { fg: args[0]! & 15, bg: args[1]! & 15, shadow: args[2]! & 15 };
        else if (sub === 0x06) fontId = args[0]!;
        else if (sub === 0x09) stop("wait");
        else if (sub === 0x0c) drawCode(args[0]!, at, i - at);
        else if (sub === 0x0d) x = MESSAGE_TEXT.x + args[0]!;
        else if (sub === 0x0e) y = MESSAGE_TEXT.y + args[0]!;
        else if (sub === 0x0f) items = [];
        continue;
      }
      if (MessageFont.isKanjiLead(sub) && KANJI_FONTS.has(fontId)) {
        const trail = next(), text = textAt(at, i - at);
        const glyph = font.kanji(sub, trail);
        if (!glyph || glyph.blank) fallback(text, 10, "missing");
        else { items.push({ kind: "glyph", x, y, width: glyph.width, glyph, colors, source: "kanji", text, code: (sub << 8) | trail, font: fontId }); advance(glyph.width); }
        continue;
      }
      // 知らない制御（漢字パッチの無い ROM の漢字も）は FC xx だけ読み、続きは字として描く。
      continue;
    }
    drawCode(b, at, 1);
  }
  stop("end");
  // `\p` で終わる文の最後の空のページは見せない。
  if (stops.length > 1 && stops[stops.length - 1]!.items.length === 0) stops.pop();
  return stops;
}

/**
 * 窓の中の字を画像に描く。ROM の字だけを描き、補った字とプレースホルダは描かない（画面の側で確認用のフォントで描く）。
 * `origin` は画像の中の窓の左上。窓の外の画素は描かない。`palette` は窓のパレット（16 色の BGR555）。
 */
export function drawMessageGlyphs(image: RgbaImage, items: readonly MessageItem[], palette: readonly number[], origin: { x: number; y: number }): void {
  for (const item of items) {
    if (item.kind !== "glyph") continue;
    const { fg, bg, shadow } = item.colors;
    const color = [bg, fg, shadow, bg];
    for (let gy = 0; gy < MESSAGE_GLYPH_HEIGHT; gy++) {
      const ay = item.y + gy;
      if (ay < 0 || ay >= MESSAGE_AREA.height) continue;
      for (let gx = 0; gx < item.width && gx < 16; gx++) {
        const ax = item.x + gx;
        if (ax < 0 || ax >= MESSAGE_AREA.width) continue;
        const px = origin.x + ax, py = origin.y + ay;
        if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
        writeBgr555(image.data, py * image.width + px, palette[color[item.glyph.pixels[gy * 16 + gx]!]!] ?? 0);
      }
    }
  }
}

/** 窓の中だけの画像（208×32、背景はパレット 1 番）に字を描く（枠の分からないとき）。 */
export function messageAreaImage(items: readonly MessageItem[], palette: readonly number[], bg = 1): RgbaImage {
  const image = createImage(MESSAGE_AREA.width, MESSAGE_AREA.height);
  for (let i = 0; i < image.width * image.height; i++) writeBgr555(image.data, i, palette[bg] ?? 0x7fff);
  drawMessageGlyphs(image, items, palette, { x: 0, y: 0 });
  return image;
}
