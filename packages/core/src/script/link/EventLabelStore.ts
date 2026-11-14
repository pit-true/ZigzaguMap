import type { MapScriptTableModel } from "../edit/MapScriptTableText.js";
import { EventScriptsFile, type EventScriptEntry } from "../project/EventScriptsFile.js";
import { eventScriptLabel, eventScriptTargetOf } from "../project/eventScriptKinds.js";
import { mapLabelsFileOf, syncEventScripts } from "./eventLabelOutput.js";
import {
  EVENT_LABEL_TARGETS,
  type EventLabel,
  type EventLabelMismatch,
  type EventLabelSavePlan,
  type EventLabelSnapshot,
  type EventLabelTarget,
  type EventPositions,
  type MapLabels,
} from "./EventLabelTypes.js";
import { MapLabelsJson, mapLabelsPath, type MapLabelEntry, type MapLabelsFile } from "./MapLabelsJson.js";

export {
  EVENT_LABEL_TARGETS,
  type EventLabel,
  type EventLabelMismatch,
  type EventLabelSavePlan,
  type EventLabelSnapshot,
  type EventLabelTarget,
  type EventPosition,
  type EventPositions,
  type MapLabels,
} from "./EventLabelTypes.js";

function key(bank: number, map: number): string {
  return `${bank}.${map}`;
}

function fromKey(k: string): { bank: number; map: number } {
  const [bank, map] = k.split(".").map(Number) as [number, number];
  return { bank, map };
}

function signature(m: MapLabels): string {
  return JSON.stringify(m);
}

function trimNulls<T>(list: readonly (T | null)[]): (T | null)[] {
  const out = list.slice();
  while (out.length > 0 && out[out.length - 1] === null) out.pop();
  return out;
}

function normalize(m: MapLabels): MapLabels {
  return { person: trimNulls(m.person), sign: trimNulls(m.sign), tile: trimNulls(m.tile), mapScripts: m.mapScripts, table: m.table };
}

function isEmpty(m: MapLabels): boolean {
  return m.person.length === 0 && m.sign.length === 0 && m.tile.length === 0 && m.mapScripts === null && m.table === null;
}

/**
 * イベントのラベル（#204 の形）。正本はマップごとのファイル `maps/BB/scripts_MM.json`（ラベルと照合用の座標）で、
 * 出力のときに eventscripts の行（`#ifdef` の外の、そのマップの行）をファイルに合わせて書き直す。
 * ファイルの無いマップは、eventscripts の `#ifdef` の外の行をそのまま読む（変えるまでファイルは作らない）。
 * マップの JSON（MM.json）・Bochi・map_project.py には手を入れない。
 */
export class EventLabelStore {
  private current = new Map<string, MapLabels>();
  /** 読んだ（書いた）ときのラベル（変わったかを調べる）。 */
  private readonly baseline = new Map<string, string>();
  /** 読んだ（書いた）ときのファイル（座標と、書き直すかを調べる）。 */
  private readonly files = new Map<string, { readonly file: MapLabelsFile; readonly text: string }>();
  private scripts: EventScriptsFile;
  private scriptsText: string;
  /** マップを初めて読んだときのイベントの座標（ファイルの座標と合わなかったラベルの座標を、出力で上書きしないため）。 */
  private readonly loadedPositions = new Map<string, EventPositions>();

  constructor(eventScriptsText: string, files: readonly { readonly path: string; readonly text: string }[] = []) {
    this.scriptsText = eventScriptsText;
    this.scripts = EventScriptsFile.parse(eventScriptsText);
    for (const f of files) {
      const file = MapLabelsJson.parse(f.text, f.path);
      const k = key(file.bank, file.map);
      this.files.set(k, { file, text: f.text });
    }
  }

  /** 読んでいる eventscripts（出力の前の内容）。 */
  get eventScripts(): EventScriptsFile {
    return this.scripts;
  }

  /** マップのラベル。 */
  get(bank: number, map: number): MapLabels {
    const k = key(bank, map);
    let m = this.current.get(k);
    if (!m) {
      m = this.initial(bank, map);
      this.current.set(k, m);
      this.baseline.set(k, signature(m));
    }
    return m;
  }

  /** イベント 1 つのラベル（無ければ null）。 */
  label(bank: number, map: number, target: EventLabelTarget, index: number): EventLabel | null {
    return this.get(bank, map)[target][index] ?? null;
  }

  /** `#ifdef` の中にある、そのイベントの eventscripts の行（ZigzaguMap は変えない）。 */
  conditionalEntries(bank: number, map: number, target: EventLabelTarget | "map", index?: number): EventScriptEntry[] {
    return this.scripts.entriesFor(bank, map, target, index).filter((e) => e.conditions.length > 0);
  }

