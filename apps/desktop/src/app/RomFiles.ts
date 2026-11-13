import { invoke } from "@tauri-apps/api/core";

/** ROM ファイルの選択と読み込み（Rust 側のコマンドを呼ぶ）。 */
export class RomFiles {
  /** ファイル選択ダイアログを出す。キャンセルなら null。 */
  async pick(): Promise<string | null> {
    return invoke<string | null>("pick_rom");
  }

  /** ROM のバイト列を読む。Rust 側から生のバイト列で受け取る。 */
  async read(path: string): Promise<Uint8Array> {
    const buffer = await invoke<ArrayBuffer>("read_rom", { path });
    return new Uint8Array(buffer);
  }
}
