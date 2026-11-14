import {
  AutoPenPlanner,
  PRIMARY_BLOCK_COUNT,
  PartIndex,
  ROM_BASE,
  analyzeParts,
  collectLayouts,
  tilesetInfoOf,
  type AutoPenLibrary,
  type AutoPenPart,
  type AutoPenTilesetInfo,
  type BochiImportResult,
} from "@zigzagumap/core";
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
 * 自動ペンのパーツ（#303・#310）。ROM を開いたら maps\autopen\ を読み、今のマップのタイルセットの組のパーツと
 * 「ブロック → パーツ」の表を作っておく（描くときは待たずに引けるように）。
 * タイルセットの組が変わったとき・パーツを保存したとき・ブロックを編集したときに作り直し、`onChange` で知らせる。
 */
export class AutoPenService {
  private library: AutoPenLibrary | null = null;
  private setValue: AutoPenSet | null = null;
  private builtFor = "";
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  /** マップから作った候補（タイルセットの組の鍵 → パーツ。保存するまでメモリだけ）。 */
  private readonly candidates = new Map<string, AutoPenPart[]>();
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
      // 読めなければ自動ペンはふつうの鉛筆として動く
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

  /** 今の組のパーツを保存する（すぐファイルに書く）。戻り値は書いたパス。 */
  async save(parts: readonly AutoPenPart[]): Promise<string[]> {
    const lib = await this.ready();
    const set = this.setValue;
    if (!lib || !set) throw new Error("マップが開かれていません");
    const written = await lib.save(set.primary, set.secondary, parts);
    this.refresh(true);
    return written;
  }

  /**
   * マップから候補を作る（#313）。主タイルセットが同じ全マップ（ROM と maps\）の並びと挙動から作る。
   * マップを読む間はときどき待ちを入れ、画面を止めない。終わったら途中の表は捨て、候補だけを持つ
   * （今の組に保存したパーツが無ければ、候補をそのまま自動ペンに使う。保存はマップ作成補助から）。
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

  /** Bochi の mapassist\*.txt の中身を取り込む。 */
  async importBochi(texts: readonly string[]): Promise<BochiImportResult> {
    const lib = await this.ready();
    const set = this.setValue;
    if (!lib || !set) throw new Error("マップが開かれていません");
    const r = await lib.importBochi(texts, set.primary, set.secondary);
    this.refresh(true);
    return r;
  }
}
