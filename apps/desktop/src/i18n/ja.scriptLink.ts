/** メインウィンドウのスクリプト連携（イベントのラベル・ひな形・マップスクリプトの表・取り込み）の文言（ZigzaguMap 独自）。 */
export const jaScriptLink = {
  noScriptFile: (bank: number, map: number) => `マップ ${bank}.${map} のスクリプトを書く .s が maps\scripts.json にありません。ファイル名を入れて作ってください`,
  templateWritten: (labels: readonly string[], path: string) => `ひな形 ${labels.join("、")} を ${path} に書きました`,
  templateRemoved: "ひな形を .s と .string から除きました",
  templateRewritten: (paths: readonly string[]) => `ひな形を書き直しました: ${paths.join("、")}`,
  templateKept: (paths: readonly string[]) => `ひな形に手が入っているので残しました: ${paths.join("、")}`,
  writeFailed: (path: string, error: string) => `${path} に書けませんでした: ${error}`,
  fileMissing: (path: string) => `${path} がありません`,
  editorWriteFailed: (path: string) => `${path} をエディタで書き換えられませんでした`,
  noProjectFolder: "プロジェクトフォルダが開かれていません",
  labelsNeedProject: "イベントのラベルを付けるには、プロジェクトフォルダ（CFRU-JP のフォルダ）を開いてください",
  scriptsJsonBroken: (error: string) => `maps/scripts.json を読めないため編集できません: ${error}`,
  replaceKept: (paths: readonly string[]) => `あとで手が入っているので、本文を戻しませんでした: ${paths.join("、")}`,
  tableNoScript: (bank: number, map: number) => `マップ ${bank}.${map} のマップスクリプトの表を書く .s が maps\scripts.json にありません`,
};
