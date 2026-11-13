import type { FlyPosition } from "../fly/types.js";
import type { BlockGrid } from "../map/BlockGrid.js";
import type { MapId } from "../map/types.js";
import type { MapDocument } from "../model/MapDocument.js";
import type { WorkMapInfo } from "../model/WorkMap.js";
import type { TextCodec } from "../name/TextCodec.js";
import type { TilesetDocument, TilesetRef } from "../tileset/TilesetDocument.js";
import type { EditorContext } from "./Command.js";

/**
 * マップ全体（ヘッダー・イベント・接続・野生など）とタイルセット、プロジェクトのマップ一覧を編集するコマンドが使う入口。
 * EditorContext（配置だけ）を広げたもの。実装は DocumentStore と CfruProject.editorContext()。
 */
export interface DocumentContext extends EditorContext {
  /** ボーダー（MapDocument のもの）。 */
  border(id: MapId): BlockGrid;
  /** 読み込み済みのマップ。無ければ Error（コマンドを実行する前に読み込んでおく）。 */
  document(id: MapId): MapDocument;
  /** 読み込み済みのタイルセット。無ければ Error。 */
  tileset(ref: TilesetRef): TilesetDocument;
  /** タイルセットとして指せるポインタ値か（新規マップやタイルセットの変更の確認用）。 */
  tilesetExists(pointer: number): boolean;
  /** 文字列の変換器。 */
  readonly textCodec: TextCodec;
  /** 地名番号のマップ名（編集後の値）。名前表の範囲外なら null。 */
  mapName(regionId: number): Uint8Array | null;
  /** このセッションで変えたマップ名。変えていなければ null。 */
  mapNameEdit(regionId: number): Uint8Array | null;
  /** マップ名を変える（null で元に戻す）。同じ地名番号の読み込み済みマップの名前も変わる。 */
  setMapNameEdit(regionId: number, name: Uint8Array | null): void;
  /** マップがあるか（ROM・JSON・追加したもの）。 */
  hasMap(id: MapId): boolean;
  /** バンクごとのマップ数（追加したものを含む）。 */
  bankCounts(): number[];
  /** 新しいマップを加える（バンクの末尾か、新しいバンクのマップ 0）。 */
  addMap(doc: MapDocument): void;
  /** addMap で加えたマップを除く（取り消し用）。 */
  removeMap(id: MapId): void;
  /** AdvanceMap のタイルセット番号（0〜67）のポインタ値。表に無ければ null。 */
  tilesetPointer(index: number): number | null;
  /** AdvanceMap のタイルセット番号。表に無ければ null。 */
  tilesetIndex(pointer: number): number | null;
  /** 作業用のマップ（バンク -1。新規作成・.map から開いたもの）を加える。同じ番号があれば Error。 */
  putWorkMap(doc: MapDocument, info: WorkMapInfo): void;
  /** 作業用のマップを除く（取り消し用）。 */
  removeWorkMap(id: MapId): void;
  /** 作業用のマップの名前とパス。作業用のマップでなければ null。 */
  workMapInfo(id: MapId): WorkMapInfo | null;
  /** 作業用のマップの名前とパスを変える（.map に保存したとき）。 */
  setWorkMapInfo(id: MapId, info: WorkMapInfo): void;
  /** 次に作る作業用のマップの番号。 */
  nextWorkMapNumber(): number;
  /** 編集中のフライトポジションの表（ROM の表の写し。タウンマップの飛び先と同じ表で、maps\regionmap.json の HealLocations に出力する）。 */
  readonly flyPositions: FlyPosition[];
}

/** EditorContext が DocumentContext か。 */
export function isDocumentContext(context: EditorContext): context is DocumentContext {
  const c = context as Partial<DocumentContext>;
  return typeof c.document === "function" && typeof c.tileset === "function" && typeof c.addMap === "function";
}

/** EditorContext を DocumentContext として使う。違えば Error。 */
export function documentContext(context: EditorContext): DocumentContext {
  if (!isDocumentContext(context)) {
    throw new Error("このコマンドには DocumentContext（DocumentStore か CfruProject.editorContext()）が必要です");
  }
  return context;
}
