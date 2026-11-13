/** 構造体のバイト列が短い・件数が合わないなど、データの形が不正なときの例外。 */
export class DataError extends Error {
  override readonly name = "DataError";
}
