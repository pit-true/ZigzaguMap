/** ビルドの欄（スクリプトエディタの下）とメニューの文言（ZigzaguMap 独自）。 */
export const jaBuild = {
  menu: "ビルド",
  run: "ビルド",
  stop: "止める",
  clear: "ログを消す",
  close: "閉じる",
  noFile: "（ファイル不明）",
  openProblem: "押すとこの行を開きます",
  running: (step: number, total: number) => `ビルド中（${step}/${total}）…`,
  okShort: (ms: number) => `成功（${(ms / 1000).toFixed(1)} 秒）`,
  ngShort: (errors: number) => `失敗（エラー ${errors} 件）`,
  stepStart: (step: number, total: number, text: string) => `手順 ${step}/${total}: ${text}`,
  copied: (from: string, to: string, bytes: number) => `${from} を ${to} へ写しました（${bytes} バイト）`,
  includedLog: (path: string) => `ログ ${path} を読みました（下に続けます）`,
  copyArgs: "copy の手順には、写すファイルと写し先の 2 つを args に書いてください",
  succeeded: (ms: number, rom: string | null) => `ビルドが終わりました（${(ms / 1000).toFixed(1)} 秒）${rom ? `。出力: ${rom}` : ""}`,
  failed: (ms: number, step: number | null, code: number | null) =>
    `ビルドに失敗しました（${(ms / 1000).toFixed(1)} 秒${step !== null ? `、手順 ${step}` : ""}${code !== null ? `、終了コード ${code}` : ""}）`,
  mainDirty: (count: number) => `マップなどに出力していない変更が ${count} 件あります。出力してからビルドしますか？\n「いいえ」で出力せずにビルドします。`,
  configFailed: (error: string) => `zigzagumap.json を読めないのでビルドできません: ${error}`,
  noProject: "ビルドするには、プロジェクトフォルダ（CFRU-JP のフォルダ）を開いてください",
};
