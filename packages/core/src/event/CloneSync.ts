import type { JsonValue } from "../command/Command.js";
import { SnapshotCommand } from "../command/commands/base/SnapshotCommand.js";
import type { DocumentContext } from "../command/DocumentContext.js";
import { argMapId, type Args } from "../command/jsonArgs.js";
import { ConnectionDirection } from "../connection/layout.js";
import type { MapConnection } from "../connection/types.js";
import type { MapId } from "../map/types.js";
import type { MapDocument } from "../model/MapDocument.js";
import { cloneEvents } from "../model/clone.js";
import type { MapEvents, PersonEvent } from "./types.js";

/**
 * クローンの自動作成（#242）。人が隣のマップの境界から `CLONE_RANGE` マス以内にいれば、隣のマップに同じ見た目のクローン
 * （種類 1。高さの欄に参照先の人の番号、トレーナーの種類の欄に参照先のマップ、視界の欄に参照先のバンク、同じフラグ）を置き、
 * 位置を合わせる。外へ出たら・元の人を消したら消す。HexManiacAdvance と同じく、リサイズやずれの調整では動かさない。
 */

/** 境界から何マス以内ならクローンを置くか。 */
export const CLONE_RANGE = 8;
/** 人の種類: クローン。 */
export const PERSON_KIND_CLONE = 1;

/** クローンの参照先（クローンの欄から読む）。 */
export interface CloneTarget {
  readonly bank: number;
  readonly map: number;
  readonly localId: number;
}

/** 人がクローンなら参照先。 */
export function cloneTargetOf(p: PersonEvent): CloneTarget | null {
  return p.kind === PERSON_KIND_CLONE ? { bank: p.trainerRangeOrBerryTree, map: p.trainerType, localId: p.elevation } : null;
}

