import { ini } from "./ini";

/** マップスクリプトの専用パネル（場所の設定タブのかんたん表示。#208）の文言（ZigzaguMap 独自）。 */
export const jaMapScriptPanel = {
  romOnly: "プロジェクトフォルダを開くと、マップスクリプトの表を .s に書いて編集できます。今の ROM のマップスクリプト:",
  noTable: "このマップのマップスクリプトの表は、まだ .s にありません。「表を作る」で今の内容を .s の表にします（ビルドしても動きは変わりません）。",
  externalTable: (label: string) => `eventscripts の map の行が ${label} を指しています（ZigzaguMap では編集しない表）。「表を作る」で ZigzaguMap の表に置き換えます。`,
  romEmpty: "（マップスクリプトはありません）",
  romTable: (rows: number) => `条件表 ${rows} 行`,
  view: "見る",
  create: "表を作る",
  tableLabel: (label: string) => `表のラベル: ${label}（.s の ZigzaguMap の印の行の間に書き、eventscripts の map の行で指します。出力のときに書きます）`,
  empty: "（種類がありません。下で足してください）",
  addPrompt: "種類を足す…",
  removeTable: "表をやめる",
  remove: ini.Header["9510"],
  open: "開く",
  addCondition: "条件を足す",
  variable: "変数",
  value: "値",
  noScriptFile: (bank: number, map: number) => `マップ ${bank}.${map} の .s が maps\scripts.json にありません。ファイル名を入れて作ってください`,
  templateWritten: (label: string, path: string) => `ひな形 ${label} を ${path} に書きました`,
};
