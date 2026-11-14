import type { SignEvent } from "@zigzagumap/core";
import { hex, ja } from "../../../i18n/ja";
import { formLabel, pushButton, type ComboBox } from "../../form/valueControls";
import { ListKindPanel, withByte, withScriptOffset, type FieldPatch, type LabelPart, type PanelHost } from "./KindPanel";
import { wrap } from "./PersonPanel";

const LABEL = 96;

/** AdvanceMap が隠しアイテムの欄を出す看板のタイプ（05〜08）。 */
function showsHiddenItem(kind: number): boolean {
  return kind >= 5 && kind <= 8;
}

/** 隠しアイテムの 4 バイト（道具 2 バイト、隠し ID、個数）を読む。 */
function hiddenBytes(e: SignEvent): { item: number; flag: number; amount: number } {
  const c = e.content;
  if (c.type === "hiddenItem") return { item: c.item, flag: c.flag, amount: (c.amount & 0x7f) | (c.underfoot ? 0x80 : 0) };
  // タイプ 08（core ではスクリプトとして持つ）は、ポインタの 4 バイトをそのまま隠しアイテムとして見せる。
  return { item: c.script & 0xffff, flag: (c.script >>> 16) & 0xff, amount: c.script >>> 24 };
}

/** 隠しアイテムの 4 バイトの 1 つを変えたときに書く項目。 */
function hiddenPatch(e: SignEvent, part: "item" | "flag" | "amount", value: number): FieldPatch {
  if (e.content.type === "hiddenItem") {
    if (part === "item") return { item: value & 0xffff };
    if (part === "flag") return { flag: value & 0xff };
    return { amount: value & 0x7f, underfoot: (value & 0x80) !== 0 };
  }
  const b = { ...hiddenBytes(e), [part]: value };
  return { script: ((b.item & 0xffff) | ((b.flag & 0xff) << 16) | ((b.amount & 0xff) << 24)) >>> 0 };
}

/**
 * 「看板」の編集パネル（AdvanceMap の Frame_Signpost1）。
 * イベントタイプが 00〜04 ならオフセットと「スクリプトを開く」、05〜08 ならアイテム ID・隠し ID・個数を出す。
 * タイプを変えると core が中身の 4 バイトを新しいタイプとして読み直す（AdvanceMap と同じく値はそのまま）。
 * 個数の欄は 1 バイト全体（最上位ビットは足元だけで拾えるか）。
 */
export class SignPanel extends ListKindPanel<SignEvent> {
  private readonly scriptPart: HTMLElement[];
  private readonly hiddenPart: HTMLElement[];
  private readonly label: LabelPart;
  private readonly offset: HTMLElement;
  private readonly items: ComboBox;
  private itemCount = 0;

  constructor(host: PanelHost) {
    super(host, "sign", "event-sign");
    const f = ja.event.sign;
    this.row(
      ja.event.position,
      LABEL,
      this.hex("x", 4, 33, (e) => e.x, (_e, v) => ({ x: v }), { bits: 16 }),
      this.hex("y", 4, 33, (e) => e.y, (_e, v) => ({ y: v }), { bits: 16 }),
    );
    this.element.append(formLabel(f.elevation));
    const elevations = ja.event.signElevations.map((t, i) => `${hex(i, 2)} ${t}`);
    this.element.append(wrap(this.combo("elevation", elevations, 161, (e) => e.elevation, (_e, i) => ({ elevation: i })).element));
    this.element.append(formLabel(f.type));
    const types = ja.event.signTypes.map((t, i) => `${hex(i, 2)} ${t}`);
    this.element.append(wrap(this.combo("type", types, 161, (e) => e.kind, (_e, i) => ({ kind: i })).element));
    this.row(
      ja.event.unknown,
      LABEL,
      this.hex("unknown1", 2, 25, (e) => e.padding & 0xff, (e, v) => ({ padding: withByte(e.padding, v, false) }), { bits: 8 }),
      this.hex("unknown2", 2, 25, (e) => e.padding >> 8, (e, v) => ({ padding: withByte(e.padding, v, true) }), { bits: 8 }),
    );
    this.label = this.labelField("sign");
    const offset = this.row(
      ja.event.offset,
      LABEL,
      this.hex(
        "script",
        6,
        65,
        (e) => (e.content.type === "script" ? e.content.script & 0xffffff : 0),
        (e, v) => ({ script: withScriptOffset(e.content.type === "script" ? e.content.script : 0, v) }),
        { prefix: "$" },
      ),
    );
    const open = pushButton("event.sign.openScript", ja.event.openScript, () => {
      const c = this.current;
      if (c?.event.content.type === "script") host.openScript("sign", c.index);
    }, "wide-button");
    this.element.append(open);
    this.offset = offset;
    this.scriptPart = [offset, open];

    const itemLabel = formLabel(f.item);
    this.items = this.combo("item", [], 161, (e) => {
      const item = hiddenBytes(e).item;
      return item < this.itemCount ? item : null;
    }, (e, i) => hiddenPatch(e, "item", i));
    const itemRow = wrap(this.items.element);
    this.element.append(itemLabel, itemRow);
    const hiddenId = this.row(f.hiddenId, LABEL, this.hex("hiddenId", 2, 25, (e) => hiddenBytes(e).flag, (e, v) => hiddenPatch(e, "flag", v), { bits: 8 }));
    const amount = this.row(f.amount, LABEL, this.hex("amount", 2, 25, (e) => hiddenBytes(e).amount, (e, v) => hiddenPatch(e, "amount", v), { bits: 8 }));
    this.hiddenPart = [itemLabel, itemRow, hiddenId, amount];
  }

  /** アイテム ID の選択肢（ROM の道具名）。 */
  setItems(names: readonly string[]): void {
    this.itemCount = names.length;
    this.items.setOptions(names.map((n, i) => ja.event.itemChoice(n, i)));
  }

  protected override afterShow(event: SignEvent): void {
    const hidden = showsHiddenItem(event.kind);
    for (const el of this.scriptPart) el.hidden = hidden;
    for (const el of this.hiddenPart) el.hidden = !hidden;
    // 隠しアイテムの看板にはラベルを付けない。ラベルが付いていればオフセットの代わりにラベルを出す
    this.offset.hidden = this.label.update(hidden) || hidden;
  }
}
