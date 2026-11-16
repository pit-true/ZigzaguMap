import { formatHex } from "@zigzagumap/core";
import { ini } from "./ini";

/** 画像からタイルとブロックを作るウィザード（Phase6 #444〜#446）の文言（ZigzaguMap 独自）。 */
export const jaTileImport = {
  menu: "画像からタイルとブロックを作る…",
  title: "画像からタイルとブロックを作る",
  steps: ["1. 画像", "2. パレット", "3. 作り方", "4. 置き場所", "5. 確認"] as const,
  back: "< 戻る",
  next: "次へ >",
  run: "取り込む",
  close: "閉じる",
  computing: "計算しています…",

  // 1. 画像
  layerNames: ["下のレイヤー（1 枚目）", "上のレイヤー（2 枚目。省略可）", "3 枚目のレイヤー（トリプルレイヤー。省略可）"] as const,
  open: "開く…",
  clear: "外す",
  noFile: "（なし）",
  pngFilter: "PNG 画像",
  target: "書く先",
  targetNames: ["今のタイルセット2（このマップ用）", "今のタイルセット1（多くのマップで共有）", "新しいタイルセット2", "新しいタイルセット1"] as const,
  transparent: "透明色",
  transparentNames: ["左上の画素", "プレビューで選んだ色", "使わない（アルファ値だけ）"] as const,
  transparentHint: "プレビューを押すと、その画素の色を透明色にします。アルファ値が 128 未満の画素はいつも透明です。",
  imageInfo: (w: number, h: number, cells: number, colors: number, padded: boolean) =>
    `${w}×${h}（ブロック ${cells} マス、色 ${colors}）${padded ? "。16 の倍数でないので、右と下を透明で埋めます" : ""}`,
  noImage: "PNG を開いてください（フルカラーとインデックスのどちらも読めます。1024×1024 まで）。",
  layersNote: (n: number) =>
    n === 1 ? "1 枚の画像は、3. 作り方の「重ね方」でどのレイヤーに置くかを決めます。" : n === 2 ? "2 枚の画像は、下と上のレイヤーに入れます。" : "3 枚の画像は、トリプルレイヤー（N と N+1 の 2 つのブロック）で作ります。",

  // 2. パレット
  paletteHead: "パレット（使う・状態・色・使うタイルの数）",
  paletteName: (n: number) => `パレット ${n}`,
  paletteUse: "使う",
  paletteStates: { used: "使用中（色はそのまま）", reused: "使用中の色をそのまま使う", opened: "新しく書く", free: "空き", excluded: "使わない", readOnly: "タイルセット1（読むだけ）" },
  paletteTiles: (n: number) => (n > 0 ? `タイル ${n}` : ""),
  reduce: "減色する",
  reduceInfo: (changed: number, before: number, after: number) => `減色しました: 色 ${before} → ${after}、変わった画素 ${changed}`,
  reduceNone: "減色はしていません。",
  before: "減らす前",
  after: "減らした後",
  shortageTitle: "パレットが足りません",
  shortageText: (used: number, capacity: number, free: number, needed: number, atLeast: boolean, over: number) =>
    `この画像は今のパレットに収まりません。\n` +
    `書く先のパレット: ${capacity} 本のうち使用中 ${used} 本、空き ${free} 本。\n` +
    `この画像に要る新しいパレット: ${needed} 本${atLeast ? "以上" : ""}（${Math.max(0, needed - free)} 本足りません）` +
    (over > 0 ? `。1 枚で 15 色を超えるタイルが ${over} 枚あります` : "") +
    `。\n\n減色すると、色を減らして収めます（色が変わった画素の数を 2. パレットに出します）。`,
  shortageReduce: "減色する",
  shortageCancel: ini.WildePokemon["23"],

  // 3. 作り方
  useFlip: "反転で同じになるタイルをまとめる",
  reuse: "同じ絵の今あるタイルを使う",
  skipEmpty: "全部が透明の 16×16 はブロックにしない",
  mergeSame: "同じ 16×16 は 1 つのブロックにする",
  reserveDoor: "タイルセット2のドアのアニメの 8 タイル（1016〜1023）を空ける",
  mode: "重ね方",
  modeNames: ["絵だけ（下のレイヤー）", "下地ブロックの上に重ね、プレイヤーの下に描く", "下地ブロックの上に重ね、プレイヤーより手前に描く"] as const,
  upperBehind: "上のレイヤーもプレイヤーの下に描く（属性のレイヤーの種類 1）",
  tripleNote: "3 枚の画像は、ブロック N（下・上）と N+1（3 枚目）を使うトリプルレイヤーで作ります。",
  base: "下地ブロック",
  baseNone: "なし",
  pickBase: "選ぶ…",
  baseHint: "16 進で打つか、選ぶ… で一覧から選びます。下地の下のレイヤーと属性を写します。",
  sample: "重ね方の見本（左から 下のレイヤー・上のレイヤー・プレイヤーと重ねたところ）",

  // 4. 置き場所
  placeHead: "置き場所（左の画像のマスを選んで右の一覧へドラッグ。右クリックで外す）",
  autoPlace: "空きへ自動で置く",
  resetPlace: "置き直す",
  allowReplace: "使っているブロックの置き換えを許す",
  placeInfo: (placed: number, total: number, unplaced: number, replaced: number) => `置いた ${placed} / ${total}、未配置 ${unplaced}、置き換え ${replaced}`,
  placeAuto: "手で決めていないブロックは、空きの小さい番号から順に置きます。",
  placeReasons: {
    zero: "0 番には置けません",
    tripleChild: "トリプルレイヤーの次の番号です",
    outside: "表の外です",
    used: "マップで使っています",
    notEmpty: "中身があります",
    taken: "ほかのブロックを置いています",
    noNext: "次の番号（トリプルレイヤーの 3 枚目）が空いていません",
  } as Record<string, string>,
  placeHover: (block: number, text: string) => `${formatHex(block, 3)}: ${text}`,
  placeFree: "空き",
  placeLegend: "緑の点線: 空き　黄色の枠: 選んだマス　赤い印: マップで使用中",

  // 5. 確認
  stamp: "画像の並びのスタンプを作る",
  stampName: "スタンプの名前",
  stampDefault: (file: string) => `取り込み ${file}`,
  summary: (o: { target: string; palettes: readonly number[]; tiles: number; blocksFrom: number | null; blocksTo: number | null; blocks: number; replaced: number; reduced: number | null }) =>
    [
      `書く先: ${o.target}`,
      `書くパレット: ${o.palettes.length > 0 ? o.palettes.join("・") : "なし"}`,
      `新しいタイル: ${o.tiles}`,
      `ブロック: ${o.blocks}${o.blocksFrom !== null ? `（${formatHex(o.blocksFrom, 3)}〜${formatHex(o.blocksTo!, 3)}）` : ""}`,
      `置き換え: ${o.replaced}`,
      o.reduced === null ? "減色: しない" : `減色: 変わった画素 ${o.reduced}`,
      "",
      "取り込むと、1 回の Ctrl+Z で元に戻せます。マップには置きません（スタンプか、選ばれた最初のブロックで描いてください）。",
    ].join("\n"),
  done: (blocks: number, first: number | null, stamp: string | null) =>
    `取り込みました: ブロック ${blocks}${first !== null ? `（最初は ${formatHex(first, 3)}）` : ""}${stamp ? `、スタンプ「${stamp}」` : ""}`,

  // メーターと問題
  meterTiles: "タイル",
  meterBlocks: ini.BlockEditorForm["13090"],
  meterPalettes: ini.BlockEditorForm["130100"],
  meter: (needed: number, free: number, capacity: number) => `使う ${needed} / 空き ${free} / 上限 ${capacity}`,
  problems: {
    palettesShort: (p: Record<string, number | string>) => `パレットが ${p["short"]} 本${p["atLeast"] ? "以上" : ""}足りません（要る ${p["needed"]}、空き ${p["free"]}）`,
    overColorTiles: (p: Record<string, number | string>) => `1 枚で 15 色を超えるタイルが ${p["count"]} 枚あります（減色が要ります）`,
    tilesShort: (p: Record<string, number | string>) => `タイルが ${p["short"]} 枚足りません（新しく作る ${p["needed"]}、空き ${p["free"]}）`,
    blocksShort: (p: Record<string, number | string>) => `ブロックが ${p["short"]} 個足りません（要る ${p["needed"]}、空き ${p["free"]}）`,
    noBlocks: () => "作るブロックがありません（全部が透明です）",
    baseSecondary: (p: Record<string, number | string>) => `下地ブロック ${formatHex(Number(p["block"]), 3)} はタイルセット2のタイルかパレットを使うので、タイルセット1へは入れられません`,
    baseMissing: (p: Record<string, number | string>) => `下地ブロック ${formatHex(Number(p["block"]), 3)} がありません`,
    placementInvalid: (p: Record<string, number | string>) => `${Number(p["block"]) + 1} 個目のブロックを ${formatHex(Number(p["local"]), 3)} に置けません`,
    padded: (p: Record<string, number | string>) => `${p["width"]}×${p["height"]} は 16 の倍数でないので、${p["toWidth"]}×${p["toHeight"]} に透明で埋めます`,
    doorTiles: () => "タイルセット2の最後の 8 タイル（1016〜1023）は、ドアのアニメが一時的に使うので空けておきます",
    baseUpper: () => "下地ブロックの上のレイヤーの絵は使いません（下のレイヤーだけを写します）",
    reduced: (p: Record<string, number | string>) => `減色しました（変わった画素 ${p["changed"]}）`,
    replaced: (p: Record<string, number | string>) => `使っているか中身のあるブロックを ${p["count"]} 個置き換えます`,
  } as Record<string, (p: Record<string, number | string>) => string>,
  problemMark: { error: "×", note: "・" },
  needImage: "画像を開いてください",
  cannotNext: "問題（×）があるので次へ進めません",

  // 下地ブロックを選ぶ窓（#445）
  pickerTitle: "下地ブロックを選ぶ",
  pickerUpper: "上のレイヤーも重ねて表示する",
  pickerStatus: (selected: number | null, cursor: number | null) => `選択: ${selected === null ? "-" : formatHex(selected, 3)} / カーソル: ${cursor === null ? "-" : formatHex(cursor, 3)}`,
  pickerMark: "右上の三角: 写さない上のレイヤーに絵があるブロック",
  pickerSecondary: "タイルセット1へ入れるときは、タイルセット2のタイルかパレットを使うブロックは下地にできません",
  ok: ini.WildePokemon["24"],
  cancel: ini.WildePokemon["23"],
};
