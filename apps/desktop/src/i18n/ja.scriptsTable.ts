import { ini } from "./ini";

/**
 * scripts.json の対応表（ツール > スクリプトファイルの対応表）と、.s を新しく作るときのファイル名の入力の文言。
 * ZigzaguMap 独自の画面。AdvanceMap と同じ言葉（追加・削除・マップ名など）だけ Japanese.ini から引く。
 */
export const jaScriptsTable = {
  /** ツールメニューの項目と、表のダイアログの題名。 */
  menu: "スクリプトファイルの対応表",
  title: "スクリプトファイルの対応表（maps\\scripts.json）",
  intro: "バンク・マップごとに、スクリプトを書く .s と .string を決めます。マップを空欄にすると、バンク全体の行になります。",
  note: "変更は出力（Ctrl+S）で maps\\scripts.json に書きます。新しく作る .s と .string も、出力のときに作ります。",

  // 表の見出し
  colBank: "バンク",
  colMap: ini.Menue["114"],
  colName: "マップ名",
  colScript: ".s",
  colStrings: ".string",
  /** マップの欄が空（バンク全体）の行。 */
  wholeBank: "（全体）",
  /** .string を省いた行（既定の名前を使う）。 */
  defaultStrings: (path: string) => `${path}（既定）`,
  /** 出力のときに .s を作る行の印。 */
  newMark: "新規",
  empty: "行がありません。「新しい .s を作る」か「追加」で足してください。",

  // 下の入力欄
  bank: "バンク:",
  map: ini.WorldMapEditor["20"],
  mapHint: "空欄でバンク全体",
  name: ini.Header["900"],
  script: ".s:",
  strings: ".string:",
  stringsHint: "空欄なら overworld_strings_<.s の名前>.string",

  // ボタン
  add: ini.AnbindungsForm["1367"],
  save: "変更を保存",
  remove: ini.AnbindungsForm["1368"],
  up: "上へ",
  down: "下へ",
  newScript: "新しい .s を作る",
  close: "閉じる",

  // 警告・エラー
  duplicate: (first: number, duplicate: number) => `${duplicate + 1} 行目は ${first + 1} 行目と同じバンク・マップを指しているため使われません。`,
  loadError: (reason: string) => `maps\\scripts.json を読めません。直すまで編集できません（${reason}）`,
  noProject: "CFRU-JPのフォルダを開いてから使ってください。",
  confirmRemove: (row: number) => `${row} 行目を対応表から消しますか？（.s と .string のファイルは消しません）`,
  notSelected: "行を選んでください。",
  invalidBank: (text: string) => `バンクは 0〜255 の数で入れてください: ${text}`,
  invalidMap: (text: string) => `マップは 0〜255 の数か空欄で入れてください: ${text}`,
  /** パスが使えない理由（EditError の reason）。 */
  pathProblem: {
    empty: "パスが空です",
    absolute: "プロジェクトフォルダからの相対パスにしてください",
    parent: "「..」や空の区切りは使えません",
    extension: "拡張子が違います",
    folder: "新しく作るファイルは .s は assembly/overworld_scripts、.string は strings の直下にだけ置けます",
    chars: "ファイル名には半角の英数字と「_」「-」「.」だけを使えます",
  } as Record<string, string>,
  invalidPath: (field: string, path: string, reason: string) => `${field === "script" ? ".s" : ".string"} のパスが使えません（${reason}）: ${path}`,
  indexOutOfRange: (index: number, count: number) => `行の番号が範囲外です: ${index}（行の数 ${count}）`,

  // .s を新しく作るときのファイル名の入力
  newTitle: ".s を新しく作る",
  newIntro: "assembly/overworld_scripts に作る .s のファイル名を入れてください。",
  /** マップにスクリプトが要るのに、対応する .s が無いとき。 */
  newNeeded: (bank: number, map: number) => `バンク ${bank} マップ ${map} に対応する .s がありません。新しく作る .s のファイル名を入れてください。`,
  fileName: ini.NewMapForm["10"],
  fileNameHint: "例: 03_00_masara",
  willCreate: (script: string, strings: string) => `作るファイル: ${script} と ${strings}`,
  create: ini.NewMapForm["15"],
  cancel: ini.NewMapForm["16"],
  invalidFileName: "ファイル名を入れてください。",
  existsAsk: (path: string) => `${path} は既にあります。作らずに、対応表に足すだけにしますか？`,
  added: (script: string) => `対応表に足しました。出力（Ctrl+S）で ${script} を作ります`,
  addedExisting: (script: string) => `対応表に足しました: ${script}`,
} as const;
