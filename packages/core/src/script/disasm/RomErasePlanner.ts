import { ROM_BASE, type Rom } from "../../rom/Rom.js";
import type { RomEraseType } from "../../project/RomEraseJson.js";
import type { DisasmCommandSet } from "./DisasmCommandSet.js";
import { disassembleScripts } from "./ScriptDisassembler.js";
import type { ScriptTextCodec } from "./scriptText.js";

/**
 * 素の ROM にあるイベントのスクリプトを消すとき、ビルドで 0xFF で埋める範囲の計画（#220）。
 *
 * 1. 入口から逆アセンブルし（取り込みと同じ ScriptDisassembler）、スクリプトのまとまり・文字列（0F・msgbox・trainerbattle など）・
 *    移動データ（4F など）・ショップの一覧を、たどった範囲（長さは逆アセンブルの結果）として集める。
 * 2. ROM 全体の 4 バイトごと（どの位置からでも）を読み、範囲の先頭か内側を指すポインタを探す。埋める範囲の中にあるポインタと、
 *    `ignore`（消すイベントのマップの元のイベント表など）にあるポインタは数えない。それ以外から指されている範囲は埋めない。
 * 3. `references`（プロジェクトのマップの JSON・開いているマップのイベント・`.s` に書いたアドレスなど）が指す範囲、
 *    `protect`（プロジェクトが上書きする領域、CFRU の挿入先）と重なる範囲、もう記録してある範囲も埋めない。
 * 4. 埋めないと決めた範囲の中のポインタは「ほかから指している」に変わるので、決まるまで 2・3 を繰り返す。
 */

/** 埋める候補の範囲（ROM の中の位置。ファイルの先頭から）。 */
export interface RomEraseSpan {
  readonly offset: number;
  readonly length: number;
  readonly type: RomEraseType;
  /** 逆アセンブルで付けた名前（`ROM_08XXXXXX`）。 */
  readonly label: string;
}

/** 埋めない理由。 */
export type RomEraseBlockReason =
  /** ROM のほかの場所のポインタが指している（`at` はポインタの位置）。 */
  | { readonly kind: "pointer"; readonly at: number }
  /** プロジェクトのほかのもの（マップの JSON のイベントなど）が指している。 */
  | { readonly kind: "reference"; readonly where: string }
  /** プロジェクトが上書きする領域と重なる。 */
  | { readonly kind: "protected"; readonly where: string }
  /** もう記録してある。 */
  | { readonly kind: "recorded" }
  /** 埋めない範囲（中のポインタがこの範囲を指す）から指されている。 */
  | { readonly kind: "keptParent"; readonly at: number }
  /** 逆アセンブルで読めない箇所があり、スクリプトかどうか確かめられない（でたらめなポインタなど）。 */
  | { readonly kind: "unreadable" };

/** ROM の先頭のヘッダー（エントリーポイント・ロゴ・ゲームコード）。ここは埋めない。 */
export const ROM_HEADER_SIZE = 0x200;

export interface RomEraseBlocked extends RomEraseSpan {
  readonly reason: RomEraseBlockReason;
}

export interface RomErasePlanOptions {
  readonly commands: DisasmCommandSet;
  readonly text?: ScriptTextCodec;
  /** 数えないポインタの位置（ファイルの位置の範囲。`to` は含まない）。 */
  readonly ignore?: readonly { readonly from: number; readonly to: number }[];
  /** プロジェクトのほかのものが指すアドレス（GBA のアドレス）。 */
  readonly references?: readonly { readonly address: number; readonly where: string }[];
  /** 埋めてはいけない領域（ファイルの位置の範囲）。 */
  readonly protect?: readonly { readonly from: number; readonly to: number; readonly where: string }[];
  /** もう記録してある範囲（GBA のアドレス）。 */
  readonly recorded?: readonly { readonly address: number; readonly length: number }[];
}

