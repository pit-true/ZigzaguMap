import { ROM_BASE, type Rom } from "../rom/Rom.js";
import { TextCodec } from "../name/TextCodec.js";

/**
 * ROM のトレーナーの表（#244）。CFRU は表を C で持たず、`gTrainers` を ROM の 0x0800F5C0 にあるポインタから読む
 * （ND・Chronos とも `src/defines_battle.h`）。素の FR（日本語版）は 743 件（0〜742）、1 件 0x20 バイト。
 *
 * 1 件の形（日本語版。`include/battle.h` の struct Trainer を日本語版の名前の長さで並べたもの）:
 * | 位置 | 大きさ | 中身 |
 * |---|---|---|
 * | 0x00 | 1 | 手持ちの形式（bit0 技あり、bit1 持ち物あり） |
 * | 0x01 | 1 | クラス |
 * | 0x02 | 1 | BGM（下位 7 ビット）と性別（最上位ビット。1 が女性） |
 * | 0x03 | 1 | 絵 |
 * | 0x04 | 6 | 名前（5 文字 + 0xFF） |
 * | 0x0A | 8 | 持ち物 4 つ（u16） |
 * | 0x12 | 1 | ダブルバトル |
 * | 0x14 | 4 | AI |
 * | 0x18 | 1 | 手持ちの数 |
 * | 0x1C | 4 | 手持ちへのポインタ |
 *
 * 手持ち 1 匹は、形式 0 と 2 が 8 バイト（個体値・レベル・種族・持ち物か 0）、1 と 3 が 16 バイト（個体値・レベル・種族・持ち物か 0・技 4 つ）。
 */

/** `gTrainers` へのポインタの位置（ROM の中の位置）。 */
export const TRAINER_TABLE_POINTER = 0xf5c0;
/** `gTrainerClassNames` へのポインタの位置（1 件 11 バイト）。 */
export const TRAINER_CLASS_NAMES_POINTER = 0x11bcf0;
/** 素の FR のトレーナーの数（0〜742）。 */
export const TRAINER_COUNT = 743;
/** 戦ったかどうかのフラグ（0x500 + 番号）がシステムのフラグ（0x800〜）と重ならない番号の上限（表を広げられるのは 767 まで）。 */
export const TRAINER_ID_MAX = 767;
/** 1 件のバイト数。 */
export const TRAINER_SIZE = 0x20;
/** 名前のバイト数（5 文字 + 終端）。 */
export const TRAINER_NAME_BYTES = 6;
/** クラス名 1 件のバイト数。 */
export const TRAINER_CLASS_NAME_BYTES = 11;
/** 素の FR のクラスの数。 */
export const TRAINER_CLASS_COUNT = 107;

/** 手持ちの形式のビット。 */
export const PARTY_FLAG_CUSTOM_MOVES = 0x1;
export const PARTY_FLAG_HAS_ITEM = 0x2;

/** 手持ち 1 匹。 */
export interface TrainerMon {
  iv: number;
  level: number;
  species: number;
  /** 持ち物（形式に持ち物が無いときは省く）。 */
  heldItem?: number;
  /** 技 4 つ（形式に技が無いときは省く）。 */
  moves?: number[];
}

/** トレーナー 1 件。 */
export interface TrainerData {
  id: number;
  partyFlags: number;
  trainerClass: number;
  music: number;
  female: boolean;
  pic: number;
  /** 名前（文字コード表で読んだもの）。 */
  name: string;
  items: number[];
  doubleBattle: boolean;
  aiFlags: number;
  party: TrainerMon[];
}

/** 手持ち 1 匹のバイト数（形式で決まる）。 */
export function trainerMonSize(partyFlags: number): number {
  return partyFlags & PARTY_FLAG_CUSTOM_MOVES ? 16 : 8;
}

