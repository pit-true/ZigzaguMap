import type { GameOffsets } from "../game/offsets.js";
import type { Rom } from "../rom/Rom.js";

/**
 * ドアの開け閉め（Phase6 #474）。根拠は日本語版の mapanm.c と素の BPRJ の逆アセンブル（0x0805A7D0〜0x0805AC60）。
 *
 * - 表（total_door_anime_table）は 12 バイトずつ: ブロック番号 u16、音 u8（0 ふつうのドア、1 自動ドア）、形 u8（0 は 1 マス、1 は縦 2 マス）、
 *   絵のポインタ、パレット番号 8 個のポインタ。絵のポインタが NULL で終わる。
 * - 動くのは、マスの挙動（下位 8 ビット）が 0x69 で、ブロック番号が表にあるときだけ（ATR_DoorEffectCheck と search_data_table）。
 * - 開ける・閉める手順は ROM の表（ANM_TBL: 待ち u8、絵の中の位置 u16、0xFFFF は元のブロック）。素の ROM はどれも待ち 4 の 4 段で、
 *   1 段は 5 フレーム（待ちが 0 の回に描き、待ちが表の値になった回に次へ）、全部で 20 フレーム。
 * - 絵は副タイルセットの最後の 8 タイル（1016〜1023）へ 256 バイト写し（形によらず 256 バイト）、マスはその番号を指す仮のブロックで描く。
 *   仮のブロックは WriteMapBGdirect の重ね方 1（素の ROM は BG3 と BG2。CFRU の DrawBlockHook では 1 はふつうの重ね方になる）。
 * - タスクは同時に 1 つだけ。動いている間の開ける・閉めるは何もしない（set_door_anime が -1 を返す）。
 */

/** ドアとみなすマスの挙動（CELL_ATTR_MAT_10）。 */
export const DOOR_BEHAVIOR = 0x69;
/** ドアの絵を一時的に置くタイル番号（DMY_CHR_START_NO）。 */
export const DOOR_TEMP_TILE = 1016;
/** 一度に写すバイト数（DMY_CHR_NUM × 32）。 */
export const DOOR_TEMP_BYTES = 256;
/** 仮のブロックの重ね方（WriteMapBGdirect）。 */
export const DOOR_CELL_LAYER = 1;

/** 手順の 1 段。`offset` が null なら元のブロックへ戻す。 */
export interface DoorStep {
  readonly wait: number;
  readonly offset: number | null;
}

/** 表の 1 件。 */
export interface DoorGraphic {
  readonly index: number;
  readonly blockId: number;
  /** 0 はふつうのドアの音、それ以外は自動ドアの音。 */
  readonly sound: number;
  /** 縦 2 マス（上のマスも描き替える）か。 */
  readonly tall: boolean;
  /** 絵の位置（ROM 先頭から）。 */
  readonly graphics: number;
  /** パレット番号。縦 2 マスの下のマスは 4〜11 番目を読む（8 個の表の後ろのバイトまで読むのは元のコードと同じ）。 */
  readonly palettes: Uint8Array;
}

/** ROM から読んだドアの表と手順。 */
export interface DoorTable {
  readonly doors: readonly DoorGraphic[];
  /** [1 マス, 縦 2 マス] の手順。 */
  readonly open: readonly [readonly DoorStep[], readonly DoorStep[]];
  readonly close: readonly [readonly DoorStep[], readonly DoorStep[]];
  /** 絵を読む（範囲の外なら null）。 */
  frameTiles(door: DoorGraphic, offset: number): Uint8Array | null;
}

