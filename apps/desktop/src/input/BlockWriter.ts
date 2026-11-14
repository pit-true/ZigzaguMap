import type { EditorState } from "../app/EditorState";
import { jaPen } from "../i18n/ja.pen";
import type { Cell } from "../ui/map/MapView";
import { AUTOPEN_PREVIEW_ALPHA, type AutoPenHost } from "./AutoPenTool";
import type { MapCells } from "./MapCells";
import { alwaysInside, cellsCommand } from "./paintCommands";
import type { FillCell } from "./paintPlans";
import type { PreviewCanvas } from "./PreviewCanvas";
import { drawPreviewBlocks } from "./previewDraw";
import { dropTripleChildren } from "./tripleRules";

/**
 * マップタブの道具が共通で使う、ブロックの書き込み（鉛筆・矩形塗り・入れ替え・自動ペン・マップ作成補助・貼り付け）。
 * 画面のマスの一覧を、マップごとのコマンドにして 1 回の操作で実行する。隣のマップが読み込まれていなければ、
 * 読み込んでから実行する（その間の操作は順に待たせる）。
 * 3 層の次の番号（#301）は、描き方ごとでなくここ 1 か所で落とす。1 つも書けなかったときはステータスバーに理由を出す。
 */
export class BlockWriter implements AutoPenHost {
  constructor(
    private readonly state: EditorState,
    /** 画面のマスとマップのマスの対応。 */
    readonly cells: MapCells,
    private readonly preview: PreviewCanvas,
    /** ドラッグの道具を使っている間か（自動ペンの下見を出さない）。 */
    private readonly dragging: () => boolean,
  ) {}

  /**
   * 画面のマスの一覧を書く。`forDrag` はドラッグで続けて描く操作（`merge` なら前の操作にまとめる）。
   * `ownMovements` は、移動許可を持つマスだけ移動許可も書く（袋・自動で選んだもの）。それ以外は「移動許可も貼る」に従う。
   */
  write(list: readonly FillCell[], forDrag: boolean, merge: boolean, ownMovements = false): void {
    // マップごとにそのマップのタイルセットで 3 層の次の番号を見る（#337）
    let skipped = 0;
    const groups = this.cells.split(list).flatMap((g) => {
      const r = dropTripleChildren(g.cells, this.cells.tripleChildOf(g.id));
      skipped += r.skipped;
      return r.kept.length > 0 ? [{ id: g.id, cells: r.kept }] : [];
    });
    if (groups.length === 0) {
      if (skipped > 0) this.state.setStatus(jaPen.tripleChildSkipped(skipped), undefined, true);
      return;
    }
    const withMovements = ownMovements || this.state.settings.data.pasteMovements;
    this.cells.run(
      groups.map((g) => g.id),
      () => groups.flatMap((g) => cellsCommand(g.id, alwaysInside, g.cells, withMovements) ?? []),
      forDrag,
      merge,
    );
  }

  /** 決めたマスを書く（ドラッグの続きは 1 回の操作にまとめる。マップ作成補助）。 */
  writeCells(list: readonly FillCell[], merge: boolean, ownMovements: boolean): void {
    this.write(list, true, merge, ownMovements);
  }

  /**
   * 書くマスを実行の直前に決めて書く（自動ペン。#335）。`area` は読むか書くかもしれない画面のマスで、そこにかかる隣のマップを
   * 先に読み込む。読み込みを待つ間に並んだ前の書き込みを済ませてから `plan` を呼ぶので、前の書き込みを見て中身を決められる。
   */
  writePlanned(area: readonly Cell[], plan: () => readonly FillCell[], merge: boolean, ownMovements: boolean): void {
    const ids = this.cells.split(area).map((g) => g.id);
    if (ids.length === 0) return;
    const withMovements = ownMovements || this.state.settings.data.pasteMovements;
    this.cells.run(
      ids,
      () => {
        const { kept, skipped } = this.dropUnplaceable(plan());
        if (kept.length === 0 && skipped > 0) this.state.setStatus(jaPen.tripleChildSkipped(skipped), undefined, true);
        // 編集用に読み込んだマップだけに書く（area の外の、まだ読んでいない隣のマップへはみ出した分は捨てる）
        return this.cells
          .split(kept)
          .filter((g) => !this.cells.needsLoad([g.id]))
          .flatMap((g) => cellsCommand(g.id, alwaysInside, g.cells, withMovements) ?? []);
      },
      true,
      merge,
    );
  }

  /** 主マップの座標のマス（境界ブロックなど）から 3 層の次の番号を落とす（主マップのタイルセットで見る）。 */
  dropUnplaceable(list: readonly FillCell[]): { kept: FillCell[]; skipped: number } {
    const triple = this.state.map?.tiles.triple ?? null;
    return dropTripleChildren(list, triple ? (b) => triple.isTripleChild(b) : null);
  }

  /** 画面のマスのブロックと移動許可（どのマップでもなければ null）。 */
  cellValue(cell: Cell): number | null {
    const ref = this.cells.resolve(cell);
    const grid = ref ? this.cells.gridOf(ref.id) : null;
    return ref && grid ? grid.getCell(ref.x, ref.y) : null;
  }

  /** カーソルに置く物を薄く重ねる（自動ペン。空なら消す）。 */
  showPreview(cells: readonly FillCell[]): void {
    if (this.dragging()) return;
    if (cells.length === 0) return this.preview.end();
    const p = this.preview.begin();
    const map = this.state.map;
    if (map) drawPreviewBlocks(p, map.tiles, cells.filter((c) => this.cells.resolve(c)), AUTOPEN_PREVIEW_ALPHA);
  }
}
