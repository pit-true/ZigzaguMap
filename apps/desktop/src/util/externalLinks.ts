import { invoke } from "@tauri-apps/api/core";

/** 開こうとした外部の URL（新しい順。自動操作の確認用。自動操作中は Rust 側がブラウザを開かない）。 */
export const openedUrls: string[] = [];

/** 外部へのリンクとして開ける URL か（http・https だけ）。 */
export function isExternalUrl(url: string): boolean {
  return /^https?:\/\/[^\s"]+$/i.test(url);
}

/** URL を既定のブラウザで開く。 */
export async function openExternal(url: string): Promise<void> {
  if (!isExternalUrl(url)) throw new Error(`開けない URL です: ${url}`);
  openedUrls.unshift(url);
  await invoke("open_url", { url });
}
