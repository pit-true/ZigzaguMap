import type { PersonEvent } from "@zigzagumap/core";
import { ja } from "../../../i18n/ja";
import { formLabel, pushButton } from "../../form/controls";
import { ListKindPanel, withByte, withScriptOffset, type PanelHost } from "./KindPanel";

/** ラベルの幅（入力欄は x=96 から）。 */
const LABEL = 88;

/**
 * 「人」の編集パネル（AdvanceMap の Frame_People1）。欄とバイトの対応は inventory 04 の表のとおり。
 * - 人 No. は表示だけ（イベント番号 + 1）。
 * - トレーナー（+12）と次の不明（+13）は core の trainerType（2 バイト）の下位・上位。
 * - 移動範囲(YX) は 1 バイト（上位 4 ビットが Y、下位 4 ビットが X）。
 */
export class PersonPanel extends ListKindPanel<PersonEvent> {
  private readonly script: HTMLButtonElement;

  constructor(host: PanelHost) {
    super(host, "person", "event-person");
    const f = ja.event.person;
    this.row(f.number, LABEL, this.spin("number", () => (this.current?.index ?? 0) + 1, null));
    this.row(f.graphics, LABEL, this.spin("graphics", (e) => e.graphicsId, (_e, v) => ({ graphicsId: v })));
    this.row(
      ja.event.unknown,
      LABEL,
      this.hex("unknown1", 2, 25, (e) => e.kind, (_e, v) => ({ kind: v }), { bits: 8 }),
      this.hex("unknown2", 2, 25, (e) => e.padding1, (_e, v) => ({ padding1: v }), { bits: 8 }),
    );
    this.row(
      ja.event.position,
      LABEL,
      this.hex("x", 4, 33, (e) => e.x, (_e, v) => ({ x: v }), { bits: 16 }),
      this.hex("y", 4, 33, (e) => e.y, (_e, v) => ({ y: v }), { bits: 16 }),
    );
    this.row(f.elevation, LABEL, this.hex("elevation", 2, 25, (e) => e.elevation, (_e, v) => ({ elevation: v }), { bits: 8 }));
    this.element.append(formLabel(f.movement));
    this.element.append(
      wrap(this.combo("movement", ja.event.movementTypes, 169, (e) => e.movementType, (_e, i) => ({ movementType: i })).element),
    );
    this.row(
      f.range,
      LABEL,
      this.hex(
        "range",
        2,
        25,
        (e) => (e.movementRangeY << 4) | e.movementRangeX,
        (_e, v) => ({ movementRangeX: v & 0xf, movementRangeY: (v >> 4) & 0xf }),
        { bits: 8 },
      ),
    );
    this.row(ja.event.unknown, LABEL, this.hex("unknown3", 2, 25, (e) => e.padding2, (_e, v) => ({ padding2: v }), { bits: 8 }));
    this.row(
      f.trainer,
      LABEL,
      this.check(
        "trainer",
        (e) => e.trainerType & 0xff,
        (e, on) => ({ trainerType: withByte(e.trainerType, on ? 1 : 0, false) }),
      ),
    );
    this.row(
      ja.event.unknown,
      LABEL,
      this.hex("unknown4", 2, 25, (e) => e.trainerType >> 8, (e, v) => ({ trainerType: withByte(e.trainerType, v, true) }), { bits: 8 }),
    );
    this.row(
      f.sight,
      LABEL,
      this.hex("sight", 4, 33, (e) => e.trainerRangeOrBerryTree, (_e, v) => ({ trainerRangeOrBerryTree: v }), { bits: 16 }),
    );
    this.row(
      ja.event.offset,
      LABEL,
      this.hex("script", 6, 65, (e) => e.script & 0xffffff, (e, v) => ({ script: withScriptOffset(e.script, v) }), { prefix: "$" }),
    );
    this.row(f.flag, LABEL, this.hex("flag", 4, 33, (e) => e.flag, (_e, v) => ({ flag: v }), { bits: 16 }));
    this.row(
      ja.event.unknown,
      LABEL,
      this.hex("unknown5", 2, 25, (e) => e.padding3 & 0xff, (e, v) => ({ padding3: withByte(e.padding3, v, false) }), { bits: 8 }),
      this.hex("unknown6", 2, 25, (e) => e.padding3 >> 8, (e, v) => ({ padding3: withByte(e.padding3, v, true) }), { bits: 8 }),
    );
    this.script = pushButton("event.person.openScript", ja.event.openScript, () => {
      if (this.current) host.openScript(this.current.event.script);
    }, "wide-button");
    this.element.append(this.script);
  }
}

/** 1 行に部品を 1 つだけ置く（ラベルの下のコンボ）。 */
export function wrap(element: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "form-row";
  row.append(element);
  return row;
}
