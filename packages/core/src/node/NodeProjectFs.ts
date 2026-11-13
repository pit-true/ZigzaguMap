import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inflateSync } from "node:zlib";
import type { ProjectFs } from "../project/ProjectFs.js";

/** Node のファイルシステムを使う ProjectFs。`root` はプロジェクトフォルダ（CFRU-JP のフォルダ）。 */
export class NodeProjectFs implements ProjectFs {
  constructor(readonly root: string) {}

  /** zlib の展開は node:zlib を使う。 */
  readonly inflate = (data: Uint8Array): Uint8Array => new Uint8Array(inflateSync(data));

  async readText(path: string): Promise<string> {
    return readFile(this.resolve(path), "utf8");
  }

  async writeText(path: string, text: string): Promise<void> {
    const full = this.resolve(path);
    await mkdir(dirname(full), { recursive: true });
    // 途中で止まっても元のファイルを壊さないよう、一時ファイルに書いてから置き換える。
    await writeFile(full + ".tmp", text, "utf8");
    await rename(full + ".tmp", full);
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const full = this.resolve(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full + ".tmp", bytes);
    await rename(full + ".tmp", full);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(path)));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  async remove(path: string): Promise<void> {
    await rm(this.resolve(path), { force: true });
  }

  async list(path: string): Promise<string[]> {
    try {
      return (await readdir(this.resolve(path))).sort();
    } catch {
      return [];
    }
  }

  private resolve(path: string): string {
    return join(this.root, ...path.split("/"));
  }
}