const u16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** 0x20 バイトと手持ちのバイト列から読む（手持ちは読めた分だけ）。 */
export function decodeTrainer(id: number, entry: Uint8Array, partyBytes: Uint8Array | null, codec: TextCodec): TrainerData {
  const flags = entry[0]!;
  const size = entry[0x18]!;
  const party: TrainerMon[] = [];
  const monSize = trainerMonSize(flags);
  if (partyBytes) {
    for (let i = 0; i < size && (i + 1) * monSize <= partyBytes.length; i++) {
      const o = i * monSize;
      const mon: TrainerMon = { iv: u16(partyBytes, o), level: u16(partyBytes, o + 2), species: u16(partyBytes, o + 4) };
      if (flags & PARTY_FLAG_HAS_ITEM) mon.heldItem = u16(partyBytes, o + 6);
      if (flags & PARTY_FLAG_CUSTOM_MOVES) mon.moves = [0, 1, 2, 3].map((m) => u16(partyBytes, o + 8 + m * 2));
      party.push(mon);
    }
  }
  return {
    id,
    partyFlags: flags,
    trainerClass: entry[1]!,
    music: entry[2]! & 0x7f,
    female: (entry[2]! & 0x80) !== 0,
    pic: entry[3]!,
    name: codec.decode(entry.subarray(4, 4 + TRAINER_NAME_BYTES)),
    items: [0, 1, 2, 3].map((i) => u16(entry, 0x0a + i * 2)),
    doubleBattle: entry[0x12]! !== 0,
    aiFlags: u32(entry, 0x14),
    party,
  };
}

/** 一覧の 1 行（画面と自動操作の `trainer.list`）。 */
export interface TrainerSummary {
  readonly id: number;
  readonly trainerClass: number;
  readonly className: string;
  readonly name: string;
  readonly partySize: number;
  readonly party: readonly { readonly species: number; readonly level: number }[];
}

/**
 * ROM のトレーナーの表を読む。表の位置は `*(0x0800F5C0)`、クラス名は `*(0x0811BCF0)`。
 * 書き換えは ZigzaguMap では行わない（#245 の `maps\trainers.json` をビルドが当てる）。
 */
export class TrainerTable {
  private readonly cache = new Map<number, TrainerData>();

  private constructor(
    private readonly rom: Rom,
    /** 表の位置（ROM の中）。 */
    readonly offset: number,
    readonly count: number,
    private readonly classNamesOffset: number | null,
    private readonly codec: TextCodec,
  ) {}

  /** ROM から読む（表の位置が ROM の外なら Error）。 */
  static read(rom: Rom, codec: TextCodec = TextCodec.japanese, count = TRAINER_COUNT): TrainerTable {
    const offset = rom.pointer(TRAINER_TABLE_POINTER);
    if (!rom.inRange(offset, count * TRAINER_SIZE)) throw new Error(`トレーナーの表が ROM の外です: 0x${(offset + ROM_BASE).toString(16)}`);
    let names: number | null = null;
    try {
      const n = rom.pointer(TRAINER_CLASS_NAMES_POINTER);
      names = rom.inRange(n, TRAINER_CLASS_COUNT * TRAINER_CLASS_NAME_BYTES) ? n : null;
    } catch {
      names = null;
    }
    return new TrainerTable(rom, offset, count, names, codec);
  }

  /** 1 件の 0x20 バイト。 */
  entryBytes(id: number): Uint8Array {
    return this.rom.slice(this.offset + id * TRAINER_SIZE, TRAINER_SIZE);
  }

  /** 1 件（番号が表の外なら null）。 */
  get(id: number): TrainerData | null {
    if (!Number.isInteger(id) || id < 0 || id >= this.count) return null;
    const hit = this.cache.get(id);
    if (hit) return hit;
    const entry = this.entryBytes(id);
    const pointer = u32(entry, 0x1c);
    const size = entry[0x18]! * trainerMonSize(entry[0]!);
    const at = pointer - ROM_BASE;
    const party = pointer >= ROM_BASE && size > 0 && this.rom.inRange(at, size) ? this.rom.slice(at, size) : null;
    const t = decodeTrainer(id, entry, party, this.codec);
    this.cache.set(id, t);
    return t;
  }

  /** クラス名（読めなければ空）。 */
  className(trainerClass: number): string {
    if (this.classNamesOffset === null || trainerClass < 0 || trainerClass >= TRAINER_CLASS_COUNT) return "";
    return this.codec.decode(this.rom.slice(this.classNamesOffset + trainerClass * TRAINER_CLASS_NAME_BYTES, TRAINER_CLASS_NAME_BYTES));
  }

  /** 全件の一覧（0 番の「無し」を除く）。 */
  list(): TrainerSummary[] {
    const out: TrainerSummary[] = [];
    for (let id = 1; id < this.count; id++) {
      const t = this.get(id)!;
      out.push(summaryOf(t, this.className(t.trainerClass)));
    }
    return out;
  }
}

/** 一覧の 1 行にする。 */
export function summaryOf(t: TrainerData, className: string): TrainerSummary {
  return {
    id: t.id,
    trainerClass: t.trainerClass,
    className,
    name: t.name,
    partySize: t.party.length,
    party: t.party.map((m) => ({ species: m.species, level: m.level })),
  };
}
