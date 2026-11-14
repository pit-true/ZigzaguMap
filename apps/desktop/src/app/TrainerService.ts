import {
  RemoveTrainerCommand,
  SetTrainerCommand,
  TRAINER_CLASS_COUNT,
  TrainerTable,
  generateTeam,
  summaryOf,
  wildCandidates,
  type Command,
  type MapId,
  type TrainerData,
  type TrainerEntry,
  type TrainerSummary,
  type WildEncounters,
} from "@zigzagumap/core";
import type { App } from "./App";
import type { TemplatePlaceRequest } from "../ui/event/TemplatePlacer";
import type { NewTrainerSource } from "../ui/event/TemplatePicker";
import { jaTrainer } from "../i18n/ja.trainer";
import { inputDialog } from "../ui/InputDialog";
import { showError } from "../ui/MessageBox";
import type { TrainerEditResult } from "../ui/trainer/TrainerEditDialog";
import { hex, parseNumber } from "../ui/trainer/trainerText";
import { errorText } from "../util/errors";

/** 一覧の 1 行（trainers.json で変えたか、ほかで使っているか）。 */
export interface TrainerListItem extends TrainerSummary {
  /** maps\trainers.json にあるか（ZigzaguMap で足した・変えた）。 */
  readonly edited: boolean;
  /** その番号を使っている場所の数（#227 の索引。スクリプトと trainers.json の両方）。 */
  readonly uses: number;
}

/**
 * トレーナー（#244・#245）の画面側。ROM のトレーナーの表に `maps\trainers.json` を重ねた一覧と、チームの自動生成。
 * ひな形を置くとき、新しいトレーナー（`values.newTrainer`）があれば `setTrainer` を同じ 1 回の取り消しに足す。
 */
export class TrainerService {
  private table: TrainerTable | null = null;
  private tableSession: unknown = null;

  constructor(private readonly app: App) {
    app.state.on("session", () => {
      this.table = null;
      this.syncUsage();
    });
  }

  /** ROM の表（初めて使うときに読む。読めなければ Error）。 */
  rom(): TrainerTable {
    const session = this.app.state.session;
    if (!session) throw new Error("ROM を開いてください");
    if (!this.table || this.tableSession !== session) {
      this.table = TrainerTable.read(session.project.rom, session.project.textCodec);
      this.tableSession = session;
    }
    return this.table;
  }

  /** 番号のトレーナー（trainers.json にあればそちら）。 */
  get(id: number): TrainerData | null {
    return this.app.state.session?.trainers.get(id) ?? this.rom().get(id);
  }

  /** 一覧（1 番から。trainers.json の 743 番以上も入れる）。 */
  async list(): Promise<TrainerListItem[]> {
    const session = this.app.state.session;
    if (!session) return [];
    const table = this.rom();
    const usage = await this.app.usage.ensure();
    const ids = new Set<number>();
    for (let i = 1; i < table.count; i++) ids.add(i);
    for (const t of session.trainers.trainers) ids.add(t.id);
    return [...ids]
      .sort((a, b) => a - b)
      .map((id) => {
        const edited = session.trainers.get(id);
        const t = edited ?? table.get(id)!;
        return { ...summaryOf(t, table.className(t.trainerClass)), edited: !!edited, uses: usage?.find("trainer", id).length ?? 0 };
      });
  }

  /** 索引（#227）に trainers.json の番号を入れる（未使用のトレーナーの番号を選ぶときに飛ばすため）。 */
  syncUsage(): void {
    const session = this.app.state.session;
    const usage = this.app.usage.now;
    if (!session || !usage) return;
    usage.setTrainers(
      session.trainers.trainers.map((t) => ({ kind: "trainer" as const, value: t.id, source: "trainers" as const, where: `maps/trainers.json（${t.name}）` })),
    );
  }

  /**
   * チームの自動生成（Q3 の推奨）。このマップと接続している隣のマップの野生から選ぶ。野生が無ければ、ワープの行き先のマップの野生。
   * それでも無ければ空の手持ち（種族を選んでもらう）。
   */
  async generate(map: MapId, seed: number): Promise<ReturnType<typeof generateTeam> & { maps: MapId[] }> {
    const session = this.app.state.session;
    if (!session) throw new Error("ROM を開いてください");
    const peek = (id: MapId) => session.project.peek(id).catch(() => null);
    const doc = await peek(map);
    const near: MapId[] = [map, ...(doc?.connections ?? []).map((c) => ({ bank: c.bank, map: c.map }))];
    const wildOf = async (ids: MapId[]): Promise<{ wild: WildEncounters[]; used: MapId[] }> => {
      const wild: WildEncounters[] = [];
      const used: MapId[] = [];
      for (const id of ids) {
        const d = id.bank === map.bank && id.map === map.map ? doc : await peek(id);
        if (d && d.wild.length > 0) {
          wild.push(...d.wild);
          used.push(id);
        }
      }
      return { wild, used };
    };
    let found = await wildOf(near);
    if (found.wild.length === 0 && doc?.events) {
      // 屋内など: ワープの行き先（外のマップ）の野生
      const dests = doc.events.warps.map((w) => ({ bank: w.bank, map: w.map }));
      found = await wildOf(dests.filter((d, i) => dests.findIndex((x) => x.bank === d.bank && x.map === d.map) === i));
    }
    return { ...generateTeam(wildCandidates(found.wild), seed), maps: found.used };
  }

