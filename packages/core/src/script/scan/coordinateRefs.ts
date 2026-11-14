import type { MapId } from "../../map/types.js";

/** `.s` の中で、マップの座標を書いている行（マップを左・上へ広げたときに直さないもの。#231）。 */
export interface CoordinateRef {
  readonly path: string;
  /** 1 から数えた行。 */
  readonly line: number;
  readonly text: string;
  /** `warp`: このマップへ座標つきで来るワープ、`object`: このマップのスクリプトの中の人の座標の指定。 */
  readonly kind: "warp" | "object";
}

/** 行き先のバンク・マップ・ワープ番号・x・y を取るワープの命令（XSE の名前）。 */
const WARP_COMMANDS = /^(warp|warpmuted|warpsilent|warpdoor|warphole|warpteleport|warpwalk|warp3|warp4|warp5|warp6|warp7|warp8|setwarp|setdynamicwarp|setescapewarp|setholewarp)$/i;
/** 人の座標を変える命令。 */
const OBJECT_COMMANDS = /^(setobjectxy|setobjectxyperm|setobjectxyperm2|movesprite|movesprite2|moveobjectoffscreen)$/i;

function parseNumber(text: string): number | null {
  const t = text.trim();
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16);
  if (/^\$[0-9a-f]+$/i.test(t)) return parseInt(t.slice(1), 16);
  if (/^-?\d+$/.test(t)) return Number(t);
  return null;
}

/**
 * `.s` の本文から、マップ `target` の座標を書いている行を探す。
 * - 座標つき（引数 5 つ以上）のワープの命令で、行き先のバンク・マップが `target` のもの。
 * - `labels`（このマップのイベントとマップスクリプトのラベル）の中の、人の座標を変える命令。
 * コメント（`@` と `//` から後）は見ない。
 */
export function findCoordinateRefs(path: string, text: string, target: MapId, labels: ReadonlySet<string>): CoordinateRef[] {
  const out: CoordinateRef[] = [];
  let inLabel = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const code = raw.replace(/(@|\/\/).*$/, "");
    const label = /^([A-Za-z_.$][\w.$]*)::?/.exec(code);
    if (label) inLabel = labels.has(label[1]!);
    const body = label ? code.slice(label[0].length) : code;
    const m = /^\s*([A-Za-z_][\w]*)\s*(.*)$/.exec(body);
    if (!m) return;
    const command = m[1]!;
    const args = m[2]!.split(/[\s,]+/).filter((a) => a.length > 0);
    if (WARP_COMMANDS.test(command) && args.length >= 5 && parseNumber(args[0]!) === target.bank && parseNumber(args[1]!) === target.map) {
      out.push({ path, line: i + 1, text: raw.trim(), kind: "warp" });
    } else if (inLabel && OBJECT_COMMANDS.test(command)) {
      out.push({ path, line: i + 1, text: raw.trim(), kind: "object" });
    }
  });
  return out;
}
