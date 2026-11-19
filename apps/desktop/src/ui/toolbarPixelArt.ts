import { gridFromRgba, gridFromRows, overlayGrid, pixelIconPixels, type IconPixels, type PixelGrid } from "./pixelIcon";

/**
 * ツールバーのドット絵のアイコン（#541・#565）: 新規マップの作成・新規マップの挿入・ワールドマップエディタ。
 * AdvanceMap 1.92 のツールバーの絵の雰囲気（1 倍のドット、黒い縁取りなし）に合わせて自分で描いたもの。描き方は docs/development.md。
 *
 * - 色はこの表の 1 文字で書く（`.` は透明）。
 * - 新規マップの作成と挿入は、町の赤い屋根の家の角と茂み・草地（32×32）に、新規は星、挿入は右向きの矢印を左上に重ねる。影は付けない。
 * - ワールドマップエディタは、ROM を開いたら ROM のタウンマップから切り出した画素を丸い島の形にした絵に差し替える
 *   （`worldMapIconFromTownMap`）。ゲームの絵はリポジトリに入れない。下の `WORLD_FALLBACK` は ROM が無いときの自作の絵。どちらも影を付ける。
 */
export const PIXEL_COLORS: Readonly<Record<string, string>> = {
  "k": "#282028", // 屋根の端の線
  "R": "#d04038", // 屋根
  "r": "#982028", // 屋根の影・町の印の影
  "h": "#e87058", // 屋根の端の光
  "n": "#384060", // ひさし・ガラスの枠・壁の縁
  "W": "#d8d8e0", // 壁
  "e": "#989898", // 町の印の角
  "B": "#60a0e8", // ガラス
  "b": "#3868c8", // ガラスの影
  "c": "#a0d0f8", // ガラスの光
  "G": "#70c898", // 地面
  "g": "#48a078", // 地面の影
  "l": "#98e0b0", // 地面の光
  "T": "#286838", // 茂みの影
  "t": "#409848", // 茂み
  "u": "#78c060", // 茂みの光
  "F": "#e84848", // 花
  "f": "#f8a098", // 花の光
  "P": "#b86048", // 壁の下の影
  "p": "#e08868", // 壁の下
  "Y": "#ffe040", // 星
  "y": "#f8b018", // 星の縁
  "O": "#e88010", // 星の影
  "V": "#fff8c0", // 星の光
  "E": "#e83018", // 町の印
  "X": "#ffffff", // 町の印の光
  "1": "#188308", // 海岸
  "2": "#39ac08", // 陸
  "4": "#289608", // 陸の影
  "5": "#f6d552", // 道
  "6": "#e6a400", // 道の影
  "A": "#f89848", // 矢印
  "a": "#d86018", // 矢印の影
  "q": "#b04010", // 矢印の縁
  "Q": "#ffc890", // 矢印の光
};

/** 町の家の角（32×32）: 左上は斜めに透明、右に赤い屋根とガラスのはまった壁、左に茂み、下に草地と花。 */
const TOWN_SCENE = [
  "..................khRRrrRRrrRRrr",
  ".................khrRRrrRRrrRRrr",
  "................khrrRRrrRRrrRRrr",
  "...............khRrrRRrrRRrrRRrr",
  "..............khRRrrRRrrRRrrRRrr",
  ".............khrRRrrRRrrRRrrRRrr",
  "............khnnnnnnnnnnnnnnnnnn",
  "...........khrrrrrrrrrrrrrrrrrrr",
  "..........nennnnnnnnnnnnnnnnnnnn",
  "........kTneWWWWWWWWWWWWWWWWWWWW",
  ".......kTtneWWWWWWWWWWWWWWWWWWWW",
  "......kTttneWWWnnnnnnnnnnnnnnnWW",
  ".....kTtutneWWWncccccccccccccnWW",
  "....kTtuutneWWWncccccccccccccnWW",
  "...kTttuttneWWWnBBBBBBBBBBBBBnWW",
  "..kTtTtttTneWWWnBBBBBBBBBBBBBnWW",
  ".kTtuuTtTtneWWWnbbbbbbbbbbbbbnWW",
  "kTtuuttTttneWWWnbbbbbbbbbbbbbnWW",
  "TtuuttTTutneWWWnnnnnnnnnnnnnnnWW",
  "TtutTtTuutneWWWWWWWWWWWWWWWWWWWW",
  "TttTttTuttneWWWWWWWWWWWWWWWWWWWW",
  "TtTtuuTttTnepppppppppppppppppppp",
  "TTtuuttTtTnepppppppppppppppppppp",
  "TtttttTTtTnepppppppppppppppppppp",
  "TTtTTtTttTnePPPPPPPPPPPPPPPPPPPP",
  "gTTTggTTTgnePPPPPPPPPPPPPPPPPPPP",
  "ggggggggggnnnnnnnnnnnnnnnnnnnnnn",
  "gggggggggggggggggggggggggggggggg",
  "GGGGGGGGGGGGGGfFGGGGGGGGGGGGGGlG",
  "GGGGGGGGGlGGGGFFGGGGfFGGGGGGGGGG",
  "GGGlGGGGGGGGGGGGGGGGFFGGGGGlGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
];

