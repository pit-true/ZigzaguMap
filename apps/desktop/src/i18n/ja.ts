/** 画面の文言（日本語）。文言はすべてここに集める。 */
export const ja = {
  appTitle: "ZigzaguMap",
  openRom: "ROMを開く",
  noRom: "ROMが開かれていません",
  dropHint: "ROM（.gba）をここにドラッグ＆ドロップするか、「ROMを開く」を押してください",
  mapList: "マップ一覧",
  bank: (bank: number) => `バンク ${bank}`,
  mapLabel: (bank: number, map: number) => `${bank}.${map}`,
  loading: "読み込み中…",
  loaded: (code: string, maps: number) => `${code} を読み込みました（マップ ${maps} 枚）`,
  mapInfo: (bank: number, map: number, width: number, height: number) => `マップ ${bank}.${map}（${width}×${height}）`,
  error: (message: string) => `エラー: ${message}`,
  unsupportedFile: "対応していないファイルです（.gba を選んでください）",
} as const;

/** 文言の型。 */
export type Messages = typeof ja;
