import { invoke } from "@tauri-apps/api/core";
import type { MapId } from "@zigzagumap/core";
import { jaProjectWatch as t } from "../i18n/ja.projectWatch";
import { messageBox } from "../ui/MessageBox";
import type { EditorState } from "./EditorState";
import type { ProjectSession } from "./ProjectSession";
import {
  WATCHED_FILES,
  WATCHED_TILESET_DIR,
  changedMapsOf,
  diffStamps,
  isBankDir,
  isWatchedMapFile,
  noChanges,
  type FileChanges,
  type FileStamps,
} from "./projectWatch";

/** `fs_stat` の返事。 */
interface FileStat {
  readonly modifiedMs: number;
  readonly size: number;
  readonly dir: boolean;
}

/** 監視が使う機能（App が渡す）。 */
export interface ProjectWatcherHost {
  readonly state: EditorState;
  /** ROM とプロジェクトを開き直す（未出力の確認は済んでいる）。 */
  reopen(rom: string, project: string | null): Promise<void>;
  openMap(id: MapId): Promise<unknown>;
}

/** 調べた結果（自動操作用）。 */
export interface WatchResult {
  readonly changes: FileChanges;
  /** 読み直したか。 */
  readonly reloaded: boolean;
}

const MAX_LISTED = 20;

/**
 * ファイルの変化の監視（Phase5 #404、Q15）。プロジェクトを開いたときに、見るファイルの更新日時と大きさを控え、
 * メインのウィンドウに戻ったときに比べる。外で変わっていれば一覧を出して読み直すか聞き、未出力の変更があれば
 * 読み直すと捨てることを書いて別に聞く。読み直しは ROM とプロジェクトを開き直し（`CfruProject` の読み込み）、
 * 開いていたマップを開き直す。ZigzaguMap が書いたファイル（出力など）は、書いたときに控えを直すので数えない。
 * 読み直さなかった変化は、次からは聞かない（今の状態を控え直す）。Rust の監視の部品は使わない（`fs_stat` で調べる）。
 */
export class ProjectWatcher {
  private stamps: Map<string, string> | null = null;
  private session: ProjectSession | null = null;
  private stopWrites: (() => void) | null = null;
  private checking: Promise<WatchResult | null> | null = null;
  /** 控えを取っている途中（自動操作用）。 */
  private snapshotting: Promise<void> = Promise.resolve();

  constructor(private readonly host: ProjectWatcherHost) {
    host.state.on("session", () => this.attach(host.state.session));
  }

  /** 控えを取り終えるまで待つ（自動操作用）。 */
  settle(): Promise<void> {
    return this.snapshotting;
  }

  /** 控えているファイルの数（無ければ 0）。 */
  get watchedCount(): number {
    return this.stamps?.size ?? 0;
  }

  /** メインのウィンドウに戻ったとき（同時に何度も来たら 1 回にまとめる）。設定 > 外で変わったファイルを調べる が外れていれば調べない。 */
  onFocus(): void {
    if (!this.host.state.settings.data.watchProject) return;
    void this.check();
  }

  /** 調べて、変わっていれば聞く。調べなかった（プロジェクトが無い・調べている途中）なら null。 */
  check(): Promise<WatchResult | null> {
    this.checking ??= this.run().finally(() => (this.checking = null));
    return this.checking;
  }

  private attach(session: ProjectSession | null): void {
    this.stopWrites?.();
    this.stopWrites = null;
    this.stamps = null;
    this.session = session;
    if (!session?.projectDir) return;
    this.stopWrites = session.onWrite((path) => void this.restamp(path));
    this.snapshotting = this.snapshot().then((s) => {
      if (this.session === session) this.stamps = s;
    });
  }

