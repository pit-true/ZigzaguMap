import { writeIndentedJson, type BochiJsonValue } from "./BochiJson.js";
import { asRecord, parseJsonObject, readInt } from "./jsonRead.js";
import { ProjectFormatError } from "./ProjectFormatError.js";
import { readTextIfExists, type ProjectFs } from "./ProjectFs.js";
import { PARTY_FLAG_CUSTOM_MOVES, PARTY_FLAG_HAS_ITEM, TRAINER_ID_MAX, type TrainerData, type TrainerMon } from "../trainer/TrainerTable.js";

/**
 * `maps\trainers.json`: ZigzaguMap で足した・変えたトレーナー（#245）。ZigzaguMap は ROM へ書かないので、
 * ビルドで `scripts/map_project.py`（build-support のパッチを当てたもの）が ROM のトレーナーの表へ当てる（`rom_erase.json` と同じ考え方）。
 *
 * 形（Bochi の maps\ の JSON と同じ整形。2 空白の字下げ、CRLF、ASCII 以外は `\uXXXX`）:
 * ```json
 * { "Format": 1, "Trainers": [
 *   { "Id": 700, "Label": "EventScript_Route1_Trainer1", "PartyFlags": 0, "Class": 3, "Music": 4, "Female": false, "Pic": 12,
 *     "Name": "タロウ", "Items": [0, 0, 0, 0], "DoubleBattle": false, "AiFlags": 1,
 *     "Party": [{ "Iv": 0, "Level": 9, "Species": 10 }, { "Iv": 0, "Level": 8, "Species": 13, "HeldItem": 0, "Moves": [33, 81, 0, 0] }] }
 * ] }
 * ```
 * - `Id` は表の番号（1〜767。743 以上はビルドが表を広げる）。同じ `Id` は 1 つだけ。
 * - `Name` は 5 文字まで（ビルドが `charmap.tbl` で変える）。`PartyFlags` の bit0 は技あり（`Moves`）、bit1 は持ち物あり（`HeldItem`）。
 * - `Label` は記録用（そのトレーナーを置いたスクリプト）。知らない項目は残す。
 */

export { TRAINERS_JSON_PATH } from "./paths.js";
import { TRAINERS_JSON_PATH } from "./paths.js";
export const TRAINERS_JSON_FORMAT = 1;
/** 手持ちの数の上限。 */
export const TRAINER_PARTY_MAX = 6;

/** trainers.json の 1 件（TrainerData と記録用のラベル・知らない項目）。 */
export interface TrainerEntry extends TrainerData {
  label?: string;
  extra?: Record<string, unknown>;
}

const KNOWN_TOP = new Set(["Format", "Trainers"]);
const KNOWN = new Set(["Id", "Label", "PartyFlags", "Class", "Music", "Female", "Pic", "Name", "Items", "DoubleBattle", "AiFlags", "Party"]);

function rest(obj: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!known.has(k)) out[k] = v;
  return out;
}

function intList(value: unknown, n: number, what: string, path: string): number[] {
  if (!Array.isArray(value) || value.length !== n || value.some((x) => !Number.isInteger(x) || x < 0 || x > 0xffff)) {
    throw new ProjectFormatError(`${what} は 0〜0xFFFF の整数 ${n} つの配列でなければなりません`, path);
  }
  return value as number[];
}

/** 1 件を確かめる（ファイルを読むときとコマンドで使う）。違えば Error。 */
export function checkTrainerEntry(t: TrainerData, path = TRAINERS_JSON_PATH): void {
  const bad = (m: string): never => {
    throw new ProjectFormatError(`トレーナー ${t.id}: ${m}`, path);
  };
  if (!Number.isInteger(t.id) || t.id < 1 || t.id > TRAINER_ID_MAX) bad(`番号は 1〜${TRAINER_ID_MAX} でなければなりません`);
  for (const [k, v, max] of [
    ["PartyFlags", t.partyFlags, 3],
    ["Class", t.trainerClass, 0xff],
    ["Music", t.music, 0x7f],
    ["Pic", t.pic, 0xff],
  ] as const) {
    if (!Number.isInteger(v) || v < 0 || v > max) bad(`${k} は 0〜${max} でなければなりません`);
  }
  if ([...t.name].length > 5) bad("名前は 5 文字まで");
  if (t.items.length !== 4) bad("持ち物は 4 つ");
  if (t.party.length < 1 || t.party.length > TRAINER_PARTY_MAX) bad(`手持ちは 1〜${TRAINER_PARTY_MAX} 匹`);
  t.party.forEach((m, i) => {
    if (!Number.isInteger(m.species) || m.species < 1 || m.species > 0xffff) bad(`手持ち ${i + 1} の種族が不正です`);
    if (!Number.isInteger(m.level) || m.level < 1 || m.level > 100) bad(`手持ち ${i + 1} のレベルは 1〜100`);
    if ((t.partyFlags & PARTY_FLAG_CUSTOM_MOVES) !== 0 && m.moves?.length !== 4) bad(`手持ち ${i + 1} の技は 4 つ`);
  });
}

