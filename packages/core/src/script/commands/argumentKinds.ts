/**
 * 命令の引数の種類と役割の推定。
 * Gen3 Script Assistant 改造版の `inferArgumentInfo` と `commandArgumentOverrides` の規則を移したもの。
 * 文字列の引数は拡張のように命令ごとに直書きせず、マクロの本文で 4 バイトのまま書く引数（ポインタ）から求める。
 * ND の 0F は 2 ポインタ、Chronos は 1 ポインタなので、文字列の引数の数はマクロから自然に決まる。
 */

/** 引数の種類。 */
export type CommandArgumentKind = "string" | "label" | "movement" | "variable" | "flag" | "constant";

/** 種類と役割（ホバーに出す説明）。 */
export interface CommandArgumentRole {
  kind: CommandArgumentKind;
  role: string;
}

/** 推定に使う引数の情報。 */
export interface CommandArgumentShape {
  name: string;
  index: number;
  /** マクロの本文で 4 バイトのまま書く（`.4byte \引数`・`.word \引数`）。 */
  pointer: boolean;
  /** 本文でそのまま書く大きさ（バイト）の一覧。分からなければ空。 */
  sizes: readonly number[];
}

/** 命令ごとの上書き（引数の番号順）。拡張の commandArgumentOverrides に、ポインタの引数の分を足した。 */
const OVERRIDES: Record<string, (CommandArgumentRole | undefined)[]> = {
  if: [
    { kind: "constant", role: "比較条件" },
    { kind: "constant", role: "分岐方法 (_goto / _call)" },
    { kind: "label", role: "分岐先スクリプトのラベル" },
  ],
  call: [{ kind: "label", role: "呼び出すスクリプトのラベル" }],
  goto: [{ kind: "label", role: "ジャンプ先スクリプトのラベル" }],
  jump: [{ kind: "label", role: "ジャンプ先スクリプトのラベル" }],
  goto_if: [
    { kind: "constant", role: "比較条件" },
    { kind: "label", role: "条件成立時のジャンプ先" },
  ],
  ifcall: [
    { kind: "constant", role: "比較条件" },
    { kind: "label", role: "条件成立時の呼び出し先" },
  ],
  cond: [
    { kind: "constant", role: "比較条件" },
    { kind: "constant", role: "分岐方法 (_goto / _call)" },
    { kind: "label", role: "分岐先スクリプトのラベル" },
  ],
  case: [
    { kind: "constant", role: "switch と比較する値" },
    { kind: "label", role: "一致した場合の分岐先" },
  ],
  copyvar: [
    { kind: "variable", role: "コピー先イベント変数" },
    { kind: "variable", role: "コピー元イベント変数" },
  ],
  copyvarifnotzero: [
    { kind: "variable", role: "コピー先イベント変数" },
    { kind: "variable", role: "コピー元の値またはイベント変数" },
  ],
  setvar: [
    { kind: "variable", role: "代入先イベント変数" },
    { kind: "constant", role: "代入する値" },
  ],
  addvar: [
    { kind: "variable", role: "加算先イベント変数" },
    { kind: "constant", role: "加算する値" },
  ],
  subvar: [
    { kind: "variable", role: "減算先イベント変数" },
    { kind: "constant", role: "減算する値" },
  ],
  cmpvar: [
    { kind: "variable", role: "比較するイベント変数" },
    { kind: "constant", role: "比較する値" },
  ],
  compare: [
    { kind: "variable", role: "比較するイベント変数" },
    { kind: "constant", role: "比較する値" },
  ],
  cmpvars: [
    { kind: "variable", role: "左辺のイベント変数" },
    { kind: "variable", role: "右辺のイベント変数" },
  ],
  special2: [
    { kind: "variable", role: "結果を格納するイベント変数" },
    { kind: "constant", role: "実行するSpecial ID" },
  ],
  specialvar: [
    { kind: "variable", role: "結果を格納するイベント変数" },
    { kind: "constant", role: "実行するSpecial ID" },
  ],
  setflag: [{ kind: "flag", role: "ONにするイベントフラグ" }],
  clearflag: [{ kind: "flag", role: "OFFにするイベントフラグ" }],
  checkflag: [{ kind: "flag", role: "状態を確認するイベントフラグ" }],
  bufferpokemon: [
    { kind: "constant", role: "出力先テキストバッファ (0=BUFFER1, 1=BUFFER2, 2=BUFFER3)" },
    { kind: "constant", role: "表示するポケモンの種族" },
  ],
  applymovement: [
    { kind: "constant", role: "移動させるオブジェクトID" },
    { kind: "movement", role: "移動データのラベル" },
    { kind: "constant", role: "対象マップのグループ番号" },
    { kind: "constant", role: "対象マップ番号" },
  ],
  mart: [{ kind: "label", role: "商品リストのラベル" }],
  mart2: [{ kind: "label", role: "商品リストのラベル" }],
  mart3: [{ kind: "label", role: "商品リストのラベル" }],
  callasm: [{ kind: "label", role: "呼び出すTHUMB関数" }],
  callnative: [{ kind: "label", role: "呼び出すネイティブ関数" }],
  callasm2: [{ kind: "label", role: "呼び出すARM関数" }],
  // ここから下は、4 バイトの引数のうち文字列ではないもの（拡張では種類を出していなかった）。
  writebyte: [undefined, { kind: "constant", role: "書き込むアドレス" }],
  addmoney: [{ kind: "constant", role: "加える金額" }],
  submoney: [{ kind: "constant", role: "減らす金額" }],
  checkmoney: [{ kind: "constant", role: "確かめる金額" }],
  cmphidevar: [undefined, { kind: "constant", role: "比較する値" }],
  virtualgoto: [{ kind: "label", role: "ジャンプ先（仮想オフセット）" }],
  virtualcall: [{ kind: "label", role: "呼び出し先（仮想オフセット）" }],
  virtualgotoif: [undefined, { kind: "label", role: "条件成立時のジャンプ先（仮想オフセット）" }],
  virtualcallif: [undefined, { kind: "label", role: "条件成立時の呼び出し先（仮想オフセット）" }],
  mapscript: [
    { kind: "constant", role: "マップスクリプトの種類" },
    { kind: "label", role: "スクリプトまたは条件表のラベル" },
  ],
};

