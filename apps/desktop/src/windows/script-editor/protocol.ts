/**
 * メインウィンドウとスクリプトエディタ（別ウィンドウ）のやり取りの形。
 *
 * - テキストファイル（`.s`・`.string`）の正本はディスク。開いている間の編集中のバッファはエディタだけが持つ
 *   （マップの編集と違い、CommandBus と履歴は通さない）。読み書きはエディタが `fs_read_text` / `fs_write_text` で直接行う。
 * - エディタ → メイン: `script-editor:request`（ScriptEditorEnvelope）。返事は `script-editor:reply`（同じ id）。
 * - メイン → エディタ: `script-editor:open`（開くファイル）と、`script-editor:query`（未保存の確認など。
 *   エディタは `script-editor:answer` で同じ id の返事を返す）。
 * - 要求・問い合わせの種類を足すときは、`ScriptEditorRequestMap` / `ScriptEditorQueryMap` に 1 項目足し、受け手の処理の表
 *   （ScriptHost の `requestHandlers` / ScriptEditorWindow の `queryHandlers`）に 1 つ足す。送る側は型から中身と返事が決まる。
 */

/** スクリプトエディタのウィンドウのラベル（Tauri）。 */
export const SCRIPT_EDITOR_WINDOW = "script-editor";

/** ファイルを開く指示（行は 1 から。省略で先頭か、開いていれば今の位置のまま）。 */
export interface ScriptOpenRequest {
  readonly path: string;
  readonly line?: number;
}

/** 素の ROM のスクリプトを読み取り専用で開く指示（#206）。 */
export interface ScriptRomOpenRequest {
  /** タブの名前（`ROM:08XXXXXX`）。 */
  readonly key: string;
  readonly pointer: number;
  /** 表示する文（`.s` の書き方。文字列は `@` のコメントにして後ろに付ける）。 */
  readonly text: string;
  /** そのスクリプトを持つイベント（取り込みでラベルを付ける相手。無ければ null）。 */
  readonly target: ScriptRomTarget | null;
  /** 「.s に取り込む」が使えるか（プロジェクトフォルダを開いていて、イベントのスクリプトか、マップスクリプトの表の行き先のとき）。 */
  readonly importable: boolean;
  /** 取り込むときに付ける名前（一覧で確かめて変えられる）。 */
  readonly items: readonly { readonly kind: string; readonly pointer: number; readonly label: string; readonly reused: boolean }[];
}

/** ROM のスクリプトを持つイベント。 */
export interface ScriptRomTarget {
  readonly map: { readonly bank: number; readonly map: number };
  readonly kind: "person" | "sign" | "trap" | "map";
  readonly index?: number;
}

/** 要求・問い合わせ 1 種類の中身（`type` を除いたもの）と返事の型。 */
interface MessageSpec<A, R> {
  readonly args: A;
  readonly reply: R;
}

/** 中身の無い要求・問い合わせ。 */
type NoArgs = Record<never, never>;

/**
 * エディタ → メインの要求（種類 → 中身と返事）。メインは ScriptHost の `requestHandlers` で答える。
 * 種類を足すときは、ここに 1 項目足し、`requestHandlers` に処理を 1 つ足す（足し忘れると型の誤りになる）。
 */
export interface ScriptEditorRequestMap {
  /** 準備ができた。返事は、開くのを待っているファイル（ScriptEditorHello）。 */
  hello: MessageSpec<NoArgs, ScriptEditorHello>;
  /** ファイルを保存した（メインはラベルの索引のそのファイルの分を読み直す）。 */
  saved: MessageSpec<{ readonly path: string }, null>;
  /** メインの未出力の変更の数（ビルドの前に聞く）。 */
  mainDirty: MessageSpec<NoArgs, number>;
  /** メインで出力する（出力できたら true）。 */
  exportMain: MessageSpec<NoArgs, boolean>;
  /** ROM のスクリプトを .s に取り込む（#207。`rename` は自動で付けた名前 → 新しい名前）。返事は取り込みの計画。 */
  importRom: MessageSpec<{ readonly pointer: number; readonly target: ScriptRomTarget; readonly rename: Readonly<Record<string, string>> }, { readonly entryLabel: string }>;
  /** エディタでラベル名を変えた（#203。メインはイベントと eventscripts の側を変えるコマンドを実行する）。返事は変えた数。 */
  labelRenamed: MessageSpec<{ readonly from: string; readonly to: string; readonly path: string }, number>;
  /** そのラベルを使っているイベントとマップスクリプトの数（手で名前を変えて保存したときに聞く）。 */
  labelUses: MessageSpec<{ readonly label: string }, number>;
  /** エディタの個人設定を変えた（メインが settings.json に残す。今はテーマ `scriptEditorTheme` だけ）。 */
  setting: MessageSpec<{ readonly key: "scriptEditorTheme"; readonly value: string }, null>;
}

/**
 * メイン → エディタの問い合わせ（種類 → 中身と返事）。エディタは ScriptEditorWindow の `queryHandlers` で答える。
 * 種類を足すときは、ここに 1 項目足し、`queryHandlers` に処理を 1 つ足す。
 */
