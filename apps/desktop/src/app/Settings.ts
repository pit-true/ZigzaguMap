import { invoke } from "@tauri-apps/api/core";
import type { Theme } from "../util/theme";

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

/** 隣のマップの見せ方。 */
export type NeighborView = "band" | "all" | "off";

/** 場所の設定タブの表示。 */
export type HeaderView = "simple" | "classic";

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
  /** 高度なヘッダーを表示（場所の設定タブの「くわしく（従来）」の中の切り替え）。 */
  advancedHeader: boolean;
  /** 場所の設定タブの表示（`simple` = かんたん（CFRU）、`classic` = くわしく（従来））。 */
  headerView: HeaderView;
  /** 最後に開いた ROM のショートカットを作る（exe と同じフォルダ）。 */
  romShortcut: boolean;
  /** エクスプローラーの右クリックに登録したか。 */
  contextMenu: boolean;
  /** 画像を保存したフォルダ（次の保存ダイアログの初期フォルダ）。 */
  imageDir: string | null;
  /** ウィンドウの位置と大きさ。 */
  window: WindowPlacement | null;
  /** 大きさを変えられる別ウィンドウ（スクリプトエディタなど）の位置と大きさ（ウィンドウのラベル → 位置）。 */
  toolWindows: Record<string, WindowPlacement>;
  /** 保存・読み込みした `.map`（マップ一覧の「マップファイル」）。 */
  mapFiles: MapFileEntry[];
  /** `.map` を保存・読み込みしたフォルダ（次のダイアログの初期フォルダ）。 */
  mapFileDir: string | null;
  /** スクリプトエディタのテーマ（`darkPlus` / `lightPlus` / `monokai` / `solarizedDark`。エディタのウィンドウが決める）。 */
  scriptEditorTheme: string;
  /** メインと道具のウィンドウの配色（`light` = 明るい標準色、`dark` = ダーク）。スクリプトエディタは `scriptEditorTheme` を使う。 */
  theme: Theme;
  /** 隣のマップの見せ方（`band` = 境界から帯の幅だけ、`all` = マップ全体、`off` = 出さない。Phase3）。 */
  neighborView: NeighborView;
  /** コネクションマネージャーで接続のずれを変えたとき、相手のマップの逆向きの接続もそろえる（Phase3 #229）。 */
  alignConnections: boolean;
  /** マップから拾った複数選択を貼るとき、移動許可も貼る（マップタブの右の欄。Phase3 #225）。 */
  pasteMovements: boolean;
  /** ブロックを 1 つ選ぶと、そのブロックにいちばん多い移動許可を選ぶ（マップタブの右の欄。Phase3 #235）。 */
  autoMovement: boolean;
  /** 移動許可だけ違うマスと、選んだ移動許可のマスに印を付ける（表示メニュー。Phase3 #235）。 */
  usageMarks: boolean;
  /** 3 層の次の番号（単独では置けないブロック）が置かれているマスに印を付ける（表示メニュー。Phase4 #301。既定オン）。 */
  tripleChildMarks: boolean;
  /** オートペン（マップタブの右の欄。P で切り替え。Phase4 #310）。 */
  autoPen: boolean;
  /** オートペンの筆の大きさ（1・2・3・5）。 */
  autoPenSize: number;
  /** オートペンで移動許可も付ける（パーツのマスの値、無ければ使用回数でいちばん多い値）。 */
  autoPenMovement: boolean;
  /** 自動で描けるブロックに、ブロックパレットで薄い色を重ねる（表示メニュー。既定オン）。 */
  autoPenTint: boolean;
  /**
   * クローン（表示メニュー。Phase3 #242。既定オフ）。オンのときだけ、人を隣のマップの境界の近くへ置く・動かすと隣のマップに
   * クローンを作り（離れたら・消したら消す）、イベントタブの隣の帯にこのマップのクローンを見せる。オフのときは作りも消しもしない。
   */
  showClones: boolean;
  /** ROM ごとに前回のプロジェクトフォルダを覚え、ROM を開いたときフォルダを選ぶ窓を出さずにそれを開く（設定メニュー。既定オン。ユーザーの要望 #278）。 */
  rememberRomProject: boolean;
  /** メインのウィンドウに戻ったとき、プロジェクトのファイルが外で変わったか調べる（設定メニュー。既定オン。Phase5 #404）。 */
  watchProject: boolean;
  /** ROM のパス（小文字）→ 前回いっしょに開いたプロジェクトフォルダ（最近開いたものの件数に関係なく残す）。 */
  romProjects: Record<string, string>;
  /** イベントタブで隠すイベントの種類（表示メニュー。`person`・`sign`・`trap`・`warp`。隠した種類は描かず、クリックでも選ばない。#304）。 */
  hiddenEventKinds: string[];
  /** イベントの印の濃さ（0.1〜1.0。移動エリアの透明度とは別の値。1.0 で今までと同じ見た目。#304）。 */
  eventOpacity: number;
  /** タウンマップの小窓を出す（表示メニュー。既定オフ。#306）。 */
  showTownMap: boolean;
  /**
   * タウンマップの小窓で自分で決めた位置（#386）。ROM のパス（小文字）→ 紐づけ（`zigzagumap.json` の `"townMap"` の節と同じ形。
   * 読み書きは core の `readTownLinks`・`writeTownLinks`）。プロジェクトフォルダを開いていないときだけ使う。
   */
  townLinks: Record<string, unknown>;
  /** ブロックパレットのタイルセット 1・2 の境目に線と「TS2 0x280〜」の見出しを出す（表示メニュー。既定オン。#308）。 */
  paletteBoundary: boolean;
  /** マップ一覧にマップの縮小（48px）を出す（表示メニュー。既定オフ。#315・Q13）。 */
  treeThumbnails: boolean;
  /** Ctrl＋ホイールで決めたタブごとの表示倍率（1〜8。0 なら「拡大表示」のチェックに従う。#316）。 */
  mapZoom: { map: number; movement: number; event: number };
  /** 描く道具（マップタブと移動エリアタブの帯。`pencil`・`fill`・`shift`。Phase5 #388）。 */
  paintTool: string;
  /** スマートパス（マップタブの道具の帯。選択がちょうど 3×3 のとき周りに合わせて描く。Phase5 #389。既定オフ）。 */
  smartPath: boolean;
  /** 鉛筆のブラシの大きさ（1〜9。マップタブと移動エリアタブの道具の帯、`[` `]`。1 ブロックを選んでいるときだけ使う。Phase7 #515。既定 1）。 */
  brushSize: number;
  /** 鉛筆のブラシの形（`square`・`circle`。Phase7 #515。既定は正方形）。 */
  brushShape: string;
  /** カーソルの枠（表示メニュー。C。Phase5 #391。既定オフ）。 */
  cursorFrame: boolean;
  /** プレイヤーの視界の枠（表示メニュー。V。Phase5 #391。既定オフ）。 */
  playerView: boolean;
  playbackGender: "male" | "female";
  /** グリッドの形（表示 > グリッドの設定…。Phase5 #391。既定は今までの見た目。読むときは normalizeGridStyle で確かめる）。 */
  gridStyle: { width: number; height: number; offsetX: number; offsetY: number; color: string; line: string };
  /**
   * 変えたショートカットキー（設定 > ショートカットの変更…。Phase5 #392）。操作の ID → キーの表記（「Ctrl+Shift+P」など。2 つまで）。
   * 既定と違う操作だけを残す（空の配列はキーを外した操作）。読むときは `app/keymap.ts` の resolveKeymap で確かめる。
   */
  shortcuts: Record<string, string[]>;
  /**
   * ミニマップの小窓（表示メニュー。既定オフ。Phase7 #511）。出すか `show`、窓の左上の位置（null なら右上）、
   * タウンマップの現在地のまわりの拡大も出すか `town`（小窓の中のチェック。既定オフ）。
   * #542 で別ウィンドウにしてからは、位置と大きさは `toolWindows` の `minimap` に残し、`left`・`top` は使わない（前の個人設定を読めるように残す）。
   */
  minimap: { show: boolean; left: number | null; top: number | null; town?: boolean };
  /** MCP の窓口を開く（設定 > MCP の窓口。Phase7 #521。既定オフ）。オンの間だけ 127.0.0.1 で待ち受け、AppData に mcp.json を書く。 */
  mcpBridge: boolean;
  /** MCP から開いているマップの書き換えを許す（既定オフ。書き換えは「元に戻す」に乗る）。 */
  mcpAllowWrite: boolean;
  /** MCP から maps\ への出力を許す（既定オフ）。 */
  mcpAllowExport: boolean;
  /** MCP の出力が .s・eventscripts などスクリプトのファイルも書くときに許す（既定オフ）。 */
  mcpAllowScripts: boolean;
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
  headerView: "simple",
  romShortcut: false,
  contextMenu: false,
  imageDir: null,
  window: null,
  toolWindows: {},
  mapFiles: [],
  mapFileDir: null,
  scriptEditorTheme: "lightPlus",
  theme: "light",
  neighborView: "band",
  alignConnections: true,
  pasteMovements: true,
  autoMovement: true,
  usageMarks: true,
  tripleChildMarks: true,
  autoPen: false,
  autoPenSize: 1,
  autoPenMovement: true,
  autoPenTint: true,
  showClones: false,
  rememberRomProject: true,
  watchProject: true,
  romProjects: {},
  hiddenEventKinds: [],
  eventOpacity: 1,
  showTownMap: false,
  townLinks: {},
  paletteBoundary: true,
  treeThumbnails: false,
  mapZoom: { map: 0, movement: 0, event: 0 },
  paintTool: "pencil",
  smartPath: false,
  brushSize: 1,
  brushShape: "square",
  cursorFrame: false,
  playerView: false,
  playbackGender: "male",
  gridStyle: { width: 1, height: 1, offsetX: 0, offsetY: 0, color: "#000000", line: "solid" },
  shortcuts: {},
  minimap: { show: false, left: null, top: null, town: false },
  mcpBridge: false,
  mcpAllowWrite: false,
  mcpAllowExport: false,
  mcpAllowScripts: false,
};

