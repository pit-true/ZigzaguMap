import { invoke } from "@tauri-apps/api/core";
import type { MapId } from "@zigzagumap/core";
import { ja } from "../i18n/ja";
import { showError } from "../ui/MessageBox";
import { errorText } from "../util/errors";
import { TAB_ORDER, type EditorState, type TabId } from "./EditorState";
import type { FileDialogs } from "./FileDialogs";
import { ProjectSession, UnknownRomError } from "./ProjectSession";
import { timings } from "./timings";

/** SessionOpener が呼ぶ App の操作。 */
export interface SessionOpenerHost {
  readonly state: EditorState;
  readonly files: FileDialogs;
  /** 未出力の変更があれば「出力しますか」と聞く。続けてよければ true。 */
  confirmDiscard(): Promise<boolean>;
  /** スクリプトエディタに未保存のファイルがあれば「保存しますか？」と聞く。続けてよければ true。 */
  confirmScriptEditor(): Promise<boolean>;
  /** 開いたセッションを画面に付ける（一覧・ROM の情報・題名・ステータスバー）。 */
  attachSession(session: ProjectSession, rom: string): Promise<void>;
  openMap(id: MapId): Promise<void>;
  showError(e: unknown): void;
}

/** ROM・プロジェクトフォルダを開く（ダイアログ、ドラッグ＆ドロップ、最近開いたもの、再読み込み）。 */
export class SessionOpener {
  constructor(private readonly host: SessionOpenerHost) {}

  /** ファイル > 開く。ROM を選ばせてから、組のフォルダを聞く。 */
  async openRomDialog(): Promise<void> {
    const path = await this.host.files.rom();
    if (path) await this.openRomAskingFolder(path);
  }

  /**
   * ROM を開くとき、続けて組にする CFRU-JP のフォルダを選ばせる（ユーザーの要望。メニュー・ツールバー・ドラッグ＆ドロップ・
   * 組のフォルダが記録されていない最近開いたもの）。キャンセルなら ROM だけで開く。未出力の変更の確認は先に済ませる。
   */
  async openRomAskingFolder(rom: string): Promise<void> {
    const state = this.host.state;
    if (!(await this.host.confirmDiscard())) return;
    // ROM でないファイルなら、フォルダを聞く前にエラーを出す（開いていたものはそのまま）
    let bytes: Uint8Array;
    try {
      bytes = await ProjectSession.readRom(rom);
    } catch (e) {
      await this.showOpenError(e);
      return;
    }
    // 前回のフォルダを覚えていて、まだあれば、窓を出さずにそれを開く（設定 > ROM ごとに前回のプロジェクトフォルダを覚える。#278）
    const remembered = state.settings.data.rememberRomProject ? state.settings.rememberedProject(rom) : null;
    if (remembered && (await invoke<boolean>("is_dir", { path: remembered }).catch(() => false))) {
      await this.openSession(rom, remembered, { confirmed: true, bytes });
      if (state.session?.projectDir) state.setStatus(ja.openedRememberedProject(state.session.projectDir));
      return;
    }
    const before = state.status;
    state.setStatus(ja.choosePairFolder);
    const project = await this.host.files.folder(ja.pairFolderTitle);
    state.setStatus(before.left, before.right, before.error);
    await this.openSession(rom, project, { confirmed: true, bytes });
  }

  /** 最近開いたものに記録した、その ROM と組のフォルダ（無ければ null）。 */
  recordedProject(rom: string): string | null {
    return this.host.state.settings.data.recent.find((r) => r.rom.toLowerCase() === rom.toLowerCase())?.project ?? null;
  }

  /** ファイル > プロジェクトフォルダを開く。 */
  async openProjectDialog(): Promise<void> {
    const folder = await this.host.files.folder(ja.projectFolderTitle);
    if (!folder) return;
    await this.openFolder(folder);
  }

