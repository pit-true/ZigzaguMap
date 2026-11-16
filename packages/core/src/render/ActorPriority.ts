/** 元の日本語版evobjmv.cの高さと優先順位の表。 */
const BG = [0, 2, 2, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 0, 0, 0] as const;
const SUB = [0, 115, 83, 115, 83, 115, 83, 115, 83, 115, 83, 115, 83, 0, 0, 0] as const;

export function actorBgPriority(elevation: number): number {
  return BG[elevation & 15]!;
}

/** EvActPriControl。画面の足元のYで並べ、同じマスなら後ろから作られたOBJを先に描く。 */
export function actorSubpriority(elevation: number, pixelY: number, viewTop: number): number {
  return SUB[elevation & 15]! + ((16 - (((pixelY + 24 - viewTop) & 255) >> 4)) << 1) + 1;
}
