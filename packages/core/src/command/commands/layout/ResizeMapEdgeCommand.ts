import { inverseOf, isVertical, type Side } from "../../../connection/NeighborLayout.js";
import type { MapConnection } from "../../../connection/types.js";
import type { MapEvents } from "../../../event/types.js";
import type { FlyPosition } from "../../../fly/types.js";
import { BlockGrid } from "../../../map/BlockGrid.js";
import type { MapId } from "../../../map/types.js";
import { cloneConnections, cloneEvents } from "../../../model/clone.js";
import { mapTargets } from "../../affectedMaps.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { EditError, EditErrorCode } from "../../EditError.js";
import { argEnum, argInt, argIntArray, argMapId, argOptInt, type Args } from "../../jsonArgs.js";
import { SnapshotCommand } from "../base/SnapshotCommand.js";
import { readTargets, type PairedArgs } from "../connection/PairedConnectionsCommand.js";
import { checkMapSize } from "./mapSize.js";

/** 辺のドラッグで変えられる、幅・高さのいちばん小さい値（HMA と同じ 4）。 */
export const MIN_EDGE_RESIZE = 4;

const SIDES: readonly Side[] = ["up", "down", "left", "right"];

/**
 * 広げた所を埋める柄（Phase5 #390 の対話式リサイズ）。新しい配置の座標に `ox`・`oy`（省略で 0）を足した位置で
 * `width`×`height` をくり返す（値は u16。ブロックと移動許可）。
 */
export type EdgeFill = { width: number; height: number; cells: number[]; ox?: number; oy?: number };

/**
 * 「辺を指定してリサイズ」の引数。`amount` は広げるマス数（負なら縮める）。`targets` は自分と、ずれを直す接続の相手。
 * `fill` を渡すと、増えた行・列を端の写しでなくその柄で埋める（省略で今までと同じ端の写し）。
 */
export type ResizeMapEdgeArgs = PairedArgs & { side: Side; amount: number; fill?: EdgeFill };

interface Saved {
  grid: BlockGrid;
  events: MapEvents | null;
  connections: Map<string, MapConnection[] | null>;
  fly: FlyPosition[];
}

/** 左・上へ広げたとき、配置・イベント・接続をずらす量（右・下は 0）。 */
export function edgeShift(side: Side, amount: number): { dx: number; dy: number } {
  return { dx: side === "left" ? amount : 0, dy: side === "up" ? amount : 0 };
}

/**
 * 「辺を指定してリサイズ」コマンド（辺のつまみのドラッグ。#231）。その辺の向きへ広げる・縮める。
 * - 増えた行・列は、元の端の行・列の写しで埋める。
 * - 左へ W・上へ H 広げたとき（縮めたときは逆）: 配置をずらし、全イベント（人・ワープ・スクリプトタイル・看板）の座標をずらす。
 *   直交する辺の接続（左右へ広げたなら上下の接続、上下なら左右の接続）のずれに足し、`targets` に入っている相手の逆の接続から引く。
 *   フライトポジションがこのマップを指していればずらす。
 * - 右と下では、ずらさない（今のリサイズと同じ）。
 * - 大きさの制限は `(幅+15)×(高さ+14) ≤ 10240` と、幅・高さ MIN_EDGE_RESIZE 以上。
 * 1 回の取り消しで全部戻る。
 */
export class ResizeMapEdgeCommand extends SnapshotCommand<ResizeMapEdgeArgs, Saved> {
  static readonly NAME = "resizeMapEdge";
  readonly name = ResizeMapEdgeCommand.NAME;

  /** 引数を作る（`partners` は、ずれを直す接続の相手）。 */
  static of(self: MapId, side: Side, amount: number, partners: readonly MapId[], fill?: EdgeFill): ResizeMapEdgeCommand {
    return new ResizeMapEdgeCommand({ bank: self.bank, map: self.map, side, amount, targets: mapTargets([self, ...partners]) as PairedArgs["targets"], ...(fill ? { fill } : {}) });
  }

  /** JSON の引数から作る。 */
  static fromJson(args: Args): ResizeMapEdgeCommand {
    const self = argMapId(args);
    return new ResizeMapEdgeCommand({
      ...self,
      side: argEnum(args, "side", SIDES),
      amount: argInt(args, "amount"),
      targets: mapTargets(readTargets(args, self)) as PairedArgs["targets"],
      ...(args["fill"] !== undefined ? { fill: readFill(args["fill"]) } : {}),
    });
  }

  /** 自分のマップ。 */
  get mapId(): MapId {
    return { bank: this.args.bank, map: this.args.map };
  }

  private get targets(): MapId[] {
    return readTargets(this.args, this.mapId);
  }