/** 表のある位置（ROM 先頭から）を、ROM の中のリテラルから読む。 */
export function readDoorTable(rom: Rom, offsets: GameOffsets): DoorTable | null {
  const tableAt = rom.pointerOrNull(offsets.doorAnimationTablePointer);
  if (tableAt === null) return null;
  const doors: DoorGraphic[] = [];
  for (let i = 0; i < 256; i++) {
    const at = tableAt + i * 12;
    if (!rom.inRange(at, 12)) return null;
    if (rom.u32(at + 4) === 0) break;
    const graphics = rom.pointerOrNull(at + 4);
    const palettes = rom.pointerOrNull(at + 8);
    if (graphics === null || palettes === null || !rom.inRange(palettes, 12)) return null;
    doors.push({ index: i, blockId: rom.u16(at), sound: rom.u8(at + 2), tall: rom.u8(at + 3) !== 0, graphics, palettes: rom.slice(palettes, 12) });
  }
  const steps = (pointer: number): DoorStep[] | null => {
    const at = rom.pointerOrNull(pointer);
    if (at === null) return null;
    const out: DoorStep[] = [];
    for (let i = 0; i < 16; i++) {
      if (!rom.inRange(at + i * 4, 4)) return null;
      const wait = rom.u8(at + i * 4);
      if (wait === 0) return out.length ? out : null;
      const offset = rom.u16(at + i * 4 + 2);
      out.push({ wait, offset: offset === 0xffff ? null : offset });
    }
    return null;
  };
  const [open1, open2] = offsets.doorOpenSequencePointers.map(steps);
  const [close1, close2] = offsets.doorCloseSequencePointers.map(steps);
  if (!open1 || !open2 || !close1 || !close2) return null;
  return {
    doors,
    open: [open1, open2],
    close: [close1, close2],
    frameTiles(door, offset) {
      const at = door.graphics + offset;
      return rom.inRange(at, DOOR_TEMP_BYTES) ? rom.slice(at, DOOR_TEMP_BYTES) : null;
    },
  };
}

/** 手順の全体の長さ（フレーム）。1 段は待ち + 1 フレーム。 */
export function doorStepFrames(steps: readonly DoorStep[]): number {
  let total = 0;
  for (const step of steps) total += step.wait + 1;
  return total;
}

/** マスの情報（ブロック番号と属性）。マップの外なら null。 */
export type DoorCellLookup = (x: number, y: number) => { readonly block: number; readonly attribute: number } | null;

/** ドアにならない理由。 */
export type DoorReason = "behavior" | "unknownDoor" | "busy";

/** マスのドア。挙動が 0x69 でない、表に無い、のどちらかなら理由を返す。 */
export function doorAt(table: DoorTable, lookup: DoorCellLookup, x: number, y: number): { readonly door: DoorGraphic | null; readonly reason: DoorReason | null } {
  const cell = lookup(x, y);
  if (!cell || (cell.attribute & 0xff) !== DOOR_BEHAVIOR) return { door: null, reason: "behavior" };
  const door = table.doors.find((d) => d.blockId === cell.block);
  return door ? { door, reason: null } : { door: null, reason: "unknownDoor" };
}

/** 仮のブロックの 8 個のタイル指定（make_dmy_cell）。前の 4 個が絵、後ろの 4 個はタイル 0。 */
export function doorCell(code: number, palettes: Uint8Array, from: number): Uint16Array {
  const cell = new Uint16Array(8);
  for (let i = 0; i < 4; i++) cell[i] = (((palettes[from + i] ?? 0) & 0xf) << 12) | (code + i);
  for (let i = 4; i < 8; i++) cell[i] = ((palettes[from + i] ?? 0) & 0xf) << 12;
  return cell;
}

/** 再生・自動操作から渡すドアの命令。`frame` は命令を実行したフレーム（スクリプトの実行は同じフレームのタスクより先）。 */
export interface DoorEvent {
  readonly frame: number;
  /** open・close はアニメ（opendoor・closedoor）、setOpen・setClosed はアニメ無し（opendoor2・closedoor2）。 */
  readonly kind: "open" | "close" | "setOpen" | "setClosed";
  readonly x: number;
  readonly y: number;
}

/** あるフレームの終わりのドアの見た目。 */
export interface DoorSceneState {
  /** 描き替えたマス（"x,y" → 8 個のタイル指定）。 */
  readonly cells: ReadonlyMap<string, Uint16Array>;
  /** 1016〜1023 に写した絵（まだ写していなければ null）。 */
  readonly tiles: Uint8Array | null;
  /** そのフレームのタスク（無ければ null）。`lastFrame` はタスクが消えるフレーム。 */
  readonly task: { readonly start: number; readonly lastFrame: number; readonly x: number; readonly y: number; readonly kind: "open" | "close" } | null;
  /** 命令ごとの結果（frame 以下の命令だけ）。 */
  readonly results: readonly { readonly event: DoorEvent; readonly ok: boolean; readonly reason: DoorReason | null }[];
}

/**
 * 命令の並びから、`frame` のフレームを処理し終えた時の見た目を求める（決まった順で計算し直すので、前後へ飛んでも同じ結果になる）。
 * 1 フレームの中では、命令（ControlFieldScript）→ タスク（MainTask）の順。タスクは始めたフレームから 1 回目を動かす。
 */
