import {
  AutoPenPlanner,
  PRIMARY_BLOCK_COUNT,
  PartIndex,
  ROM_BASE,
  analyzeParts,
  collectLayouts,
  mergeParts,
  tilesetInfoOf,
  type AutoPenLibrary,
  type AutoPenPart,
  type AutoPenTilesetInfo,
  type BochiImportResult,
} from "@zigzagumap/core";
import { jaAssist } from "../i18n/ja.assist";
import { scheduleIdleGc } from "../util/idleGc";
import type { EditorState } from "./EditorState";
import type { OpenMap } from "./ProjectSession";

/** 今のマップのタイルセットの組で使うパーツ。 */
export interface AutoPenSet {
  /** タイルセットの組の鍵（TilesetView.key）。 */
  readonly key: string;
  readonly primary: AutoPenTilesetInfo;
  readonly secondary: AutoPenTilesetInfo;
  readonly parts: readonly AutoPenPart[];
  readonly index: PartIndex;
  readonly planner: AutoPenPlanner;
  /** パーツがマップから作った候補（保存していない）か。 */
  readonly candidates: boolean;
}

/** マップのタイルセットの組の見分け方（識別子は今のブロックのデータから作る）。 */
export function tilesetInfos(map: OpenMap, game: string): { primary: AutoPenTilesetInfo; secondary: AutoPenTilesetInfo } {
  const t = map.tiles;
  const address = (pointer: number) => ((pointer >>> 0) >= ROM_BASE ? (pointer >>> 0) - ROM_BASE : pointer >>> 0);
  return {
    primary: tilesetInfoOf({ secondary: false, game, headerAddress: address(map.doc.primaryTileset), blocks: t.primary.blocks, blockCount: PRIMARY_BLOCK_COUNT }),
    secondary: tilesetInfoOf({ secondary: true, game, headerAddress: address(map.doc.secondaryTileset), blocks: t.secondary.blocks, blockCount: t.secondaryCount }),
  };
}

/**
 * オートペンのパーツ（#303・#310）。ROM を開いたら maps\autopen\ を読み、今のマップのタイルセットの組のパーツと
 * 「ブロック → パーツ」の表を作っておく（描くときは待たずに引けるように）。
 * タイルセットの組が変わったとき・パーツを保存したとき・ブロックを編集したときに作り直し、`onChange` で知らせる。
 *
 * マップ作成補助の窓で編集中の一覧（下書き）もここに持つ（パーツの正本を 1 か所にする。#379）。窓は編集のたびに下書きを送り、
 * 窓の外の変更（Bochi の読み込み・マップから候補を作る）は下書きにも足す。保存すると下書きを捨てる。オートペンは下書きを使わない。
 */
export class AutoPenService {
  private library: AutoPenLibrary | null = null;
  private setValue: AutoPenSet | null = null;
  private builtFor = "";
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  /** マップから作った候補（タイルセットの組の鍵 → パーツ。保存するまでメモリだけ）。 */
  private readonly candidates = new Map<string, AutoPenPart[]>();
  /** マップ作成補助の窓で編集中の一覧（タイルセットの組の鍵 → パーツ。保存するまでメモリだけ。#379）。 */
  private readonly drafts = new Map<string, readonly AutoPenPart[]>();
  /** 解析している組の鍵。 */
  private analyzing: Promise<AutoPenPart[]> | null = null;

  constructor(private readonly state: EditorState) {
    state.on("session", () => void this.reload());
    state.on("map", () => this.refresh());
    state.on("tiles", () => this.refresh(true));
  }

  /** 今の組のパーツ（読み込み中・マップが無いときは null）。 */
  get set(): AutoPenSet | null {
    return this.setValue;
  }

  /** 読み込んだパーツの一覧（無ければ null）。 */
  get lib(): AutoPenLibrary | null {
    return this.library;
  }

  /** 変わったときに呼ぶ。 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  /** ROM を開いた・閉じた。 */
  private async reload(): Promise<void> {
    const gen = ++this.generation;
    this.library = null;
    this.setValue = null;
    this.candidates.clear();
    this.drafts.clear();
    this.builtFor = "";
    this.notify();
    const session = this.state.session;
    if (!session) return;
    try {
      const lib = await session.autopen();
      if (gen !== this.generation) return;
      this.library = lib;
      this.refresh(true);
    } catch {
      // 読めなければオートペンはふつうの鉛筆として動く
    }
  }

  /** 読み込みを待つ（自動操作・マップ作成補助用）。 */
  async ready(): Promise<AutoPenLibrary | null> {
    const session = this.state.session;
    if (!session) return null;
    if (!this.library) {
      this.library = await session.autopen();
      this.refresh(true);
    }
    return this.library;
  }

  /** 今のマップの組の表を作り直す（同じ組・同じ版なら何もしない）。 */
  refresh(force = false): void {
    const map = this.state.map;
    const lib = this.library;
    const session = this.state.session;
    if (!map || !lib || !session) {
      if (this.setValue) {
        this.setValue = null;
        this.notify();
      }
      return;
    }
    const tag = `${map.tiles.key}#${lib.revision}`;
    if (!force && tag === this.builtFor) return;
    const { primary, secondary } = tilesetInfos(map, session.project.game.code);
    const saved = lib.partsFor(primary, secondary);
    const guess = saved.length === 0 ? (this.candidates.get(map.tiles.key) ?? null) : null;
    const parts = guess ?? saved;
    const triple = map.tiles.triple;
    const index = new PartIndex(parts, (b) => triple.isTripleChild(b));
    this.setValue = { key: map.tiles.key, primary, secondary, parts, index, planner: new AutoPenPlanner(index), candidates: guess !== null };
    this.builtFor = tag;
    this.notify();
  }

