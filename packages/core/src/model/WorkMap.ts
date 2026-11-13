import type { MapId } from "../map/types.js";

/**
 * 作業用のマップ（AdvanceMap の「新規マップの作成」で作ったマップと、「作成したマップを開く」で `.map` から開いたマップ）。
 * プロジェクトのバンクには入らず、出力（maps\）にも書かない。マップの追加/挿入でプロジェクトへ写す。
 * 番号はバンク WORK_MAP_BANK（-1）の、作った順の連番。
 */
export const WORK_MAP_BANK = -1;

/** 作業用のマップの名前と、読み書きした `.map` のパス。 */
export interface WorkMapInfo {
  /** 名前（新規作成ダイアログのマップの名前、`.map` から開いたものはファイル名）。 */
  readonly name: string;
  /** 開いた・保存した `.map` のパス（無ければ null）。 */
  readonly path: string | null;
}

/** 作業用のマップの番号か。 */
export function isWorkMapId(id: MapId): boolean {
  return id.bank === WORK_MAP_BANK;
}
