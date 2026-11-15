import { ItemBallStyleCounter, type ItemBallStyle, type UsageKind } from "@zigzagumap/core";
import { jaEventView } from "../i18n/ja.eventView";
import { jaUsage } from "../i18n/ja.usage";
import type { ScriptSummaries } from "../ui/event/ScriptSummaries";
import { errorText } from "../util/errors";
import type { App } from "./App";

/** イベントタブの操作（未使用の番号、ひな形を置く、イベントの削除、ワープ先のマップを作る、スクリプトの要約）。中身は初めて使うときに読み込む。 */
export class EventActions {
  private summariesValue: Promise<ScriptSummaries> | null = null;
  private warpMapCreatorValue: Promise<import("../ui/event/WarpMapCreator").WarpMapCreator> | null = null;
  private eventDeleterValue: Promise<import("../ui/event/EventDeleter").EventDeleter> | null = null;
  private templatePlacerValue: Promise<import("../ui/event/TemplatePlacer").TemplatePlacer> | null = null;
  /** 落とし物の見た目（#304。開いているセッションごとに 1 回だけ数える）。 */
  private itemBallStyleValue: { session: unknown; style: Promise<ItemBallStyle> } | null = null;

  /** 窓の中身（未使用の番号・トレーナーの一覧など）。#244・#245 が足す。 */
  readonly templateSource: import("../ui/event/TemplatePicker").TemplatePickerSource;

  /** `app.usage` と `app.trainers` を作ってから作る。 */
  constructor(private readonly app: App) {
    this.templateSource = {
      unused: (kind, skip) => this.app.usage.next(kind, skip),
      trainers: () => this.trainerChoices(),
      newTrainer: app.trainers.newTrainerSource(),
    };
  }

  /** 範囲の中で使われていない最小の番号（#227）。無ければステータスバーに出して null。 */
  async pickUnused(kind: UsageKind): Promise<number | null> {
    const app = this.app;
    const what = jaUsage.kind[kind] ?? kind;
    if (!app.usage.now) app.state.setStatus(jaUsage.building);
    const value = await app.usage.next(kind);
    const error = app.usage.state().error;
    if (error) app.state.setStatus(jaUsage.failed(error), undefined, true);
    else if (value === null) app.state.setStatus(jaUsage.none(what), undefined, true);
    else app.state.setStatus(jaUsage.picked(what, `0x${value.toString(16).toUpperCase()}`));
    return value;
  }

  /** ひな形を置く処理（#243。初めて使うときに読み込む）。 */
  templatePlacer(): Promise<import("../ui/event/TemplatePlacer").TemplatePlacer> {
    return (this.templatePlacerValue ??= import("../ui/event/TemplatePlacer").then(({ TemplatePlacer }) => {
      const placer = new TemplatePlacer(this.app);
      // 新しいトレーナー（#245）は setTrainer を同じ 1 回の取り消しに足す
      placer.extend({ commands: (request, map) => this.app.trainers.commandsFor(request, map) });
      return placer;
    }));
  }

  /** ひな形の窓のトレーナーの選択肢（#244。番号・クラス・名前・手持ちの数。ほかで使っていれば印）。 */
  private async trainerChoices(): Promise<{ id: number; text: string }[]> {
    const { jaTrainer } = await import("../i18n/ja.trainer");
    return (await this.app.trainers.list()).map((t) => ({ id: t.id, text: jaTrainer.choice(t.id, t.className, t.name, t.partySize, t.uses, t.edited) }));
  }

  /** 「ここにひな形を置く」（#243）: 窓で種類と入力を聞いて置く。 */
  async placeTemplate(x: number, y: number): Promise<boolean> {
    try {
      const { openTemplatePicker } = await import("../ui/event/TemplatePicker");
      const request = await openTemplatePicker(this.app, x, y, this.templateSource);
      if (!request) return false;
      await (await this.templatePlacer()).place(request);
      return true;
    } catch (e) {
      this.app.showError(e);
      return false;
    }
  }

  /**
   * 「ここに落とし物を追加」（#304）: ひな形「落とし物」を見えるボール（人）で置く。道具は 1（モンスターボール）・数 1、
   * フラグは未使用の最小、見た目と向きは全マップの落とし物でいちばん多いもの。
   */
  async placeItemBall(x: number, y: number): Promise<boolean> {
    try {
      const flag = await this.pickUnused("flag");
      if (flag === null) return false;
      await (await this.templatePlacer()).place({ kind: "hiddenItem", x, y, values: { ball: true, item: 1, amount: 1, flag } });
      return true;
    } catch (e) {
      this.app.showError(e);
      return false;
    }
  }

