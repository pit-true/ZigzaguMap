import type { MapDocument } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import type { OpenMap, ProjectSession } from "../../app/ProjectSession";
import { hex, ja } from "../../i18n/ja";

/** 場所の設定タブの各欄が読むもの（表示中のマップ）。 */
export interface HeaderContext {
  readonly state: EditorState;
  readonly session: ProjectSession;
  readonly map: OpenMap;
  readonly doc: MapDocument;
}

/** 選択肢の表を 16 件（00〜0F）にのばす。表に無い番号は「0n ???」。 */
export function choices16(list: readonly string[]): string[] {
  return Array.from({ length: 16 }, (_, i) => list[i] ?? ja.unknownChoice(i));
}

/** マップスクリプトの種類の選択肢（00〜0F）。 */
export function scriptTypeChoices(): string[] {
  return Array.from({ length: 16 }, (_, i) => `${hex(i, 2)} ${ja.mapScriptTypes[i] ?? "???"}`);
}
