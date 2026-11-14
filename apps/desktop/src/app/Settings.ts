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

/** ウィンドウの位置と大きさ（物理ピクセル）。 */
export interface WindowPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly maximized: boolean;
}

/** マップ一覧の「マップファイル」に出す `.map`（AdvanceMap の Ini\MapDateien.ini と同じく、名前とパス）。 */
export interface MapFileEntry {
  readonly name: string;
  readonly path: string;
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
  /** オブジェクトの表示（人を OW 画像で描く）。 */
  showObjects: boolean;
  /** イベントパネルの非表示（AdvanceMap でも見た目の変化は無い。設定として持つだけ）。 */
  hideEventPanel: boolean;
  /** コンボボックス（左の一覧の代わりにコンボ 2 つを出す）。 */
  comboBox: boolean;
  /** 自動的にオフセットを検索する（ROM へ書かないので設定として持つだけ）。 */
  autoSearch: boolean;
  /** 高度なヘッダーを表示。 */
  advancedHeader: boolean;
  /** 最後に開いた ROM のショートカットを作る（exe と同じフォルダ）。 */
  romShortcut: boolean;
  /** エクスプローラーの右クリックに登録したか。 */
  contextMenu: boolean;
  /** 画像を保存したフォルダ（次の保存ダイアログの初期フォルダ）。 */
  imageDir: string | null;
  /** ウィンドウの位置と大きさ。 */
  window: WindowPlacement | null;
  /** 保存・読み込みした `.map`（マップ一覧の「マップファイル」）。 */
  mapFiles: MapFileEntry[];
  /** `.map` を保存・読み込みしたフォルダ（次のダイアログの初期フォルダ）。 */
  mapFileDir: string | null;
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
  showObjects: false,
  hideEventPanel: true,
  comboBox: false,
  autoSearch: true,
  advancedHeader: true,
  romShortcut: false,
  contextMenu: false,
  imageDir: null,
  window: null,
  mapFiles: [],
  mapFileDir: null,
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

  /** 値を変えるが保存はしない（スライダーを動かしている間の描き直し用。離したときに `update` で保存する）。 */
  preview(patch: Partial<SettingsData>): void {
    Object.assign(this.data, patch);
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
