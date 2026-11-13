/** JSON の引数から整数を取り出す。無い・整数でない場合は TypeError。 */
export function readInt(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`引数 ${key} は整数でなければなりません`);
  }
  return value;
}
