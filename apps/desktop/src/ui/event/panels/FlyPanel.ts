import { SetFlyPositionCommand, type FlyPosition } from "@zigzagumap/core";
import { ja } from "../../../i18n/ja";
import { KindPanel, type FieldPatch, type PanelHost } from "./KindPanel";

const LABEL = 96;

/**
 * 「フライトポジション」のパネル（AdvanceMap の Frame_FlugPos1）。座標・不明は 4 桁まで（MaxLength=4）。
 * バンク・マップを変えると、このマップのフライトポジションではなくなる（注意文のとおり）。
 * 値は ROM の表の写しに書き、アンドゥできる。maps\ の形式に置き場所が無いため出力はしない。
 */
export class FlyPanel extends KindPanel<FlyPosition> {
  constructor(host: PanelHost) {
    super(host, "event.fly", "event-fly");
    const f = ja.event.fly;
    this.row(
      ja.event.position,
      LABEL,
      this.hex("x", 4, 33, (e) => e.x, (_e, v) => ({ x: v }), { bits: 16, maxLength: 4 }),
      this.hex("y", 4, 33, (e) => e.y, (_e, v) => ({ y: v }), { bits: 16, maxLength: 4 }),
    );
    this.row(ja.event.unknown, LABEL, this.hex("unknown", 4, 33, (e) => e.unknown, (_e, v) => ({ unknown: v }), { bits: 16, maxLength: 4 }));
    const note = document.createElement("p");
    note.className = "event-note";
    note.textContent = f.warning;
    this.element.append(note);
    this.row(f.bank, LABEL, this.spin("bank", (e) => e.bank, (_e, v) => ({ bank: v })));
    this.row(f.map, LABEL, this.spin("map", (e) => e.map, (_e, v) => ({ map: v })));
  }

  protected override commit(index: number, fields: FieldPatch, key: string): void {
    this.host.editor.run(new SetFlyPositionCommand({ index, fields: fields as Record<string, number> }), key);
  }
}
