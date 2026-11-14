import { ini } from "./ini";

/** 場所の設定タブの「かんたん（CFRU）」表示と、表示の切り替えの文言（ZigzaguMap 独自）。 */
export const jaHeaderSimple = {
  modeSimple: "かんたん（CFRU）",
  modeClassic: "くわしく（従来）",
  advanced: ini.Menue["129"],

  nameSection: "マップ名",
  region: "地名",
  regionItem: (id: number, name: string) => `${id.toString(16).toUpperCase().padStart(2, "0")} ${name}`,
  newName: "名前の書き換え",
  rename: "名前を変更",
  newNameNote: "同じ地名のマップすべての名前が変わります",
  showName: "マップに入ったときに名前を表示する",

  lookSection: "音楽と見た目",
  music: "音楽",
  musicNo: " 番号 ",
  weather: "天候",
  mapType: "マップのタイプ",
  battle: "戦闘背景",
  cave: "明るさ（洞窟）",

  allowSection: "できること",
  bike: "自転車に乗れる",
  run: "走れる（ランニングシューズ）",
  escape: "あなぬけのひも・テレポートで外へ出られる",

  tilesetSection: "タイルセット",
  tileset1: "主（タイルセット1）",
  tileset2: "副（タイルセット2）",
  tilesetItem: (n: number, group: string | null) => (group && group !== "NormaleMaps" ? `${n}（${group}）` : String(n)),
  tilesetOther: (pointer: number) => `表に無いタイルセット（${pointer.toString(16).toUpperCase()}）`,
  changeTilesets: "タイルセットを変更",

  sizeSection: "大きさ",
  mapSize: "マップ（横×高さ）",
  mapSizeNote: "左上を基準に伸び縮みします",
  resize: "大きさを変更",
  borderSize: "境界ブロック（横×高さ）",
  resizeBorder: "大きさを変更",

  connectionSection: ini.Menue["136"],
  connectionItem: (direction: string, name: string, bank: number, map: number) => `${direction}: ${name} (${bank}.${map})`,
  noConnections: "つながっているマップはありません",
  openConnections: "マップコネクションを開く",
} as const;
