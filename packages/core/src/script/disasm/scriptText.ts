/**
 * ROM の文字列のバイト列と、`.string` の本文の変換。CFRU の scripts/string.py（ProcessString）と同じ読み方で戻す。
 *
 * string.py は charmap.tbl の右辺を書いたまま（`\n`・`\"`・`\$` も 2 字のまま）辞書に入れ、同じ文字が何度出ると最後の定義を使う。
 * 本文は「`{…}` は辞書の名前」「`<XX YY>` は 16 進のバイト」「`[名前]` は決まった名前か 2 桁の 16 進」
 * 「それ以外は 3 字・2 字・1 字の順に辞書を引く」と読む。
 * 戻すときは、string.py で同じバイトになる定義だけを使い（同じなら charmap.tbl で先の定義）、最後に string.py の読み方で
 * 元のバイト列に戻るかを確かめる。戻らなければ、すべてを `[XX]` で書く。
 *
 * - FD 01・02・03・04・06 は `[PLAYER]`・`[BUFFER1]`・`[BUFFER2]`・`[BUFFER3]`・`[RIVAL]`。
 * - 表に無い 1 バイトは `[F7]`、表に無い FC xx yy は `<FC 88 9F>`。
 */

import { formatHex } from "../../binary/bytes.js";
import { DataError } from "../../binary/DataError.js";
import { ND_CHARMAP_TBL } from "../../name/charmapNd.js";

/** `[名前]` → バイト列（string.py の SpecialBuffers のうち、戻すときに使うもの）。 */
const SPECIAL_BUFFERS: ReadonlyMap<string, readonly number[]> = new Map([
  ["PLAYER", [0xfd, 0x01]],
  ["BUFFER1", [0xfd, 0x02]],
  ["BUFFER2", [0xfd, 0x03]],
  ["BUFFER3", [0xfd, 0x04]],
  ["RIVAL", [0xfd, 0x06]],
]);
/**
 * string.py の SpecialBuffers の残り（書くときだけ使う。戻すときは使わない）。色・待ち・ボタンの絵など。
 * `[BUFFER]` `[MAIN_COLOUR]` などは続きのバイトを `[XX]` で書く形。
 */
const ENCODE_ONLY_BUFFERS: ReadonlyMap<string, readonly number[]> = new Map([
  [".", [0xb0]], ["BUFFER", [0xfd]],
  ["ATTACKER", [0xfd, 0x0f]], ["TARGET", [0xfd, 0x10]], ["EFFECT_BANK", [0xfd, 0x11]], ["SCRIPTING_BANK", [0xfd, 0x13]],
  ["CURRENT_MOVE", [0xfd, 0x14]], ["LAST_ITEM", [0xfd, 0x16]], ["LAST_ABILITY", [0xfd, 0x17]], ["ATTACKER_ABILITY", [0xfd, 0x18]],
  ["TARGET_ABILITY", [0xfd, 0x19]], ["SCRIPTING_BANK_ABILITY", [0xfd, 0x1a]], ["TRAINER1_CLASS", [0xfd, 0x1c]], ["TRAINER1_NAME", [0xfd, 0x1d]],
  ["PLAYER_NAME", [0xfd, 0x23]], ["TARGET_NAME", [0xfd, 0x3b]], ["TARGET_PARTNER_NAME", [0xfd, 0x3c]], ["DEF_PREFIX_5", [0xfd, 0x3d]],
  ["WHITE", [0xfc, 0x01, 0x01]], ["BLACK", [0xfc, 0x01, 0x02]], ["GRAY", [0xfc, 0x01, 0x03]], ["RED", [0xfc, 0x01, 0x04]],
  ["ORANGE", [0xfc, 0x01, 0x05]], ["GREEN", [0xfc, 0x01, 0x06]], ["LIGHT_GREEN", [0xfc, 0x01, 0x07]], ["BLUE", [0xfc, 0x01, 0x08]],
  ["LIGHT_BLUE", [0xfc, 0x01, 0x09]], ["MAIN_COLOUR", [0xfc, 0x01]], ["SHADOW_COLOUR", [0xfc, 0x03]],
  ["ARROW_UP", [0x79]], ["ARROW_DOWN", [0x7a]], ["ARROW_LEFT", [0x7b]], ["ARROW_RIGHT", [0x7c]],
  ["SHRINK", [0xfc, 0x06, 0x00]], ["PAUSE", [0xfc, 0x08]], ["PAUSE_UNTIL_PRESS", [0xfc, 0x09]], ["PLAY_BGM", [0xfc, 0x0b]],
  ["ESCAPE", [0xfc, 0x0c]], ["SHIFT_TEXT", [0xfc, 0x0d]], ["PLAY_SE", [0xfc, 0x10]], ["CLEAR", [0xfc, 0x11]], ["SKIP", [0xfc, 0x12]],
  ["ALIGN", [0xfc, 0x13]], ["MIN_LETTER_SPACING", [0xfc, 0x14]], ["PAUSE_MUSIC", [0xfc, 0x17]], ["RESUME_MUSIC", [0xfc, 0x18]],
  ["A_BUTTON", [0xf8, 0x00]], ["B_BUTTON", [0xf8, 0x01]], ["L_BUTTON", [0xf8, 0x02]], ["R_BUTTON", [0xf8, 0x03]],
  ["START_BUTTON", [0xf8, 0x04]], ["SELECT_BUTTON", [0xf8, 0x05]], ["DPAD_UP", [0xf8, 0x06]], ["DPAD_DOWN", [0xf8, 0x07]],
  ["DPAD_LEFT", [0xf8, 0x08]], ["DPAD_RIGHT", [0xf8, 0x09]], ["DPAD_UP_DOWN", [0xf8, 0x0a]], ["DPAD_LEFT_RIGHT", [0xf8, 0x0b]], ["DPAD", [0xf8, 0x0c]],
]);

