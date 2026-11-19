import {
  appendBlock,
  autoMapScript,
  autoMapScriptCandidates,
  type AutoMapScriptCandidate,
  buildScriptIndex,
  defaultScriptsJsonStringsPath,
  indexAsmFile,
  isScriptSourcePath,
  reloadScriptIndexFile,
  removeBlock,
  scriptLabelCandidates,
  scriptLabelPlace,
  type ScriptIndex,
  type ScriptLabelCandidate,
  type ScriptLabelPlace,
} from "@zigzagumap/core";
import type { App } from "../../app/App";
import { jaScriptLink as t } from "../../i18n/ja.scriptLink";
import { normalizeScriptPath } from "../../windows/script-editor/fileText";

/** マップの `.s` と `.string`、どこで決まったか（`map`: マップの行、`bank`: バンク全体の行、`auto`: ラベルから自動。#562）。 */
export interface MapScriptChoice {
  readonly script: string;
  readonly strings: string;
  readonly from: "map" | "bank" | "auto";
}

/** 本文の読み先（エディタで開いていればエディタの本文、無ければディスク）。 */
interface Loaded {
  readonly text: string;
  readonly inEditor: boolean;
}

/**
 * `.s`・`.string`（と幅検査の登録）を書き換える窓口。書き込みはすべてこの 1 本の列で 1 つずつ順に行う（#293）。
 * メインの書き込み（ひな形・取り込み・イベントの削除・マップスクリプトの表・幅検査の登録）も、エディタのディスクへの書き込み
 * （ラベル名の変更で開いていないファイル・幅検査の登録。`writeIfUnchanged`）も、エディタを閉じる間の待ち（`hold`）も、この列に並ぶ。
 * エディタで開いているファイルはエディタの本文へ送り、未保存の変更が無ければそのまま保存させる（ディスクにも入る）。
 * 開いていなければディスクに書く。書く前にタブやエディタが閉じたら、ディスクの本文に書き直す。
 * 書いたファイルのラベルの一覧（イベントタブのスクリプト欄が使う）も読み直す。
 */
export class ScriptFiles {
  private queue: Promise<unknown> = Promise.resolve();
  /** ファイルごとのラベルの一覧（読んだもの）。 */
  private readonly labels = new Map<string, Promise<string[]>>();
  /** 読み終わったラベルの一覧。 */
  private readonly done = new Map<string, string[]>();
  /** ラベルの一覧が変わったときに呼ぶもの。 */
  private readonly listeners = new Set<() => void>();
  /** ファイルが変わったときに呼ぶもの（パスつき。使われている番号の索引 #227 が使う）。 */
  private readonly pathListeners = new Set<(path: string) => void>();
  /**
   * プロジェクトの `.s` のラベルの索引（#554。ほかのファイルの `.global` のラベルを探す）。初めて使うときに作り、
   * 書き換えたファイルの分だけ読み直す。全部を捨てたとき（前面に戻った・プロジェクトを開き直した）は、次に使うときに作り直す。
   */
  private index: Promise<ScriptIndex> | null = null;
  /** 最後に作り終わった索引と、そのときのセッション（すぐに答えが要るとき用。前面に戻って捨てたあとも、作り直すまで使う）。 */
  private last: { readonly session: unknown; readonly index: ScriptIndex } | null = null;
  /** アプリに 1 つ（ensureScriptFile など、App を受け取らない所から使う）。 */
  static current: ScriptFiles | null = null;

  constructor(private readonly app: App) {
    ScriptFiles.current = this;
  }

  /** ラベルの一覧が変わったときに呼ぶ。戻り値でやめる。 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** ファイルが変わった（書き換えた・エディタで保存した）ときに呼ぶ。戻り値でやめる。 */
  onPathChange(listener: (path: string) => void): () => void {
    this.pathListeners.add(listener);
    return () => this.pathListeners.delete(listener);
  }

  /** `.s` のラベルの名前（ファイルの順。無いファイルは空）。 */
  labelsOf(path: string): Promise<string[]> {
    let p = this.labels.get(path);
    if (!p) {
      p = this.read(path)
        .then((l) => (l ? indexAsmFile(path, l.text).labels.map((x) => x.name) : []))
        .catch(() => [])
        .then((names) => {
          if (this.labels.get(path) === p) this.done.set(path, names);
          return names;
        });
      this.labels.set(path, p);
    }
    return p;
  }

  /** 読み終わっているラベルの一覧（まだなら null。すぐに答えが要るとき用）。 */
  cachedLabels(path: string): string[] | null {
    return this.done.get(path) ?? null;
  }

