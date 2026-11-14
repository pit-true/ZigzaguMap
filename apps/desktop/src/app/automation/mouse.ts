import type { App } from "../App";
import { findField } from "./ui";
import { int, num, optStr, settle, str, type AutomationRequest, type CommandTable } from "./registry";
import { describeSelection } from "./status";

/**
 * マウス操作（`mouse`）。実際のマウスは動かさず、部品へ同じ入力イベント（pointer・mouse・click・dblclick・contextmenu）を
 * 実際の操作と同じ順に送る。画面側は人が操作したときと同じ処理を通る。
 *
 * `{"cmd":"mouse","target":"map","action":"click","cell":[5,3]}` のように使う。
 * - target: `connectionHandle`（隣の帯のつまみ。`handle` に `connection.handles` の `id`。`cell: [0, 0]` がつまみの中心）/
 *   `map`（マップタブ）/ `movement`（移動エリア）/ `event`（イベント）/ `palette`（ブロックパレット）/ `border`（境界ブロック）/
 *   `movementPalette`（移動許可のパレット）。`id` を渡すと `data-auto-id`（か `field:<AdvanceMap の部品名>`）の部品の上（`px` だけ使える）。
 * - 位置: `cell: [x, y]`（マス。マスの中央を押す）か `px: [x, y]`（部品の左上からの表示上の画素）。古い形の `x`・`y`（マス）も読む。
 *   マップのタブ（map / movement / event）の `cell` は主マップの左上が原点で、負の値や大きさを超える値で隣のマップの帯の上を指せる（Phase3）。
 * - action: `click` / `dblclick` / `rightClick` / `drag`（`to` / `toPx` まで `steps` 回（既定 8）に分けて動かす）/ `hover` /
 *   `down` / `move` / `up`（1 つずつ送る）。
 * - button: `left`（既定）/ `right`（`drag` と `down`・`up` で使う）。ctrl・shift・alt: 修飾キー。
 * 返事は選択中のブロック・移動許可・イベントとステータスバー。
 */

interface Target {
  /** 入力イベントを送る部品。 */
  readonly element: HTMLElement;
  /** 1 マスの表示上の大きさ（横・縦）。 */
  readonly cell: { readonly w: number; readonly h: number };
  /** `cell` の原点の、部品の左上からの位置（マップのタブでは、隣のマップの帯の余白の分）。 */
  readonly origin?: { readonly x: number; readonly y: number };
}

/** マップのタブの、主マップの左上の位置（ステージの中の画素。隣の帯の余白が無ければ 0）。 */
function mapOrigin(stage: HTMLElement): { x: number; y: number } {
  const base = stage.querySelector<HTMLElement>(".map-base");
  return { x: parseFloat(base?.style.left ?? "") || 0, y: parseFloat(base?.style.top ?? "") || 0 };
}

export const MOUSE_TARGETS: Readonly<Record<string, string>> = {
  map: ".map-tab-view .map-stage",
  movement: ".movement-tab-view .map-stage",
  event: ".event-tab-view .map-stage",
  palette: ".block-palette .palette-stage",
  border: "canvas.border-canvas",
  movementPalette: ".movement-palette canvas",
};