  /**
   * 落とし物の見た目と向きの既定（#304）。ROM と `maps\` の全マップの落とし物（ROM の finditem のスクリプトを指す人と、
   * `maps\` の落とし物の人）を数え、いちばん多いもの。初めて使うときに数え、同じセッションの間は覚えておく。
   */
  itemBallStyle(): Promise<ItemBallStyle> {
    const session = this.app.state.session;
    if (!session) return Promise.resolve(new ItemBallStyleCounter(null).mostCommon());
    if (this.itemBallStyleValue?.session === session) return this.itemBallStyleValue.style;
    const style = (async () => {
      this.app.state.setStatus(jaEventView.scanning);
      const counter = new ItemBallStyleCounter(session.project.rom);
      let n = 0;
      for (const id of session.project.mapIds()) {
        const doc = session.project.loaded(id) ?? (await session.project.peek(id).catch(() => null));
        if (doc) counter.addMap(doc.events, new Set(doc.itemBalls.map((b) => b.personIndex)));
        // 画面を止めないよう、ときどき待ち時間をはさむ
        if (++n % 32 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return counter.mostCommon();
    })();
    this.itemBallStyleValue = { session, style };
    return style;
  }

  /** イベントの削除（#220。初めて使うときに読み込む）。 */
  eventDeleter(): Promise<import("../ui/event/EventDeleter").EventDeleter> {
    return (this.eventDeleterValue ??= import("../ui/event/EventDeleter").then(({ EventDeleter }) => new EventDeleter(this.app)));
  }

  /**
   * イベントを削除する（右クリックの「イベントを削除」・Delete キー・「イベントの削除」ボタン）。
   * 消すものを調べて確認のダイアログを出し、「削除」なら消す。`confirm` が false なら確かめずに消す（自動操作用）。
   */
  async deleteEvent(kind: string, index: number, confirm = true): Promise<boolean> {
    const state = this.app.state;
    const id = state.map?.id;
    if (!id || kind === "fly") return false;
    const { jaEventDelete: t } = await import("../i18n/ja.eventDelete");
    try {
      state.setStatus(t.planning);
      const deleter = await this.eventDeleter();
      const plan = await deleter.plan(id, kind as "person" | "sign" | "warp" | "trap", index);
      const { confirmEventDelete, eventName } = await import("../ui/event/EventDeleteDialog");
      state.setStatus("");
      if (confirm && !(await confirmEventDelete(plan))) return false;
      const files = await deleter.run(plan);
      state.setStatus(files.length > 0 ? t.doneWithFiles(eventName(plan), files) : t.done(eventName(plan)));
      return true;
    } catch (e) {
      state.setStatus(t.failed(errorText(e)), undefined, true);
      return false;
    }
  }

  /**
   * いくつかのイベントをまとめて削除する（#399。複数選択の Delete キー・右クリック）。確認のダイアログは 1 回で、
   * 1 回の元に戻すで全部戻る。1 つだけなら `deleteEvent` と同じ。`confirm` が false なら確かめずに消す（自動操作用）。
   */
  async deleteEvents(events: readonly { kind: string; index: number }[], confirm = true): Promise<boolean> {
    const list = events.filter((e) => e.kind !== "fly") as { kind: "person" | "sign" | "warp" | "trap"; index: number }[];
    if (list.length === 1) return this.deleteEvent(list[0]!.kind, list[0]!.index, confirm);
    const state = this.app.state;
    const id = state.map?.id;
    if (!id || list.length === 0) return false;
    const { jaEventDelete: t } = await import("../i18n/ja.eventDelete");
    const { jaEventMulti: m } = await import("../i18n/ja.eventMulti");
    try {
      state.setStatus(t.planning);
      const deleter = await this.eventDeleter();
      const batch = await deleter.planMany(id, list);
      const { confirmEventDeleteBatch } = await import("../ui/event/EventDeleteDialog");
      state.setStatus("");
      if (confirm && !(await confirmEventDeleteBatch(batch))) return false;
      const files = await deleter.runMany(batch);
      state.setStatus(files.length > 0 ? m.deletedManyWithFiles(list.length, files) : m.deletedMany(list.length));
      return true;
    } catch (e) {
      state.setStatus(t.failed(errorText(e)), undefined, true);
      return false;
    }
  }

  /** ワープの「行き先のマップを作る」（#241。初めて使うときに読み込む）。 */
  warpMapCreator(): Promise<import("../ui/event/WarpMapCreator").WarpMapCreator> {
    return (this.warpMapCreatorValue ??= import("../ui/event/WarpMapCreator").then(({ WarpMapCreator }) => new WarpMapCreator(this.app)));
  }

  /** イベントのスクリプトの要約（#226。初めてホバーしたときに読み込む）。 */
  eventSummaries(): Promise<ScriptSummaries> {
    return (this.summariesValue ??= import("../ui/event/ScriptSummaries").then(({ ScriptSummaries }) => new ScriptSummaries(this.app)));
  }
}