  /** クラス名（番号の順）。 */
  classNames(): string[] {
    const t = this.rom();
    return Array.from({ length: TRAINER_CLASS_COUNT }, (_, i) => t.className(i));
  }

  /** ひな形の窓の「新しいトレーナーを作る」の欄が使うもの。 */
  newTrainerSource(): NewTrainerSource {
    return {
      nextId: () => this.app.usage.next("trainer"),
      base: (id) => this.get(id),
      classes: () => this.classNames(),
      generate: async (seed) => {
        const map = this.app.state.map?.id;
        if (!map) return { party: [], note: jaTrainer.generated("", 0) };
        const g = await this.generate(map, seed);
        return { party: g.party, note: jaTrainer.generated(g.maps.map((m) => `${m.bank}.${m.map}`).join("・"), g.party.length) };
      },
      speciesName: (n) => this.speciesName(n),
    };
  }

  /**
   * 表示中のマップの人 `index` のスクリプトが使っているトレーナーの番号（`trainer`・`trainerbattle*` の番号。#226 の要約から）。
   * 見つからなければ null。
   */
  async idForPerson(index: number): Promise<number | null> {
    const map = this.app.state.map;
    const person = map?.doc.events?.persons[index];
    if (!map || !person) return null;
    const summaries = await this.app.eventSummaries();
    const result = await summaries.summarize({ map: map.id, kind: "person", index }, person.script);
    if (result.kind !== "summary") return null;
    for (const e of result.summary.entries) if (e.type === "trainer" && e.id !== null) return e.id;
    return null;
  }

  /**
   * イベントタブの右クリック「トレーナーを編集」（#274）: 人のスクリプトのトレーナーを直す窓を出す。番号が見つからなければ聞く。
   * 窓を閉じるまで待つ。直したら true。
   */
  async editForPerson(index: number): Promise<boolean> {
    let id = await this.idForPerson(index).catch(() => null);
    if (id === null) {
      const answer = await inputDialog(jaTrainer.askIdTitle, jaTrainer.askId, hex(1));
      if (answer === null) return false;
      try {
        id = parseNumber(answer);
      } catch (e) {
        await showError(errorText(e));
        return false;
      }
    }
    return this.edit(id);
  }

  /**
   * トレーナー `id` を直す窓を出し、答えを書く（`setTrainer`。ROM の表と同じに戻したら `removeTrainer`）。`answer` を渡すと窓を出さない（自動操作）。
   * 元に戻せる。書いたら true。
   */
  async edit(id: number, answer?: TrainerEditResult | null): Promise<boolean> {
    const session = this.app.state.session;
    if (!session) return false;
    const table = this.rom();
    const base = table.get(id);
    const edited = session.trainers.get(id);
    const current = edited ?? base;
    if (!current) {
      this.app.state.setStatus(jaTrainer.outOfRange(id), undefined, true);
      return false;
    }
    const result =
      answer !== undefined
        ? answer
        : await (await import("../ui/trainer/TrainerEditDialog")).openTrainerEditDialog({
            current,
            edited: !!edited,
            inRom: !!base,
            classes: this.classNames(),
            speciesName: (n) => this.speciesName(n),
          });
    if (!result) return false;
    let command: Command | null = null;
    let status: string;
    if (result.kind === "revert" || (base && sameTrainer(result.trainer, base))) {
      command = edited ? new RemoveTrainerCommand({ id }) : null;
      status = command ? jaTrainer.reverted(id) : jaTrainer.unchanged;
    } else if (edited && sameTrainer(result.trainer, edited)) {
      status = jaTrainer.unchanged;
    } else {
      command = new SetTrainerCommand({ trainer: result.trainer });
      status = jaTrainer.saved(id, result.trainer.name);
    }
    if (command) {
      try {
        session.bus.execute(command);
      } catch (e) {
        await showError(errorText(e));
        return false;
      }
    }
    this.syncUsage();
    this.app.state.setStatus(status);
    return command !== null;
  }

  /** 種族名（無ければ `#番号`）。 */
  speciesName(n: number): string {
    return this.app.state.session?.speciesNames?.name(n, this.app.state.session.project.textCodec) ?? `#${n}`;
  }

  /** ひな形の拡張: 新しいトレーナーがあれば setTrainer を足す。 */
  commandsFor(request: TemplatePlaceRequest, map: MapId): Command[] {
    const t: TrainerEntry | undefined = request.values.newTrainer;
    return request.kind === "trainer" && t ? [new SetTrainerCommand({ trainer: t, bank: map.bank, map: map.map })] : [];
  }
}

/** トレーナーの中身が同じか（番号・記録用のラベル・知らない項目は見ない）。 */
function sameTrainer(a: TrainerData, b: TrainerData): boolean {
  const pick = (t: TrainerData) => [t.partyFlags, t.trainerClass, t.music, t.female, t.pic, t.name, t.items, t.doubleBattle, t.aiFlags >>> 0, t.party];
  return JSON.stringify(pick(a)) === JSON.stringify(pick(b));
}
