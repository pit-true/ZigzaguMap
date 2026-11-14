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
