import type { Extension } from "@codemirror/state";
import type { ScriptFileKind } from "../fileText";
import type { ScriptProject } from "../ScriptProject";

/**
 * 拡張に渡す、開いているファイルの情報と、エディタの窓口。
 * 拡張はファイル（タブ）ごとに作る（EditorState がファイルごとなので、`.s` と `.string` で違う拡張を返せる）。
 * 後の issue で窓口が要るときは、ここに項目を足す（ScriptEditorWindow の `fileContext` で値を入れる）。
 */
export interface EditorFileContext {
  /** プロジェクトフォルダからの相対パス（区切りは `/`）。 */
  readonly path: string;
  readonly kind: ScriptFileKind;
  /** このファイルを保存する（Ctrl+S）。 */
  save(): void;
  /** 別のファイルを開く（定義へ移動など。行は 1 から）。 */
  openFile(path: string, line?: number): void;
  /** プロジェクトの知識（命令表・索引）。ウィンドウで 1 つ。 */
  readonly project: ScriptProject;
  /** ウィンドウの窓口（下の帯のお知らせ、移動と戻る、文字列の書き戻し）。 */
  readonly host: EditorHost;
}

/** 拡張から使う、ウィンドウの窓口。 */
export interface EditorHost {
  /** 下の帯にお知らせを出す。 */
  setMessage(text: string): void;
  /** 今の位置を「戻る」の履歴に積んでから、ファイルの行（1 から）と桁（1 から。省略で行頭）へ移る。 */
  navigate(path: string, line: number, column?: number): Promise<boolean>;
  /** 「戻る」（Alt+←）。戻る場所が無ければ false。 */
  back(): Promise<boolean>;
  /**
   * `.string` のラベルの本文を差し替える（そのファイルのタブの本文を変えて未保存にする。開いていなければ裏で開く）。
   * 差し替えたファイルのパスを返す。ラベルが見つからなければ null。本文に書けない文字列なら例外。
   */
  editStringBody(label: string, body: string): Promise<string | null>;
}

/** 機能 1 つ分の拡張を作る関数。 */
export type EditorExtensionFactory = (ctx: EditorFileContext) => Extension;
