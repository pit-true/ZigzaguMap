/** 設定 > ショートカットの変更…（Phase5 #392）の文言（ZigzaguMap 独自）。 */
export const jaShortcutEdit = {
  menu: "ショートカットの変更…",
  title: "ショートカットの変更",
  note: "キーの欄を押してから、決めたいキーを押します。1 つの操作に 2 つまで決められます。OK で決めるとすぐ使えます。スクリプトエディタのキーは変えられません。",
  headerAction: "操作",
  headerWhere: "使える所",
  headerKey1: "キー 1",
  headerKey2: "キー 2",
  none: "（なし）",
  waiting: "キーを押す…",
  clear: "外す",
  reset: "既定に戻す",
  changed: "ショートカットを変えました",
  /** 表の操作の名前（ショートカット一覧では 2 行に分けているもの）。 */
  dragCancel: "ドラッグを取りやめる（矩形塗り・入れ替え・矩形の選択・マップシフト）",
  /** 重なりを聞く窓。 */
  conflictTitle: "キーの重なり",
  conflict: (key: string, other: string) => `${key} は「${other}」にも決めてあります。どちらに残しますか（残さない方からは ${key} を外します）。`,
  keepNew: (mine: string) => `「${mine}」に残す`,
  keepOld: (other: string) => `「${other}」に残す`,
};
