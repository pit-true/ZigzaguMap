import type { MapDocument } from "../../../model/MapDocument.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argInt, argMapId, argOptString, type Args } from "../../jsonArgs.js";
import { EventsCommand, type MapArgs } from "../base/MapPartCommand.js";

/** 「落とし物を設定する」の引数。 */
export type SetItemBallArgs = MapArgs & {
  /** 何番目の人か。 */
  personIndex: number;
  /** 道具番号。null で落とし物をやめる（人のスクリプトは 0 のまま残る）。 */
  itemId: number | null;
  /** 識別子（32 桁の 16 進）。省略すると作ったときに決め、引数に残す（操作列の再生で同じ値になる）。 */
  id?: string;
};

/** 落とし物のラベル名（Bochi と同じ `HiddenItem_BB_MM_<id>`）。 */
export function itemBallLabel(bank: number, map: number, id: string): string {
  return `HiddenItem_${String(bank).padStart(2, "0")}_${String(map).padStart(2, "0")}_${id}`;
}

/** 新しい識別子（32 桁の 16 進。.NET の Guid.ToString("N") と同じ形）。 */
export function newItemBallId(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?(b: Uint8Array): Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 「落とし物を設定する」コマンド（Bochi の ItemBalls）。人を落とし物にし、拾うスクリプトを
 * assembly/overworld_scripts/HiddenItem.s に保存時に作る（ラベルはビルドで人のスクリプトに入る）。
 * 落とし物にした人のスクリプトのポインタは 0 にする（maps\ の JSON と同じ）。既に落とし物なら道具だけ変える。
 */
export class SetItemBallCommand extends EventsCommand<SetItemBallArgs> {
  static readonly NAME = "setItemBall";
  readonly name = SetItemBallCommand.NAME;

  constructor(args: SetItemBallArgs) {
    super(args.itemId !== null && args.id === undefined ? { ...args, id: newItemBallId() } : args);
  }

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetItemBallCommand {
    const itemId = args["itemId"] === null ? null : argInt(args, "itemId");
    const id = argOptString(args, "id");
    if (id !== undefined && !/^[0-9a-fA-F]{32}$/.test(id)) throw new TypeError("引数 id は 32 桁の 16 進でなければなりません");
    return new SetItemBallCommand({ ...argMapId(args), personIndex: argInt(args, "personIndex"), itemId, ...(id ? { id } : {}) });
  }

  protected edit(doc: MapDocument): void {
    const { bank, map, personIndex, itemId } = this.args;
    const persons = doc.events?.persons ?? [];
    const person = persons[personIndex];
    if (!person) throw new EditError(EditErrorCode.ItemBallPersonOutOfRange, { personIndex, count: persons.length });
    const current = doc.itemBalls.findIndex((i) => i.personIndex === personIndex);
    if (itemId === null) {
      if (current >= 0) doc.itemBalls.splice(current, 1);
      return;
    }
    checkRange("itemId", itemId, 0, 0xffff);
    if (current >= 0) {
      doc.itemBalls[current] = { ...doc.itemBalls[current]!, itemId };
      return;
    }
    const id = this.args.id!;
    doc.itemBalls.push({ id, personIndex, itemId, label: itemBallLabel(bank, map, id) });
    person.script = 0;
  }
}
