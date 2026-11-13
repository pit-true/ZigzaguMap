/** JSON の引数から整数を取り出す。無い・整数でない場合は TypeError。 */
export function readInt(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`引数 ${key} は整数でなければなりません`);
  }
  return value;
}

/** JSON の引数からマスの一覧（`cells: [{x, y, <valueKey>}]`）を取り出す。形が違えば TypeError。 */
export function readCells(args: Record<string, unknown>, valueKey: string): { x: number; y: number; value: number }[] {
  const cells = args["cells"];
  if (!Array.isArray(cells)) throw new TypeError("引数 cells は配列でなければなりません");
  return cells.map((cell: unknown, i) => {
    if (typeof cell !== "object" || cell === null) throw new TypeError(`cells[${i}] はオブジェクトでなければなりません`);
    const c = cell as Record<string, unknown>;
    return { x: readInt(c, "x"), y: readInt(c, "y"), value: readInt(c, valueKey) };
  });
}
