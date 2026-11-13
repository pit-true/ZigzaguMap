import { invoke } from "@tauri-apps/api/core";

/** ファイルの種類（拡張子に "*" で全部）。 */
export interface FileFilter {
  readonly name: string;
  readonly extensions: readonly string[];
}

/** 開く・保存ダイアログの指定。 */
export interface FileDialogOptions {
  readonly title: string;
  readonly filters: readonly FileFilter[];
  readonly directory?: string | null;
  readonly fileName?: string | null;
}

/**
 * ファイル・フォルダを選ぶダイアログ（Windows 標準）と、選んだ場所への書き込み。
 * 自動操作では、`queue` で次に選ぶパスを積んでおくと、ダイアログを出さずにそれを使う（画面を奪わないため）。
 */
export class FileDialogs {
  private readonly queued: (string | null)[] = [];

  /** 次のダイアログで選ぶパスを積む（null はキャンセル）。 */
  queue(path: string | null): void {
    this.queued.push(path);
  }

  /** 「名前を付けて保存」。キャンセルなら null。 */
  saveFile(options: FileDialogOptions): Promise<string | null> {
    if (this.queued.length > 0) return Promise.resolve(this.queued.shift()!);
    return invoke<string | null>("pick_save_file", toArgs(options));
  }

  /** 「ファイルを開く」。キャンセルなら null。 */
  openFile(options: FileDialogOptions): Promise<string | null> {
    if (this.queued.length > 0) return Promise.resolve(this.queued.shift()!);
    return invoke<string | null>("pick_open_file", toArgs(options));
  }

  /** フォルダを選ぶ。キャンセルなら null。 */
  folder(title: string): Promise<string | null> {
    if (this.queued.length > 0) return Promise.resolve(this.queued.shift()!);
    return invoke<string | null>("pick_folder", { title });
  }

  /** ROM を選ぶ。キャンセルなら null。 */
  rom(): Promise<string | null> {
    if (this.queued.length > 0) return Promise.resolve(this.queued.shift()!);
    return invoke<string | null>("pick_rom");
  }
}

/** ファイルにバイト列を書く（上書き）。 */
export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  await invoke("write_file", data, { headers: { path: encodeURIComponent(path) } });
}

/** ファイルがあるか。 */
export function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>("file_exists", { path });
}

/** パスのフォルダ部分。 */
export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

/** パスのファイル名部分。 */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function toArgs(o: FileDialogOptions): Record<string, unknown> {
  return {
    title: o.title,
    filters: o.filters.map((f) => ({ name: f.name, extensions: [...f.extensions] })),
    directory: o.directory ?? null,
    fileName: o.fileName ?? null,
  };
}