/** 部品とマスの大きさ。 */
function resolveTarget(app: App, req: AutomationRequest): Target {
  if (typeof req["id"] === "string") return { element: findField(req["id"]), cell: { w: 1, h: 1 } };
  const name = str(req, "target");
  if (name === "connectionHandle") {
    // 隣の帯のつまみ（Phase3）。`cell: [0, 0]` がつまみの中心で、`to` はマップタブのマス単位のずらし
    const id = str(req, "handle");
    const element = document.querySelector<HTMLElement>(`.map-tab-view [data-auto-id="${CSS.escape(id)}"]`);
    if (!element) throw new Error(`つまみが見つかりません: ${id}`);
    const size = app.state.settings.data.zoomMap ? 32 : 16;
    const r = element.getBoundingClientRect();
    return { element, cell: { w: size, h: size }, origin: { x: r.width / 2 - size / 2, y: r.height / 2 - size / 2 } };
  }
  const selector = MOUSE_TARGETS[name];
  if (!selector) throw new Error(`target は ${Object.keys(MOUSE_TARGETS).join(" / ")} のどれかです: ${name}`);
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`部品が見つかりません: ${name}`);
  const s = app.state.settings.data;
  const zoom = (on: boolean): number => (on ? 32 : 16);
  switch (name) {
    case "map":
      return { element, cell: { w: zoom(s.zoomMap), h: zoom(s.zoomMap) }, origin: mapOrigin(element) };
    case "movement":
      return { element, cell: { w: zoom(s.zoomMovement), h: zoom(s.zoomMovement) }, origin: mapOrigin(element) };
    case "event":
      return { element, cell: { w: zoom(s.zoomEvent), h: zoom(s.zoomEvent) }, origin: mapOrigin(element) };
    case "palette":
      return { element, cell: { w: zoom(s.zoomBlockPalette), h: zoom(s.zoomBlockPalette) } };
    case "movementPalette":
      return { element, cell: { w: zoom(s.zoomMovementPalette), h: zoom(s.zoomMovementPalette) } };
    default: {
      // 境界ブロック: 表示の大きさをマスの数で割る
      const border = app.state.map?.doc.border;
      const r = element.getBoundingClientRect();
      return { element, cell: { w: border ? r.width / border.width : 16, h: border ? r.height / border.height : 16 } };
    }
  }
}

function pair(v: unknown, key: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== "number" || typeof v[1] !== "number") throw new Error(`${key} は [x, y] で指定してください`);
  return [v[0], v[1]];
}

/** 部品の左上からの表示上の画素。`cellKey`（マス）か `pxKey`（画素）か、古い形の x・y（マス）。 */
function pointOf(req: AutomationRequest, t: Target, cellKey: string, pxKey: string, xKey: string, yKey: string): [number, number] | null {
  if (req[pxKey] !== undefined) return pair(req[pxKey], pxKey);
  if (req[cellKey] !== undefined) {
    const [x, y] = pair(req[cellKey], cellKey);
    return [(t.origin?.x ?? 0) + x * t.cell.w + t.cell.w / 2, (t.origin?.y ?? 0) + y * t.cell.h + t.cell.h / 2];
  }
  if (typeof req[xKey] === "number" && typeof req[yKey] === "number") {
    return [(t.origin?.x ?? 0) + num(req, xKey) * t.cell.w + t.cell.w / 2, (t.origin?.y ?? 0) + num(req, yKey) * t.cell.h + t.cell.h / 2];
  }
  return null;
}

/** 入力イベントを送る道具。 */
class MouseSender {
  constructor(
    private readonly el: HTMLElement,
    private readonly ctrl: boolean,
    private readonly shift: boolean,
    private readonly alt = false,
  ) {}

  private init(x: number, y: number, button: number, buttons: number, detail = 1): PointerEventInit {
    const r = this.el.getBoundingClientRect();
    const clientX = r.left + x;
    const clientY = r.top + y;
    return {
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      button,
      buttons,
      detail,
      ctrlKey: this.ctrl,
      shiftKey: this.shift,
      altKey: this.alt,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    };
  }

  move(x: number, y: number, buttons: number): void {
    const i = this.init(x, y, -1, buttons);
    this.el.dispatchEvent(new PointerEvent("pointermove", i));
    this.el.dispatchEvent(new MouseEvent("mousemove", { ...i, button: 0 }));
  }

  down(x: number, y: number, button: number, detail = 1): void {
    const i = this.init(x, y, button, maskOf(button), detail);
    this.el.dispatchEvent(new PointerEvent("pointerdown", i));
    this.el.dispatchEvent(new MouseEvent("mousedown", i));
  }

