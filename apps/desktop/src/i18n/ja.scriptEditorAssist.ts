/**
 * スクリプトエディタの機能（色付けとテーマ・補完・ホバー・定義へ移動・検索と置換・波線・文字列の編集・幅検査）の文言（ZigzaguMap 独自）。
 * エディタの土台の文言は ja.scriptEditor.ts。
 */
export const jaScriptEditorAssist = {
  // ---- テーマ（#191） ----
  themeLabel: "テーマ",
  themes: {
    darkPlus: "Dark+ 風",
    lightPlus: "Light+ 風",
    monokai: "Monokai 風",
    solarizedDark: "Solarized Dark 風",
  } as Record<string, string>,
  themeChanged: (name: string) => `テーマを「${name}」にしました`,

  // ---- CodeMirror の部品の文言（EditorState.phrases） ----
  phrases: {
    Find: "検索",
    Replace: "置換",
    next: "次へ",
    previous: "前へ",
    all: "すべて",
    "match case": "大文字小文字を区別",
    regexp: "正規表現",
    "by word": "単語単位",
    replace: "置換",
    "replace all": "すべて置換",
    close: "閉じる",
    "current match": "今の一致",
    "replaced $ matches": "$ 件を置換しました",
    "replaced match on line $": "$ 行目の一致を置換しました",
    "on line": "行目",
    "Go to line": "行へ移動",
    go: "移動",
    Diagnostics: "問題",
    "No diagnostics": "問題はありません",
    Completions: "補完の候補",
    "Control character": "制御文字",
    "Selection deleted": "選択を削除しました",
  } as Record<string, string>,

  // ---- ホバー（#192・#196） ----
  hover: {
    signature: (text: string) => `引数: \`${text}\``,
    source: (path: string, line: number) => `場所: \`${path}:${line}\``,
    required: "必須の引数",
    defaultValue: (value: string) => `省略時: \`${value}\``,
    equValue: (value: string) => `定義値: \`${value}\``,
    number: (decimal: number, hex: string) => `10 進: \`${decimal}\`、16 進: \`${hex}\``,
    aliases: (names: readonly string[]) => `同じ値の名前: ${names.map((n) => `\`${n}\``).join(", ")}`,
    stringEquNote: "本文は strings フォルダにありません。",
    omitted: "（省略。ひらがなと同じ文字列を使います）",
    stringMissing: "（strings フォルダに見つかりません）",
    edit: "本文を編集",
  },

  // ---- 補完（#192） ----
  completion: {
    command: "命令",
    directive: "ディレクティブ",
  },

  // ---- 定義へ移動（#193） ----
  definition: {
    notFound: (name: string) => `${name} の定義が見つかりません`,
    noWord: "カーソルの位置に名前がありません",
    outside: (name: string, path: string, line: number) => `${name} の定義は ${path} の ${line} 行目です（エディタでは開けないファイルです）`,
    moved: (name: string, path: string, line: number) => `${name} の定義（${path} の ${line} 行目）へ移動しました`,
    many: (count: number) => `（ほかに ${count} か所に同じ名前があります）`,
    noBack: "戻る場所がありません",
  },

  // ---- 波線（#195・#196） ----
  lint: {
    unknownCommand: (name: string) => `知らない命令です: ${name}（xse_commands.s のマクロにも、ARM / Thumb の命令にもありません）`,
    undefinedLabel: (name: string, role: string) => `${name} の定義が見つかりません${role ? `（${role}）` : ""}`,
    missingArgs: (name: string, missing: string) => `${name} の必須の引数が足りません: ${missing}`,
    tooManyArgs: (name: string, max: number, given: number) => `${name} の引数が多すぎます（${max} 個まで、${given} 個あります）`,
    duplicateString: (label: string, line: number) => `ラベル ${label} はこのファイルの ${line} 行目にもあります`,
    duplicateStringOther: (label: string, path: string, line: number) => `ラベル ${label} は ${path} の ${line} 行目にもあります`,
    textWidthColumns: (label: string, page: number, line: number, columns: number, limit: number) =>
      `${label} の ${page} ページ目 ${line} 行目が ${columns} 字です（1 行 ${limit} 字まで）`,
    textWidthLines: (label: string, page: number, limit: number) => `${label} の ${page} ページ目が ${limit} 行を超えています`,
  },

  // ---- 文字列の編集（#196） ----
  stringEdit: {
    title: (label: string) => `${label} の本文`,
    apply: "反映",
    cancel: "やめる",
    hint: "改行は \\n、改ページは \\p と書きます。反映すると .string が未保存になります（Ctrl+S で保存）。",
    lineInfo: (page: number, line: number, columns: number, limit: number) => `${page}-${line}: ${columns} / ${limit} 字`,
    applied: (label: string, path: string) => `${label} の本文を ${path} に反映しました（未保存）`,
    notFound: (label: string) => `${label} の #org が strings に見つかりません`,
  },

  // ---- 保存 ----
  savedAll: (count: number) => `${count} 件のファイルを保存しました`,

  // ---- ヘルプのショートカット一覧（#194） ----
  shortcuts: {
    where: "スクリプトエディタ",
    save: "表示中のファイルを保存（メインの「出力」は動かない）",
    saveAll: "未保存のファイルをすべて保存",
    closeTab: "表示中のタブを閉じる",
    cycleTab: "タブを切り替える",
    find: "検索",
    replace: "置換",
    findNext: "次・前の一致へ",
    nextOccurrence: "同じ文字列を選択に足す（複数カーソル）",
    allOccurrences: "同じ文字列をすべて選ぶ",
    rectangle: "矩形選択",
    ctrlClick: "定義へ移動（定義の無い所ではカーソルを足す）",
    addCursor: "上・下の行にカーソルを足す",
    moveLine: "行を上・下へ移す",
    copyLine: "行を上・下へ複製する",
    comment: "コメントの切り替え（.s は @、.string は //）",
    definition: "定義へ移動",
    back: "定義へ移動する前の位置へ戻る",
    complete: "補完の候補を出す",
    nextDiagnostic: "次の波線へ",
    diagnostics: "波線の一覧",
    gotoLine: "行へ移動",
    indent: "字下げ（タブ文字）",
  },
};