/** 個人設定の読み書き。書き込みは少し待ってまとめる。 */
export class Settings {
  private timer: ReturnType<typeof setTimeout> | null = null;

  private constructor(readonly data: SettingsData) {}

  /** AppData から読む。読めなければ既定値。 */
  static async load(prefetched?: Promise<string>): Promise<Settings> {
    let saved: Partial<SettingsData> = {};
    try {
      const text = await (prefetched ?? invoke<string>("load_settings"));
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
    const romProjects = entry.project ? { ...this.data.romProjects, [entry.rom.toLowerCase()]: entry.project } : this.data.romProjects;
    this.update({ recent: [entry, ...rest].slice(0, Math.max(1, this.data.recentMax)), romProjects });
  }

  /** その ROM と前回いっしょに開いたプロジェクトフォルダ（無ければ null）。 */
  rememberedProject(rom: string): string | null {
    return this.data.romProjects[rom.toLowerCase()] ?? null;
  }

  /** すぐに保存する（終了時など）。 */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await invoke("save_settings", { text: JSON.stringify(this.data, null, 2) }).catch(() => undefined);
  }

  /** 書き込みを待っていれば、すぐに書く（`setting` の命令のように保存を頼んでいない変更は書かない）。 */
  async flushPending(): Promise<void> {
    if (this.timer) await this.flush();
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 300);
  }
}
