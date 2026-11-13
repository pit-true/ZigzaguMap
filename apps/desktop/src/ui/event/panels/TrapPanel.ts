import type { TrapEvent } from "@zigzagumap/core";
import { ja } from "../../../i18n/ja";
import { pushButton } from "../../form/valueControls";
import { ListKindPanel, withByte, withScriptOffset, type PanelHost } from "./KindPanel";

const LABEL = 96;

/**
 * 「スクリプト」（スクリプトタイル）の編集パネル（AdvanceMap の Frame_Script1）。
 * 「フラグバリュー」は +4 の 2 バイト（core の elevation と padding1）、不明 ×2 は +10 の 2 バイト（padding2）の下位・上位。
 */
export class TrapPanel extends ListKindPanel<TrapEvent> {
  constructor(host: PanelHost) {
    super(host, "trap", "event-trap");
    const f = ja.event.trap;
    this.row(
      ja.event.position,
      LABEL,
      this.hex("x", 4, 33, (e) => e.x, (_e, v) => ({ x: v }), { bits: 16 }),
      this.hex("y", 4, 33, (e) => e.y, (_e, v) => ({ y: v }), { bits: 16 }),
    );
    this.row(
      f.flagValue,
      LABEL,
      this.hex("flagValue", 4, 49, (e) => e.elevation | (e.padding1 << 8), (_e, v) => ({ elevation: v & 0xff, padding1: v >> 8 }), { bits: 16 }),
    );
    this.row(f.variable, LABEL, this.hex("variable", 4, 49, (e) => e.variable, (_e, v) => ({ variable: v }), { bits: 16 }));
    this.row(f.value, LABEL, this.hex("value", 4, 49, (e) => e.value, (_e, v) => ({ value: v }), { bits: 16 }));
    this.row(
      ja.event.unknown,
      LABEL,
      this.hex("unknown1", 2, 25, (e) => e.padding2 & 0xff, (e, v) => ({ padding2: withByte(e.padding2, v, false) }), { bits: 8 }),
      this.hex("unknown2", 2, 25, (e) => e.padding2 >> 8, (e, v) => ({ padding2: withByte(e.padding2, v, true) }), { bits: 8 }),
    );
    this.row(
      ja.event.offset,
      LABEL,
      this.hex("script", 6, 65, (e) => e.script & 0xffffff, (e, v) => ({ script: withScriptOffset(e.script, v) }), { prefix: "$" }),
    );
    this.element.append(
      pushButton("event.trap.openScript", ja.event.openScript, () => {
        if (this.current) host.openScript(this.current.event.script);
      }, "wide-button"),
    );
  }
}