export interface ScriptEditorQueryMap {
  /** 未保存のファイルのパス。 */
  dirty: MessageSpec<NoArgs, string[]>;
  /** 未保存のファイルを全部保存する（全部保存できたら true）。 */
  saveAll: MessageSpec<NoArgs, boolean>;
  /** 開いているファイルの本文（改行は LF。開いていなければ null）。メインがひな形などを書く前に読む。 */
  bufferText: MessageSpec<{ readonly path: string }, string | null>;
  /** 開いているファイルの本文を書き換える（変わった範囲だけ。元に戻す履歴に入る）。開いていなければ false。`save` なら保存もする。 */
  setBufferText: MessageSpec<{ readonly path: string; readonly text: string; readonly save: boolean }, boolean>;
}

/** 種類 → 中身と返事の表から作る、1 件の形（`{ type, ...中身 }`）。 */
export type MessageOf<M extends Record<keyof M, MessageSpec<unknown, unknown>>, K extends keyof M> = { readonly type: K } & M[K]["args"];

/** 種類ごとの処理の表（すべての種類に 1 つずつ）。 */
export type MessageHandlers<M extends Record<keyof M, MessageSpec<unknown, unknown>>> = {
  readonly [K in keyof M]: (message: MessageOf<M, K>) => M[K]["reply"] | Promise<M[K]["reply"]>;
};

/** 処理の表で 1 件に答える（種類に合う処理を呼ぶ）。 */
export function handleMessage<M extends Record<keyof M, MessageSpec<unknown, unknown>>>(handlers: MessageHandlers<M>, message: { readonly type: keyof M }): Promise<unknown> {
  const handler = handlers[message.type] as ((m: unknown) => unknown) | undefined;
  if (!handler) return Promise.reject(new Error(`知らない種類です: ${String(message.type)}`));
  return Promise.resolve(handler(message));
}

/** エディタ → メインの要求。 */
export type ScriptEditorRequest = { [K in keyof ScriptEditorRequestMap]: MessageOf<ScriptEditorRequestMap, K> }[keyof ScriptEditorRequestMap];

/** メイン → エディタの問い合わせ。 */
export type ScriptEditorQuery = { [K in keyof ScriptEditorQueryMap]: MessageOf<ScriptEditorQueryMap, K> }[keyof ScriptEditorQueryMap];

/** `hello` の返事。 */
export interface ScriptEditorHello {
  readonly opens: readonly ScriptOpenRequest[];
  /** 開くのを待っている ROM のスクリプト。 */
  readonly roms?: readonly ScriptRomOpenRequest[];
  /** プロジェクトフォルダ（絶対パス）。 */
  readonly projectDir?: string | null;
  /** 開いてすぐビルドする（メインのメニューから頼まれた）。 */
  readonly build?: boolean;
}

/** 要求の封筒（返事は同じ id で返す）。 */
export interface ScriptEditorEnvelope {
  readonly id: number;
  readonly request: ScriptEditorRequest;
}

/** 返事（要求への返事と、問い合わせへの答えで同じ形）。 */
export type ScriptEditorReply =
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** 問い合わせの封筒。 */
export interface ScriptEditorQueryEnvelope {
  readonly id: number;
  readonly query: ScriptEditorQuery;
}

/**
 * メイン → エディタの知らせ（返事は無い。種類 → 中身）。種類を足すときは、ここに 1 項目足し、`ScriptEditorEvents` と
 * `ScriptEditorNoticeEvents` にイベント名を足し、エディタの受け手（ScriptEditorWindow の `connect` に渡す表）に処理を足す。
 */
export interface ScriptEditorNoticeMap {
  /** ファイルを開く。 */
  open: ScriptOpenRequest;
  /** ビルドする（中身なし）。 */
  build: null;
  /** ROM のスクリプトを読み取り専用で開く。 */
  openRom: ScriptRomOpenRequest;
}

/** イベント名。 */
export const ScriptEditorEvents = {
  /** エディタ → メイン: 要求。 */
  request: "script-editor:request",
  /** メイン → エディタ: 返事。 */
  reply: "script-editor:reply",
  /** メイン → エディタ: ファイルを開く（ScriptOpenRequest）。 */
  open: "script-editor:open",
  /** メイン → エディタ: ビルドする（中身なし）。 */
  build: "script-editor:build",
  /** メイン → エディタ: ROM のスクリプトを読み取り専用で開く（ScriptRomOpenRequest）。 */
  openRom: "script-editor:openRom",
  /** メイン → エディタ: 問い合わせ。 */
  query: "script-editor:query",
  /** エディタ → メイン: 問い合わせの答え。 */
  answer: "script-editor:answer",
} as const;

/** 知らせの種類 → イベント名。 */
export const ScriptEditorNoticeEvents: { readonly [K in keyof ScriptEditorNoticeMap]: string } = {
  open: ScriptEditorEvents.open,
  build: ScriptEditorEvents.build,
  openRom: ScriptEditorEvents.openRom,
};

/** ウィンドウの大きさ（初めて開くとき。論理ピクセル）と最小の大きさ。 */
export const SCRIPT_EDITOR_SIZE = { width: 900, height: 640, minWidth: 420, minHeight: 260 } as const;
