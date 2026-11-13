/** maps\ の JSON の形式が不正なときの例外。`path` は問題のあったファイル（分かる場合）。 */
export class ProjectFormatError extends Error {
  override readonly name = "ProjectFormatError";

  constructor(
    message: string,
    readonly path: string | null = null,
  ) {
    super(path ? `${message} (${path})` : message);
  }
}