  /** ラベルのファイルがあるマップ。 */
  hasFile(bank: number, map: number): boolean {
    return this.files.has(key(bank, map));
  }

  /** どこかのイベントかマップスクリプトが使っているラベル名。 */
  usedLabels(): Set<string> {
    const out = new Set<string>();
    for (const k of this.allKeys()) {
      const { bank, map } = fromKey(k);
      const m = this.get(bank, map);
      for (const t of EVENT_LABEL_TARGETS) for (const l of m[t]) if (l) out.add(l.label);
      if (m.mapScripts) out.add(m.mapScripts);
      if (m.table) out.add(m.table.label);
    }
    return out;
  }

  /** ZigzaguMap が書く表のあるマップ。 */
  tableMaps(): { bank: number; map: number }[] {
    return [...this.allKeys()].map(fromKey).filter(({ bank, map }) => this.get(bank, map).table !== null);
  }

  /** そのラベルを使っているイベント。 */
  usesOf(label: string): { bank: number; map: number; target: EventLabelTarget | "map"; index: number }[] {
    const out: { bank: number; map: number; target: EventLabelTarget | "map"; index: number }[] = [];
    for (const k of this.allKeys()) {
      const { bank, map } = fromKey(k);
      const m = this.get(bank, map);
      for (const t of EVENT_LABEL_TARGETS) m[t].forEach((l, i) => l?.label === label && out.push({ bank, map, target: t, index: i }));
      if (m.mapScripts === label) out.push({ bank, map, target: "map", index: 0 });
    }
    return out;
  }

  // ---- 変える（コマンドと、イベントの並びの付け直しから呼ぶ） ----

  /** イベント 1 つのラベルを変える（null で外す）。 */
  set(bank: number, map: number, target: EventLabelTarget, index: number, label: EventLabel | null): void {
    const m = this.get(bank, map);
    const list = m[target].slice();
    while (list.length <= index) list.push(null);
    list[index] = label;
    this.put(bank, map, { ...m, [target]: list });
  }

  /** マップスクリプトの表のラベルを変える（表を書かない、手で書いた表を指すとき）。 */
  setMapScripts(bank: number, map: number, label: string | null): void {
    const m = this.get(bank, map);
    this.put(bank, map, { ...m, mapScripts: label, table: m.table && m.table.label === label ? m.table : null });
  }

  /** ZigzaguMap が書く表を変える（null で表をやめる）。 */
  setTable(bank: number, map: number, table: MapScriptTableModel | null): void {
    const m = this.get(bank, map);
    this.put(bank, map, { ...m, table, mapScripts: table ? table.label : null });
  }

  /** イベントを消したとき: その番号を除き、後ろを詰める。 */
  removeAt(bank: number, map: number, target: EventLabelTarget, index: number): void {
    const m = this.get(bank, map);
    if (index >= m[target].length) return;
    const list = m[target].slice();
    list.splice(index, 1);
    this.put(bank, map, { ...m, [target]: list });
  }

  /** イベントの数を減らしたとき: `count` 以降を除く。 */
  truncate(bank: number, map: number, target: EventLabelTarget, count: number): void {
    const m = this.get(bank, map);
    if (m[target].length <= count) return;
    this.put(bank, map, { ...m, [target]: m[target].slice(0, count) });
  }

  /** 並びを付け直す（`order[新しい番号] = 古い番号`）。 */
  reorder(bank: number, map: number, target: EventLabelTarget, order: readonly number[]): void {
    const m = this.get(bank, map);
    this.put(bank, map, { ...m, [target]: order.map((i) => m[target][i] ?? null) });
  }

  /** ラベル名を変える（すべてのマップのイベントとマップスクリプト、表の行き先）。変えた数を返す。 */
  rename(from: string, to: string): number {
    let count = 0;
    for (const k of this.allKeys()) {
      const { bank, map } = fromKey(k);
      const m = this.get(bank, map);
      let changed = false;
      const swap = (l: EventLabel | null): EventLabel | null => {
        if (l?.label !== from) return l;
        changed = true;
        count++;
        return { ...l, label: to };
      };
      const next: MapLabels = {
        person: m.person.map(swap),
        sign: m.sign.map(swap),
        tile: m.tile.map(swap),
        mapScripts: m.mapScripts === from ? (count++, (changed = true), to) : m.mapScripts,
        table: m.table ? renameInTable(m.table, from, to, () => ((changed = true), count++)) : null,
      };
      if (changed) this.put(bank, map, next);
    }
    return count;
  }

  snapshot(): EventLabelSnapshot {
    return new Map(this.current);
  }

  restore(snapshot: EventLabelSnapshot): void {
    this.current = new Map(snapshot);
  }

  // ---- 照合 ----

