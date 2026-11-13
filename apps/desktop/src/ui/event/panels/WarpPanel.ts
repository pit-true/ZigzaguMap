import type { WarpEvent } from "@zigzagumap/core";
import { ja } from "../../../i18n/ja";
import { pushButton } from "../../form/controls";
import { ListKindPanel, type PanelHost } from "./KindPanel";

const LABEL = 96;

/** 「ワープ」の編集パネル（AdvanceMap の Frame_Warp1）。「マップの移動」で行き先のマップを開く。 */
export class WarpPanel extends ListKindPanel<WarpEvent> {
  constructor(host: PanelHost) {
    super(host, "warp", "event-warp");
    const f = ja.event.warp;
    this.row(
      ja.event.position,
      LABEL,
      this.hex("x", 4, 33, (e) => e.x, (_e, v) => ({ x: v }), { bits: 16 }),
      this.hex("y", 4, 33, (e) => e.y, (_e, v) => ({ y: v }), { bits: 16 }),
    );
    this.row(f.elevation, LABEL, this.hex("elevation", 2, 25, (e) => e.elevation, (_e, v) => ({ elevation: v }), { bits: 8 }));
    this.row(f.warpId, LABEL, this.spin("warpId", (e) => e.warpId, (_e, v) => ({ warpId: v })));
    this.row(f.bank, LABEL, this.spin("bank", (e) => e.bank, (_e, v) => ({ bank: v })));
    this.row(f.map, LABEL, this.spin("map", (e) => e.map, (_e, v) => ({ map: v })));
    this.element.append(
      pushButton("event.warp.go", f.go, () => {
        const e = this.current?.event;
        if (e) host.goTo(e.bank, e.map, e.warpId);
      }, "wide-button"),
    );
  }
}
