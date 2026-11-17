import heroUrl from "../assets/toolbar-hero.png";
import type { IconPixels } from "./pixelIcon";
import { INSERT_MAP_ICON, NEW_MAP_ICON, WORLD_MAP_FALLBACK_ICON } from "./toolbarPixelArt";

/**
 * ツールバーのアイコン（32×32）。AdvanceMap の絵と同じ意味のものを SVG で自作した。
 * 「オブジェクトの表示」は主人公のドット絵の PNG。新規マップの作成・挿入とワールドマップエディタはドット絵（toolbarPixelArt.ts。#541）。
 */

const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="geometricPrecision">${body}</svg>`;

/** GBA カートリッジ（左上寄り）。 */
const cartridge = `
  <g transform="rotate(-18 14 14)">
    <rect x="3" y="7" width="22" height="15" rx="2" fill="#3b3b3b" stroke="#111" stroke-width="1"/>
    <rect x="6" y="9" width="16" height="9" fill="#bfc7cf" stroke="#6b7680" stroke-width="0.8"/>
    <rect x="8" y="11" width="12" height="2" fill="#7d8a96"/>
    <rect x="5" y="22" width="18" height="2" fill="#555"/>
  </g>`;

/** 右下の小さな箱（ショートカット風の矢印を載せる）。 */
const cornerBox = `<rect x="17" y="17" width="14" height="14" fill="#fff" stroke="#555" stroke-width="1"/>`;

/**
 * 「オブジェクトの表示」は、ユーザーが用意した主人公の小さなドット絵（assets/hero-source.png）を、
 * 背景を透過にして 2 倍にし、影を付けた PNG（scripts/make-hero-icon.py で作る。4KB 未満なので Vite が data URL にして埋め込む）。
 */
const hero = `<img class="toolbar-bitmap" src="${heroUrl}" width="32" height="32" alt="">`;

/**
 * ドット絵の画素（toolbarPixelArt.ts）を PNG の data URL の `<img>` にする（主人公の絵と同じ出し方。#541）。
 * 画面の部品は `<img>` 1 つだけにし、ドットごとの要素を作らない。
 */
export function pixelIconHtml(pixels: IconPixels): string {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext("2d")!.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  return `<img class="toolbar-bitmap" src="${canvas.toDataURL("image/png")}" width="${pixels.width}" height="${pixels.height}" alt="">`;
}

/** アイコンの一覧（キーはツールバーの項目）。 */
export const ICONS: Readonly<Record<string, string>> = {
  open: svg(`${cartridge}${cornerBox}<path d="M20 28 C20 22 22 21 27 21" fill="none" stroke="#1f6fd1" stroke-width="2.4"/><polygon points="26,18 30,21 26,24" fill="#1f6fd1"/>`),
  save: svg(`${cartridge}${cornerBox}<rect x="22.5" y="19" width="3" height="6" fill="#1f6fd1"/><polygon points="19,24 29,24 24,30" fill="#1f6fd1"/>`),
  newMap: pixelIconHtml(NEW_MAP_ICON),
  insertMap: pixelIconHtml(INSERT_MAP_ICON),
  previousMap: svg(
    `<rect x="3" y="2" width="18" height="18" rx="2" fill="#8a3fd0" stroke="#4b1a7a"/><text x="12" y="16" font-family="Arial Black,Arial" font-weight="bold" font-size="13" text-anchor="middle" fill="#f8e048" stroke="#6a4a00" stroke-width="0.6">W</text><path d="M10 27 C17 30 25 28 27 20" fill="none" stroke="#1f6fd1" stroke-width="2.6"/><polygon points="23,20 30,17 29,24" fill="#1f6fd1"/>`,
  ),
  showObjects: hero,
  blockEditor: svg(
    `<path d="M5 9 H12 C11 4 18 4 17 9 H24 V15 C29 14 29 22 24 21 V28 H17 C18 23 11 23 12 28 H5 V21 C10 22 10 14 5 15 Z" fill="#9b2fc4" stroke="#4e0f6a" stroke-width="1"/>`,
  ),
  connections: svg(
    `<g fill="#6f8ff0" stroke="#2f4fb0" stroke-width="0.8"><polygon points="16,1 22,8 18,8 18,13 14,13 14,8 10,8"/><polygon points="16,31 10,24 14,24 14,19 18,19 18,24 22,24"/><polygon points="1,16 8,10 8,14 13,14 13,18 8,18 8,22"/><polygon points="31,16 24,22 24,18 19,18 19,14 24,14 24,10"/></g>`,
  ),
  worldMap: pixelIconHtml(WORLD_MAP_FALLBACK_ICON),
  find: svg(
    `<circle cx="19" cy="12" r="8" fill="#dff0ff" stroke="#8a8f96" stroke-width="2.4"/><path d="M14 9 A6 6 0 0 1 20 6" fill="none" stroke="#fff" stroke-width="2"/><line x1="13" y1="18" x2="4" y2="28" stroke="#8a8f96" stroke-width="3.4" stroke-linecap="round"/>`,
  ),
  about: svg(
    `<defs><radialGradient id="g" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#7cc0ff"/><stop offset="1" stop-color="#0d5ec9"/></radialGradient></defs><circle cx="16" cy="16" r="14" fill="url(#g)" stroke="#0a3f8a"/><text x="16" y="23" font-family="Arial" font-weight="bold" font-size="20" text-anchor="middle" fill="#fff">?</text>`,
  ),
};
