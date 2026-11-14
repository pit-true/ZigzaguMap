import type { Extension } from "@codemirror/state";
import type { ScriptFileKind } from "../fileText";

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
  /** ラベル名を変える（F2。プロジェクトの .s の定義と参照、イベントのラベルも。#203）。 */
  renameLabel?(from: string): void;
}

/** 機能 1 つ分の拡張を作る関数。 */
export type EditorExtensionFactory = (ctx: EditorFileContext) => Extension;
