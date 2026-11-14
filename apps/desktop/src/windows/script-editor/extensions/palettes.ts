/**
 * スクリプトエディタのテーマ 4 つの色の表（DOM も CodeMirror も使わない。単体テストから読む）。
 *
 * - `code`: 本文（CodeMirror）の色。字句の種類と、命令表と索引で決めた種類ごと。
 * - `ui`: ウィンドウの部品（タブの帯・下の帯・ビルドの欄・誤りの一覧・ダイアログ・入力欄とボタン・スクロールバー）の色。
 *   `uiVariables` で CSS 変数にし、エディタのウィンドウの `<html>` に付ける（メインのテーマ light / dark とは別）。
 */

export type EditorThemeId = "darkPlus" | "lightPlus" | "monokai" | "solarizedDark";
export const EDITOR_THEMES: readonly EditorThemeId[] = ["darkPlus", "lightPlus", "monokai", "solarizedDark"];
export const DEFAULT_EDITOR_THEME: EditorThemeId = "lightPlus";

/** 本文の色。 */
export interface CodePalette {
  dark: boolean;
  bg: string;
  fg: string;
  gutterBg: string;
  gutterFg: string;
  activeLine: string;
  activeGutter: string;
  selection: string;
  cursor: string;
  match: string;
  panel: string;
  border: string;
  comment: string;
  labelDef: string;
  directive: string;
  number: string;
  string: string;
  macroArg: string;
  escape: string;
  placeholder: string;
  special: string;
  raw: string;
  command: string;
  instruction: string;
  text: string;
  label: string;
  variable: string;
  constant: string;
}

/** ウィンドウの部品の色。 */
export interface UiPalette {
  /** 帯（タブの帯・下の帯・ビルドの欄の上の帯・ダイアログ）の地。 */
  face: string;
  /** 一覧・ログ・ダイアログの本文の地。 */
  window: string;
  /** 部品の文字。 */
  text: string;
  /** 控えめな文字（カーソルの位置・未保存の印など）。 */
  muted: string;
  /** 枠と区切り線。 */
  border: string;
  /** 指したときの地。 */
  hot: string;
  /** 選んだ行の地と文字。 */
  select: string;
  selectText: string;
  /** 表示中のタブの上の線・押せる部品のフォーカスの色。 */
  accent: string;
  /** 表示中のタブと、そうでないタブの地。 */
  tabActive: string;
  tabInactive: string;
  /** 下の帯の地と文字。 */
  status: string;
  statusText: string;
  /** ボタン。 */
  button: string;
  buttonText: string;
  buttonBorder: string;
  buttonHot: string;
  /** 入力欄。 */
  field: string;
  fieldText: string;
  fieldBorder: string;
  /** 誤りの文字と地。 */
  error: string;
  errorBg: string;
  /** 知らせ（警告）の地と文字。 */
  warnBg: string;
  warnText: string;
  /** リンク。 */
  link: string;
  /** スクロールバーのつまみと溝。 */
  scrollThumb: string;
  scrollTrack: string;
}

export interface EditorPalette {
  code: CodePalette;
  ui: UiPalette;
}

