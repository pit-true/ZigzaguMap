import type { MapId } from "@zigzagumap/core";

/** スクリプトを開くイベント（番号は並びの中の位置、0 から。`map` はマップスクリプトで番号を使わない）。 */
export interface ScriptTarget {
  readonly map: MapId;
  readonly kind: "person" | "sign" | "trap" | "map";
  readonly index?: number;
}

/**
 * 「スクリプトを開く」の入口（イベントのダブルクリック、イベントタブの各パネル、場所の設定タブのマップスクリプト）。
 * 中身（内蔵のスクリプトエディタの窓口 `ScriptHost`）は App が `installScriptEntry` で差し込み、初めて開くときに読み込む。
 * このファイルはメインの起動で読むので、重いものを import しない。
 */
export interface ScriptEntry {
  /** 開けるか（プロジェクトフォルダを開いているとき）。 */
  readonly available: boolean;
  /** イベントのスクリプトを開く（eventscripts と maps\scripts.json からファイルと行を求める）。 */
  open(target: ScriptTarget): void;
  /** ファイルを開く（行は 1 から）。開けるのは assembly/overworld_scripts と strings の中だけ。 */
  openFile(path: string, line?: number): void;
  /** ROM のポインタのスクリプトを開く（素の ROM のスクリプトの表示 #205 / #206 で作る。今は何もしない）。 */
  openPointer(pointer: number): void;
}

/** 差し込む中身。 */
export interface ScriptEntryImpl {
  available(): boolean;
  open(target: ScriptTarget): void;
  openFile(path: string, line?: number): void;
}

let impl: ScriptEntryImpl | null = null;

/** 入口に中身を差し込む（App の起動で 1 回）。 */
export function installScriptEntry(value: ScriptEntryImpl): void {
  impl = value;
}

/** 今の入口。 */
export const scriptEntry: ScriptEntry = {
  get available() {
    return impl?.available() ?? false;
  },
  open: (target) => {
    if (impl?.available()) impl.open(target);
  },
  openFile: (path, line) => impl?.openFile(path, line),
  openPointer: () => undefined,
};

/**
 * 「スクリプトを開く」ボタンを出すか。ボタンは画面を作るときに 1 回だけ決まり、まだポインタしか渡せないので、
 * イベントタブのスクリプト欄（#200）で出し方を決めるまで隠す。ダブルクリックからは開ける。
 */
export const SCRIPT_BUTTONS_SHOWN = false;

/** 「スクリプトを開く」ボタンを、出すときだけ見せる。 */
export function showIfScriptEntry<T extends HTMLElement>(button: T): T {
  button.hidden = !SCRIPT_BUTTONS_SHOWN;
  if (!SCRIPT_BUTTONS_SHOWN) button.dataset["scriptEntry"] = "off";
  return button;
}
