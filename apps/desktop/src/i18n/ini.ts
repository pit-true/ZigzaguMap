import { formatHex } from "@zigzagumap/core";
import { ini } from "./ini.generated";

/**
 * Japanese.ini（source/Japanese.ini。改訂版）の値を使うための道具。
 * 値は `ini.節["番号"]` で引く（ini.generated.ts は scripts/gen-i18n.mjs が作る）。
 */
export { ini };

type Section = Readonly<Record<string, string>>;

/** printf 風の %d・%s・%x（%6x のような桁指定も）を、引数で順に埋める。 */
export function fmt(template: string, ...args: readonly (string | number)[]): string {
  let i = 0;
  return template.replace(/%(\d*)([dsx])/g, (_, width: string, kind: string) => {
    const arg = args[i++];
    if (arg === undefined) return "";
    const text = kind === "x" && typeof arg === "number" ? formatHex(arg) : String(arg);
    return width ? text.padStart(Number(width), kind === "x" ? "0" : " ") : text;
  });
}

/** 16 進 2 桁の番号（00, 01, …）で引いた値。無い番号は undefined。 */
export function byHex(section: Section, index: number): string | undefined {
  return section[formatHex(index, 2)];
}

/** 00〜(count-1) を 16 進 2 桁の番号で引いた並び。無い番号は undefined。 */
export function hexList(section: Section, count: number): (string | undefined)[] {
  return Array.from({ length: count }, (_, i) => byHex(section, i));
}

/** 「00-値」の形（値の先頭に番号が無い節を、旧版と同じ見た目で並べる）。 */
export function numbered(index: number, value: string): string {
  return `${formatHex(index, 2)}-${value}`;
}

/** 16 進 2 桁の番号の値を、番号（数）から引ける表にする。 */
export function hexRecord(section: Section): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [key, value] of Object.entries(section)) {
    if (/^[0-9A-F]{2}$/i.test(key)) out[parseInt(key, 16)] = value;
  }
  return out;
}
