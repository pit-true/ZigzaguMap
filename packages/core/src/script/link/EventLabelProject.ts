import type { Command } from "../../command/Command.js";
import type { CommandBus, CommandEvent } from "../../command/CommandBus.js";
import { flattenCommandRecords } from "../../command/CommandGroup.js";
import type { MapId } from "../../map/types.js";
import { readTextIfExists, type ProjectFs } from "../../project/ProjectFs.js";
import { listBankFiles } from "../../project/paths.js";
import { EVENT_SCRIPTS_PATH } from "../project/EventScriptsFile.js";
import { EventLabelStore, type EventLabelSavePlan, type EventLabelSnapshot, type EventLabelTarget, type EventPositions } from "./EventLabelStore.js";
import { parseMapLabelsPath } from "./MapLabelsJson.js";

/** イベントの数（人・看板・スクリプトタイル）。 */
export type EventLabelCounts = Readonly<Record<EventLabelTarget, number>>;

/** 新しく置いたイベント（ひな形を書く相手）。 */
export interface AddedEvents {
  readonly map: MapId;
  readonly target: EventLabelTarget;
  /** 増えた番号（`from` から `to - 1` まで）。 */
  readonly from: number;
  readonly to: number;
}

/** 付け直しのときに呼ぶもの。 */
export interface EventLabelTrackHooks {
  /** マップの今のイベントの数（読み込んでいなければ null）。 */
  counts(map: MapId): EventLabelCounts | null;
  /**
   * イベントが増えた（置いた・数を増やした。やり直しでも呼ぶ）。ここで `store.set` したラベルは、
   * 増やしたコマンドを取り消したときに一緒に戻る。`command` は増やしたコマンド（控えのキーに使える）。
   */
  added?(events: AddedEvents, command: Command): void;
  /** 増やしたコマンドを取り消した（ラベルはもう戻してある）。 */
  undone?(command: Command): void;
}

const TARGET_OF_KIND: Readonly<Record<string, EventLabelTarget | undefined>> = { person: "person", sign: "sign", trap: "tile" };
const COUNT_KEYS: readonly [string, EventLabelTarget][] = [
  ["persons", "person"],
  ["signs", "sign"],
  ["traps", "tile"],
];

/** 番号を付け直すコマンド。 */
const TRACKED = new Set(["removeEvent", "setEventCounts", "addEvent", "duplicateEvent"]);

function mapKey(id: MapId): string {
  return `${id.bank}.${id.map}`;
}

/**
 * プロジェクトのイベントのラベル。開いたときに eventscripts と `maps/BB/scripts_MM.json` をすべて読み、
 * 出力のときに書く。イベントを消す・数を変えるコマンド（`removeEvent`・`setEventCounts`・`addEvent`）に合わせて、
 * ラベルの番号を付け直す（取り消すと戻る）。
 */
export class EventLabelProject {
  /** 付け直す前の控え（取り消し用。コマンドごと）。 */
  private readonly before = new WeakMap<Command, { labels: EventLabelSnapshot; counts: Map<string, EventLabelCounts> }>();
  /** 知っているイベントの数（増えた分を見つけるため）。 */
  private counts = new Map<string, EventLabelCounts>();

  private constructor(readonly store: EventLabelStore) {}

  /** 読む。`fs` が null（素の ROM だけ）なら空。 */
  static async open(fs: ProjectFs | null): Promise<EventLabelProject> {
    if (!fs) return new EventLabelProject(new EventLabelStore(""));
    const scripts = (await readTextIfExists(fs, EVENT_SCRIPTS_PATH)) ?? "";
    const files: { path: string; text: string }[] = [];
    for (const { path } of await listBankFiles(fs)) {
      if (parseMapLabelsPath(path)) files.push({ path, text: await fs.readText(path) });
    }
    return new EventLabelProject(new EventLabelStore(scripts, files));
  }

  /** 読んだ内容から作る（テスト用）。 */
  static of(store: EventLabelStore): EventLabelProject {
    return new EventLabelProject(store);
  }

  /** マップのイベントの数を覚える（マップを開いたとき）。`positions` は読んだときのイベントの座標（照合用。初めて開いたときだけ使う）。 */
  observe(map: MapId, counts: EventLabelCounts, positions?: EventPositions): void {
    this.counts.set(mapKey(map), counts);
    if (positions) this.store.noteLoaded(map.bank, map.map, positions);
  }

