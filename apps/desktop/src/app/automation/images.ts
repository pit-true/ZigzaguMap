import { invoke } from "@tauri-apps/api/core";
import type { App } from "../App";
import { findField } from "./ui";
import { optStr, str, type AutomationRequest, type CommandTable } from "./registry";

/**
 * 画像（`canvasPng` / `ui.shot`）。
 * - `canvasPng {target}`: `map` / `movement` / `event`（マップ表示。重ね描きとグリッドを含む）、`palette`（ブロックパレット。選択の枠とグリッドを含む）、
 *   `border`（境界ブロック）、`movementPalette`（移動許可のパレット）。古い形の `tab` も読む（省略時は表示中のタブのマップ）。
 *   どれも表示の大きさ（拡大表示なら 2 倍）で、タブが隠れていても撮れる。`id` を付けるとその部品の Canvas（場所の設定の境界の画像 `field:RandBox` など）。
 * - `ui.shot {id}`: 部品の範囲の画面の画像（PrintWindow）。
 */

const CANVAS_GROUPS: Readonly<Record<string, string>> = {
  palette: ".block-palette .palette-stage",
  border: ".border-box",
  movementPalette: ".movement-palette",
};

/** 部品の中の Canvas を重ねて 1 枚にする（いちばん大きい Canvas の大きさで。小さいものは引き伸ばす）。 */
function composite(container: Element, only?: string): string {
  const canvases = [...container.querySelectorAll<HTMLCanvasElement>(only ?? "canvas")].filter((c) => c.width > 0 && c.height > 0);
  if (canvases.length === 0) throw new Error("画像がありません（マップが開かれていません）");
  const w = Math.max(...canvases.map((c) => c.width));
  const h = Math.max(...canvases.map((c) => c.height));
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const c = out.getContext("2d")!;
  c.imageSmoothingEnabled = false;
  for (const src of canvases) c.drawImage(src, 0, 0, w, h);
  return out.toDataURL("image/png");
}

function canvasPng(app: App, req: AutomationRequest): unknown {
  const id = optStr(req, "id");
  if (id) {
    // 部品（`field:<AdvanceMap の部品名>` か ID）の Canvas。部品が Canvas でなければ中の Canvas を重ねる
    const el = findField(id);
    const url = el instanceof HTMLCanvasElement ? el.toDataURL("image/png") : composite(el);
    return { png: url.slice(url.indexOf(",") + 1) };
  }
  const target = optStr(req, "target") ?? optStr(req, "tab") ?? app.state.tab;
  let url: string | null;
  if (target === "map" || target === "movement" || target === "event") {
    url = app.tabs[target].view.toPng();
    if (!url) throw new Error("マップが開かれていません");
  } else {
    const selector = CANVAS_GROUPS[target];
    if (!selector) throw new Error(`target は map / movement / event / palette / border / movementPalette のどれかです: ${target}`);
    const el = document.querySelector(selector);
    if (!el) throw new Error(`部品が見つかりません: ${target}`);
    url = composite(el, target === "border" ? "canvas.border-canvas" : undefined);
  }
  const img = { png: url.slice(url.indexOf(",") + 1) };
  return img;
}

/**
 * 部品の見えている範囲（CSS ピクセル）。スクロールする枠やウィンドウからはみ出す分は切り詰める。まったく見えていなければ null。
 */
function visibleRect(el: Element): { left: number; top: number; right: number; bottom: number } | null {
  const r = el.getBoundingClientRect();
  let left = Math.max(r.left, 0);
  let top = Math.max(r.top, 0);
  let right = Math.min(r.right, window.innerWidth);
  let bottom = Math.min(r.bottom, window.innerHeight);
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const c = p.getBoundingClientRect();
    left = Math.max(left, c.left);
    top = Math.max(top, c.top);
    right = Math.min(right, c.right);
    bottom = Math.min(bottom, c.bottom);
  }
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

async function uiShot(_app: App, req: AutomationRequest): Promise<unknown> {
  // 部品（パネル）の見えている範囲の画像。位置は CSS ピクセル × devicePixelRatio でクライアント領域の物理ピクセルにする。
  const id = str(req, "id");
  const r = visibleRect(findField(id));
  if (!r) throw new Error(`部品が見えていません（隠れているか、枠の外にスクロールしています）: ${id}`);
  const s = window.devicePixelRatio || 1;
  const x = Math.floor(r.left * s);
  const y = Math.floor(r.top * s);
  return invoke("automation_capture", {
    x,
    y,
    width: Math.max(1, Math.ceil(r.right * s) - x),
    height: Math.max(1, Math.ceil(r.bottom * s) - y),
  });
}

export const imageCommands: CommandTable = {
  canvasPng,
  "ui.shot": uiShot,
};