/** 読む。形が違えば ProjectFormatError。 */
export function parseTrainersJson(text: string, path = TRAINERS_JSON_PATH): { trainers: TrainerEntry[]; extra: Record<string, unknown> } {
  const root = parseJsonObject(text, path);
  const format = readInt(root, "Format", path, TRAINERS_JSON_FORMAT);
  if (format !== TRAINERS_JSON_FORMAT) throw new ProjectFormatError(`Format ${format} には対応していません（${TRAINERS_JSON_FORMAT} だけ）`, path);
  const list = root["Trainers"] ?? [];
  if (!Array.isArray(list)) throw new ProjectFormatError("Trainers は配列でなければなりません", path);
  const seen = new Set<number>();
  const trainers = list.map((raw, i): TrainerEntry => {
    const o = asRecord(raw, `Trainers[${i}]`, path);
    const flags = readInt(o, "PartyFlags", path, 0);
    const partyRaw = o["Party"];
    if (!Array.isArray(partyRaw)) throw new ProjectFormatError(`Trainers[${i}].Party は配列でなければなりません`, path);
    const party = partyRaw.map((p, j): TrainerMon => {
      const m = asRecord(p, `Trainers[${i}].Party[${j}]`, path);
      const mon: TrainerMon = { iv: readInt(m, "Iv", path, 0), level: readInt(m, "Level", path), species: readInt(m, "Species", path) };
      if (flags & PARTY_FLAG_HAS_ITEM) mon.heldItem = readInt(m, "HeldItem", path, 0);
      if (flags & PARTY_FLAG_CUSTOM_MOVES) mon.moves = intList(m["Moves"] ?? [0, 0, 0, 0], 4, `Trainers[${i}].Party[${j}].Moves`, path);
      return mon;
    });
    const name = o["Name"];
    const t: TrainerEntry = {
      id: readInt(o, "Id", path),
      partyFlags: flags,
      trainerClass: readInt(o, "Class", path, 0),
      music: readInt(o, "Music", path, 0),
      female: o["Female"] === true,
      pic: readInt(o, "Pic", path, 0),
      name: typeof name === "string" ? name : "",
      items: intList(o["Items"] ?? [0, 0, 0, 0], 4, `Trainers[${i}].Items`, path),
      doubleBattle: o["DoubleBattle"] === true,
      aiFlags: readInt(o, "AiFlags", path, 0),
      party,
    };
    if (typeof o["Label"] === "string") t.label = o["Label"];
    const extra = rest(o, KNOWN);
    if (Object.keys(extra).length > 0) t.extra = extra;
    checkTrainerEntry(t, path);
    if (seen.has(t.id)) throw new ProjectFormatError(`トレーナー ${t.id} が 2 つあります`, path);
    seen.add(t.id);
    return t;
  });
  return { trainers, extra: rest(root, KNOWN_TOP) };
}

