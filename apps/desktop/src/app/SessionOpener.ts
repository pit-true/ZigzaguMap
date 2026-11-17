import { invoke } from "@tauri-apps/api/core";
import { locateCfruFolder, type CfruFolderLocation, type FolderEntry, type MapId } from "@zigzagumap/core";
import { ja } from "../i18n/ja";
import { jaCfruFolder } from "../i18n/ja.cfruFolder";
import { choiceDialog } from "../ui/ChoiceDialog";
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
  /** 未出力の変更があるか（`confirmDiscard` が聞くかどうか）。 */
  hasUnexportedChanges(): boolean;
  /** スクリプトエディタの未保存のファイルの数（`confirmScriptEditor` が聞くかどうか。エディタを読み込んでいなければ 0）。 */
  scriptEditorDirtyCount(): Promise<number>;
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

  /** ファイル > CFRU-JP のフォルダを開く…（#540。一番上の項目、Ctrl+O）。 */
  async openProjectDialog(): Promise<void> {
    const folder = await this.host.files.folder(jaCfruFolder.folderTitle);
    if (folder) await this.openCfruFolder(folder);
  }

  /**
   * CFRU-JP のフォルダを開く（#540）。選んだフォルダからプロジェクトのフォルダ（`src\config.h` がある所。Chronos のルートなら `cfru`）と
   * 中のベース ROM を見つけ、両方を開く。ROM が 1 つに決まらなければ候補から選ばせ、無ければ ROM を選ばせる。
   * `rom` を渡せばその ROM を使う。`quiet`（自動操作の `openFolder`）はダイアログを出さず、決められないときは例外にする。
   */
  async openCfruFolder(folder: string, options: { quiet?: boolean; rom?: string } = {}): Promise<void> {
    const quiet = options.quiet ?? false;
    const found = await locateCfruFolder(folder, { list: (path) => invoke<FolderEntry[] | null>("scan_folder", { path }) });
    const rom = options.rom ?? (await this.chooseBaseRom(found, quiet));
    if (!rom) return;
    await this.openSession(rom, found.projectDir, { quiet });
    const session = this.host.state.session;
    if (session && session.romPath === rom && session.projectDir !== null) this.host.state.setStatus(jaCfruFolder.opened(session.projectDir, rom));
  }

  /** 見つけたベース ROM の候補から 1 つに決める（決められなければ、最近開いたものの組、選ばせる、の順。やめたら null）。 */
  private async chooseBaseRom(found: CfruFolderLocation, quiet: boolean): Promise<string | null> {
    const choice = found.rom;
    if (choice.kind === "found") return choice.path;
    const paired = this.pairedRom(found.projectDir);
    if (choice.kind === "choose") {
      const known = paired && choice.candidates.find((c) => c.toLowerCase() === paired.toLowerCase());
      if (known) return known;
      if (quiet) throw new Error(jaCfruFolder.romAmbiguous(choice.candidates));
      const index = await choiceDialog(jaCfruFolder.chooseTitle, jaCfruFolder.choosePrompt(found.projectDir), choice.candidates);
      return index === null ? null : (choice.candidates[index] ?? null);
    }
    if (paired) return paired;
    if (quiet) throw new Error(jaCfruFolder.romMissing(choice.searched));
    const state = this.host.state;
    const before = state.status;
    state.setStatus(jaCfruFolder.romNotFound(choice.searched));
    const rom = await this.host.files.rom();
    if (!rom) state.setStatus(before.left, before.right, before.error);
    return rom;
  }

  /** 最近開いたものに記録した、そのプロジェクトのフォルダと組の ROM（無ければ null）。 */
  private pairedRom(project: string): string | null {
    const key = project.replace(/[\\/]+$/, "").toLowerCase();
    return this.host.state.settings.data.recent.find((r) => r.project?.replace(/[\\/]+$/, "").toLowerCase() === key)?.rom ?? null;
  }

  /** ドラッグ＆ドロップされたもの（先頭の 1 つ）を開く。フォルダなら CFRU-JP のフォルダ（中のベース ROM も開く）、.gba なら ROM。 */
  async drop(paths: readonly string[]): Promise<void> {
    const path = paths[0];
    if (path === undefined) return;
    if (await invoke<boolean>("is_dir", { path })) await this.openCfruFolder(path);
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
   * `quiet` は自動操作の `open`（#380）。ダイアログを出さず、聞く必要があるときや開けないときは例外にする（開いていたものは残す）。
   */
  async openSession(
    rom: string,
    project: string | null,
    options: { reload?: boolean; confirmed?: boolean; bytes?: Uint8Array; quiet?: boolean } = {},
  ): Promise<void> {
    const host = this.host;
    const reload = options.reload ?? false;
    const quiet = options.quiet ?? false;
    // 別のプロジェクトフォルダへ移るときは、スクリプトエディタの未保存も確かめる（エディタは閉じる）
    const folder = (p: string | null | undefined): string => (p ?? "").replace(/[\\/]+$/, "").toLowerCase();
    if (folder(project) !== folder(host.state.session?.projectDir)) {
      if (quiet) {
        const dirty = await host.scriptEditorDirtyCount();
        if (dirty > 0) throw new Error(ja.openBlockedScripts(dirty));
      } else if (!(await host.confirmScriptEditor())) return;
    }
    if (!options.confirmed) {
      if (quiet) {
        if (host.hasUnexportedChanges()) throw new Error(ja.openBlockedUnexported);
      } else if (!(await host.confirmDiscard())) return;
    }
    const state = host.state;
    const previous = state.session;
    state.setStatus(ja.loading);
    let session: ProjectSession;
    try {
      session = await ProjectSession.open(rom, project, options.bytes);
    } catch (e) {
      await previous?.reattach().catch(() => undefined);
      if (quiet) {
        this.restoreStatus();
        throw new Error(openErrorText(e));
      }
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
      if (quiet) throw e;
      host.showError(e);
    }
  }

  /** 開けなかったときのエラー（ステータスバーを元に戻してから出す）。 */
  private async showOpenError(e: unknown): Promise<void> {
    this.restoreStatus();
    await showError(openErrorText(e));
  }

  /** 開けなかったときのステータスバー（開いているものがあれば、その表示に戻す）。 */
  private restoreStatus(): void {
    const state = this.host.state;
    state.setStatus(state.session ? ja.statusRomLoaded : ja.statusOpenRom);
  }
}

/** 開けなかったときのエラーの文言。 */
function openErrorText(e: unknown): string {
  return e instanceof UnknownRomError ? ja.unknownRomType : errorText(e);
}
