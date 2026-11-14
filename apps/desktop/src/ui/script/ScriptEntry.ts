import type { MapId } from "@zigzagumap/core";

/** スクリプトを開くイベント（番号は並びの中の位置、0 から。`map` はマップスクリプトで番号を使わない）。 */
export interface ScriptTarget {
  readonly map: MapId;
  readonly kind: "person" | "sign" | "trap" | "map";
  readonly index?: number;
}

/**
 * 「スクリプトを開く」の入口（イベントのダブルクリック、イベントタブの各パネルのボタン、場所の設定タブのマップスクリプト）。
 * 中身（内蔵のスクリプトエディタの窓口 `ScriptHost`）は App が `installScriptEntry` で差し込み、初めて開くときに読み込む。
 * このファイルはメインの起動で読むので、重いものを import しない。
 */
export interface ScriptEntry {
  /** 開けるか（ROM を開いているとき）。 */
  readonly available: boolean;
  /**
   * イベントのスクリプトを開く。ラベルが付いていれば（scripts_MM.json・eventscripts）エディタのその行を開き、
   * 無ければ `pointer`（ROM のポインタ）のスクリプトを読み取り専用で出す。
   */
  open(target: ScriptTarget, pointer?: number | null): void;
  /** ファイルを開く（行は 1 から）。開けるのは assembly/overworld_scripts と strings の中だけ。 */
  openFile(path: string, line?: number): void;
  /** ROM のポインタのスクリプトを読み取り専用で出す（`target` はそのスクリプトを持つイベント。取り込みに使う）。 */
  openPointer(pointer: number, target?: ScriptTarget): void;
}

/** 差し込む中身。 */
export interface ScriptEntryImpl {
  available(): boolean;
  open(target: ScriptTarget, pointer: number | null): void;
  openFile(path: string, line?: number): void;
  openPointer(pointer: number, target: ScriptTarget | null): void;
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
  open: (target, pointer) => {
    if (impl?.available()) impl.open(target, pointer ?? null);
  },
  openFile: (path, line) => impl?.openFile(path, line),
  openPointer: (pointer, target) => {
    if (impl?.available()) impl.openPointer(pointer, target ?? null);
  },
};
