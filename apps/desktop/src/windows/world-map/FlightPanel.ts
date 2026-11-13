import type { RegionMapDocument } from "@zigzagumap/core";
import { hex } from "../../i18n/ja";
import { jaWorldMap } from "../../i18n/ja.worldMap";
import { box, button, edit, label } from "./controls";

/**
 * 「フライトポジション マップ/座標」の欄（AdvanceMap の ScrollBox_FlugPos）。
 * 左の欄は空を飛ぶの行き先 3 バイト（バンク・マップ・飛び先の番号）、右の欄は飛び先 6 バイト（バンク・マップ・X・Y）を
 * ROM の並びのまま 16 進で出す。値は基本レイヤーの「ポジションの保存」で一緒に確定する。
 */
export class FlightPanel {
  private readonly flyEdit: HTMLInputElement;
  private readonly healEdit: HTMLInputElement;
  private readonly openButton: HTMLButtonElement;

  constructor(parent: HTMLElement, onOpen: () => void) {
    const b = box(parent, [257, 274, 212, 88]);
    label(b, [8, 8], jaWorldMap.flyPosition);
    this.flyEdit = edit(b, [8, 24, 57, 19], "Txt_FlugWert");
    this.healEdit = edit(b, [72, 24, 129, 19], "Txt_FlugPosWerte");
    this.openButton = button(b, [8, 56, 193, 25], jaWorldMap.openThisMap, "Cmd_GotoFlugPos", onOpen);
    this.flyEdit.maxLength = 6;
    this.healEdit.maxLength = 12;
  }

  /** 地名の行き先を表示する。行き先の表に無い地名なら空にして「このマップを開く」を押せなくする。 */
  show(doc: RegionMapDocument, id: number): void {
    const fly = doc.flyDestination(id);
    this.flyEdit.value = fly ? hex(fly.bank, 2) + hex(fly.map, 2) + hex(fly.heal, 2) : "";
    const heal = fly ? doc.healLocation(fly.heal) : null;
    this.healEdit.value = heal ? hex(heal.bank, 2) + hex(heal.map, 2) + le16(heal.x) + le16(heal.y) : "";
    this.flyEdit.disabled = !fly;
    this.healEdit.disabled = !heal;
    this.openButton.disabled = !fly;
  }

  /** 入力欄の文字列（行き先、飛び先）。 */
  input(): { fly: string; heal: string } {
    return { fly: this.flyEdit.value, heal: this.healEdit.value };
  }

  /** 行き先の欄が使えるか。 */
  get hasFly(): boolean {
    return !this.flyEdit.disabled;
  }

  /** 飛び先の欄が使えるか。 */
  get hasHeal(): boolean {
    return !this.healEdit.disabled;
  }
}

/** s16 を ROM の並び（下位・上位）の 16 進 4 桁にする。 */
function le16(v: number): string {
  const u = v & 0xffff;
  return hex(u & 0xff, 2) + hex(u >> 8, 2);
}