export const PALETTES: Record<EditorThemeId, EditorPalette> = {
  darkPlus: {
    code: {
      dark: true, bg: "#1e1e1e", fg: "#d4d4d4", gutterBg: "#1e1e1e", gutterFg: "#858585", activeLine: "#2a2d2e", activeGutter: "#2a2d2e",
      selection: "#264f78", cursor: "#aeafad", match: "#613214", panel: "#252526", border: "#454545",
      comment: "#6a9955", labelDef: "#dcdcaa", directive: "#c586c0", number: "#b5cea8", string: "#ce9178", macroArg: "#9cdcfe",
      escape: "#d7ba7d", placeholder: "#4fc1ff", special: "#4ec9b0", raw: "#808080",
      command: "#569cd6", instruction: "#c586c0", text: "#ce9178", label: "#dcdcaa", variable: "#9cdcfe", constant: "#b5cea8",
    },
    ui: {
      face: "#252526", window: "#1e1e1e", text: "#cccccc", muted: "#9d9d9d", border: "#454545", hot: "#2a2d2e",
      select: "#04395e", selectText: "#ffffff", accent: "#3794ff", tabActive: "#1e1e1e", tabInactive: "#2d2d2d",
      status: "#007acc", statusText: "#ffffff",
      button: "#3a3d41", buttonText: "#ffffff", buttonBorder: "#5a5d61", buttonHot: "#45494e",
      field: "#3c3c3c", fieldText: "#cccccc", fieldBorder: "#5a5a5a",
      error: "#f48771", errorBg: "#5a1d1d", warnBg: "#4d3f12", warnText: "#f0e2b0", link: "#3794ff",
      scrollThumb: "#555555", scrollTrack: "#1e1e1e",
    },
  },
  lightPlus: {
    code: {
      dark: false, bg: "#ffffff", fg: "#000000", gutterBg: "#f5f5f5", gutterFg: "#237893", activeLine: "#f3f8ff", activeGutter: "#e4eefb",
      selection: "#add6ff", cursor: "#000000", match: "#f8c9ab", panel: "#f3f3f3", border: "#cccccc",
      comment: "#008000", labelDef: "#795e26", directive: "#af00db", number: "#098658", string: "#a31515", macroArg: "#001080",
      escape: "#ee0000", placeholder: "#0070c1", special: "#267f99", raw: "#808080",
      command: "#0000ff", instruction: "#af00db", text: "#a31515", label: "#795e26", variable: "#001080", constant: "#098658",
    },
    ui: {
      face: "#f3f3f3", window: "#ffffff", text: "#1f1f1f", muted: "#616161", border: "#cccccc", hot: "#e4e6f1",
      select: "#0060c0", selectText: "#ffffff", accent: "#005fb8", tabActive: "#ffffff", tabInactive: "#ececec",
      status: "#f3f3f3", statusText: "#1f1f1f",
      button: "#e5e5e5", buttonText: "#1f1f1f", buttonBorder: "#b8b8b8", buttonHot: "#d6d6d6",
      field: "#ffffff", fieldText: "#1f1f1f", fieldBorder: "#b0b0b0",
      error: "#c00000", errorBg: "#ffe0e0", warnBg: "#fff6d0", warnText: "#1f1f1f", link: "#005fb8",
      scrollThumb: "#c1c1c1", scrollTrack: "#f3f3f3",
    },
  },
  monokai: {
    code: {
      dark: true, bg: "#272822", fg: "#f8f8f2", gutterBg: "#272822", gutterFg: "#90908a", activeLine: "#3e3d32", activeGutter: "#3e3d32",
      selection: "#49483e", cursor: "#f8f8f0", match: "#6b5b14", panel: "#1e1f1c", border: "#414339",
      comment: "#75715e", labelDef: "#a6e22e", directive: "#f92672", number: "#ae81ff", string: "#e6db74", macroArg: "#fd971f",
      escape: "#ae81ff", placeholder: "#66d9ef", special: "#a6e22e", raw: "#75715e",
      command: "#66d9ef", instruction: "#f92672", text: "#e6db74", label: "#a6e22e", variable: "#fd971f", constant: "#ae81ff",
    },
    ui: {
      face: "#1e1f1c", window: "#272822", text: "#f8f8f2", muted: "#a59f85", border: "#414339", hot: "#3e3d32",
      select: "#575b49", selectText: "#ffffff", accent: "#f92672", tabActive: "#272822", tabInactive: "#34352f",
      status: "#414339", statusText: "#f8f8f2",
      button: "#414339", buttonText: "#f8f8f2", buttonBorder: "#5b5d4f", buttonHot: "#4e5043",
      field: "#3b3c35", fieldText: "#f8f8f2", fieldBorder: "#5b5d4f",
      error: "#ff6188", errorBg: "#4f2232", warnBg: "#4a4320", warnText: "#f8f8f2", link: "#66d9ef",
      scrollThumb: "#5b5d4f", scrollTrack: "#1e1f1c",
    },
  },
  solarizedDark: {
    code: {
      dark: true, bg: "#002b36", fg: "#839496", gutterBg: "#073642", gutterFg: "#586e75", activeLine: "#073642", activeGutter: "#0b4452",
      selection: "#274642", cursor: "#d30102", match: "#5d4a00", panel: "#00212b", border: "#0b4452",
      comment: "#586e75", labelDef: "#b58900", directive: "#859900", number: "#d33682", string: "#2aa198", macroArg: "#cb4b16",
      escape: "#dc322f", placeholder: "#268bd2", special: "#6c71c4", raw: "#657b83",
      command: "#268bd2", instruction: "#859900", text: "#2aa198", label: "#b58900", variable: "#cb4b16", constant: "#d33682",
    },
    ui: {
      face: "#00212b", window: "#002b36", text: "#93a1a1", muted: "#839496", border: "#0b4452", hot: "#073642",
      select: "#005a6f", selectText: "#fdf6e3", accent: "#2aa198", tabActive: "#002b36", tabInactive: "#00252f",
      status: "#00212b", statusText: "#93a1a1",
      button: "#073642", buttonText: "#eee8d5", buttonBorder: "#2a5a66", buttonHot: "#0b4452",
      field: "#073642", fieldText: "#eee8d5", fieldBorder: "#2a5a66",
      error: "#ff7b72", errorBg: "#4a1c1c", warnBg: "#3b3500", warnText: "#eee8d5", link: "#55a8e8",
      scrollThumb: "#2a5a66", scrollTrack: "#00212b",
    },
  },
};

