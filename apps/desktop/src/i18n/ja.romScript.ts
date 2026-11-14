import { ini } from "./ini";

/** 素の ROM のスクリプトの表示と取り込み（#206・#207）の文言（ZigzaguMap 独自）。 */
export const jaRomScript = {
  header: (pointer: string) => `@ ROM 0x${pointer} のスクリプト（読み取り専用。「.s に取り込む」で、ラベルを付けてマップの .s へ書けます）`,
  stringsHeader: "@ ---- 文字列（取り込むと .string に書きます） ----",
  problemsHeader: "@ ---- 読めなかった箇所 ----",
  noRom: "ROM を開いていません",
  noProject: "取り込むには、プロジェクトフォルダ（CFRU-JP のフォルダ）を開いてください",
  noConfig: "スクリプトの設定（zigzagumap.json）を読めません",
  outOfRom: (pointer: string) => `0x${pointer} は ROM の外を指しています`,
  externalTable: (label: string) => `このマップのマップスクリプトは ${label} を指しています（ZigzaguMap の表ではない）。行き先は ${label} のある .s で書き換えてください`,
  notMapScriptTarget: (pointer: string) => `0x${pointer} はこのマップのマップスクリプトの行き先ではありません`,
  noScriptFile: (bank: number, map: number) => `マップ ${bank}.${map} の .s が maps\\scripts.json にありません。ツール > スクリプトファイルの対応表で作ってください`,
  imported: (label: string, path: string) => `ROM のスクリプトを ${label} として ${path} に取り込みました`,
  nothingToImport: (problems: string) => `取り込めるスクリプトがありません${problems ? `（${problems}）` : ""}`,
  reused: (label: string) => `このアドレスはもう ${label} として取り込んであるので、そのラベルを付けました`,
  // ---- エディタ側 ----
  importButton: ".s に取り込む",
  readOnly: "読み取り専用",
  notImportable: "プロジェクトフォルダを開いていないか、イベントやマップスクリプトの行き先のスクリプトではないので取り込めません",
  dialogTitle: ".s に取り込む",
  dialogText: "付けるラベルを確かめてください（変えられます）。灰色の行は前に取り込んだもので、そのラベルを使います。",
  kindNames: { script: ini.EventType["02"], string: "文字列", movement: "移動", mart: "ショップ" } as Readonly<Record<string, string>>,
  importOk: "取り込む",
  cancel: ini.NewMapForm["16"],
  noButton: (button: string) => `ボタンがありません: ${button}`,
  importDone: (label: string) => `${label} として取り込みました（元に戻すときはメインのウィンドウで Ctrl+Z）`,
  importFailed: (error: string) => `取り込めませんでした: ${error}`,
};