  private async run(): Promise<WatchResult | null> {
    await this.snapshotting;
    const session = this.session;
    const before = this.stamps;
    if (!session || !before || this.host.state.session !== session) return null;
    const after = await this.snapshot();
    if (this.session !== session) return null;
    const changes = diffStamps(before, after);
    // 聞いても聞かなくても、次は今の状態と比べる
    this.stamps = after;
    if (noChanges(changes)) return { changes, reloaded: false };
    const reloaded = await this.ask(session, changes);
    return { changes, reloaded };
  }

  private async ask(session: ProjectSession, changes: FileChanges): Promise<boolean> {
    const lines = [
      ...changes.changed.map((p) => t.changed(p)),
      ...changes.added.map((p) => t.added(p)),
      ...changes.removed.map((p) => t.removed(p)),
    ];
    const shown = lines.slice(0, MAX_LISTED);
    if (lines.length > shown.length) shown.push(t.more(lines.length - shown.length));
    if ((await messageBox(t.title, t.question(shown.join("\n")), "question", "yesNo")) !== "yes") return false;
    const dirty = session.modifiedMaps();
    if (dirty.length > 0) {
      const changed = new Set(changedMapsOf(changes).map((id) => `${id.bank}.${id.map}`));
      const text = (ids: readonly MapId[]) => ids.map((id) => `${id.bank}.${id.map}`).join("、");
      const both = dirty.filter((id) => changed.has(`${id.bank}.${id.map}`));
      if ((await messageBox(t.title, t.discard(text(dirty), both.length > 0 ? text(both) : null), "warning", "yesNo")) !== "yes") return false;
    }
    const current = this.host.state.map?.id ?? null;
    await this.host.reopen(session.romPath, session.projectDir);
    const reopened = this.host.state.session;
    if (!reopened || reopened === session) return false;
    if (current && current.bank >= 0) {
      try {
        await this.host.openMap(current);
      } catch {
        // 外で消えたマップは開かない
      }
    }
    this.host.state.setStatus(t.reloaded);
    return true;
  }

  /** ZigzaguMap が書いたファイルの控えを直す。 */
  private async restamp(path: string): Promise<void> {
    const stamps = this.stamps;
    if (!stamps) return;
    const stat = await statOf(path);
    if (stat && !stat.dir) stamps.set(path, stampOf(stat));
    else stamps.delete(path);
  }

  /** 見るファイルの印を全部取る。 */
  private async snapshot(): Promise<Map<string, string>> {
    const paths: string[] = [...WATCHED_FILES];
    for (const bank of (await list("maps")).filter(isBankDir)) {
      for (const name of (await list(`maps/${bank}`)).filter(isWatchedMapFile)) paths.push(`maps/${bank}/${name}`);
    }
    const tilesetDirs = [WATCHED_TILESET_DIR];
    const stamps = new Map<string, string>();
    // タイルセットのフォルダは下まで（フォルダかどうかは `fs_stat` で見る）
    while (tilesetDirs.length > 0) {
      const dir = tilesetDirs.pop()!;
      const names = await list(dir);
      const stats = await Promise.all(names.map((n) => statOf(`${dir}/${n}`)));
      names.forEach((n, i) => {
        const s = stats[i];
        if (!s) return;
        if (s.dir) tilesetDirs.push(`${dir}/${n}`);
        else stamps.set(`${dir}/${n}`, stampOf(s));
      });
    }
    const stats = await Promise.all(paths.map(statOf));
    paths.forEach((p, i) => {
      const s = stats[i];
      if (s && !s.dir) stamps.set(p, stampOf(s));
    });
    return stamps;
  }

  /** 今の控え（自動操作用）。 */
  current(): FileStamps | null {
    return this.stamps;
  }
}

function stampOf(s: FileStat): string {
  return `${s.modifiedMs}:${s.size}`;
}

function statOf(path: string): Promise<FileStat | null> {
  return invoke<FileStat | null>("fs_stat", { path }).catch(() => null);
}

function list(path: string): Promise<string[]> {
  return invoke<string[]>("fs_list", { path }).catch(() => []);
}