  /** CommandBus の出来事を見て、ラベルの番号を付け直す。戻り値で見るのをやめる。 */
  track(bus: CommandBus, hooks: EventLabelTrackHooks): () => void {
    return bus.subscribe((e) => this.onEvent(e, hooks));
  }

  private onEvent(e: CommandEvent, hooks: EventLabelTrackHooks): void {
    const command = e.command;
    if (!command) {
      if (e.type === "clear") this.counts = new Map();
      return;
    }
    if (e.type === "undo") {
      const saved = this.before.get(command);
      if (!saved) return;
      this.store.restore(saved.labels);
      this.counts = new Map(saved.counts);
      hooks.undone?.(command);
      return;
    }
    const records = flattenCommandRecords(command).filter((r) => TRACKED.has(r.name));
    if (records.length === 0) return;
    this.before.set(command, { labels: this.store.snapshot(), counts: new Map(this.counts) });
    const added: AddedEvents[] = [];
    // 1 回の操作でいくつも足したとき（複製。#399）は、足した順に末尾の番号を割り当てる
    const adds = new Map<string, number>();
    for (const r of records) {
      if (r.name !== "addEvent" && r.name !== "duplicateEvent") continue;
      const a = r.args as Record<string, unknown>;
      const k = `${String(a["bank"])}.${String(a["map"])}.${String(a["kind"])}`;
      adds.set(k, (adds.get(k) ?? 0) + 1);
    }
    const addedSoFar = new Map<string, number>();
    for (const r of records) {
      const a = r.args as Record<string, unknown>;
      const id = { bank: Number(a["bank"]), map: Number(a["map"]) };
      const known = this.counts.get(mapKey(id)) ?? null;
      const now = hooks.counts(id);
      if (r.name === "removeEvent") {
        const target = TARGET_OF_KIND[String(a["kind"])];
        if (target) this.store.removeAt(id.bank, id.map, target, Number(a["index"]));
      } else if (r.name === "setEventCounts") {
        for (const [k, target] of COUNT_KEYS) {
          const n = a[k];
          if (typeof n !== "number") continue;
          this.store.truncate(id.bank, id.map, target, n);
          if (known && n > known[target]) added.push({ map: id, target, from: known[target], to: n });
        }
      } else {
        const target = TARGET_OF_KIND[String(a["kind"])];
        const k = `${id.bank}.${id.map}.${String(a["kind"])}`;
        const n = addedSoFar.get(k) ?? 0;
        addedSoFar.set(k, n + 1);
        if (target && now) {
          const index = now[target] - (adds.get(k) ?? 1) + n;
          if (r.name === "duplicateEvent") {
            // 複製は元のイベントと同じラベル（同じスクリプト）を使う。ラベルが無ければ付けない（元と同じポインタのまま）
            const source = this.store.label(id.bank, id.map, target, Number(a["index"]));
            if (source) this.store.set(id.bank, id.map, target, index, { ...source });
          } else added.push({ map: id, target, from: index, to: index + 1 });
        }
      }
      if (now) this.counts.set(mapKey(id), now);
    }
    for (const x of added) hooks.added?.(x, command);
  }

  /** 出力していない変更があるか。 */
  isModified(): boolean {
    return this.store.isModified();
  }

  /**
   * 出力する（ラベルのファイルと eventscripts）。`.s` の表の書き直しは計画の `tables` に入れて返す（書くのは呼ぶ側）。
   * 戻り値は書いたパスと消したパスと計画。
   */
  async save(fs: ProjectFs, positions: (bank: number, map: number) => EventPositions | null): Promise<{ written: string[]; removed: string[]; plan: EventLabelSavePlan }> {
    const plan = this.store.planSave(positions);
    const written: string[] = [];
    const removed: string[] = [];
    for (const f of plan.files) {
      if (f.text === null) {
        await fs.remove(f.path);
        removed.push(f.path);
      } else {
        await fs.writeText(f.path, f.text);
        written.push(f.path);
      }
    }
    if (plan.eventScripts !== null) {
      await fs.writeText(EVENT_SCRIPTS_PATH, plan.eventScripts);
      written.push(EVENT_SCRIPTS_PATH);
    }
    this.store.markSaved(plan);
    return { written, removed, plan };
  }
}
