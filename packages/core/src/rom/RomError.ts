/** ROM の読み取りで範囲外や不正なデータに当たったときの例外。 */
export class RomError extends Error {
  override readonly name = "RomError";
}