  /** プロジェクトフォルダを開く。ベース ROM は、開いている ROM か、最近開いたものの組から選ぶ。無ければ選ばせる。 */
  private async openFolder(folder: string): Promise<void> {
    const state = this.host.state;
    const known = state.settings.data.recent.find((r) => r.project?.toLowerCase() === folder.toLowerCase());
    let rom = state.session?.romPath ?? known?.rom ?? null;
    if (!rom) {
      state.setStatus(ja.needRomForProject);
      rom = await this.host.files.rom();
    }
    if (rom) await this.openSession(rom, folder);
  }

  /** ドラッグ＆ドロップされたもの（先頭の 1 つ）を開く。フォルダならプロジェクト、.gba なら ROM。 */
  async drop(paths: readonly string[]): Promise<void> {
    const path = paths[0];
    if (path === undefined) return;
    if (await invoke<boolean>("is_dir", { path })) await this.openFolder(path);
    else if (path.toLowerCase().endsWith(".gba")) await this.openRomAskingFolder(path);
    else this.host.state.setStatus(ja.unsupportedFile, undefined, true);
  }

  /** ファイル > 最近開いたもの。組のフォルダが記録されていなければ聞く。 */
  async openRecent(index: number): Promise<void> {
    const entry = this.host.state.settings.data.recent[index];
    if (!entry) return;
    if (entry.project) await this.openSession(entry.rom, entry.project);
    else await this.openRomAskingFolder(entry.rom);
  }

  /** ファイル > 再読み込み。 */
  async reload(): Promise<void> {
    const s = this.host.state.session;
    // AdvanceMap と同じく、読み直したあとはマップを開かない（題名はアプリ名、ステータスは「マップを選択してください」）
    if (s) await this.openSession(s.romPath, s.projectDir, { reload: true });
  }

  /**
   * ROM と（あれば）プロジェクトフォルダを開く。未出力の変更があれば先に確かめる。
   * 開けなかったときはエラーを出し、開いていたものはそのまま残す。
   * `reload` は ROM の再読み込み（マップを開かない）、`confirmed` は未出力の確認が済んでいる、`bytes` は読み済みの ROM。
   */
  async openSession(rom: string, project: string | null, options: { reload?: boolean; confirmed?: boolean; bytes?: Uint8Array } = {}): Promise<void> {
    const host = this.host;
    const reload = options.reload ?? false;
    // 別のプロジェクトフォルダへ移るときは、スクリプトエディタの未保存も確かめる（エディタは閉じる）
    const folder = (p: string | null | undefined): string => (p ?? "").replace(/[\\/]+$/, "").toLowerCase();
    if (folder(project) !== folder(host.state.session?.projectDir) && !(await host.confirmScriptEditor())) return;
    if (!options.confirmed && !(await host.confirmDiscard())) return;
    const state = host.state;
    const previous = state.session;
    state.setStatus(ja.loading);
    let session: ProjectSession;
    try {
      session = await ProjectSession.open(rom, project, options.bytes);
    } catch (e) {
      await previous?.reattach().catch(() => undefined);
      await this.showOpenError(e);
      return;
    }
    try {
      timings.mark("sessionOpened");
      await host.attachSession(session, rom);

      const last = state.settings.data.last;
      const target =
        !reload && state.settings.data.rememberLast && last && last.rom.toLowerCase() === rom.toLowerCase() ? { bank: last.bank, map: last.map } : null;
      if (target && session.catalog.has(target)) {
        if (last && (TAB_ORDER as readonly string[]).includes(last.tab)) state.setTab(last.tab as TabId);
        await host.openMap(target);
      }
    } catch (e) {
      host.showError(e);
    }
  }

  /** 開けなかったときのエラー（ステータスバーを元に戻してから出す）。 */
  private async showOpenError(e: unknown): Promise<void> {
    const state = this.host.state;
    state.setStatus(state.session ? ja.statusRomLoaded : ja.statusOpenRom);
    if (e instanceof UnknownRomError) await showError(ja.unknownRomType);
    else await showError(errorText(e));
  }
}
