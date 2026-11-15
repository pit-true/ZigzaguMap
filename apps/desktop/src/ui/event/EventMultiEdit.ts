import {
  CommandGroup,
  DuplicateEventCommand,
  MoveEventCommand,
  PERSON_KIND_CLONE,
  SetFlyPositionCommand,
  SetItemBallCommand,
  type Command,
  type MapDocument,
  type MapId,
} from "@zigzagumap/core";
import type { PlacedEvent } from "../map/EventLayer";
import { clampGroupDelta, duplicatePosition, type EventRef } from "./EventSelection";
import { eventList, listCount, type ListKind } from "./eventModel";

/** まとめて動かすときの、つかんだ時点の位置。 */
export interface GroupDragStart {
  readonly items: readonly { readonly ref: EventRef; readonly x: number; readonly y: number }[];
}

/** 選んでいるものの、つかんだ時点の位置（`placed` の印から）。 */
export function groupDragStart(refs: readonly EventRef[], placed: readonly PlacedEvent[]): GroupDragStart {
  const items = refs.flatMap((ref) => {
    const p = placed.find((e) => e.kind === ref.kind && (ref.kind === "fly" || e.index === ref.index));
    return p ? [{ ref: { kind: p.kind, index: p.index }, x: p.x, y: p.y }] : [];
  });
  return { items };
}

/**
 * まとめて動かすコマンド（#399）。全部を同じだけ動かし、マップの中のものはマップの外へ出さない。
 * 中身は MoveEventCommand（フライトポジションは SetFlyPositionCommand）の CommandGroup（1 回で戻る）。
 */
export function groupMoveCommand(id: MapId, doc: MapDocument, start: GroupDragStart, dx: number, dy: number): Command | null {
  if (start.items.length === 0) return null;
  const d = clampGroupDelta(start.items, dx, dy, doc);
  return CommandGroup.of(
    start.items.map(({ ref, x, y }) => {
      const nx = (x + d.dx) & 0xffff;
      const ny = (y + d.dy) & 0xffff;
      return ref.kind === "fly"
        ? new SetFlyPositionCommand({ index: ref.index, fields: { x: nx, y: ny } })
        : new MoveEventCommand({ ...id, kind: ref.kind, index: ref.index, x: nx, y: ny });
    }),
  );
}

/** 複製の計画。 */
export interface DuplicatePlan {
  readonly command: Command;
  /** 写しの番号（置いた順）と位置。 */
  readonly copies: readonly { readonly kind: ListKind; readonly index: number; readonly x: number; readonly y: number }[];
  /** 人を写したか（隣のマップのクローンを合わせる）。 */
  readonly person: boolean;
  /** 写さなかったもの（フライトポジションとクローン）の数。 */
  readonly skipped: number;
}

/**
 * 選んでいるものの複製（#399。Ctrl+D）。1 マス右下（ふさがっていれば近くの空いたマス）に置き、番号は種類ごとの末尾に足す。
 * 欄はフラグもスクリプトも写す（Porymap と同じく聞かない）。落とし物の人は落とし物も写す。フライトポジションとクローンは写さない。
 * 写せるものが無ければ null。
 */
export function duplicatePlan(id: MapId, doc: MapDocument, refs: readonly EventRef[], placed: readonly PlacedEvent[]): DuplicatePlan | null {
  const events = doc.events;
  if (!events) return null;
  const taken = new Set(placed.map((p) => `${p.x},${p.y}`));
  const next: Record<ListKind, number> = { person: listCount(doc, "person"), sign: listCount(doc, "sign"), warp: listCount(doc, "warp"), trap: listCount(doc, "trap") };
  const commands: Command[] = [];
  const copies: { kind: ListKind; index: number; x: number; y: number }[] = [];
  let skipped = 0;
  for (const ref of refs) {
    if (ref.kind === "fly") {
      skipped++;
      continue;
    }
    const kind = ref.kind;
    const source = eventList(events, kind)[ref.index];
    if (!source || (kind === "person" && events.persons[ref.index]!.kind === PERSON_KIND_CLONE)) {
      skipped++;
      continue;
    }
    const at = duplicatePosition(source, doc, taken);
    const index = next[kind]++;
    commands.push(new DuplicateEventCommand({ ...id, kind, index: ref.index, x: at.x, y: at.y }));
    const ball = kind === "person" ? doc.itemBalls.find((b) => b.personIndex === ref.index) : undefined;
    if (ball) commands.push(new SetItemBallCommand({ ...id, personIndex: index, itemId: ball.itemId }));
    copies.push({ kind, index, x: at.x, y: at.y });
  }
  if (commands.length === 0) return null;
  return { command: CommandGroup.of(commands), copies, person: copies.some((c) => c.kind === "person"), skipped };
}
