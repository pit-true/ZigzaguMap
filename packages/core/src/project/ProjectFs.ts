import type { InflateFunction } from "./png/inflate.js";

/**
 * プロジェクトフォルダのファイル入出力。パスはプロジェクトフォルダからの相対パスで、区切りは `/`
 * （例: `maps/03/00.json`）。Node 用の実装は `@zigzagumap/core/node` の NodeProjectFs。
 */
export interface ProjectFs {
  /** テキストファイルを UTF-8 で読む。 */
  readText(path: string): Promise<string>;
  /** テキストファイルを UTF-8（BOM なし）で書く。フォルダが無ければ作る。 */
  writeText(path: string, text: string): Promise<void>;
  /** バイナリファイルを読む（tiles.png など）。 */
  readBytes(path: string): Promise<Uint8Array>;
  /** バイナリファイルを書く（tiles.png）。フォルダが無ければ作る。無い実装ではタイルセットを保存できない。 */
  writeBytes?(path: string, bytes: Uint8Array): Promise<void>;
  /** ファイルかフォルダがあるか。 */
  exists(path: string): Promise<boolean>;
  /** ファイルを消す。無ければ何もしない。 */
  remove(path: string): Promise<void>;
  /** フォルダの中の名前（ファイルとフォルダ）。フォルダが無ければ空。 */
  list(path: string): Promise<string[]>;
  /** zlib の展開関数（省略時は内蔵の inflate を使う）。 */
  readonly inflate?: InflateFunction;
}

/** テキストファイルがあれば読む（無ければ null）。 */
export async function readTextIfExists(fs: ProjectFs, path: string): Promise<string | null> {
  return (await fs.exists(path)) ? fs.readText(path) : null;
}

/** メモリ上の ProjectFs（テスト・プレビュー用）。 */
export class MemoryProjectFs implements ProjectFs {
  /** パス → 中身。 */
  readonly files = new Map<string, string | Uint8Array>();

  async readText(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ファイルがありません: ${path}`);
    if (typeof v !== "string") throw new Error(`テキストではありません: ${path}`);
    return v;
  }

  async writeText(path: string, text: string): Promise<void> {
    this.files.set(path, text);
  }

  /** バイナリファイルを置く。 */
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes.slice());
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ファイルがありません: ${path}`);
    if (typeof v === "string") throw new Error(`バイナリではありません: ${path}`);
    return v;
  }

  async exists(path: string): Promise<boolean> {
    if (this.files.has(path)) return true;
    const prefix = path.endsWith("/") ? path : path + "/";
    for (const key of this.files.keys()) if (key.startsWith(prefix)) return true;
    return false;
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(path: string): Promise<string[]> {
    const prefix = path === "" ? "" : path.endsWith("/") ? path : path + "/";
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const name = rest.split("/")[0];
      if (name) names.add(name);
    }
    return [...names].sort();
  }
}