export interface RomErasePlan {
  /** 入口（ファイルの位置）。 */
  readonly entry: number;
  readonly erase: readonly RomEraseSpan[];
  readonly keep: readonly RomEraseBlocked[];
  /** 逆アセンブルで読めなかった箇所など。 */
  readonly problems: readonly string[];
}

/** 範囲の候補を集める（位置の順。重なりは除く）。 */
export function romScriptSpans(rom: Rom, entry: number, options: { commands: DisasmCommandSet; text?: ScriptTextCodec }): { spans: RomEraseSpan[]; problems: string[] } {
  const d = disassembleScripts(rom, [{ offset: entry }], options);
  const label = (offset: number) => d.labels.get(offset) ?? `ROM_${(offset + ROM_BASE).toString(16).toUpperCase().padStart(8, "0")}`;
  const spans: RomEraseSpan[] = [
    ...d.blocks.map((b) => ({ offset: b.offset, length: b.end - b.offset, type: "script" as const, label: label(b.offset) })),
    ...d.strings.map((s) => ({ offset: s.offset, length: s.bytes.length + 1, type: "text" as const, label: s.label })),
    ...d.movements.map((m) => ({ offset: m.offset, length: m.steps.length, type: "movement" as const, label: m.label })),
    ...d.marts.map((m) => ({ offset: m.offset, length: m.items.length * 2, type: "mart" as const, label: m.label })),
  ]
    .filter((s) => s.length > 0 && rom.inRange(s.offset, s.length))
    .sort((a, b) => a.offset - b.offset);
  // 重なり（同じ場所を文字列とスクリプトの両方で読んだなど）は先のものだけにする
  const out: RomEraseSpan[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.offset < last.offset + last.length) continue;
    out.push(s);
  }
  const problems = d.problems.map((p) => (p.offset === null ? p.message : `0x${(p.offset + ROM_BASE).toString(16).toUpperCase()}: ${p.message}`));
  return { spans: out, problems };
}

/** ROM の中で、範囲（位置の順で重ならない）のどれかを指すポインタの位置を探す。 */
export function findPointersInto(bytes: Uint8Array, spans: readonly { offset: number; length: number }[]): { at: number; span: number }[] {
  const hits: { at: number; span: number }[] = [];
  if (spans.length === 0) return hits;
  const starts = spans.map((s) => s.offset);
  const lo = Math.min(...starts);
  const hi = Math.max(...spans.map((s) => s.offset + s.length));
  for (let p = 0; p + 3 < bytes.length; p++) {
    const top = bytes[p + 3]!;
    if (top !== 0x08 && top !== 0x09) continue;
    const value = (bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16) | ((top - 0x08) << 24)) >>> 0;
    if (value < lo || value >= hi) continue;
    // 二分探索で、value を含む範囲
    let a = 0;
    let b = spans.length - 1;
    while (a <= b) {
      const m = (a + b) >> 1;
      const s = spans[m]!;
      if (value < s.offset) b = m - 1;
      else if (value >= s.offset + s.length) a = m + 1;
      else {
        hits.push({ at: p, span: m });
        break;
      }
    }
  }
  return hits;
}