/** 隣のマップの置き場所（主マップの左上を原点にした、隣のマップの左上）。上下左右の接続だけ。 */
export interface ClonePlacement {
  readonly id: MapId;
  readonly direction: number;
  /** 隣のマップの左上（主マップの座標）。 */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 接続から隣のマップの置き場所を求める（相手の大きさは `size` で引く。分からなければ外す）。 */
export function clonePlacements(
  main: { width: number; height: number; connections: readonly MapConnection[] | null },
  size: (id: MapId) => { width: number; height: number } | null,
): ClonePlacement[] {
  const out: ClonePlacement[] = [];
  for (const c of main.connections ?? []) {
    const id = { bank: c.bank, map: c.map };
    const s = size(id);
    if (!s) continue;
    switch (c.direction) {
      case ConnectionDirection.Down:
        out.push({ id, direction: c.direction, x: c.offset, y: main.height, ...s });
        break;
      case ConnectionDirection.Up:
        out.push({ id, direction: c.direction, x: c.offset, y: -s.height, ...s });
        break;
      case ConnectionDirection.Left:
        out.push({ id, direction: c.direction, x: -s.width, y: c.offset, ...s });
        break;
      case ConnectionDirection.Right:
        out.push({ id, direction: c.direction, x: main.width, y: c.offset, ...s });
        break;
    }
  }
  return out;
}

/** 人の座標（16 ビットで回った負の値を戻す）。 */
function signed(v: number): number {
  return v >= 0x8000 ? v - 0x10000 : v;
}

/** 隣のマップ `n` に置くべきクローンの位置（隣のマップの座標）。置かないなら null。 */
export function clonePosition(main: { width: number; height: number }, n: ClonePlacement, p: { x: number; y: number }): { x: number; y: number } | null {
  const x = signed(p.x);
  const y = signed(p.y);
  if (x < 0 || y < 0 || x >= main.width || y >= main.height) return null;
  let near: boolean;
  switch (n.direction) {
    case ConnectionDirection.Down:
      near = main.height - 1 - y < CLONE_RANGE;
      break;
    case ConnectionDirection.Up:
      near = y < CLONE_RANGE;
      break;
    case ConnectionDirection.Left:
      near = x < CLONE_RANGE;
      break;
    default:
      near = main.width - 1 - x < CLONE_RANGE;
  }
  if (!near) return null;
  const cx = x - n.x;
  const cy = y - n.y;
  // 隣のマップの横（上下の接続）・縦（左右の接続）の範囲から大きく外れる位置には置かない
  const vertical = n.direction === ConnectionDirection.Down || n.direction === ConnectionDirection.Up;
  if (vertical ? cx < -CLONE_RANGE || cx >= n.width + CLONE_RANGE : cy < -CLONE_RANGE || cy >= n.height + CLONE_RANGE) return null;
  return { x: cx & 0xffff, y: cy & 0xffff };
}

/** 変えたこと（知らせ用）。 */
export interface CloneChange {
  readonly map: MapId;
  readonly localId: number;
  readonly action: "add" | "move" | "remove";
}

/**
 * 隣のマップ `neighbor` のクローンを、主マップ `main`（番号 `mainId`）の人に合わせる。変えたことを返す。
 * クローン自身（種類 1）の人はクローンを作らない。
 */
export function syncClones(main: MapDocument, mainId: MapId, n: ClonePlacement, neighbor: MapDocument): CloneChange[] {
  const changes: CloneChange[] = [];
  const events: MapEvents = (neighbor.events ??= { persons: [], warps: [], traps: [], signs: [] });
  const want = new Map<number, { p: PersonEvent; x: number; y: number }>();
  for (const p of main.events?.persons ?? []) {
    if (p.kind === PERSON_KIND_CLONE) continue;
    const pos = clonePosition(main, n, p);
    if (pos) want.set(p.localId, { p, ...pos });
  }
  const isMine = (q: PersonEvent): boolean => {
    const t = cloneTargetOf(q);
    return !!t && t.bank === mainId.bank && t.map === mainId.map;
  };
  // 動かす・消す
  for (let i = events.persons.length - 1; i >= 0; i--) {
    const q = events.persons[i]!;
    if (!isMine(q)) continue;
    const w = want.get(q.elevation);
    if (!w) {
      events.persons.splice(i, 1);
      changes.push({ map: n.id, localId: q.elevation, action: "remove" });
      continue;
    }
    want.delete(q.elevation);
    if (q.x !== w.x || q.y !== w.y || q.graphicsId !== w.p.graphicsId || q.flag !== w.p.flag) {
      Object.assign(q, { x: w.x, y: w.y, graphicsId: w.p.graphicsId, flag: w.p.flag });
      changes.push({ map: n.id, localId: q.elevation, action: "move" });
    }
  }
  // 足す
  for (const [localId, w] of want) {
    const used = new Set(events.persons.map((q) => q.localId));
    let id = events.persons.length + 1;
    while (used.has(id & 0xff) && id < 0x100) id++;
    events.persons.push({
      localId: id & 0xff,
      graphicsId: w.p.graphicsId,
      kind: PERSON_KIND_CLONE,
      padding1: 0,
      x: w.x,
      y: w.y,
      elevation: localId,
      movementType: 0,
      movementRangeX: 0,
      movementRangeY: 0,
      padding2: 0,
      trainerType: mainId.map,
      trainerRangeOrBerryTree: mainId.bank,
      script: 0,
      flag: w.p.flag,
      padding3: 0,
    });
    changes.push({ map: n.id, localId, action: "add" });
  }
  return changes;
}

/** 「クローンを合わせる」の引数。 */
export type CloneSyncArgs = {
  bank: number;
  map: number;
  /** 隣のマップ（読み込んでおくこと）。描き直しと未出力の印のため `targets` と同じ。 */
  targets: JsonValue[];
};

/**
 * 「クローンを合わせる」コマンド（#242）。主マップの今の人に合わせて、隣のマップ（`targets`）のクローンを作る・動かす・消す。
 * 人を動かす・消すコマンドと `CommandGroup` で 1 つにして使う（1 回の取り消しで両方戻る）。隣のマップのイベントの表を控えて戻す。
 */
export class CloneSyncCommand extends SnapshotCommand<CloneSyncArgs, { id: MapId; events: MapEvents | null }[]> {
  static readonly NAME = "syncClones";
  readonly name = CloneSyncCommand.NAME;
  /** 最後に実行したときに変えたこと。 */
  changes: CloneChange[] = [];

  /** JSON の引数から作る。 */
  static fromJson(args: Args): CloneSyncCommand {
    const { bank, map } = argMapId(args);
    const list = Array.isArray(args["targets"]) ? (args["targets"] as JsonValue[]) : [];
    return new CloneSyncCommand({ bank, map, targets: list });
  }

  private ids(): MapId[] {
    return (this.args.targets as { bank: number; map: number }[]).map((t) => ({ bank: t.bank, map: t.map }));
  }

  protected capture(context: DocumentContext): { id: MapId; events: MapEvents | null }[] {
    return this.ids().map((id) => ({ id, events: cloneEvents(context.document(id).events) }));
  }

  protected apply(context: DocumentContext): void {
    const mainId = { bank: this.args.bank, map: this.args.map };
    const main = context.document(mainId);
    const targets = new Set(this.ids().map((id) => `${id.bank}.${id.map}`));
    const size = (id: MapId) => (targets.has(`${id.bank}.${id.map}`) ? { width: context.document(id).width, height: context.document(id).height } : null);
    this.changes = [];
    for (const n of clonePlacements(main, size)) {
      if (!targets.has(`${n.id.bank}.${n.id.map}`)) continue;
      this.changes.push(...syncClones(main, mainId, n, context.document(n.id)));
    }
  }

  protected restore(context: DocumentContext, saved: { id: MapId; events: MapEvents | null }[]): void {
    for (const s of saved) context.document(s.id).events = cloneEvents(s.events);
  }
}
