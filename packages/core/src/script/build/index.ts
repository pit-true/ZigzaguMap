// script/build の公開する名前（ビルド・幅検査のコマンドの出力の読み取りと、Chronos の幅検査の登録ファイル）。
export { parseWidthCheckLine, parseWidthCheckOutput, type WidthCheckError } from "./WidthCheckLog.js";
export { parseWidthRegistryListing, planWidthRegistry, type WidthRegistryListing, type WidthRegistryPlan } from "./WidthRegistry.js";
