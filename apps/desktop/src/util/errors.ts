/** 例外の文言（Error ならその message、それ以外は文字列にしたもの）。 */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