  /**
   * マップを読んだときのイベントの座標を覚える（2 回目からは何もしない）。読んだときにファイルの座標と合わなかったラベル
   * （Bochi などで順を変えた）は、付け直すか付け替えるまで、出力でもファイルの座標を書き直さない（ずれの知らせを残す）。
   */
  noteLoaded(bank: number, map: number, positions: EventPositions): void {
    const k = key(bank, map);
    if (!this.loadedPositions.has(k)) this.loadedPositions.set(k, positions);
  }

  /**
   * そのマップの照合用の座標（ファイルに書いた座標と、読んだときの座標）を (dx, dy) ずらす（マップを左・上へ広げたとき。#231）。
   * ファイルの文字列は変えないので、次の出力でずらした座標が書かれる。逆にずらせば元に戻る。
   */
  shiftPositions(bank: number, map: number, dx: number, dy: number): void {
    const k = key(bank, map);
    const shift = <T extends { x: number; y: number }>(e: T): T => ({ ...e, x: e.x + dx, y: e.y + dy });
    const f = this.files.get(k);
    if (f) this.files.set(k, { text: f.text, file: { ...f.file, persons: f.file.persons.map(shift), signs: f.file.signs.map(shift), traps: f.file.traps.map(shift) } });
    const p = this.loadedPositions.get(k);
    if (p) this.loadedPositions.set(k, { person: p.person.map(shift), sign: p.sign.map(shift), tile: p.tile.map(shift) });
  }

  /** ファイルに書いた座標と、今のイベントの座標が合わないラベル（ファイルの無いマップは空）。 */
  mismatches(bank: number, map: number, positions: EventPositions): EventLabelMismatch[] {
    const f = this.files.get(key(bank, map));
    if (!f) return [];
    const m = this.get(bank, map);
    const out: EventLabelMismatch[] = [];
    const lists: [EventLabelTarget, readonly MapLabelEntry[]][] = [
      ["person", f.file.persons],
      ["sign", f.file.signs],
      ["tile", f.file.traps],
    ];
    for (const [target, entries] of lists) {
      const events = positions[target];
      for (const e of entries) {
        if (m[target][e.index]?.label !== e.label) continue;
        const actual = events[e.index] ?? null;
        if (actual && actual.x === e.x && actual.y === e.y) continue;
        const hits = events.flatMap((p, i) => (p.x === e.x && p.y === e.y ? [i] : []));
        out.push({ target, index: e.index, label: e.label, expected: { x: e.x, y: e.y }, actual, candidate: hits.length === 1 ? hits[0]! : null });
      }
    }
    return out;
  }

  /** 座標が合わないラベルを、書いた座標にあるイベントへ付け替える（候補の無いものはそのまま）。付け替えた数を返す。 */
  realign(bank: number, map: number, positions: EventPositions): number {
    const found = this.mismatches(bank, map, positions).filter((x) => x.candidate !== null);
    if (found.length === 0) return 0;
    const m = this.get(bank, map);
    const next = { person: m.person.slice(), sign: m.sign.slice(), tile: m.tile.slice() };
    for (const x of found) next[x.target][x.index] = null;
    for (const x of found) {
      const list = next[x.target];
      while (list.length <= x.candidate!) list.push(null);
      list[x.candidate!] = m[x.target][x.index] ?? null;
    }
    this.put(bank, map, { ...m, ...next });
    return found.length;
  }

  // ---- 出力 ----

  /** 出力していない変更があるか。 */
  isModified(): boolean {
    for (const [k, m] of this.current) if (this.baseline.get(k) !== signature(m)) return true;
    return false;
  }

  /** 変えたマップ（バンク・マップの順）。 */
  modifiedMaps(): { bank: number; map: number }[] {
    return [...this.current.entries()]
      .filter(([k, m]) => this.baseline.get(k) !== signature(m))
      .map(([k]) => fromKey(k))
      .sort((a, b) => a.bank - b.bank || a.map - b.map);
  }