/** 本文の一部と、そのバイト列（{@link ScriptTextCodec.encodeParts}）。`bytes` が null の字は書けない字。 */
export interface ScriptTextPart {
  readonly text: string;
  readonly bytes: readonly number[] | null;
}

/** string.py が辞書を引く長さ（字）の上限。 */
const LOOKUP_CHARS = 3;
const TERMINATOR = 0xff;
const KANJI_PREFIX = 0xfc;

interface Entry {
  text: string;
  bytes: readonly number[];
}

const hex2 = (b: number) => formatHex(b, 2);

/** string.py と同じ読み方の、`.string` の本文とバイト列の変換。 */
export class ScriptTextCodec {
  /** 終端のバイト。 */
  readonly terminator = TERMINATOR;
  /** 右辺 → バイト列（string.py と同じく最後の定義）。 */
  private readonly dictionary = new Map<string, readonly number[]>();
  /** 先頭のバイト → 戻すときに使う定義（長い順、同じ長さは charmap.tbl の順）。 */
  private readonly byFirst = new Map<number, Entry[]>();

  private constructor(charmap: string) {
    const entries: Entry[] = [];
    for (const raw of charmap.replace(/^﻿/, "").split(/\r?\n/)) {
      if (raw.trim() === "" || raw.trim().startsWith("/")) continue;
      const eq = raw.indexOf("=");
      if (eq < 0) continue;
      const left = raw.slice(0, eq).trim();
      if (!/^[0-9A-Fa-f]{1,2}(?:\s+[0-9A-Fa-f]{1,2})*$/.test(left)) continue;
      const bytes = left.split(/\s+/).map((h) => parseInt(h, 16));
      const text = raw.slice(eq + 1);
      if (text === "") continue;
      this.dictionary.set(text, bytes);
      entries.push({ text, bytes });
    }
    this.dictionary.set(" ", [0]);
    for (const e of entries) {
      if (e.bytes.length === 1 && e.bytes[0] === TERMINATOR) continue;
      if (!this.usable(e)) continue;
      const list = this.byFirst.get(e.bytes[0]!) ?? [];
      list.push(e);
      this.byFirst.set(e.bytes[0]!, list);
    }
    for (const list of this.byFirst.values()) list.sort((a, b) => b.bytes.length - a.bytes.length);
  }

  /** charmap.tbl の中身から作る。 */
  static fromCharmap(charmap: string): ScriptTextCodec {
    return new ScriptTextCodec(charmap);
  }

  /** 同梱の charmap.tbl（NeoDark-CFRU のもの）を使う変換。 */
  static get japanese(): ScriptTextCodec {
    return (japaneseCache ??= new ScriptTextCodec(ND_CHARMAP_TBL));
  }

