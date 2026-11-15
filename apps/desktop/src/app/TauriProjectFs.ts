import { invoke } from "@tauri-apps/api/core";
import type { ProjectFs } from "@zigzagumap/core";

/**
 * Rust 側のコマンドで読み書きする ProjectFs。読み書きできるのは開いたプロジェクトフォルダの配下だけ。
 * フォルダが開かれていない間（素の ROM だけを開いているとき）は、一覧は空・存在しない扱いになる。
 */
export class TauriProjectFs implements ProjectFs {
  private rootPath: string | null = null;
  /** 書いた・消したファイルを知らせる先（ファイルの変化の監視が「自分で書いたもの」を数えないため。Phase5 #404）。 */
  readonly writeListeners = new Set<(path: string) => void>();

  private wrote(path: string): void {
    for (const l of this.writeListeners) l(path);
  }

  /** 開いているフォルダ（無ければ null）。 */
  get root(): string | null {
    return this.rootPath;
  }

  /** フォルダを設定する（null で閉じる）。 */
  async setRoot(path: string | null): Promise<void> {
    this.rootPath = await invoke<string | null>("project_set_root", { path });
  }

  readText(path: string): Promise<string> {
    return invoke<string>("fs_read_text", { path });
  }

  async writeText(path: string, text: string): Promise<void> {
    await invoke("fs_write_text", { path, text });
    this.wrote(path);
  }

  /** バイナリファイルを書く（タイルセットの tiles.png など）。 */
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await invoke("fs_write_bytes", bytes, { headers: { path: encodeURIComponent(path) } });
    this.wrote(path);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await invoke<ArrayBuffer>("fs_read_bytes", { path }));
  }

  exists(path: string): Promise<boolean> {
    return invoke<boolean>("fs_exists", { path });
  }

  async remove(path: string): Promise<void> {
    await invoke("fs_remove", { path });
    this.wrote(path);
  }

  list(path: string): Promise<string[]> {
    return invoke<string[]>("fs_list", { path });
  }
}
