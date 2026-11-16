import { ini } from "./ini.generated";

export const jaPreviewPlayer = {
  menu: "仮の主人公を置く",
  male: "男の主人公",
  female: "女の主人公",
  down: ini.Bewegung["08"],
  up: ini.Bewegung["07"],
  left: ini.Bewegung["09"],
  right: ini.Bewegung["0A"],
  hint: "ドラッグか矢印キーで移動、右クリックで向き変更",
  stop: "仮の主人公を終了",
  save: "画面をPNGで保存",
  saveFailed: "仮の主人公の画像を保存できませんでした。",
  active: "仮の主人公を置きました。位置と向きは保存されません。",
  finished: "仮の主人公を終了しました。",
  missing: (count: number) => `仮の主人公の表示: 読めない画像が${count}件あります。`,
};
