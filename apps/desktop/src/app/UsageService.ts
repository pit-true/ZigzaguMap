import {
  UsageProject,
  flattenCommandRecords,
  loadUsageConfig,
  type CommandEvent,
  type MapDocument,
  type MapId,
  type UsageBuildStats,
  type UsageKind,
  type UsageMapContent,
  type UsageSite,
} from "@zigzagumap/core";
import type { App } from "./App";
import type { ProjectSession } from "./ProjectSession";
import { scheduleIdleGc } from "../util/idleGc";

/** イベントタブを開いてから索引を作り始めるまでの待ち（起動からマップの表示を遅らせないため）。 */
const START_DELAY_MS = 1200;
/** 編集のあと、マップの分を直すまでの待ち（続けて入力したときにまとめる）。 */
const UPDATE_DELAY_MS = 150;

/** 索引の状態（自動操作の `usage.state`）。 */
export interface UsageState {
  readonly ready: boolean;
  readonly building: boolean;
  readonly stats: UsageBuildStats | null;
  readonly counts: Record<UsageKind, number> | null;
  readonly error: string | null;
}

function contentOf(doc: MapDocument): UsageMapContent {
  return { events: doc.events, mapScripts: doc.mapScripts, itemBallPersons: new Set(doc.itemBalls.map((b) => b.personIndex)) };
}

/**
 * 使われているフラグ・変数・隠しアイテムの番号・トレーナーの番号の索引（#227）の画面側。
 * ROM（とプロジェクトフォルダ）を開いたあとの待ち時間に作り、イベントの編集と `.s` の書き換えで差分を直す。
 * 「未使用を選ぶ」ボタンとひな形（#243〜）が `next` で未使用の最小の番号を引く。
 */
export class UsageService {
  private project: UsageProject | null = null;
  private building: Promise<UsageProject | null> | null = null;
  private session: ProjectSession | null = null;
  private error: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void)[] = [];
  private readonly dirtyMaps = new Map<string, MapId>();
  private readonly dirtyFiles = new Set<string>();
  private updateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly app: App) {
    app.state.on("session", () => this.attach(app.state.session));
    app.state.on("tab", () => this.scheduleStart());
  }

  private attach(session: ProjectSession | null): void {
    if (session === this.session) return;
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.session = session;
    this.project = null;
    this.building = null;
    this.error = null;
    this.dirtyMaps.clear();
    this.dirtyFiles.clear();
    if (!session) return;
    this.unsubscribe.push(session.bus.subscribe((e) => this.onCommand(e)));
    this.unsubscribe.push(
      this.app.scripts.files.onPathChange((path) => {
        if (!path.endsWith(".s")) return;
        this.dirtyFiles.add(path);
        this.scheduleUpdate();
      }),
    );
    this.scheduleStart();
  }

  /**
   * 待ち時間に作り始める。作るのはイベントタブを開いているときだけ（マップタブだけを使う間はメモリを増やさない）。
   * ほかのタブでも、「未使用」ボタン・ひな形・自動操作で要れば `ensure` がすぐ作る。
   */
  private scheduleStart(): void {
    if (this.project || this.building || this.timer || this.app.state.tab !== "event") return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.ensure();
    }, START_DELAY_MS);
  }

  /** 作り終えた索引（まだなら作り終えるまで待つ。作れなければ null）。 */
  ensure(): Promise<UsageProject | null> {
    if (this.project) return Promise.resolve(this.project);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const session = this.session;
    if (!session) return Promise.resolve(null);
    this.building ??= this.build(session);
    return this.building;
  }

  /** 作り終えた索引（まだなら null。すぐに答えが要るとき）。 */
  get now(): UsageProject | null {
    return this.project;
  }

  /** 範囲の中で使われていない最小の番号（索引を作り終えるまで待つ）。 */
  async next(kind: UsageKind, skip?: ReadonlySet<number>): Promise<number | null> {
    const p = await this.ensure();
    await this.flush();
    return p?.next(kind, skip) ?? null;
  }

  /** その番号を使っている場所。 */
  async find(kind: UsageKind, value: number): Promise<UsageSite[]> {
    const p = await this.ensure();
    await this.flush();
    return p?.find(kind, value) ?? [];
  }

  /** 状態（自動操作用）。 */
  state(): UsageState {
    return {
      ready: this.project !== null,
      building: this.building !== null && this.project === null,
      stats: this.project?.built ?? null,
      counts: this.project?.index.usedCounts() ?? null,
      error: this.error,
    };
  }

  private async build(session: ProjectSession): Promise<UsageProject | null> {
    try {
      const { disasmTools } = await import("../ui/script/disasmTools");
      const tools = await disasmTools(session);
      const fs = session.projectDir ? session.files : null;
      const config = await loadUsageConfig(fs);
      const project = await UsageProject.build(
        {
          rom: session.project.rom,
          commands: tools.commands,
          text: tools.text,
          maps: session.project.mapIds(),
          map: async (id) => {
            const doc = await session.project.peek(id).catch(() => null);
            return doc ? contentOf(doc) : null;
          },
          fs,
          table: tools.table ?? null,
          pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
        },
        config,
      );
      if (this.session !== session) return null;
      this.project = project;
      // trainers.json（#245）の番号も使用中に入れる
      this.app.trainers.syncUsage();
      // 作っている間の編集を入れる
      for (const id of session.project.mapIds()) {
        const doc = session.project.loaded(id);
        if (doc) project.setMap(id, contentOf(doc));
      }
      await this.flush(tools);
      // 命令表は持ち続けない（直すときに作り直す）。全マップと C のソースを読んだごみを片付け、空いた領域も OS へ返す
      // （待機時のメモリを 150MB 以下に保つ）
      project.setTools(null);
      scheduleIdleGc(true);
      return project;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  private onCommand(e: CommandEvent): void {
    if (!e.command) return;
    for (const r of flattenCommandRecords(e.command)) {
      const a = r.args as { bank?: unknown; map?: unknown };
      if (typeof a.bank === "number" && typeof a.map === "number") this.dirtyMaps.set(`${a.bank}.${a.map}`, { bank: a.bank, map: a.map });
    }
    if (this.dirtyMaps.size > 0) this.scheduleUpdate();
    this.app.trainers.syncUsage();
  }

  private scheduleUpdate(): void {
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => void this.flush(), UPDATE_DELAY_MS);
  }

  /** たまった差分を索引へ入れる。 */
  private async flush(given?: Awaited<ReturnType<typeof import("../ui/script/disasmTools").disasmTools>>): Promise<void> {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    const project = this.project;
    const session = this.session;
    if (!project || !session) return;
    if (this.dirtyMaps.size === 0 && this.dirtyFiles.size === 0) return;
    // 命令表はこのときだけ作る（持ち続けない）
    const tools = given ?? (await (await import("../ui/script/disasmTools")).disasmTools(session).catch(() => null));
    if (tools) project.setTools({ table: tools.table ?? null, commands: tools.commands, text: tools.text });
    for (const id of this.dirtyMaps.values()) {
      const doc = session.project.loaded(id);
      if (doc) project.setMap(id, contentOf(doc));
      else if (!session.project.mapIds().some((m) => m.bank === id.bank && m.map === id.map)) project.removeMap(id);
    }
    this.dirtyMaps.clear();
    const files = [...this.dirtyFiles];
    this.dirtyFiles.clear();
    for (const path of files) {
      const loaded = await this.app.scripts.files.read(path).catch(() => null);
      project.updateAsm(path, loaded?.text ?? null);
    }
    if (!given) project.setTools(null);
  }
}
