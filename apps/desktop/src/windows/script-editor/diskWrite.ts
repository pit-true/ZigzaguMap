import { invoke } from "@tauri-apps/api/core";
import { jaScriptEditor as t } from "../../i18n/ja.scriptEditor";
import type { ScriptEditorClient } from "./ScriptEditorClient";

/** 読み直してやり直す回数の上限。 */
const WRITE_ATTEMPTS = 3;

/**
 * エディタで開いていないファイルを書き換える（#293。ラベル名の変更・幅検査の登録）。読んだ本文から `edit` で新しい本文を作り、
 * メインの書き込みの列で「読んだときのままなら書く」（`writeIfUnchanged`）。間にメインの書き込み（ひな形など）が入っていたら
 * 読み直してやり直す。`edit` の返す数（書き換えた数）を返す（変えるものが無ければ 0）。
 */
export async function writeOnDisk(
  client: ScriptEditorClient,
  path: string,
  edit: (raw: string | null) => { readonly text: string; readonly count: number } | null,
): Promise<number> {
  for (let i = 0; i < WRITE_ATTEMPTS; i++) {
    const raw = await invoke<string>("fs_read_text", { path }).catch(() => null);
    const out = edit(raw);
    if (!out) return 0;
    if (await client.request({ type: "writeIfUnchanged", path, expected: raw, text: out.text })) return out.count;
  }
  throw new Error(t.writeConflict);
}