  /** ラベルの一覧を捨てる（外で書き換えたかもしれないとき。`path` を省くと全部）。 */
  forget(path?: string): void {
    if (path === undefined) {
      this.labels.clear();
      this.done.clear();
      this.index = null;
    } else {
      this.labels.delete(path);
      this.done.delete(path);
      const index = this.index;
      const fs = this.app.state.session?.files;
      if (index && fs && isScriptSourcePath(normalizeScriptPath(path))) {
        const next = index.then(async (i) => {
          await reloadScriptIndexFile(i, fs, normalizeScriptPath(path)).catch(() => false);
          return i;
        });
        this.index = next;
        next.catch(() => {
          if (this.index === next) this.index = null;
        });
      }
      for (const l of this.pathListeners) l(path);
    }
    for (const l of this.listeners) l();
  }

  /** プロジェクトの `.s` のラベルの索引（無ければ作る）。 */
  scriptIndex(): Promise<ScriptIndex> {
    const fs = this.app.state.session?.files;
    if (!fs?.root) return Promise.reject(new Error(t.noProjectFolder));
    const session = this.app.state.session;
    const building = (this.index ??= buildScriptIndex(fs));
    building.then(
      (index) => {
        if (this.index === building && this.app.state.session === session) this.last = { session, index };
      },
      () => {
        if (this.index === building) this.index = null;
      },
    );
    return building;
  }

  /**
   * そのマップの `.s` と `.string`（決まらなければ null）。maps\scripts.json の行（マップを指定した行、バンク全体の行）が
   * あればそれ、無ければマップのラベルから自動で決めたもの（#562。保存はしない。`.string` は既定の名前）。
   */
  async mapScriptOf(bank: number, map: number): Promise<MapScriptChoice | null> {
    const table = this.tableScript(bank, map);
    if (table) return table;
    const index = await this.scriptIndex().catch(() => null);
    return index ? this.autoScript(bank, map, index) : null;
  }

  /** {@link mapScriptOf} のすぐ答える形（自動で決めるのは、索引を作り終わっているときだけ）。 */
  mapScriptNow(bank: number, map: number): MapScriptChoice | null {
    const table = this.tableScript(bank, map);
    if (table) return table;
    const last = this.last;
    return last && last.session === this.app.state.session ? this.autoScript(bank, map, last.index) : null;
  }

  /** 自動で決めるときの候補（ファイルごとの数。自動操作で確かめる用）。 */
  async autoCandidates(bank: number, map: number): Promise<AutoMapScriptCandidate[]> {
    const store = this.app.state.session?.labels.store;
    const index = await this.scriptIndex().catch(() => null);
    return store && index ? autoMapScriptCandidates(store.labelsOfMap(bank, map), index, store.labelsOfOtherMaps(bank, map)) : [];
  }

  private tableScript(bank: number, map: number): MapScriptChoice | null {
    const r = this.app.state.session?.scriptsTable.document.resolve(bank, map);
    return r ? { script: r.script, strings: r.strings, from: r.entry.map === null ? "bank" : "map" } : null;
  }

  private autoScript(bank: number, map: number, index: ScriptIndex): MapScriptChoice | null {
    const store = this.app.state.session?.labels.store;
    if (!store || !this.app.state.session?.projectDir) return null;
    const found = autoMapScript(store.labelsOfMap(bank, map), index, store.labelsOfOtherMaps(bank, map));
    return found ? { script: found.path, strings: defaultScriptsJsonStringsPath(found.path), from: "auto" } : null;
  }

  /**
   * ラベルがどこにあるか（#554。そのマップの `.s` か、ほかの `.s` の `.global` か）。マップの `.s` にあれば索引は使わない。
   * プロジェクトフォルダが無ければ `missing`。
   */
  async labelPlace(bank: number, map: number, label: string): Promise<ScriptLabelPlace> {
    const script = (await this.mapScriptOf(bank, map))?.script ?? null;
    const own = script ? await this.labelsOf(script) : [];
    if (own.includes(label)) return { kind: "map" };
    const index = await this.scriptIndex().catch(() => null);
    return index ? scriptLabelPlace(label, script, own, index) : { kind: "missing" };
  }

  /** ラベルの欄の候補（マップの `.s` のラベルを先に、ほかの `.s` の `.global` のラベルを後ろに）。 */
  async labelCandidates(bank: number, map: number): Promise<ScriptLabelCandidate[]> {
    const script = (await this.mapScriptOf(bank, map))?.script ?? null;
    const own = script ? await this.labelsOf(script) : [];
    const index = await this.scriptIndex().catch(() => null);
    return index ? scriptLabelCandidates(script, own, index) : own.map((name) => ({ name, path: null }));
  }