/**
 * ウィンドウの部品の CSS 変数。base.css・dialog.css などの共通の部品が使う変数（`--face` など）を上書きし、
 * エディタだけの変数（`--se-*`）を足す。
 */
export function uiVariables(p: EditorPalette): Record<string, string> {
  const u = p.ui;
  return {
    "--face": u.face,
    "--window": u.window,
    "--text": u.text,
    "--gray-text": u.muted,
    "--note-text": u.muted,
    "--shadow": u.border,
    "--highlight": u.window,
    "--border": u.border,
    "--rule": u.border,
    "--row-rule": u.border,
    "--frame-border": u.border,
    "--group-border": u.border,
    "--groupbox-border": u.border,
    "--select": u.select,
    "--select-text": u.selectText,
    "--hot": u.hot,
    "--hot-border": u.buttonBorder,
    "--field-border": u.fieldBorder,
    "--field-disabled-border": u.border,
    "--button-face": u.button,
    "--button-border": u.buttonBorder,
    "--button-hot": u.buttonHot,
    "--button-pressed": u.hot,
    "--button-pressed-border": u.accent,
    "--disabled-text": u.muted,
    "--disabled-face": u.face,
    "--disabled-border": u.border,
    "--dialog-border": u.buttonBorder,
    "--dialog-close-text": u.text,
    "--link-text": u.link,
    "--md-link": u.link,
    "--memo-bg": u.field,
    "--notice-bg": u.warnBg,
    "--notice-border": u.buttonBorder,
    "--warn-bg": u.warnBg,
    "--warn-border": u.buttonBorder,
    "--warn-text": u.warnText,
    "--error-bg": u.errorBg,
    "--error-text": u.error,
    "--error-text-strong": u.error,
    "--se-accent": u.accent,
    "--se-tab-active": u.tabActive,
    "--se-tab-inactive": u.tabInactive,
    "--se-status": u.status,
    "--se-status-text": u.statusText,
    "--se-button": u.button,
    "--se-button-text": u.buttonText,
    "--se-button-border": u.buttonBorder,
    "--se-button-hot": u.buttonHot,
    "--se-field": u.field,
    "--se-field-text": u.fieldText,
    "--se-field-border": u.fieldBorder,
    "--se-scroll-thumb": u.scrollThumb,
    "--se-scroll-track": u.scrollTrack,
  };
}

/** `#rrggbb` の相対輝度（WCAG 2）。 */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** 2 色のコントラスト比（1〜21）。 */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
