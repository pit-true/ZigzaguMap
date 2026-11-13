import type { MapDocument } from "../../../model/MapDocument.js";

/** 人 `index` を消したときに落とし物の人の番号を合わせる（消した人の落とし物は消え、後ろは 1 つ詰まる）。 */
export function shiftItemBallsAfterRemoval(doc: MapDocument, index: number): void {
  doc.itemBalls = doc.itemBalls
    .filter((i) => i.personIndex !== index)
    .map((i) => (i.personIndex > index ? { ...i, personIndex: i.personIndex - 1 } : i));
}

/** 人の数を `count` に減らしたときに、いなくなった人の落とし物を消す。 */
export function trimItemBalls(doc: MapDocument, count: number): void {
  doc.itemBalls = doc.itemBalls.filter((i) => i.personIndex < count);
}
