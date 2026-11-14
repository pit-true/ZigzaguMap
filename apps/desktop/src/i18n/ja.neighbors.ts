/** 隣のマップの帯と、接続のつまみの文言（Phase3。ZigzaguMap 独自）。 */
export const jaNeighbors = {
  /** 表示 > 隣のマップ（見せ方の切り替え）。 */
  menu: "隣のマップ",
  viewBand: "境界から 8 ブロックの帯",
  viewAll: "マップ全体",
  viewOff: "出さない",
  /** 設定 > 接続のずれを相手のマップにもそろえる（#229）。 */
  alignConnections: "接続のずれを相手のマップにもそろえる",
  /** 角のつまみ（#229）。 */
  cornerHint: "ドラッグで接続のずれを変える（相手のマップもそろえる）",
  shifting: (offset: number) => `接続のずれ: ${offset}`,
  shifted: (offset: number, other: number) => `接続のずれを ${offset} にしました（相手のマップは ${other}）`,
  shiftedOneSide: (offset: number) => `接続のずれを ${offset} にしました。相手のマップに逆向きの接続が無いので、このマップだけ変えました`,
  /** 辺のつまみと右クリックのメニュー（#230）。 */
  edgeHint: "ドラッグで広げる・縮める。右クリックで接続のメニュー",
  menuNewMap: "新しいマップを作ってつなぐ…",
  menuConnect: "既存のマップとつなぐ…",
  menuRemove: (name: string) => `接続を消す（${name}）…`,
  menuRemoveDive: (name: string) => `ダイブ先の接続を消す（${name}）…`,
  menuRemoveEmerge: (name: string) => `浮上先の接続を消す（${name}）…`,
  menuDiveNew: "ダイブ先を作ってつなぐ…",
  menuDiveConnect: "ダイブ先をつなぐ…",
  menuEmergeNew: "浮上先を作ってつなぐ…",
  menuEmergeConnect: "浮上先をつなぐ…",
  bankTitle: "新しいマップのバンク",
  bankPrompt: (newBank: number) => `新しいマップを置くバンクの番号（0〜${newBank}。${newBank} は新しいバンク）`,
  bankInvalid: (newBank: number) => `バンクの番号は 0〜${newBank} で入れてください`,
  bankFull: (bank: number) => `バンク ${bank} はいっぱいです（255 枚まで）`,
  created: (bank: number, map: number, w: number, h: number) => `新しいマップ ${bank}.${map}（${w}×${h}）を作ってつなぎました`,
  pickTitle: "つなぐマップ",
  pickDiveTitle: "ダイブ・浮上でつなぐマップ",
  pickPrompt: "マップを選んでください（番号「3.19」か名前の一部で絞り込めます）",
  pickFilter: "絞り込み",
  connected: (bank: number, map: number, offset: number) => `${bank}.${map} とつなぎました（ずれ ${offset}）`,
  confirmRemove: (bank: number, map: number) => `${bank}.${map} との接続を消しますか？\n相手のマップの逆向きの接続も消します。`,
  removed: (bank: number, map: number) => `${bank}.${map} との接続を消しました`,
  /** 辺のつまみのドラッグでのリサイズ（#231）。 */
  resizing: (w: number, h: number) => `大きさ: ${w}×${h}`,
  resized: (w: number, h: number) => `大きさを ${w}×${h} にしました`,
  refsTitle: "直していない座標",
  refsText: "マップの左・上をずらしましたが、次の .s の行の座標は直していません。必要なら手で直してください。",
  refsMore: (n: number) => `ほかに ${n} 行`,
} as const;
