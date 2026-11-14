import { AddEventCommand, type EventKind, type MapId } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { jaEventView as t } from "../../i18n/ja.eventView";
import type { ContextMenuItem } from "../ContextMenu";
import type { EventEditor } from "./EventEditor";
import { listCount } from "./eventModel";

/** 素のイベントを置ける種類（右クリックの並び）。 */
const QUICK_KINDS: readonly EventKind[] = ["person", "sign", "trap", "warp"];

/** EventQuickAdd が使う、タブの外の機能。 */
export interface EventQuickAddHost {
  /** 置いたイベントを選ぶ。 */
  select(kind: EventKind, index: number): void;
  /** 落とし物を置く処理（ひな形「落とし物」の見えるボールと同じ。HiddenItem.s に書くのでプロジェクトフォルダがあるときだけ。無ければ null）。 */
  itemBall(): ((x: number, y: number) => void) | null;
}

/**
 * 右クリックの「ここに○○を追加」（#304。Bochi の EventAdd）。押したマスに、イベント数の設定で増やしたときと同じ初期値の
 * イベントを 1 つ置く（AddEventCommand。人は隣のマップのクローンも合わせ、1 回の取り消しで消える）。
 */
export class EventQuickAdd {
  constructor(
    private readonly state: EditorState,
    private readonly editor: EventEditor,
    private readonly host: EventQuickAddHost,
  ) {}

  /** メニューの項目（マップの中のマスだけ。落とし物は置けるときだけ）。 */
  items(x: number, y: number): ContextMenuItem[] {
    const doc = this.state.map?.doc;
    if (!doc || x < 0 || y < 0 || x >= doc.width || y >= doc.height) return [];
    const items: ContextMenuItem[] = QUICK_KINDS.map((kind) => ({ id: `add.${kind}`, label: t.add[kind]!, run: () => void this.add(kind, x, y) }));
    const ball = this.host.itemBall();
    if (ball) items.push({ id: "add.itemBall", label: t.add["itemBall"]!, run: () => ball(x, y) });
    return items;
  }

  /** 1 つ置く。置けたら番号、置けなければ null（上限など。理由はステータスバーに出る）。 */
  add(kind: EventKind, x: number, y: number): number | null {
    const map = this.state.map;
    if (!map) return null;
    const id: MapId = map.id;
    const index = listCount(map.doc, kind);
    const command = new AddEventCommand({ ...id, kind, x, y });
    this.editor.endSession();
    const ok = kind === "person" ? this.editor.runWithClones(command, id) : this.editor.run(command);
    this.editor.endSession();
    if (!ok) return null;
    this.host.select(kind, index);
    this.state.setStatus(t.added(ja.event.kindNames[kind] ?? kind, index, x, y));
    return index;
  }
}
