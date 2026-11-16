import type { DnsConfig, DnsConfigError, TimeOfDay } from "@zigzagumap/core";
import { jaTimeOfDay as t } from "../../i18n/ja.timeOfDay";
import type { Actions } from "../Actions";
import type { EditorState } from "../EditorState";
import type { ProjectSession } from "../ProjectSession";
import { activeTint, setActiveTint } from "./activeTint";
import type { DnsActiveTint } from "./dnsTint";

/** 区分の並び（朝・昼・夕・夜）。core の TIMES_OF_DAY と同じ（起動のときに dns の部品を読まないよう、ここにも持つ）。 */
export const TIME_IDS: readonly TimeOfDay[] = ["morning", "day", "evening", "night"];

/** 時間帯ビューアが呼ぶ App の操作。 */
export interface TimeOfDayHost {
  /** 隣のマップの帯を作り直す。 */
  rebuildNeighbors(): void;
}

/** 読み込んだ設定（セッションごと）。 */
type Loaded = { readonly config: DnsConfig; readonly module: typeof import("./dnsTint") } | { readonly error: DnsConfigError | null };

/**
 * 時間帯ビューア（Phase6 #434）。表示 > 時間帯とツール欄のコンボで、マップを実機の時間帯の色で見せる。
 * - 区分は朝・昼・夕・夜の 4 つ。起動したとき・ROM を開き直したときはいつも昼（覚えない）。
 * - 色の表（CFRU の dns_data.h など）と計算の部品は、初めて昼以外にしたときに読み込む。昼に戻すと今までと同じ道で描く。
 * - 色を変えるのはマップの表示・隣の帯・ダイブ先の重ね表示。ブロックパレットとブロックエディタは元の色のまま。
 * - 屋内・地下・秘密基地のマップは色を変えず、ステータスバーにそう出す。
 */
export class TimeOfDayView {
  private current: TimeOfDay = "day";
  private loaded: { session: ProjectSession; value: Promise<Loaded> } | null = null;
  private generation = 0;
  /** ツール欄のコンボ。 */
  readonly select: HTMLSelectElement;
  /** 最後に切り替えたときの描き直しの時間（ミリ秒。主マップの分だけ。隣の帯は後から描く）。 */
  lastSwitchMs = 0;
  /** 最後に読めなかった理由（読めたか、まだ読んでいなければ null）。 */
  lastError: string | null = null;

  constructor(
    private readonly state: EditorState,
    actions: Actions,
    private readonly host: TimeOfDayHost,
  ) {
    this.select = document.createElement("select");
    this.select.className = "toolbar-time";
    this.select.title = t.comboHint;
    this.select.dataset["autoId"] = "toolbar.timeOfDay";
    for (const id of TIME_IDS) this.select.append(new Option(t.names[id]!, id));
    this.select.addEventListener("change", () => void this.set(this.select.value as TimeOfDay));
    for (const id of TIME_IDS) {
      actions.register(`time.${id}`, () => this.set(id));
      actions.registerCheck(`time.${id}`, () => this.current === id);
    }
    state.on("session", () => {
      this.loaded = null;
      this.syncConfig = null;
      this.lastError = null;
      if (this.current !== "day") this.apply("day", null);
    });
    state.on("map", () => {
      this.syncSelect();
      if (this.current !== "day" && !this.mapTinted()) state.setStatus(t.notTinted);
    });
    this.syncSelect();
  }

  /** 今の区分。 */
  get time(): TimeOfDay {
    return this.current;
  }

  /** 表示中のマップの色が時間帯で変わるか（昼なら false）。 */
  mapTinted(): boolean {
    const tint = activeTint();
    const map = this.state.map;
    return tint !== null && map !== null && tint.tintsMapType(map.doc.header.mapType);
  }

  /** 読み込んだ設定（昼のままなら null。読めなければ null）。 */
  async config(): Promise<DnsConfig | null> {
    const l = await this.load();
    return l && "config" in l ? l.config : null;
  }

  /** 今の時間帯の色（昼なら null。#435 の人物の絵と書き出しが使う）。 */
  get tint(): DnsActiveTint | null {
    return activeTint() as DnsActiveTint | null;
  }

  /**
   * 区分を切り替える。読めなければ理由をステータスバーに出して昼のままにし、false を返す。
   * 描き直しは主マップの全部と、隣の帯・ダイブ先（後から描く）。時間帯ごとの絵は持たない。
   */
  async set(time: TimeOfDay): Promise<boolean> {
    if (!TIME_IDS.includes(time)) throw new Error(`時間帯は ${TIME_IDS.join(" / ")} のどれかです: ${time}`);
    if (time === this.current) {
      this.syncSelect();
      return true;
    }
    if (time === "day") {
      this.apply("day", null);
      return true;
    }
    const loaded = await this.load();
    if (!loaded || !("config" in loaded)) {
      this.syncSelect();
      return false;
    }
    this.apply(time, loaded.module.makeActiveTint(loaded.config, time, ++this.generation));
    return true;
  }

  /** Chronos の `settimeofday` の値（0 昼・1 朝・2 夕・3 夜・4 深夜）の区分。深夜は夜。読めなければ null。 */
  async chronosTime(value: number): Promise<TimeOfDay | null> {
    const config = await this.config();
    if (!config) return null;
    return config.chronosValues[value] ?? (value === 4 ? "night" : null);
  }

  private apply(time: TimeOfDay, tint: DnsActiveTint | null): void {
    const t0 = performance.now();
    setActiveTint(tint);
    this.current = time;
    const state = this.state;
    state.mapImage?.redrawAll();
    state.emit("cells");
    this.lastSwitchMs = performance.now() - t0;
    this.host.rebuildNeighbors();
    this.syncSelect();
    state.emit("view");
    if (time === "day") state.setStatus(t.day);
    else if (state.map && !this.mapTinted()) state.setStatus(t.notTinted);
    else {
      const hour = this.syncConfig?.sections.find((s) => s.id === time)?.hour ?? 0;
      state.setStatus(t.shown(t.names[time]!, hour));
    }
  }

  /** 読み込んだ設定（区分の時刻をステータスバーに出すため）。 */
  private syncConfig: DnsConfig | null = null;

  /** 設定を読む（セッションごとに 1 回）。読めなければ理由をステータスバーに出して null。 */
  private async load(): Promise<Loaded | null> {
    const session = this.state.session;
    if (!session) return null;
    if (!this.loaded || this.loaded.session !== session) {
      const value = (async (): Promise<Loaded> => {
        const fs = session.projectFs();
        if (!fs) return { error: null };
        const module = await import("./dnsTint");
        const r = await module.loadDnsConfig(fs);
        return "config" in r ? { config: r.config, module } : { error: r.error };
      })();
      this.loaded = { session, value };
    }
    const l = await this.loaded.value;
    if ("config" in l) {
      this.syncConfig = l.config;
      this.lastError = null;
    } else {
      this.lastError = l.error ? t.unreadable(l.error.file, l.error.line, l.error.message) : t.noProject;
      this.state.setStatus(this.lastError, undefined, l.error !== null);
    }
    return l;
  }

  private syncSelect(): void {
    this.select.value = this.current;
    this.select.disabled = this.state.map === null;
  }
}
