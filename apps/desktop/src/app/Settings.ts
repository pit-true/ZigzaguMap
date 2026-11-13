import { invoke } from "@tauri-apps/api/core";

/** 最近開いたもの 1 件（ベース ROM と、あればプロジェクトフォルダ）。 */
export interface RecentEntry {
  readonly rom: string;
  readonly project: string | null;
}

/** 開いていたマップ（「最後に選択したものを覚える」用）。 */
export interface LastSelection {
  readonly rom: string;
  readonly bank: number;
  readonly map: number;
  readonly tab: string;
}

/** 個人設定（AppData の settings.json）。項目名は保存形式なので変えないこと。 */
export interface SettingsData {
  grid: boolean;
  zoomMap: boolean;
  zoomMovement: boolean;
  zoomEvent: boolean;
  zoomBlockPalette: boolean;
  zoomMovementPalette: boolean;
  /** ブロックパレットの 1 行のブロック数。 */
  paletteWidth: number;
  /** 移動エリアの透明度（0.0〜1.0）。 */
  movementOpacity: number;
  showToolbar: boolean;
  rememberLast: boolean;
  /** マップ一覧の並べ替え（0〜4）。 */
  sortMode: number;
  /** 左の欄の幅。 */
  leftWidth: number;
  recent: RecentEntry[];
  recentMax: number;
  recentShowPath: boolean;
  last: LastSelection | null;
  /** 高度なヘッダーを表示。 */
  advancedHeader: boolean;
}

/** 既定値（AdvanceMap の初期状態に合わせる）。 */
export const DEFAULT_SETTINGS: SettingsData = {
  grid: false,
  zoomMap: false,
  zoomMovement: false,
  zoomEvent: false,
  zoomBlockPalette: false,
  zoomMovementPalette: false,
  paletteWidth: 8,
  movementOpacity: 0.3,
  showToolbar: true,
  rememberLast: true,
  sortMode: 4,
  leftWidth: 232,
  recent: [],
  recentMax: 5,
  recentShowPath: false,
  last: null,
  advancedHeader: true,
};

/** 個人設定の読み書き。書き込みは少し待ってまとめる。 */
export class Settings {
  private timer: ReturnType<typeof setTimeout> | null = null;

  private constructor(readonly data: SettingsData) {}

  /** AppData から読む。読めなければ既定値。 */
  static async load(): Promise<Settings> {
    let saved: Partial<SettingsData> = {};
    try {
      const text = await invoke<string>("load_settings");
      if (text) saved = JSON.parse(text) as Partial<SettingsData>;
    } catch {
      saved = {};
    }
    return new Settings({ ...DEFAULT_SETTINGS, ...saved });
  }

  /** 値を変えて保存を予約する。 */
  update(patch: Partial<SettingsData>): void {
    Object.assign(this.data, patch);
    this.scheduleSave();
  }

  /** 最近開いたものの先頭に加える（同じものは前から消す）。 */
  addRecent(entry: RecentEntry): void {
    const rest = this.data.recent.filter((r) => r.rom.toLowerCase() !== entry.rom.toLowerCase());
    this.update({ recent: [entry, ...rest].slice(0, Math.max(1, this.data.recentMax)) });
  }

  /** すぐに保存する（終了時など）。 */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await invoke("save_settings", { text: JSON.stringify(this.data, null, 2) }).catch(() => undefined);
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 300);
  }
}