export function doorStateAt(table: DoorTable, lookup: DoorCellLookup, events: readonly DoorEvent[], frame: number): DoorSceneState {
  const cells = new Map<string, Uint16Array>();
  let tiles: Uint8Array | null = null;
  let task: { start: number; door: DoorGraphic; steps: readonly DoorStep[]; x: number; y: number; kind: "open" | "close"; seq: number; wait: number; last: number } | null = null;
  const results: { event: DoorEvent; ok: boolean; reason: DoorReason | null }[] = [];
  const write = (door: DoorGraphic, step: DoorStep, x: number, y: number): void => {
    if (step.offset === null) {
      cells.delete(`${x},${y}`);
      if (door.tall) cells.delete(`${x},${y - 1}`);
      return;
    }
    tiles = table.frameTiles(door, step.offset) ?? new Uint8Array(DOOR_TEMP_BYTES);
    if (door.tall) {
      cells.set(`${x},${y - 1}`, doorCell(DOOR_TEMP_TILE, door.palettes, 0));
      cells.set(`${x},${y}`, doorCell(DOOR_TEMP_TILE + 4, door.palettes, 4));
    } else cells.set(`${x},${y}`, doorCell(DOOR_TEMP_TILE, door.palettes, 0));
  };
  let at = Number.NEGATIVE_INFINITY;
  // フレーム f のタスクを、命令の後に動かす。
  const runTask = (f: number): void => {
    if (!task || f < task.start) return;
    const t = task;
    if (t.wait === 0) write(t.door, t.steps[t.seq]!, t.x, t.y);
    if (t.wait === t.steps[t.seq]!.wait) {
      t.wait = 0;
      t.seq++;
      if (t.seq >= t.steps.length) task = null;
    } else t.wait++;
  };
  const advance = (until: number): void => {
    // at より後、until 以下のフレームのタスクを動かす（タスクが無い間は飛ばす）。
    while (task && at < until) {
      at = Math.max(at + 1, task.start);
      if (at > until) break;
      runTask(at);
    }
    at = Math.max(at, until);
  };
  const ordered = events.map((event, i) => ({ event, i })).sort((a, b) => a.event.frame - b.event.frame || a.i - b.i);
  for (const { event } of ordered) {
    if (event.frame > frame) break;
    advance(event.frame - 1);
    const found = doorAt(table, lookup, event.x, event.y);
    if (!found.door) { results.push({ event, ok: false, reason: found.reason }); continue; }
    const door = found.door;
    const steps = (event.kind === "open" || event.kind === "setOpen" ? table.open : table.close)[door.tall ? 1 : 0];
    if (event.kind === "setOpen") { write(door, steps[steps.length - 1]!, event.x, event.y); results.push({ event, ok: true, reason: null }); continue; }
    if (event.kind === "setClosed") { write(door, { wait: 0, offset: null }, event.x, event.y); results.push({ event, ok: true, reason: null }); continue; }
    if (task) { results.push({ event, ok: false, reason: "busy" }); continue; }
    task = { start: event.frame, door, steps, x: event.x, y: event.y, kind: event.kind, seq: 0, wait: 0, last: event.frame + doorStepFrames(steps) - 1 };
    at = event.frame - 1;
    results.push({ event, ok: true, reason: null });
  }
  advance(frame);
  const current = task as { start: number; last: number; x: number; y: number; kind: "open" | "close" } | null;
  return { cells, tiles, task: current ? { start: current.start, lastFrame: current.last, x: current.x, y: current.y, kind: current.kind } : null, results };
}

/**
 * `waitdooranim`（waitdoor、0xAE）を `frame` で実行したとき、続きを実行するフレーム。
 * 待ちは次のフレームから毎回「タスクが無いか」を見る（VM_SetWait）。タスクは lastFrame のタスクの処理で消える。
 * 待ちの関数が「終わった」と返したフレームは VM_Control（0x080690C4）が戻るだけなので、続きの命令はその次のフレーム
 * （タスクがあれば lastFrame+2、無ければ命令の 2 フレーム後。素の BPRJ の 0x0806BE64 と VM_Control の逆アセンブルで確認）。
 */
export function doorWaitResume(table: DoorTable, lookup: DoorCellLookup, events: readonly DoorEvent[], frame: number): number {
  const state = doorStateAt(table, lookup, events, frame);
  return state.task ? Math.max(frame + 2, state.task.lastFrame + 2) : frame + 2;
}
