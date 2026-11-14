// script/strings の公開する名前（.string の読み書きと、文字数による簡易の幅検査）。
export {
  StringFileError,
  appendStringEntry,
  findStringEntry,
  parseStringFile,
  replaceStringBody,
  resolveStringText,
  stringFileNewline,
  stringLineOffsets,
  stringifyStringFile,
  type StringEntry,
  type StringFile,
  type StringFileSettings,
  type StringLine,
  type StringLineEnding,
  type StringLineKind,
} from "./StringFile.js";
export {
  formatStringText,
  splitStringPages,
  tokenizeStringText,
  type StringTextLine,
  type StringTextPage,
  type StringToken,
  type StringTokenKind,
} from "./StringText.js";
export {
  TEXT_WIDTH_DEFAULT_COLUMNS,
  TEXT_WIDTH_DEFAULT_LINES,
  TEXT_WIDTH_DEFAULT_PLACEHOLDERS,
  checkStringFileWidth,
  checkTextWidth,
  type StringFileWidthIssue,
  type TextWidthIssue,
  type TextWidthLine,
  type TextWidthOptions,
  type TextWidthResult,
} from "./TextWidth.js";