/** 拡張でラベルとみなす引数の名前。 */
const LABEL_NAME = /^(destination|script|label|movements?|products?|subroutine|func|intro\d*|loss\d*|win|cantbattle|cannotbattle\d*|extra\d*|dest)$/;
/** 拡張でイベント変数とみなす引数の名前。 */
const VARIABLE_NAME = /^(var\d*|variable|output|destination|source|dest)$/;
/** 4 バイトのまま書く引数のうち、文字列とみなす名前（`_kanji` などの付いたものも含む）。 */
const STRING_NAME = /^(text|pointer|value|offset|top|bottom|string|message|msg)\d*(_?(kanji|hiragana))?$/;

/** 名前の部分からの役割（拡張の rolePatterns）。 */
const ROLE_PATTERNS: [RegExp, string][] = [
  [/condition/, "比較条件"],
  [/goto_or_call/, "分岐方法"],
  [/flag/, "イベントフラグ"],
  [/species/, "ポケモン種族"],
  [/item/, "アイテム"],
  [/move|attack/, "技"],
  [/trainer|foeindex|partnerindex/, "トレーナーID"],
  [/localid|npc|index/, "オブジェクトまたは対象ID"],
  [/direction/, "向き"],
  [/mapgroup|bank/, "マップグループ"],
  [/mapnum|^map$/, "マップ番号"],
  [/x_axis|^x$/, "X座標"],
  [/y_axis|^y$/, "Y座標"],
  [/quantity|amount|count/, "数量"],
  [/level/, "レベル"],
  [/sound|song|fanfare/, "サウンドID"],
  [/type/, "種類"],
  [/value|param|argument|byte|word|num|time|speed|effect|limit/, "指定値"],
];

/** `top_kanji` → `top` のように、ひらがな・漢字の印を外した名前。 */
function stringBase(name: string): string {
  return name.toLowerCase().replace(/_?(kanji|hiragana)$/, "");
}

/** 文字列の引数の役割。同じ命令に `X` と `X_kanji` が並ぶときは、ひらがな・漢字を付ける。 */
function stringRole(arg: CommandArgumentShape, all: readonly CommandArgumentShape[]): string {
  const lower = arg.name.toLowerCase();
  const base = stringBase(arg.name);
  const isKanji = /_?kanji$/.test(lower);
  const paired = all.some((a) => a !== arg && a.pointer && stringBase(a.name) === base);
  const head = base === "top" ? "上選択肢" : base === "bottom" ? "下選択肢" : null;
  if (!paired) return head ?? "テキスト";
  if (head) return `${head}・${isKanji ? "漢字" : "ひらがな"}`;
  return isKanji ? "漢字テキスト" : "ひらがなテキスト";
}

/**
 * 引数 1 つの種類と役割を推定する。
 * 順番は、(1) 命令ごとの上書き、(2) 4 バイトの文字列らしい引数、(3) 引数の名前の規則。
 * 名前の規則は、本文での大きさが合うときだけ使う（1 バイトの destination をラベルや変数にしない）。
 */
export function inferCommandArgumentRole(
  command: string,
  arg: CommandArgumentShape,
  all: readonly CommandArgumentShape[],
): CommandArgumentRole {
  const override = OVERRIDES[command.toLowerCase()]?.[arg.index];
  const lower = arg.name.toLowerCase();
  if (!override && arg.pointer && STRING_NAME.test(lower)) {
    return { kind: "string", role: stringRole(arg, all) };
  }
  if (override) return override;

  const fits = (size: number) => arg.sizes.length === 0 || arg.sizes.includes(size);
  if (LABEL_NAME.test(lower) && fits(4)) {
    return /^movements?$/.test(lower)
      ? { kind: "movement", role: `${arg.name}: 移動データのラベル` }
      : { kind: "label", role: `${arg.name}: 参照先ラベル/アドレス` };
  }
  if (VARIABLE_NAME.test(lower) && fits(2)) return { kind: "variable", role: `${arg.name}: イベント変数` };
  if (/^(out|buf)$/.test(lower)) return { kind: "constant", role: `${arg.name}: 出力先テキストバッファ` };

  const role = ROLE_PATTERNS.find(([pattern]) => pattern.test(lower))?.[1] ?? "命令の引数";
  return { kind: role === "イベントフラグ" ? "flag" : "constant", role: `${arg.name}: ${role}` };
}

/** 0x800D などの変数の説明（拡張の describeScriptVariable）。知らなければ null。 */
export function describeScriptVariable(value: number): string | null {
  if (value === 0x800d) return "LASTRESULT: 直前に実行したスクリプト命令の結果";
  if (value >= 0x8000 && value <= 0x800f) return "一時スクリプト変数";
  if (value >= 0x4000 && value <= 0x40ff) return "セーブデータに保持されるイベント変数";
  return null;
}
