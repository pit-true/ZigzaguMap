import { appendBlock, indexAsmFile, removeBlock } from "@zigzagumap/core";
import type { App } from "../../app/App";
import { jaScriptLink as t } from "../../i18n/ja.scriptLink";

/** 本文の読み先（エディタで開いていればエディタの本文、無ければディスク）。 */
interface Loaded {
  readonly text: string;
  readonly inEditor: boolean;
}

/**
 * メインウィンドウから `.s` と `.string` を書き換える窓口（ひな形・取り込み・マップスクリプトの表）。
 * エディタで開いているファイルはエディタの本文へ送り（ディスクへ直接書かない）、開いていなければディスクに書く。
 * 書き換えは 1 つずつ順に行う。書いたファイルのラベルの一覧（イベントタブのスクリプト欄が使う）も読み直す。
 */
export class ScriptFiles {
  private queue: Promise<unknown> = Promise.resolve();
  /** ファイルごとのラベルの一覧（読んだもの）。 */
  private readonly labels = new Map<string, Promise<string[]>>();
  /** 読み終わったラベルの一覧。 */
  private readonly done = new Map<string, string[]>();
  /** ラベルの一覧が変わったときに呼ぶもの。 */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly app: App) {}

  /** ラベルの一覧が変わったときに呼ぶ。戻り値でやめる。 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    }
    for (const l of this.listeners) l();
  }

  /** 本文を読む（無ければ null）。 */
  async read(path: string): Promise<Loaded | null> {
    const host = await this.app.scriptHostIfLoaded();
    const buffer = host ? await host.bufferText(path).catch(() => null) : null;
    if (buffer !== null) return { text: buffer, inEditor: true };
    const fs = this.app.state.session?.files;
    if (!fs?.root || !(await fs.exists(path))) return null;
    return { text: await fs.readText(path), inEditor: false };
  }

  /**
   * 本文を書き換える。`edit` は今の本文（無いファイルは `create` の本文、`create` も無ければ Error）を受け、新しい本文を返す
   * （null なら書かない）。エディタで開いていればエディタの本文を書き換え、`save` ならそのタブを保存する。
   */
  change(path: string, edit: (text: string) => string | null, options: { create?: string; save?: boolean } = {}): Promise<boolean> {
    const job = this.queue.then(async () => {
      const loaded = await this.read(path);
      if (!loaded && options.create === undefined) throw new Error(t.fileMissing(path));
      const before = loaded?.text ?? options.create!;
      const after = edit(before);
      if (after === null) return false;
      if (loaded?.inEditor) {
        const host = await this.app.scriptHostIfLoaded();
        if (!host || !(await host.setBufferText(path, after, options.save === true))) throw new Error(t.editorWriteFailed(path));
      } else {
        const fs = this.app.state.session?.files;
        if (!fs?.root) throw new Error(t.noProjectFolder);
        if (after !== before || !loaded) await fs.writeText(path, after);
        const host = await this.app.scriptHostIfLoaded();
        await host?.fileChanged(path);
      }
      this.forget(path);
      return true;
    });
    this.queue = job.catch(() => undefined);
    return job;
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
