import type { App } from "../App";
import { optStr, settle, type AutomationRequest, type CommandTable } from "./registry";

/**
 * 左のマップ一覧と ROM 情報（`tree.list` / `tree.select` / `tree.open` / `romInfo`）。
 * - `tree.list`: 全項目（文字列（未出力の印 ` *` を含む）、深さ、子があるか、開いているか、選択、開いているマップか、未出力か、マップの番号）。
 *   `visibleOnly: true` で、開いている枝の中だけ（画面に並ぶもの）。
 * - `tree.select` / `tree.open`: 項目を左クリック（選ぶだけ）／ダブルクリック（マップなら開く、グループなら開閉）する。
 *   項目は `key`、`text`（文字列が同じなら最初のもの）、`bank`・`map`（「ヘッダー」の下のそのマップ）のどれかで指す。
 *   行が無い（親が閉じている）ときは親を開いてから押す。
 */

function find(app: App, req: AutomationRequest): string {
  const items = app.tree.items();
  const key = optStr(req, "key");
  if (key !== null) {
    if (!items.some((i) => i.key === key)) throw new Error(`一覧に項目がありません: ${key}`);
    return key;
  }
  const text = optStr(req, "text");
  if (text !== null) {
    const hit = items.find((i) => i.text === text || i.text.replace(/ \*$/, "") === text);
    if (!hit) throw new Error(`一覧に「${text}」がありません`);
    return hit.key;
  }
  if (typeof req["bank"] === "number" && typeof req["map"] === "number") {
    const hit = items.find((i) => i.mapId && i.mapId.bank === req["bank"] && i.mapId.map === req["map"]);
    if (!hit) throw new Error(`一覧にマップ ${String(req["bank"])}.${String(req["map"])} がありません`);
    return hit.key;
  }
  throw new Error("項目を key・text・bank と map のどれかで指定してください");
}

function row(app: App, key: string): HTMLElement {
  const el = app.tree.rowElement(key);
  if (!el) throw new Error(`一覧の行を作れません: ${key}`);
  el.scrollIntoView({ block: "nearest" });
  return el;
}

function mouseInit(el: HTMLElement, detail: number): MouseEventInit {
  const r = el.getBoundingClientRect();
  return { clientX: r.left + 20, clientY: r.top + r.height / 2, button: 0, buttons: 1, detail, bubbles: true, cancelable: true, view: window };
}

function list(app: App, req: AutomationRequest): unknown {
  const items = app.tree.items();
  if (req["visibleOnly"] !== true) return items;
  // 開いている枝の中だけ
  const out = [];
  const closedDepth: number[] = [];
  for (const i of items) {
    while (closedDepth.length && closedDepth[closedDepth.length - 1]! >= i.depth) closedDepth.pop();
    if (closedDepth.length) continue;
    out.push(i);
    if (i.hasChildren && !i.expanded) closedDepth.push(i.depth);
  }
  return out;
}

async function select(app: App, req: AutomationRequest): Promise<unknown> {
  const key = find(app, req);
  const el = row(app, key);
  el.dispatchEvent(new MouseEvent("mousedown", mouseInit(el, 1)));
  el.dispatchEvent(new MouseEvent("mouseup", { ...mouseInit(el, 1), buttons: 0 }));
  el.dispatchEvent(new MouseEvent("click", { ...mouseInit(el, 1), buttons: 0 }));
  await settle();
  return app.tree.items().find((i) => i.key === key) ?? null;
}

async function open(app: App, req: AutomationRequest): Promise<unknown> {
  const key = find(app, req);
  const el = row(app, key);
  for (const detail of [1, 2]) {
    el.dispatchEvent(new MouseEvent("mousedown", mouseInit(el, detail)));
    el.dispatchEvent(new MouseEvent("mouseup", { ...mouseInit(el, detail), buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...mouseInit(el, detail), buttons: 0 }));
  }
  el.dispatchEvent(new MouseEvent("dblclick", { ...mouseInit(el, 2), buttons: 0 }));
  // マップを開くのは非同期なので、開き終わるまで待つ（最大 5 秒）
  const item = app.tree.items().find((i) => i.key === key);
  if (item?.mapId) {
    for (let t = 0; t < 100; t++) {
      const m = app.state.map;
      if (m && m.id.bank === item.mapId.bank && m.id.map === item.mapId.map) break;
      await settle(50);
    }
  }
  await settle();
  return { item: app.tree.items().find((i) => i.key === key) ?? null, status: app.state.status };
}

/** 左下の ROM 情報（見出しと値の組）。 */
function romInfo(): { label: string; value: string }[] {
  const spans = [...document.querySelectorAll<HTMLElement>(".rom-info > span")].map((s) => s.textContent ?? "");
  const out = [];
  for (let i = 0; i + 1 < spans.length; i += 2) out.push({ label: spans[i]!, value: spans[i + 1]! });
  return out;
}

export const treeCommands: CommandTable = {
  "tree.list": list,
  "tree.select": select,
  "tree.open": open,
  romInfo: () => romInfo(),
};
