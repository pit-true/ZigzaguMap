import type { CfruProject } from "../project/CfruProject.js";
import type { MapId } from "./types.js";

/**
 * 配置（フッター）を共有しているマップ（#228）。
 *
 * 数え方:
 * - ベース ROM のマップは、ヘッダーの先頭のフッターのポインタが同じものを同じ配置とみなす。
 * - maps\ に JSON があるマップは数えない。Bochi 改造版と `map_project.py` は JSON のマップごとに
 *   フッター・配置・境界を別の場所に置き直すので、ビルドした ROM でもほかと共有しない
 *   （ヘッダーの配置の番号はそのまま残るが、データはつながらない）。
 * - ZigzaguMap の中でもマップごとに別の配置として編集し、出力すると JSON になって共有から外れる。
 *   ほかのマップは変わらない。
 */
export class LayoutSharing {
  private constructor(
    /** フッターの位置 → そこを使うマップ（バンク・マップの順）。 */
    private readonly groups: ReadonlyMap<number, readonly MapId[]>,
    private readonly footerOf: ReadonlyMap<string, number>,
  ) {}

  /** プロジェクトの全マップから作る（ヘッダーの 4 バイトだけを読むので速い）。 */
  static build(project: CfruProject): LayoutSharing {
    const groups = new Map<number, MapId[]>();
    const footerOf = new Map<string, number>();
    const rom = project.base.rom;
    for (const id of project.mapIds()) {
      if (!project.inBase(id) || project.hasJson(id)) continue;
      let footer: number;
      try {
        footer = rom.pointer(project.base.bankTable.headerOffset(id));
      } catch {
        continue;
      }
      footerOf.set(key(id), footer);
      const list = groups.get(footer);
      if (list) list.push(id);
      else groups.set(footer, [id]);
    }
    return new LayoutSharing(groups, footerOf);
  }

  /** そのマップと同じ配置を使うマップ（自分を含む。バンク・マップの順）。共有していなければ自分だけ、数えないマップなら空。 */
  mapsSharing(id: MapId): readonly MapId[] {
    const footer = this.footerOf.get(key(id));
    if (footer === undefined) return [];
    return this.groups.get(footer) ?? [];
  }

  /** そのマップの配置を使うマップの数（自分を含む。数えないマップは 0）。 */
  count(id: MapId): number {
    return this.mapsSharing(id).length;
  }

  /** 2 枚以上で共有している配置の数。 */
  get sharedGroupCount(): number {
    let n = 0;
    for (const list of this.groups.values()) if (list.length > 1) n++;
    return n;
  }
}

function key(id: MapId): string {
  return `${id.bank}.${id.map}`;
}