  /** 今の組の、マップ作成補助の窓で編集中の一覧（無ければ null）。 */
  get draft(): readonly AutoPenPart[] | null {
    const set = this.setValue;
    return (set && this.drafts.get(set.key)) ?? null;
  }

  /** 窓に出す今の組の一覧（編集中のものがあればそれ、無ければオートペンが使うもの）。 */
  get editing(): readonly AutoPenPart[] {
    return this.draft ?? this.setValue?.parts ?? [];
  }

  /** 窓で編集した今の組の一覧を預かる（窓が送ってくる。オートペンには使わないので知らせない）。 */
  setDraft(parts: readonly AutoPenPart[]): void {
    const set = this.setValue;
    if (set) this.drafts.set(set.key, parts);
  }

  /** 編集中の一覧を全部捨てる（窓を閉じたとき）。 */
  discardDrafts(): void {
    this.drafts.clear();
  }

  /** 今の組の編集中の一覧に `parts` を足して知らせる（編集中のものが無ければ何もしない）。 */
  private mergeIntoDraft(parts: readonly AutoPenPart[]): void {
    const set = this.setValue;
    const draft = set ? this.drafts.get(set.key) : undefined;
    if (!set || !draft || parts.length === 0) return;
    this.drafts.set(set.key, mergeParts(draft, parts));
    this.notify();
  }

  /**
   * 今の組のパーツを置き換えて保存する（すぐファイルに書く。自動操作の `autopen.save`）。窓で編集中なら、その一覧にも足す
   * （窓の外で保存したものを、窓の保存で消さないように。#379）。戻り値は書いたパス。
   */
  async save(parts: readonly AutoPenPart[]): Promise<string[]> {
    const written = await this.write(parts);
    this.refresh(true);
    this.mergeIntoDraft(parts);
    return written;
  }

  /** 窓の一覧を保存する（すぐファイルに書き、その組の編集中の一覧は捨てる）。戻り値は書いたパス。 */
  async saveDraft(parts: readonly AutoPenPart[]): Promise<string[]> {
    const key = this.setValue?.key;
    const written = await this.write(parts);
    if (key !== undefined) this.drafts.delete(key);
    this.refresh(true);
    return written;
  }

  private async write(parts: readonly AutoPenPart[]): Promise<string[]> {
    const lib = await this.ready();
    const set = this.setValue;
    if (!lib || !set) throw new Error(jaAssist.noMap);
    return lib.save(set.primary, set.secondary, parts);
  }

  /**
   * マップから候補を作り、今の組の窓の一覧（編集中のものか、無ければオートペンが使うもの）に無い名前のものを足す（保存はしない）。
   * 戻り値は足したパーツ。
   */
  async addCandidates(): Promise<AutoPenPart[]> {
    const key = this.setValue?.key;
    // 候補を作る前の一覧に足す（候補を作ると、保存したパーツが無い組ではオートペンの一覧が候補に変わるため）
    const before = this.editing;
    const parts = await this.analyze();
    const set = this.setValue;
    if (!set || set.key !== key) return [];
    // 作っている間に窓で編集したものは残す
    const base = this.drafts.get(set.key) ?? before;
    const names = new Set(base.map((p) => p.name));
    const add = parts.filter((p) => !names.has(p.name));
    if (add.length > 0) {
      this.drafts.set(set.key, [...base, ...add]);
      this.notify();
    }
    return add;
  }

  /**
   * マップから候補を作る（#313）。主タイルセットが同じ全マップ（ROM と maps\）の並びと挙動から作る。
   * マップを読む間はときどき待ちを入れ、画面を止めない。終わったら途中の表は捨て、候補だけを持つ
   * （今の組に保存したパーツが無ければ、候補をそのままオートペンに使う。保存はマップ作成補助から）。
   */
  analyze(): Promise<AutoPenPart[]> {
    if (this.analyzing) return this.analyzing;
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session) return Promise.resolve([]);
    const key = map.tiles.key;
    const attributes = map.tiles.primary.attributes;
    const run = (async () => {
      const pause = () => new Promise<void>((r) => window.setTimeout(r, 0));
      const layouts = await collectLayouts(session.project, map.doc.primaryTileset, pause);
      await pause();
      const parts = analyzeParts({ layouts, behavior: (b) => attributes[b] ?? 0, blockLimit: PRIMARY_BLOCK_COUNT });
      if (this.state.session === session) {
        this.candidates.set(key, parts);
        this.refresh(true);
      }
      // 全マップを読んだごみを片付け、空いた領域も OS へ返す（待機時のメモリを 150MB 以下に保つ）
      scheduleIdleGc(true);
      return parts;
    })();
    this.analyzing = run;
    const clear = () => {
      if (this.analyzing === run) this.analyzing = null;
    };
    run.then(clear, clear);
    return run;
  }

  /** Bochi の mapassist\*.txt の中身を取り込む（ファイルに書き、窓で編集中の一覧にも足す）。 */
  async importBochi(texts: readonly string[]): Promise<BochiImportResult> {
    const lib = await this.ready();
    const set = this.setValue;
    if (!lib || !set) throw new Error(jaAssist.noMap);
    const r = await lib.importBochi(texts, set.primary, set.secondary);
    this.refresh(true);
    // 窓で編集中なら、その一覧にも足す（保存しても消えないように。#379）
    this.mergeIntoDraft(r.incoming);
    return r;
  }
}
