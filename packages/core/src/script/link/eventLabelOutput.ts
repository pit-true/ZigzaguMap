import type { EventScriptEntry, EventScriptsFile } from "../project/EventScriptsFile.js";
import { eventScriptSymbolFor, eventScriptTargetOf, type EventScriptKind } from "../project/eventScriptKinds.js";
import { EVENT_LABEL_TARGETS, type EventLabelTarget, type EventPositions, type MapLabels } from "./EventLabelTypes.js";
import type { MapLabelEntry, MapLabelsFile } from "./MapLabelsJson.js";

// 出力のときに書くもの（ラベルのファイルの中身と、eventscripts の行）を作る（EventLabelStore.planSave から使う）。

/**
 * マップ 1 枚のラベルのファイル（`maps/BB/scripts_MM.json`）の中身。座標は今のイベントの座標（`positions`。読み込んでいない
 * マップは前のファイルの値）。読んだときにファイルの座標と合わなかったラベルは、前のファイルの座標のまま書く。
 */
export function mapLabelsFileOf(
  bank: number,
  map: number,
  m: MapLabels,
  positions: EventPositions | null,
  old: MapLabelsFile | null,
  loaded: EventPositions | null,
): MapLabelsFile {
  const oldEntry = (target: EventLabelTarget, index: number): MapLabelEntry | undefined => {
    const list = target === "person" ? old?.persons : target === "sign" ? old?.signs : old?.traps;
    return list?.find((x) => x.index === index);
  };
  /** 読んだときにファイルの座標と合わず、まだ同じ番号に付いたままのラベルか。 */
  const stale = (target: EventLabelTarget, index: number, label: string, e: MapLabelEntry | undefined): boolean => {
    if (!e || !loaded || e.label !== label) return false;
    const p = loaded[target][index];
    return !p || p.x !== e.x || p.y !== e.y;
  };
  const entries = (target: EventLabelTarget): MapLabelEntry[] =>
    m[target].flatMap((l, index) => {
      if (!l) return [];
      const e = oldEntry(target, index);
      const p = stale(target, index, l.label, e) ? { x: e!.x, y: e!.y } : (positions?.[target][index] ?? (e ? { x: e.x, y: e.y } : { x: 0, y: 0 }));
      return [{ index, x: p.x, y: p.y, kind: l.kind, label: l.label }];
    });
  return { bank, map, mapScripts: m.mapScripts, table: m.table, persons: entries("person"), signs: entries("sign"), traps: entries("tile") };
}

/** eventscripts の、そのマップの `#ifdef` の外の行をラベルに合わせる（同じ番号の行はシンボルだけ書き換える）。 */
export function syncEventScripts(file: EventScriptsFile, bank: number, map: number, m: MapLabels): void {
  const wanted = new Map<string, { kind: EventScriptKind; index: number | null; symbol: string }>();
  for (const t of EVENT_LABEL_TARGETS) {
    m[t].forEach((l, index) => {
      if (!l) return;
      let kind = l.kind;
      let symbol = eventScriptSymbolFor(kind, l.label);
      if (symbol === null) {
        // trainer / item の頭の文字列で始まらないラベルは、人の npc として書く
        kind = "npc";
        symbol = l.label;
      }
      wanted.set(`${t}:${index}`, { kind, index, symbol });
    });
  }
  if (m.mapScripts) wanted.set("map:", { kind: "map", index: null, symbol: m.mapScripts });
  const entries = file.entriesFor(bank, map).filter((e) => e.conditions.length === 0);
  // 同じイベントの行が複数あれば、種別の合う最初の行を残す
  const keep = new Map<string, number>();
  for (const e of entries) {
    const k = entryKey(e);
    if (wanted.get(k)?.kind === e.kind && !keep.has(k)) keep.set(k, e.line);
  }
  // 後ろの行から変える（前の行の行番号を変えないため）
  for (const e of [...entries].reverse()) {
    const k = entryKey(e);
    const want = wanted.get(k);
    if (want && keep.get(k) === e.line) {
      if (e.symbol !== want.symbol) file.setSymbol(e, want.symbol);
    } else {
      file.remove(e);
    }
  }
  for (const [k, want] of wanted) if (!keep.has(k)) file.add({ kind: want.kind, bank, map, index: want.index, symbol: want.symbol });
}

function entryKey(e: EventScriptEntry): string {
  const target = eventScriptTargetOf(e.kind);
  return target === "map" ? "map:" : `${target}:${e.index}`;
}