/** 「新規」の星（13×13）。 */
const STAR = [
  "......y......",
  "......y......",
  ".y...yYy...y.",
  "..y.yYYYy.y..",
  "...yYVVYYy...",
  "...yYVYYYy...",
  "yyyYYYYYYOyyy",
  "...yYYYYOy...",
  "...yYYYOOy...",
  "..O.yOOOy.O..",
  ".O...yOy...O.",
  "......O......",
  "......O......",
];

/** 「挿入」の矢印（20×16）。 */
const ARROW = [
  "...........q........",
  "...........qq.......",
  "...........qQq......",
  "...........qQAq.....",
  "qqqqqqqqqqqqQAAq....",
  "qQQQQQQQQQQQAAAAq...",
  "qQAAAAAAAAAAAAAAAq..",
  "qAAAAAAAAAAAAAAAAAq.",
  "qAAAAAAAAAAAAAAAAaq.",
  "qAAAAAAAAAAAAAAAaq..",
  "qaaaaaaaaaaaaAAaq...",
  "qqqqqqqqqqqqaAaq....",
  "...........qaaq.....",
  "...........qaq......",
  "...........qq.......",
  "...........q........",
];

/** ROM を開く前・読めないときのワールドマップの絵（30×30）: 島と小島、道、町の印。 */
const WORLD_FALLBACK = [
  "...................1..........",
  "................111211........",
  ".............1112222221.......",
  ".........11112256222221.......",
  "........122222256222221.......",
  "........122222256222221.......",
  ".......12222222562222441......",
  ".......12222222562224441......",
  ".......122222eEEEEe444441.....",
  ".......122222EXVEEE44444411...",
  ".......122222EVEEEr444444441..",
  ".......122222EEEErr4444444441.",
  "......1222222EEErrr4444444441.",
  ".....12222222eErrre4444444441.",
  ".....122222224456444444444441.",
  ".....12222224445644444444441..",
  ".....1222224444564444444411...",
  ".....12222444445644444411.....",
  "......11244114456444441.......",
  "........111..115644441........",
  "...............114441.........",
  ".................111..........",
  "....11111.....................",
  "...144441.....................",
  "...1444441....................",
  "...14444441...................",
  "..144444441...................",
  "...1144411....................",
  ".....111......................",
  "..............................",
];

const rows = (r: readonly string[]): PixelGrid => gridFromRows(r, PIXEL_COLORS);

/** 新規マップの作成（家の角の左上に星）。 */
export const NEW_MAP_ICON = pixelIconPixels(overlayGrid(rows(TOWN_SCENE), rows(STAR), 0, 0));
/** 新規マップの挿入（家の角の左上に矢印）。 */
export const INSERT_MAP_ICON = pixelIconPixels(overlayGrid(rows(TOWN_SCENE), rows(ARROW), 0, 1));
/** ワールドマップエディタ（ROM を開く前・読めないとき）。 */
export const WORLD_MAP_FALLBACK_ICON = pixelIconPixels(rows(WORLD_FALLBACK), { shadow: true });

/** 島の形にするときの丸の半径（画素。切り出した絵の真ん中から）。 */
const ISLAND_RADIUS = 12;
/** 島の縁の色（タウンマップの海岸の色）。 */
const COAST = [24, 131, 8] as const;

/** 海の色か（青が赤より 30 以上強く、緑以上。タウンマップの海と水道の色）。 */
function isSea(r: number, g: number, b: number): boolean {
  return b > r + 30 && b >= g;
}

/**
 * ROM のタウンマップから切り出した画素（core の `readRegionMapIcon`。30×30）を、ワールドマップエディタのアイコンにする。
 * 真ん中から半径 12 画素の丸の中の陸だけを残し（海は透明）、丸で切った所に海岸の色の縁を付けて島の形にし、影を付ける。
 */
export function worldMapIconFromTownMap(image: { readonly width: number; readonly height: number; readonly data: ArrayLike<number> }): IconPixels {
  const { width: w, height: h, data } = image;
  const keep = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const dx = x + 0.5 - w / 2;
      const dy = y + 0.5 - h / 2;
      if (dx * dx + dy * dy <= ISLAND_RADIUS * ISLAND_RADIUS && data[o + 3] !== 0 && !isSea(data[o]!, data[o + 1]!, data[o + 2]!)) keep[y * w + x] = 1;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && keep[y * w + x] === 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const o = (y * w + x) * 4;
      const edge = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
      if (edge) out.set([COAST[0], COAST[1], COAST[2], 255], o);
      else out.set([data[o]!, data[o + 1]!, data[o + 2]!, 255], o);
    }
  }
  return pixelIconPixels(gridFromRgba({ width: w, height: h, data: out }), { shadow: true });
}
