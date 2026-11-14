import { appendBlock, indexAsmFile, removeBlock } from "@zigzagumap/core";
import type { App } from "../../app/App";
import { jaScriptLink as t } from "../../i18n/ja.scriptLink";

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

  constructor(private readonly app: App) {}

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
    } else {
      this.labels.delete(path);
      this.done.delete(path);
      for (const l of this.pathListeners) l(path);
    }
    for (const l of this.listeners) l();
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
