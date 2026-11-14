/**
 * 「スクリプトを開く」の入口（イベントタブの各パネルと、場所の設定タブのマップスクリプト）。
 * Phase1 では外部のスクリプトエディタとの連携を外したので、使える入口は無い（ボタンは隠す）。
 * Phase2 の内蔵スクリプトエディタは、`scriptEntry` を差し替えるだけで全部の入口から開けるようにする。
 */
export interface ScriptEntry {
  /** 開けるか（false ならボタンを隠し、ダブルクリックも何もしない）。 */
  readonly available: boolean;
  /** ポインタ（ROM のアドレス）のスクリプトを開く。 */
  open(pointer: number): void;
}

/** 今の入口（内蔵のスクリプトエディタができるまでは使えない）。 */
export const scriptEntry: ScriptEntry = {
  available: false,
  open: () => undefined,
};

/** 「スクリプトを開く」ボタンを、入口が使えるときだけ見せる。 */
export function showIfScriptEntry<T extends HTMLElement>(button: T): T {
  button.hidden = !scriptEntry.available;
  if (!scriptEntry.available) button.dataset["scriptEntry"] = "off";
  return button;
}
