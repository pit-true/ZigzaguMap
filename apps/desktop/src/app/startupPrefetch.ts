import { invoke } from "@tauri-apps/api/core";
import { readRomBytes } from "./romRead";

/** 起動引数（Rust の StartupArgs）。 */
export interface StartupArgs {
  readonly rom: string | null;
  readonly project: string | null;
  readonly automation: number | null;
  /** 個人設定と WebView2 のデータの置き場所（`--profile`、自動操作なら一時フォルダ。通常の場所なら null）。 */
  readonly profile: string | null;
}

/** 先に読み始めた起動引数と ROM。 */
export interface StartupPrefetch {
  readonly args: Promise<StartupArgs>;
  /** 個人設定のファイルの中身（Rust の load_settings。読めなければ空）。 */
  readonly settings: Promise<string>;
  /** 起動引数の ROM のバイト列（ROM が無い・読めなければ null。種類はまだ確かめていない）。 */
  readonly rom: Promise<{ readonly path: string; readonly bytes: Uint8Array } | null>;
}

let started: StartupPrefetch | null = null;

/**
 * 起動引数・個人設定と、起動引数の ROM を読み始める（Phase4 #318。画面のコードを読み込んで組み立てる間に ROM を読み終えておき、
 * 起動からマップ表示までを短くする）。ここは画面のコードを読む前に動くので、invoke と ROM を読む小さなモジュールしか読まない。
 * ROM は、起動引数と個人設定を受け取ってから頼む（大きな ROM を受け取っている間は、ほかの返事が遅れるため）。
 */
export function startStartupPrefetch(): void {
  const args = invoke<StartupArgs>("startup_args");
  const settings = invoke<string>("load_settings").catch(() => "");
  const rom = Promise.all([args, settings])
    .then(async ([a]) => (a.rom ? { path: a.rom, bytes: await readRomBytes(a.rom) } : null))
    .catch(() => null);
  started = { args, settings, rom };
}

/** 先に読み始めた個人設定（読み始めていなければ undefined）。 */
export function peekStartupSettings(): Promise<string> | undefined {
  return started?.settings;
}

/** 先に読み始めたもの（1 回だけ受け取れる。読み始めていなければ null）。 */
export function takeStartupPrefetch(): StartupPrefetch | null {
  const value = started;
  started = null;
  return value;
}