  /**
   * 出力の計画を作る。変えたマップと、ファイルのあるマップについて、ファイルの中身（座標は `positions` の今の値。
   * 読み込んでいないマップは前の値）と eventscripts の行を作る。ファイルも eventscripts も、中身が変わるときだけ書く。
   */
  planSave(positions: (bank: number, map: number) => EventPositions | null): EventLabelSavePlan {
    const keys = new Set<string>([...this.files.keys()]);
    for (const [k, m] of this.current) if (this.baseline.get(k) !== signature(m)) keys.add(k);
    const files: { path: string; text: string | null }[] = [];
    const tables: { bank: number; map: number; label: string; previous: string | null; table: MapScriptTableModel | null }[] = [];
    const scripts = EventScriptsFile.parse(this.scripts.stringify());
    for (const k of [...keys].sort(compareKeys)) {
      const { bank, map } = fromKey(k);
      const m = normalize(this.get(bank, map));
      const old = this.files.get(k);
      const path = mapLabelsPath(bank, map);
      if (isEmpty(m)) {
        if (old) files.push({ path, text: null });
      } else {
        const text = MapLabelsJson.stringify(mapLabelsFileOf(bank, map, m, positions(bank, map), old?.file ?? null, this.loadedPositions.get(k) ?? null));
        if (text !== old?.text) files.push({ path, text });
      }
      syncEventScripts(scripts, bank, map, m);
      const before = this.baselineLabels(k);
      if (signatureOf(before?.table ?? null) !== signatureOf(m.table)) {
        const label = m.table?.label ?? before?.table?.label ?? "";
        tables.push({ bank, map, label, previous: before?.table?.label ?? null, table: m.table });
      }
    }
    const text = scripts.stringify();
    return { files, eventScripts: text === this.scriptsText ? null : text, tables };
  }

  /** 計画どおりに書いたことを記録する（次の出力では、その状態から比べる）。 */
  markSaved(plan: EventLabelSavePlan): void {
    for (const f of plan.files) {
      const parsed = f.text === null ? null : MapLabelsJson.parse(f.text, f.path);
      if (parsed) this.files.set(key(parsed.bank, parsed.map), { file: parsed, text: f.text! });
      else {
        const k = pathKey(f.path);
        if (k) this.files.delete(k);
      }
    }
    if (plan.eventScripts !== null) {
      this.scriptsText = plan.eventScripts;
      this.scripts = EventScriptsFile.parse(plan.eventScripts);
    }
    for (const [k, m] of this.current) this.baseline.set(k, signature(m));
  }

  // ---- 内部 ----

  /** 読んだ（書いた）ときの表（出力で `.s` を書き直すかを調べる）。 */
  private baselineLabels(k: string): { table: MapScriptTableModel | null } | null {
    const sig = this.baseline.get(k);
    if (sig === undefined) return null;
    return { table: (JSON.parse(sig) as MapLabels).table };
  }

  private put(bank: number, map: number, labels: MapLabels): void {
    const k = key(bank, map);
    if (!this.baseline.has(k)) this.get(bank, map);
    this.current.set(k, labels);
  }

  private allKeys(): Set<string> {
    const keys = new Set<string>([...this.current.keys(), ...this.files.keys()]);
    for (const e of this.scripts.entries()) if (e.conditions.length === 0) keys.add(key(e.bank, e.map));
    return keys;
  }

  private initial(bank: number, map: number): MapLabels {
    const f = this.files.get(key(bank, map));
    if (f) {
      const list = (entries: readonly MapLabelEntry[]): (EventLabel | null)[] => {
        const out: (EventLabel | null)[] = [];
        for (const e of entries) {
          while (out.length <= e.index) out.push(null);
          out[e.index] = { label: e.label, kind: e.kind };
        }
        return out;
      };
      return { person: list(f.file.persons), sign: list(f.file.signs), tile: list(f.file.traps), mapScripts: f.file.mapScripts, table: f.file.table };
    }
    const m = { person: [] as (EventLabel | null)[], sign: [] as (EventLabel | null)[], tile: [] as (EventLabel | null)[], mapScripts: null as string | null };
    for (const e of this.scripts.entriesFor(bank, map)) {
      if (e.conditions.length > 0) continue;
      const target = eventScriptTargetOf(e.kind);
      if (target === "map") {
        m.mapScripts = e.symbol;
        continue;
      }
      if (e.index === null) continue;
      const list = m[target];
      while (list.length <= e.index) list.push(null);
      list[e.index] = { label: eventScriptLabel(e.kind, e.symbol), kind: e.kind };
    }
    return { ...m, table: null };
  }
}

function signatureOf(table: MapScriptTableModel | null): string {
  return JSON.stringify(table);
}

function compareKeys(a: string, b: string): number {
  const x = fromKey(a);
  const y = fromKey(b);
  return x.bank - y.bank || x.map - y.map;
}

function pathKey(path: string): string | null {
  const m = /^maps\/([0-9]+)\/scripts_([0-9]+)\.json$/i.exec(path);
  return m ? key(Number(m[1]), Number(m[2])) : null;
}

function renameInTable(table: MapScriptTableModel, from: string, to: string, hit: () => void): MapScriptTableModel {
  const swap = (s: string): string => (s === from ? (hit(), to) : s);
  return {
    label: swap(table.label),
    items: table.items.map((i) => ({ ...i, script: swap(i.script), conditions: i.conditions.map((c) => ({ ...c, script: swap(c.script) })) })),
  };
}
