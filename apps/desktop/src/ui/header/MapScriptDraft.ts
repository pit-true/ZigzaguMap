import {
  AddMapScriptCommand,
  AddMapScriptConditionCommand,
  ROM_BASE,
  RemoveMapScriptCommand,
  RemoveMapScriptConditionCommand,
  SetMapScriptCommand,
  SetMapScriptConditionCommand,
  isTableType,
  type Command,
  type MapId,
  type MapScriptEntry,
} from "@zigzagumap/core";
import { DraftList, type DraftOps } from "../form/DraftList";

/**
 * マップスクリプト 1 件の下書き（AdvanceMap の欄の値）。
 * 条件表の種類（2・4）は表の先頭の行だけを「フラグ・フラグの値・フラグのオフセット」に出す（AdvanceMap と同じ）。
 * ポインタはそのままの値（0x08000000 起点）。
 */
export interface ScriptDraft {
  type: number;
  pointer: number;
  flag: number;
  value: number;
  flagOffset: number;
  /** 条件表に行があるか（元のデータ）。 */
  readonly hasRow: boolean;
  /** 元のデータの種類（条件表の種類のままなら、ポインタは表の位置）。 */
  readonly origType: number;
}

/** マップスクリプトの一覧から下書きを作る。 */
export function scriptDrafts(list: readonly MapScriptEntry[]): ScriptDraft[] {
  return list.map((e) => {
    const row = e.table?.entries[0];
    return { type: e.type, pointer: e.pointer, flag: row?.variable ?? 0, value: row?.value ?? 0, flagOffset: row?.script ?? e.pointer, hasRow: !!row, origType: e.type };
  });
}

/** 下書きの一覧（外で変わったかの判定は元の一覧の中身で行う）。 */
export function newScriptDraftList(list: readonly MapScriptEntry[]): DraftList<ScriptDraft> {
  return new DraftList(scriptDrafts(list), (d) => ({ ...d }), (l) => JSON.stringify(l.map((d) => [d.type, d.pointer, d.flag, d.value, d.flagOffset])));
}

/** オフセット欄の入力（ROM 先頭からの位置）をポインタ値にする。0 は 0 のまま。 */
export function offsetToPointer(offset: number): number {
  if (offset === 0) return 0;
  return offset >= ROM_BASE ? offset >>> 0 : (offset + ROM_BASE) >>> 0;
}

/** ポインタ値をオフセット欄の値にする。 */
export function pointerToOffset(pointer: number): number {
  return pointer >= ROM_BASE ? pointer - ROM_BASE : pointer;
}

/** 下書きを編集中の状態へ反映するコマンド。 */
export function scriptOps(id: MapId): DraftOps<ScriptDraft> {
  const m = { bank: id.bank, map: id.map };
  const rowCommands = (index: number, hadRow: boolean, before: ScriptDraft | null, after: ScriptDraft): Command[] => {
    if (!isTableType(after.type)) return [];
    if (after.flag === 0) return hadRow ? [new RemoveMapScriptConditionCommand({ ...m, index, row: 0 })] : [];
    const row = { variable: after.flag, value: after.value, script: after.flagOffset };
    if (!hadRow) return [new AddMapScriptConditionCommand({ ...m, index, ...row })];
    if (before && before.flag === after.flag && before.value === after.value && before.flagOffset === after.flagOffset) return [];
    return [new SetMapScriptConditionCommand({ ...m, index, row: 0, ...row })];
  };
  return {
    remove: (index) => new RemoveMapScriptCommand({ ...m, index }),
    update: (index, before, after) => {
      const out: Command[] = [];
      if (before.type !== after.type || before.pointer !== after.pointer) {
        out.push(new SetMapScriptCommand({ ...m, index, type: after.type, pointer: after.pointer }));
      }
      // 種類を変えずに条件表の種類のままなら、元の行が残っている。
      const hadRow = isTableType(before.type) && isTableType(after.type) && before.hasRow;
      out.push(...rowCommands(index, hadRow, before, after));
      return out;
    },
    add: (index, after) => [new AddMapScriptCommand({ ...m, type: after.type, pointer: after.pointer }), ...rowCommands(index, false, null, after)],
  };
}