/** 計画を作る。入口が ROM の外なら、何も埋めない計画を返す。 */
export function planRomErase(rom: Rom, entry: number, options: RomErasePlanOptions): RomErasePlan {
  if (!rom.inRange(entry) || entry < ROM_HEADER_SIZE) return { entry, erase: [], keep: [], problems: [`0x${(entry + ROM_BASE).toString(16).toUpperCase()} は ROM の外です`] };
  const { spans, problems } = romScriptSpans(rom, entry, options);
  // 読めない箇所があれば、スクリプトでないところ（でたらめなポインタの先など）を読んだかもしれないので、何も埋めない
  if (problems.length > 0) return { entry, erase: [], keep: spans.map((s) => ({ ...s, reason: { kind: "unreadable" } })), problems };
  const hits = findPointersInto(rom.bytes, spans);
  const ignored = (at: number) => (options.ignore ?? []).some((r) => at >= r.from && at + 4 <= r.to);
  const blocked = new Map<number, RomEraseBlockReason>();
  // 動かない理由（ポインタ以外）を先に決める
  for (const [i, s] of spans.entries()) {
    const address = s.offset + ROM_BASE;
    const ref = (options.references ?? []).find((r) => r.address >= address && r.address < address + s.length);
    const prot = (options.protect ?? []).find((r) => s.offset < r.to && r.from < s.offset + s.length);
    const recorded = (options.recorded ?? []).some((r) => r.address <= address && address + s.length <= r.address + r.length);
    if (recorded) blocked.set(i, { kind: "recorded" });
    else if (ref) blocked.set(i, { kind: "reference", where: ref.where });
    else if (prot) blocked.set(i, { kind: "protected", where: prot.where });
  }
  const spanOf = (at: number): number => spans.findIndex((s) => at >= s.offset && at + 4 <= s.offset + s.length);
  for (let changed = true; changed; ) {
    changed = false;
    for (const h of hits) {
      if (blocked.has(h.span) || ignored(h.at)) continue;
      const from = spanOf(h.at);
      // 埋める範囲の中のポインタは数えない（埋めない範囲の中なら、そこから指されている）
      if (from >= 0 && !blocked.has(from)) continue;
      // 記録済みの範囲の中のポインタは、もう埋めると決まっているので数えない
      if (from >= 0 && blocked.get(from)?.kind === "recorded") continue;
      blocked.set(h.span, from >= 0 ? { kind: "keptParent", at: h.at } : { kind: "pointer", at: h.at });
      changed = true;
    }
  }
  return {
    entry,
    erase: spans.filter((_, i) => !blocked.has(i)),
    keep: spans.flatMap((s, i) => (blocked.has(i) ? [{ ...s, reason: blocked.get(i)! }] : [])),
    problems,
  };
}

/**
 * プロジェクトが ROM に上書きする領域（CFRU の bytereplacement・hooks・repoints・routinepointers・functionrewrites・
 * special_inserts.asm の `.org`）と、挿入先（`OFFSET_TO_PUT` から後ろ）。どれもファイルの位置の範囲。
 * 長さが書いていない形（hooks など）は、書き込むものの大きさを多めに見積もる（hooks・functionrewrites 16、ポインタ 4、`.org` 64）。
 */
export function projectOverwriteRegions(files: readonly { readonly name: string; readonly text: string }[], insertOffset: number | null): { from: number; to: number; where: string }[] {
  const out: { from: number; to: number; where: string }[] = [];
  const toOffset = (token: string): number | null => {
    const m = /^(?:0x)?([0-9A-Fa-f]{1,8})$/.exec(token);
    if (!m) return null;
    const v = Number.parseInt(m[1]!, 16);
    return v >= ROM_BASE ? (v - ROM_BASE) & 0x1ffffff : v;
  };
  for (const f of files) {
    const base = f.name.replace(/^.*\//, "");
    for (const [n, raw] of f.text.split(/\r\n|\n|\r/).entries()) {
      const line = raw.replace(/\s*(?:#|\/\/|@).*$/, "").trim();
      if (line === "") continue;
      const where = `${f.name}:${n + 1}`;
      const words = line.split(/\s+/);
      if (base === "special_inserts.asm") {
        const m = /^\.org\s+(\S+)/i.exec(line);
        const at = m ? toOffset(m[1]!) : null;
        if (at !== null) out.push({ from: at, to: at + 64, where });
        continue;
      }
      if (base === "bytereplacement") {
        const at = toOffset(words[0]!);
        if (at !== null) out.push({ from: at, to: at + Math.max(1, words.length - 1), where });
        continue;
      }
      const at = words.length > 1 ? toOffset(words[1]!) : null;
      if (at === null) continue;
      const size = base === "hooks" || base === "functionrewrites" ? 16 : 4;
      out.push({ from: at, to: at + size, where });
    }
  }
  if (insertOffset !== null) out.push({ from: insertOffset, to: 0x2000000, where: `OFFSET_TO_PUT 0x${insertOffset.toString(16).toUpperCase()}` });
  return out;
}
