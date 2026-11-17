/** MCP の窓口（Phase7 #521）の文言（ZigzaguMap 独自）。 */
export const jaMcp = {
  /** 設定メニューのサブメニュー。 */
  menu: "MCP の窓口",
  bridge: "MCP の窓口を開く",
  allowWrite: "AI にマップの書き換えを許す",
  allowExport: "AI に出力を許す",
  allowScripts: "AI にスクリプトのファイルの書き換えを許す",
  opened: (port: number) => `MCP の窓口を開きました（127.0.0.1:${port}）`,
  closed: "MCP の窓口を閉じました",
  openFailed: (reason: string) => `MCP の窓口を開けません: ${reason}`,
  noRom: "ROM を開いていません。ZigzaguMap で ROM を開いてください。",
  noProject: "プロジェクトフォルダを開いていません。出力先は ZigzaguMap のファイル > 出力先を指定して出力 で決めてください。",
  unknownTool: (name: string) => `この ZigzaguMap には道具 ${name} がありません（MCP サーバーと ZigzaguMap のバージョンが違うかもしれません）`,
} as const;