  /** 本文を読む（無ければ null）。`editor` が false ならエディタの本文を見ずにディスクを読む。 */
  async read(path: string, editor = true): Promise<Loaded | null> {
    const host = editor ? await this.app.scriptHostIfLoaded() : null;
    const buffer = host ? await host.bufferText(path).catch(() => null) : null;
    if (buffer !== null) return { text: buffer, inEditor: true };
    const fs = this.app.state.session?.files;
    if (!fs?.root || !(await fs.exists(path))) return null;
    return { text: await fs.readText(path), inEditor: false };
  }

  /** 書き込みの列に `job` を並べ、順番が来たら動かす（前の書き込みが済んでから。失敗しても列は止めない）。 */
  exclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * 書き込みの列を `until` が決まるまで止める（エディタを閉じる間。閉じる前の確認と保存に、メインの書き込みを混ぜない）。
   * 前に並んでいる書き込みが済んだら決まる。
   */
  hold(until: Promise<unknown>): Promise<void> {
    return new Promise((started) => {
      void this.exclusive(() => {
        started();
        return until;
      });
    });
  }

  /**
   * 本文を書き換える。`edit` は今の本文（無いファイルは `create` の本文、`create` も無ければ Error）と、ファイルがあったかを受け、
   * 新しい本文を返す（null なら書かない）。エディタで開いていればエディタの本文を書き換え、そのタブに未保存の変更が無ければ
   * 保存する（`save: false` なら保存しない）。
   */
  change(path: string, edit: (text: string, existed: boolean) => string | null, options: { create?: string; save?: boolean } = {}): Promise<boolean> {
    return this.exclusive(() => this.changeNow(path, edit, options, true));
  }

  private async changeNow(path: string, edit: (text: string, existed: boolean) => string | null, options: { create?: string; save?: boolean }, editor: boolean): Promise<boolean> {
    const loaded = await this.read(path, editor);
    if (!loaded && options.create === undefined) throw new Error(t.fileMissing(path));
    const before = loaded?.text ?? options.create!;
    const after = edit(before, loaded !== null);
    if (after === null) return false;
    if (loaded?.inEditor) {
      const host = await this.app.scriptHostIfLoaded();
      const ok = host ? await host.setBufferText(path, after, options.save !== false).catch(() => false) : false;
      // 読んだあとでタブかエディタが閉じた: ディスクの本文に書き直す（閉じかけのエディタへ渡して消えないように）
      if (!ok) return this.changeNow(path, edit, options, false);
    } else {
      const fs = this.app.state.session?.files;
      if (!fs?.root) throw new Error(t.noProjectFolder);
      if (after !== before || !loaded) await fs.writeText(path, after);
      const host = await this.app.scriptHostIfLoaded();
      await host?.fileChanged(path);
    }
    this.forget(path);
    return true;
  }

  /**
   * ディスクの本文が `expected`（無いファイルなら null）のときだけ `text` に書き換える（エディタからのディスクへの書き込み）。
   * 書けたら true、本文が変わっていたら false（読み直してやり直してもらう）。
   */
  writeIfUnchanged(path: string, expected: string | null, text: string): Promise<boolean> {
    return this.exclusive(async () => {
      const fs = this.app.state.session?.files;
      if (!fs?.root) throw new Error(t.noProjectFolder);
      const current = (await fs.exists(path)) ? await fs.readText(path) : null;
      if (current !== expected) return false;
      if (current !== text) await fs.writeText(path, text);
      const host = await this.app.scriptHostIfLoaded();
      await host?.fileChanged(path);
      this.forget(path);
      return true;
    });
  }

  /** ファイルを消す（書き込みの列に並べる。幅検査の登録を取り消しで消すとき）。 */
  removeFile(path: string): Promise<void> {
    return this.exclusive(async () => {
      const fs = this.app.state.session?.files;
      if (fs?.root && (await fs.exists(path))) await fs.remove(path);
      this.forget(path);
    });
  }

  /** 最後にまとまりを足す（無いファイルは `create` の本文から作る）。実際に足した文字列を返す（取り消しで探す）。 */
  async append(path: string, block: string, create?: string): Promise<string> {
    let added = "";
    await this.change(
      path,
      (text) => {
        const out = appendBlock(text, block);
        added = out.added;
        return out.text;
      },
      create === undefined ? {} : { create },
    );
    return added;
  }

  /** 足したまとまりを除く。手で書き換えていて見つからなければ false（そのまま残す）。 */
  async remove(path: string, added: string): Promise<boolean> {
    let found = false;
    await this.change(path, (text) => {
      // エディタは改行を LF で持つので、CRLF で足したものは LF でも探す
      const next = removeBlock(text, added) ?? removeBlock(text, added.replace(/\r\n/g, "\n"));
      found = next !== null;
      return next;
    }).catch(() => false);
    return found;
  }
}