  up(x: number, y: number, button: number, detail = 1): void {
    const i = this.init(x, y, button, 0, detail);
    this.el.dispatchEvent(new PointerEvent("pointerup", i));
    this.el.dispatchEvent(new MouseEvent("mouseup", i));
    if (button === 0) this.el.dispatchEvent(new MouseEvent("click", i));
    else if (button === 2) this.el.dispatchEvent(new MouseEvent("contextmenu", i));
  }

  dblclick(x: number, y: number): void {
    this.down(x, y, 0, 1);
    this.up(x, y, 0, 1);
    this.down(x, y, 0, 2);
    this.up(x, y, 0, 2);
    this.el.dispatchEvent(new MouseEvent("dblclick", this.init(x, y, 0, 0, 2)));
  }
}

function maskOf(button: number): number {
  return button === 2 ? 2 : button === 1 ? 4 : 1;
}

function buttonOf(req: AutomationRequest, fallback: number): number {
  const b = req["button"];
  if (b === undefined) return fallback;
  if (b === "left" || b === 0) return 0;
  if (b === "right" || b === 2) return 2;
  if (b === "middle" || b === 1) return 1;
  throw new Error(`button は left / right です: ${String(b)}`);
}

async function mouse(app: App, req: AutomationRequest): Promise<unknown> {
  const t = resolveTarget(app, req);
  const action = optStr(req, "action") ?? "click";
  const at = pointOf(req, t, "cell", "px", "x", "y");
  if (!at) throw new Error("位置を cell: [x, y] か px: [x, y] で指定してください");
  const m = new MouseSender(t.element, req["ctrl"] === true, req["shift"] === true, req["alt"] === true);
  const [x, y] = at;
  switch (action) {
    case "hover":
      m.move(x, y, 0);
      break;
    case "click":
      m.move(x, y, 0);
      m.down(x, y, buttonOf(req, 0));
      m.up(x, y, buttonOf(req, 0));
      break;
    case "rightClick":
      m.move(x, y, 0);
      m.down(x, y, 2);
      m.up(x, y, 2);
      break;
    case "dblclick":
      m.move(x, y, 0);
      m.dblclick(x, y);
      break;
    case "drag": {
      const to = pointOf(req, t, "to", "toPx", "toX", "toY");
      if (!to) throw new Error("drag の行き先を to: [x, y]（マス）か toPx: [x, y]（画素）で指定してください");
      const button = buttonOf(req, 0);
      const steps = typeof req["steps"] === "number" ? Math.max(1, int(req, "steps")) : 8;
      m.move(x, y, 0);
      m.down(x, y, button);
      for (let i = 1; i <= steps; i++) m.move(x + ((to[0] - x) * i) / steps, y + ((to[1] - y) * i) / steps, maskOf(button));
      m.up(to[0], to[1], button);
      break;
    }
    case "down":
      m.down(x, y, buttonOf(req, 0));
      break;
    case "move":
      m.move(x, y, req["button"] === undefined ? 0 : maskOf(buttonOf(req, 0)));
      break;
    case "up":
      m.up(x, y, buttonOf(req, 0));
      break;
    default:
      throw new Error(`action は click / dblclick / rightClick / drag / hover / down / move / up のどれかです: ${action}`);
  }
  await settle();
  return describeSelection(app);
}

/** 古い `pointer`（type: down / move / up、x・y は画素）。 */
function pointer(app: App, req: AutomationRequest): Promise<unknown> {
  return mouse(app, { ...req, action: str(req, "type"), px: [num(req, "x"), num(req, "y")], x: undefined, y: undefined });
}

/** 古い `event.mouse`（イベントタブのマップ。x・y・toX・toY はマス）。 */
function eventMouse(app: App, req: AutomationRequest): Promise<unknown> {
  const action = str(req, "action");
  const next: AutomationRequest = { ...req, target: "event", cell: [int(req, "x"), int(req, "y")], x: undefined, y: undefined };
  if (action === "drag") next["to"] = [int(req, "toX"), int(req, "toY")];
  return mouse(app, next);
}

export const mouseCommands: CommandTable = {
  mouse,
  pointer,
  "event.mouse": eventMouse,
};