/** 書く（番号の順。Bochi と同じ整形）。 */
export function stringifyTrainersJson(trainers: readonly TrainerEntry[], extra: Record<string, unknown> = {}): string {
  const list = [...trainers]
    .sort((a, b) => a.id - b.id)
    .map((t) => {
      const o: Record<string, BochiJsonValue> = { Id: t.id };
      if (t.label !== undefined) o["Label"] = t.label;
      Object.assign(o, {
        PartyFlags: t.partyFlags,
        Class: t.trainerClass,
        Music: t.music,
        Female: t.female,
        Pic: t.pic,
        Name: t.name,
        Items: [...t.items],
        DoubleBattle: t.doubleBattle,
        AiFlags: t.aiFlags,
        Party: t.party.map((m) => {
          const p: Record<string, BochiJsonValue> = { Iv: m.iv, Level: m.level, Species: m.species };
          if (t.partyFlags & PARTY_FLAG_HAS_ITEM) p["HeldItem"] = m.heldItem ?? 0;
          if (t.partyFlags & PARTY_FLAG_CUSTOM_MOVES) p["Moves"] = [...(m.moves ?? [0, 0, 0, 0])];
          return p;
        }),
      });
      for (const [k, v] of Object.entries(t.extra ?? {})) o[k] = v as BochiJsonValue;
      return o;
    });
  const root: Record<string, BochiJsonValue> = { Format: TRAINERS_JSON_FORMAT, Trainers: list };
  for (const [k, v] of Object.entries(extra)) root[k] = v as BochiJsonValue;
  return writeIndentedJson(root);
}

/** 1 件を写す（コマンドの控え用）。 */
export function cloneTrainer<T extends TrainerData>(t: T): T {
  return JSON.parse(JSON.stringify(t)) as T;
}

/**
 * プロジェクトのトレーナー（`maps\trainers.json`）。開いたときに読み（無ければ空）、出力のときに書く（中身が変わったときだけ）。
 * 1 件も無くなったらファイルを消す（知らない項目があれば空の Trainers で残す）。
 */
export class TrainersProject {
  private list: TrainerEntry[];
  private savedText: string | null;

  private constructor(
    list: TrainerEntry[],
    private readonly extra: Record<string, unknown>,
    savedText: string | null,
    readonly loadError: string | null,
  ) {
    this.list = list;
    this.savedText = savedText;
  }

  /** 読む。`fs` が null（素の ROM だけ）なら空。読めなければ `loadError` を持ち、編集も上書きもしない。 */
  static async open(fs: ProjectFs | null): Promise<TrainersProject> {
    const text = fs ? await readTextIfExists(fs, TRAINERS_JSON_PATH) : null;
    if (text === null) return new TrainersProject([], {}, null, null);
    try {
      const file = parseTrainersJson(text);
      const p = new TrainersProject(file.trainers, file.extra, null, null);
      p.savedText = p.text();
      return p;
    } catch (e) {
      return new TrainersProject([], {}, text, e instanceof Error ? e.message : String(e));
    }
  }

  /** 中身から作る（テスト用）。 */
  static of(trainers: TrainerEntry[]): TrainersProject {
    const p = new TrainersProject(trainers.map(cloneTrainer), {}, null, null);
    p.savedText = p.text();
    return p;
  }

  get trainers(): readonly TrainerEntry[] {
    return this.list;
  }

  get(id: number): TrainerEntry | undefined {
    return this.list.find((t) => t.id === id);
  }

  /** 足すか置き換える（読めなかったファイルなら Error）。 */
  set(t: TrainerEntry): void {
    this.writable();
    checkTrainerEntry(t);
    this.list = [...this.list.filter((x) => x.id !== t.id), cloneTrainer(t)];
  }

  /** 消す。 */
  remove(id: number): void {
    this.writable();
    this.list = this.list.filter((x) => x.id !== id);
  }

  private writable(): void {
    if (this.loadError !== null) throw new Error(`${TRAINERS_JSON_PATH} が読めないので変えられません: ${this.loadError}`);
  }

  private text(): string | null {
    if (this.list.length === 0 && Object.keys(this.extra).length === 0) return null;
    return stringifyTrainersJson(this.list, this.extra);
  }

  isModified(): boolean {
    return this.loadError === null && this.text() !== this.savedText;
  }

  async save(fs: ProjectFs): Promise<{ written: string[]; removed: string[] }> {
    if (!this.isModified()) return { written: [], removed: [] };
    const text = this.text();
    if (text === null) {
      await fs.remove(TRAINERS_JSON_PATH);
      this.savedText = null;
      return { written: [], removed: [TRAINERS_JSON_PATH] };
    }
    await fs.writeText(TRAINERS_JSON_PATH, text);
    this.savedText = text;
    return { written: [TRAINERS_JSON_PATH], removed: [] };
  }
}