  protected capture(context: DocumentContext): Saved {
    const doc = context.document(this.mapId);
    const connections = new Map<string, MapConnection[] | null>();
    for (const id of this.targets) connections.set(`${id.bank}.${id.map}`, cloneConnections(context.document(id).connections));
    return { grid: doc.grid, events: cloneEvents(doc.events), connections, fly: context.flyPositions.map((f) => ({ ...f })) };
  }

  protected restore(context: DocumentContext, saved: Saved): void {
    const doc = context.document(this.mapId);
    doc.grid = saved.grid;
    doc.events = cloneEvents(saved.events);
    for (const id of this.targets) context.document(id).connections = cloneConnections(saved.connections.get(`${id.bank}.${id.map}`) ?? null);
    saved.fly.forEach((f, i) => {
      const entry = context.flyPositions[i];
      if (entry) Object.assign(entry, f);
    });
  }

  protected apply(context: DocumentContext): void {
    const { side, amount } = this.args;
    if (!Number.isInteger(amount)) throw new EditError(EditErrorCode.InvalidMapSize, { width: amount, height: amount });
    const doc = context.document(this.mapId);
    const w = doc.width;
    const h = doc.height;
    const width = side === "left" || side === "right" ? w + amount : w;
    const height = side === "up" || side === "down" ? h + amount : h;
    if (width < MIN_EDGE_RESIZE || height < MIN_EDGE_RESIZE) throw new EditError(EditErrorCode.InvalidMapSize, { width, height });
    checkMapSize(width, height);
    const { dx, dy } = edgeShift(side, amount);
    // 配置: 元の位置から写し、増えたところは端の行・列の写し（`fill` があればその柄）
    const old = doc.grid;
    const grid = new BlockGrid(width, height);
    const fill = this.args.fill;
    if (fill && (fill.width < 1 || fill.height < 1 || fill.cells.length !== fill.width * fill.height || fill.cells.some((c) => !Number.isInteger(c) || c < 0 || c > 0xffff))) {
      throw new EditError(EditErrorCode.InvalidRawBytes, { field: "fill", expected: fill.width * fill.height * 2 });
    }
    for (let y = 0; y < height; y++) {
      const sy = y - dy;
      const oy = Math.min(Math.max(sy, 0), h - 1);
      for (let x = 0; x < width; x++) {
        const sx = x - dx;
        if (fill && (sx < 0 || sy < 0 || sx >= w || sy >= h)) {
          const fy = (((y + (fill.oy ?? 0)) % fill.height) + fill.height) % fill.height;
          const fx = (((x + (fill.ox ?? 0)) % fill.width) + fill.width) % fill.width;
          grid.cells[y * width + x] = fill.cells[fy * fill.width + fx]!;
          continue;
        }
        const ox = Math.min(Math.max(sx, 0), w - 1);
        grid.cells[y * width + x] = old.cells[oy * w + ox]!;
      }
    }
    doc.grid = grid;
    if (dx === 0 && dy === 0) return;
    // イベント（座標は u16 なので、左・上へはみ出した分は折り返して「マップの外のイベント」にする）
    const move = (e: { x: number; y: number }): void => {
      e.x = (e.x + dx) & 0xffff;
      e.y = (e.y + dy) & 0xffff;
    };
    if (doc.events) {
      doc.events.persons.forEach(move);
      doc.events.warps.forEach(move);
      doc.events.traps.forEach(move);
      doc.events.signs.forEach(move);
    }
    // 直交する辺の接続のずれ（自分は足し、相手の逆の接続は -offset にそろえる）
    const shift = dx !== 0 ? dx : dy;
    const list = doc.connections ?? [];
    list.forEach((c, i) => {
      const affected = dx !== 0 ? isVertical(c.direction) : c.direction === 3 || c.direction === 4;
      if (!affected) return;
      const next = c.offset + shift;
      const partner = this.targets.find((t) => (t.bank !== this.args.bank || t.map !== this.args.map) && t.bank === c.bank && t.map === c.map);
      if (partner) {
        const other = context.document(partner);
        const j = inverseOf(other.connections, this.mapId, c.direction, c.offset);
        if (j !== null) other.connections![j] = { ...other.connections![j]!, offset: 0 - next };
      }
      list[i] = { ...c, offset: next };
    });
    // フライトポジション
    for (const f of context.flyPositions) {
      if (f.bank !== this.args.bank || f.map !== this.args.map) continue;
      f.x = Math.max(0, f.x + dx);
      f.y = Math.max(0, f.y + dy);
    }
  }
}

/** JSON の `fill`（`{width, height, cells}`）を読む。 */
function readFill(v: unknown): EdgeFill {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new EditError(EditErrorCode.InvalidRawBytes, { field: "fill", expected: 0 });
  const o = v as Args;
  return { width: argInt(o, "width"), height: argInt(o, "height"), cells: argIntArray(o, "cells"), ox: argOptInt(o, "ox") ?? 0, oy: argOptInt(o, "oy") ?? 0 };
}