  /** string.py で書いたとおりのバイト列になる定義か。 */
  private usable(e: Entry): boolean {
    const t = e.text;
    const braced = t.startsWith("{") && t.endsWith("}");
    if (!braced && ([...t].length > LOOKUP_CHARS || /^[{<[]/.test(t))) return false;
    if (t === "\\") return false;
    const got = this.dictionary.get(t);
    return got !== undefined && sameBytes(got, e.bytes);
  }

  /** 本文のバイト列（終端を含まない）を `.string` の本文にする。 */
  decode(body: Uint8Array): string {
    let out = "";
    let at = 0;
    while (at < body.length) {
      const code = body[at]!;
      if (code === 0xfd && at + 1 < body.length) {
        const name = [...SPECIAL_BUFFERS].find(([, b]) => b[1] === body[at + 1])?.[0];
        if (name !== undefined) {
          out += `[${name}]`;
          at += 2;
          continue;
        }
      }
      const hit = this.byFirst.get(code)?.find((e) => matchesAt(body, at, e.bytes));
      if (hit) {
        out += hit.text;
        at += hit.bytes.length;
        continue;
      }
      if (code === KANJI_PREFIX && at + 2 < body.length) {
        out += `<${[...body.subarray(at, at + 3)].map(hex2).join(" ")}>`;
        at += 3;
        continue;
      }
      out += `[${hex2(code)}]`;
      at++;
    }
    // 隣の字とつながって別の定義になるなど、元に戻らないときは全部 16 進にする。
    const back = this.tryEncode(out);
    return back && sameBytes(back, body) ? out : [...body].map((b) => `[${hex2(b)}]`).join("");
  }

  /** `.string` の本文をバイト列にする（終端は付けない）。string.py と同じ読み方で、読めない書き方は DataError。 */
  encode(text: string): Uint8Array {
    const out: number[] = [];
    for (const part of this.parts(text, false)) out.push(...part.bytes!);
    return Uint8Array.from(out);
  }

  /**
   * `.string` の本文を、字（か `[名前]` などのまとまり）ごとのバイト列にする。書けない字は `bytes` を null にして続ける
   * （再生のメッセージで、読めない字を確認用のフォントで補うため）。`[RED]` などの色・待ちの名前も string.py と同じく書く。
   */
  encodeParts(text: string): ScriptTextPart[] {
    return this.parts(text, true);
  }

  private parts(text: string, lenient: boolean): ScriptTextPart[] {
    const out: ScriptTextPart[] = [];
    let i = 0;
    const fail = (message: string, length: number): void => {
      if (!lenient) throw new DataError(message);
      const end = Math.min(text.length, i + Math.max(1, length));
      out.push({ text: text.slice(i, end), bytes: null });
      i = end;
    };
    while (i < text.length) {
      const c = text[i]!;
      if (c === "{") {
        const close = text.indexOf("}", i);
        if (close < 0) { fail("{ が閉じていません", 1); continue; }
        const bytes = this.dictionary.get(text.slice(i, close + 1));
        if (!bytes) { fail(`知らない名前です: ${text.slice(i, close + 1)}`, close + 1 - i); continue; }
        out.push({ text: text.slice(i, close + 1), bytes });
        i = close + 1;
        continue;
      }
      if (c === "<") {
        const close = text.indexOf(">", i);
        if (close < 0) { fail("< が閉じていません", 1); continue; }
        const bytes: number[] = [];
        const bad = text.slice(i + 1, close).trim().split(/\s+/).find((h) => !/^[0-9A-Fa-f]+$/.test(h));
        if (bad !== undefined) { fail(`16 進ではありません: ${bad}`, close + 1 - i); continue; }
        for (const h of text.slice(i + 1, close).trim().split(/\s+/)) bytes.push(parseInt(h, 16) & 0xff);
        out.push({ text: text.slice(i, close + 1), bytes });
        i = close + 1;
        continue;
      }
      let matched = false;
      for (let len = LOOKUP_CHARS; len >= 1; len--) {
        const bytes = this.dictionary.get(text.slice(i, i + len));
        if (bytes && i + len <= text.length) {
          out.push({ text: text.slice(i, i + len), bytes });
          i += len;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      if (c === "[") {
        const close = text.indexOf("]", i);
        if (close < 0) { fail("[ が閉じていません", 1); continue; }
        const inner = text.slice(i + 1, close);
        const special = SPECIAL_BUFFERS.get(inner) ?? ENCODE_ONLY_BUFFERS.get(inner);
        if (special) out.push({ text: text.slice(i, close + 1), bytes: special });
        else if (/^[0-9A-Fa-f]{1,2}$/.test(inner)) out.push({ text: text.slice(i, close + 1), bytes: [parseInt(inner, 16)] });
        else { fail(`知らない [ ] の名前です: ${inner}`, close + 1 - i); continue; }
        i = close + 1;
        continue;
      }
      if (c === "\\") {
        const bytes = this.dictionary.get(text.slice(i, i + 2));
        if (!bytes) { fail(`知らない \\ の書き方です: ${text.slice(i, i + 2)}`, 2); continue; }
        out.push({ text: text.slice(i, i + 2), bytes });
        i += 2;
        continue;
      }
      fail(`使えない文字です: ${JSON.stringify(c)}`, (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1);
    }
    return out;
  }

  private tryEncode(text: string): Uint8Array | null {
    try {
      return this.encode(text);
    } catch {
      return null;
    }
  }
}

let japaneseCache: ScriptTextCodec | undefined;

function matchesAt(bytes: Uint8Array, at: number, pattern: readonly number[]): boolean {
  if (at + pattern.length > bytes.length) return false;
  for (let i = 0; i < pattern.length; i++) if (bytes[at + i] !== pattern[i]) return false;
  return true;
}

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
