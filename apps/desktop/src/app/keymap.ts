import { ja } from "../i18n/ja";
import { jaEventDelete } from "../i18n/ja.eventDelete";
import { jaEventMulti } from "../i18n/ja.eventMulti";
import { jaNeighbors } from "../i18n/ja.neighbors";
import { jaPaint } from "../i18n/ja.paint";
import { jaPen } from "../i18n/ja.pen";
import { jaTools } from "../i18n/ja.tools";
import { jaShortcutEdit } from "../i18n/ja.shortcutEdit";
import { jaBlockTools } from "../i18n/ja.blockTools";
import { jaUserScript } from "../i18n/ja.userScript";
import { jaPlayback } from "../i18n/ja.playback";

/**
 * ショートカットキーの表（Phase5 #392）。メニューのショートカットと、各所で受けている道具のキーをここにまとめる。
 * 既定のキーはこの表に書き、利用者が変えたものは個人設定 `shortcuts`（既定と違うものだけ）に残す。
 * メニューの定義（`menuDefinition.ts`）・`Shortcuts.ts`・各所のキーの処理・ヘルプのショートカット一覧は、どれもこの表から引く。
 * 変えられるのはメインのウィンドウと別ウィンドウ（ブロックエディタなど）のキー。スクリプトエディタは今のまま（Q16）。
 * Esc（ダイアログを閉じる）、メニューやマップ一覧の中の矢印、マウスと組み合わせる修飾キーは表に入れない。
 * DOM を使わないので vitest から読める。
 */

/** キー 1 つ（修飾キーとの組）。`key` は KeyboardEvent.key を大文字にしたもの（Space は "SPACE"）。 */
export interface KeyChord {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}

/** キーを受ける場所。重なりを調べるのに使う（場所が重ならなければ同じキーでもよい）。 */
export type KeyArea = "map" | "movement" | "event" | "otherTabs" | "toolWindows" | "blockEditor" | "playback";

const MAIN: readonly KeyArea[] = ["map", "movement", "event", "otherTabs"];
const ANYWHERE: readonly KeyArea[] = [...MAIN, "toolWindows", "blockEditor"];
/** ブロックエディタの窓のメニュー（`windows/block-editor/BlockEditorMenu.ts`）。 */
const BLOCK_EDITOR: readonly KeyArea[] = ["blockEditor"];

/** 表の 1 行（操作 1 つ）。 */
export interface KeyAction {
  /** 操作の ID（メニューの項目はアクションの ID と同じ）。 */
  readonly id: string;
  /** 既定のキー（2 つまで）。 */
  readonly defaults: readonly KeyChord[];
  /** キーを受ける場所。 */
  readonly areas: readonly KeyArea[];
  /** メニューの項目か（名前と場所はメニューから引く）。 */
  readonly menu?: true;
  /** メニューに無い操作の名前と場所（ショートカット一覧と同じ文言）。 */
  readonly label?: string;
  readonly where?: string;
}

/** キーを決められるスクリプトの操作の数（ツール > スクリプト の上から N 番目。Phase5 #405）。 */
export const SCRIPT_KEY_SLOTS = 9;

/** 1 つの操作に決められるキーの数。 */
export const MAX_KEYS = 2;

const c = (key: string): KeyChord => ({ key, ctrl: true });
const k = (key: string): KeyChord => ({ key });
const menu = (id: string, key: KeyChord, areas: readonly KeyArea[] = MAIN): KeyAction => ({ id, defaults: [key], areas, menu: true });

/** 表（メニューの順 → メニューに無い操作の順）。 */
export const KEY_ACTIONS: readonly KeyAction[] = [
  menu("file.open", c("O")),
  menu("file.reload", k("F5")),
  menu("file.export", c("S"), ANYWHERE),
  menu("view.grid", c("G")),
  menu("view.cursorFrame", k("C")),
  menu("view.playerView", k("V")),
  menu("view.history", c("E")),
  menu("view.paletteWidth", c("P")),
  menu("view.toolbar", c("T")),
  menu("opt.advancedHeader", c("H")),
  menu("tools.blockEditor", c("B")),
  menu("tools.connections", c("A")),
  menu("tools.worldMap", c("W")),
  menu("tools.build", k("F7")),
  menu("tools.previousMap", { key: "BACKSPACE", alt: true }),
  menu("view.forward", { key: "BACKSPACE", alt: true, shift: true }),
  menu("tools.openMap", c("M")),
  menu("map.find", c("F")),
  menu("tools.pointers", { key: "P", ctrl: true, shift: true }),
  menu("help.about", k("F1")),
  menu("help.eula", k("F2")),
  { id: "edit.undo", defaults: [c("Z")], areas: ANYWHERE, label: ja.shortcuts.undo, where: ja.shortcuts.anywhere },
  { id: "edit.redo", defaults: [c("Y"), { key: "Z", ctrl: true, shift: true }], areas: ANYWHERE, label: ja.shortcuts.redo, where: ja.shortcuts.anywhere },
  ...[
    ["playback.toggle", k("SPACE"), jaPlayback.toggle],
    ["playback.previous", k("ARROWLEFT"), jaPlayback.previous],
    ["playback.next", k("ARROWRIGHT"), jaPlayback.next],
    ["playback.previousFrame", { key: "ARROWLEFT", shift: true }, jaPlayback.previousFrame],
    ["playback.nextFrame", { key: "ARROWRIGHT", shift: true }, jaPlayback.nextFrame],
    ["playback.first", k("HOME"), jaPlayback.first],
    ["playback.last", k("END"), jaPlayback.last],
  ].map(([id, chord, label]) => ({ id, defaults: [chord], areas: ["playback"], label, where: jaPlayback.shortcutWhere }) as KeyAction),
  { id: "event.delete", defaults: [k("DELETE")], areas: ["event"], label: jaEventDelete.shortcut, where: jaEventDelete.shortcutWhere },
  { id: "event.duplicate", defaults: [c("D")], areas: ["event"], label: jaEventMulti.shortcutDuplicate, where: jaEventMulti.shortcutWhere },
  // イベントのコピー・切り取り・貼り付け（Phase7 #519）
  { id: "event.copy", defaults: [c("C")], areas: ["event"], label: jaEventMulti.shortcutCopy, where: jaEventMulti.shortcutWhere },
  { id: "event.cut", defaults: [c("X")], areas: ["event"], label: jaEventMulti.shortcutCut, where: jaEventMulti.shortcutWhere },
  { id: "event.paste", defaults: [c("V")], areas: ["event"], label: jaEventMulti.shortcutPaste, where: jaEventMulti.shortcutWhere },
  { id: "stamp.copy", defaults: [c("C")], areas: ["map"], label: jaPaint.shortcutCopy, where: jaPaint.shortcutWhere },
  { id: "stamp.paste", defaults: [c("V")], areas: ["map"], label: jaPaint.shortcutPaste, where: jaPaint.shortcutWhere },
  { id: "drag.cancel", defaults: [k("ESCAPE")], areas: ["map", "movement"], label: jaShortcutEdit.dragCancel, where: jaTools.shortcutToolWhere },
  { id: "dive.hold", defaults: [k("SPACE")], areas: ["map", "event"], label: jaNeighbors.shortcutDive, where: jaNeighbors.shortcutDiveWhere },
  { id: "pen.autoPen", defaults: [k("P")], areas: ["map"], label: jaPen.shortcutAutoPen, where: jaPen.shortcutAutoPenWhere },
  { id: "tool.pencil", defaults: [k("N")], areas: ["map", "movement"], label: jaTools.shortcutPencil, where: jaTools.shortcutToolWhere },
  { id: "tool.fill", defaults: [k("B")], areas: ["map", "movement"], label: jaTools.shortcutFill, where: jaTools.shortcutToolWhere },
  { id: "tool.shift", defaults: [k("S")], areas: ["map", "movement"], label: jaTools.shortcutShift, where: jaTools.shortcutToolWhere },
  // スクリプトが登録した操作（Phase5 #405。ツール > スクリプト の上から N 番目。既定のキーは無し）
  ...Array.from({ length: SCRIPT_KEY_SLOTS }, (_, i): KeyAction => ({
    id: `scripts.run.${i + 1}`,
    defaults: [],
    areas: MAIN,
    label: jaUserScript.keyLabel(i + 1),
    where: jaUserScript.keyWhere,
  })),
  // ブロックエディタの窓の 編集 メニュー（Phase5 #395。ID は `blockEditor.` ＋ メニューの項目の ID）
  ...(["copy", "cut", "paste", "swap"] as const).map(
    (name): KeyAction => ({
      id: `blockEditor.edit.${name}`,
      defaults: [name === "copy" ? c("C") : name === "cut" ? c("X") : name === "paste" ? c("V") : k("X")],
      areas: BLOCK_EDITOR,
      label: `${jaBlockTools.menuEdit} > ${jaBlockTools[name]}`,
      where: jaBlockTools.shortcutWindowWhere,
    }),
  ),
];

const BY_ID = new Map(KEY_ACTIONS.map((a) => [a.id, a]));

/** 表の操作か。 */
export function isKeyAction(id: string): boolean {
  return BY_ID.has(id);
}

/** 操作の行（無ければ Error）。 */
export function keyAction(id: string): KeyAction {
  const a = BY_ID.get(id);
  if (!a) throw new Error(`ショートカットの表にない操作です: ${id}`);
  return a;
}

// ---- キーの文字列 ----

/** 表示の名前が大文字の名前と違うキー。 */
const KEY_NAMES: Readonly<Record<string, string>> = {
  BACKSPACE: "BkSp",
  DELETE: "Delete",
  ESCAPE: "Esc",
  SPACE: "Space",
  ENTER: "Enter",
  TAB: "Tab",
  INSERT: "Insert",
  HOME: "Home",
  END: "End",
  PAGEUP: "PageUp",
  PAGEDOWN: "PageDown",
  ARROWUP: "↑",
  ARROWDOWN: "↓",
  ARROWLEFT: "←",
  ARROWRIGHT: "→",
};

/** 修飾キーだけのキー（これだけではショートカットにしない）。 */
const MODIFIERS = new Set(["CONTROL", "ALT", "SHIFT", "META", "ALTGRAPH", "CAPSLOCK", "NUMLOCK", "SCROLLLOCK", "PROCESS", "UNIDENTIFIED", "DEAD"]);

function modifiers(ch: KeyChord): string {
  return (ch.ctrl ? "Ctrl+" : "") + (ch.alt ? "Alt+" : "") + (ch.shift ? "Shift+" : "");
}

/** 画面に出す表記（「Ctrl+Shift+P」「Alt+BkSp」など）。 */
export function chordText(ch: KeyChord): string {
  return modifiers(ch) + (KEY_NAMES[ch.key] ?? ch.key);
}

/** 個人設定に残す表記（「Ctrl+Shift+P」「Alt+BACKSPACE」など）。 */
export function chordCode(ch: KeyChord): string {
  return modifiers(ch) + ch.key;
}

/** 個人設定の表記をキーにする（読めなければ null）。 */
export function parseChord(code: unknown): KeyChord | null {
  if (typeof code !== "string") return null;
  let rest = code;
  const ch: { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean } = { key: "" };
  for (;;) {
    if (rest.startsWith("Ctrl+") && rest.length > 5) (ch.ctrl = true), (rest = rest.slice(5));
    else if (rest.startsWith("Alt+") && rest.length > 4) (ch.alt = true), (rest = rest.slice(4));
    else if (rest.startsWith("Shift+") && rest.length > 6) (ch.shift = true), (rest = rest.slice(6));
    else break;
  }
  if (!rest || MODIFIERS.has(rest.toUpperCase())) return null;
  ch.key = rest.toUpperCase();
  return ch;
}

/** 同じキーか。 */
export function sameChord(a: KeyChord, b: KeyChord): boolean {
  return a.key === b.key && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift;
}

/** キーボードのイベント（の一部）。 */
export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** イベントのキーの名前（大文字。Space は "SPACE"）。 */
export function eventKeyName(e: Pick<KeyLike, "key">): string {
  return e.key === " " ? "SPACE" : e.key.toUpperCase();
}

/** 押されたキー（修飾キーだけなら null）。 */
export function chordOf(e: KeyLike): KeyChord | null {
  const key = eventKeyName(e);
  if (!key || MODIFIERS.has(key)) return null;
  return { key, ctrl: e.ctrlKey || undefined, alt: e.altKey || undefined, shift: e.shiftKey || undefined };
}

// ---- 表と個人設定 ----

/** 操作ごとのキー（全操作の分）。 */
export type Keymap = Readonly<Record<string, readonly KeyChord[]>>;

/** 既定のキー。 */
export function defaultKeymap(): Keymap {
  return Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.defaults]));
}

/** 個人設定 `shortcuts` から、全操作のキーを作る（表に無い操作・読めないキーは捨てる）。 */
export function resolveKeymap(overrides: unknown): Keymap {
  const o = typeof overrides === "object" && overrides !== null ? (overrides as Record<string, unknown>) : {};
  const out: Record<string, readonly KeyChord[]> = {};
  for (const a of KEY_ACTIONS) {
    const v = o[a.id];
    if (!Array.isArray(v)) {
      out[a.id] = a.defaults;
      continue;
    }
    const keys: KeyChord[] = [];
    for (const code of v) {
      const ch = parseChord(code);
      if (ch && !keys.some((x) => sameChord(x, ch)) && keys.length < MAX_KEYS) keys.push(ch);
    }
    out[a.id] = keys;
  }
  return out;
}

/** 個人設定に残す形（既定と違う操作だけ。キーを全部外した操作は空の配列）。 */
export function keymapOverrides(map: Keymap): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of KEY_ACTIONS) {
    const keys = map[a.id] ?? a.defaults;
    const same = keys.length === a.defaults.length && keys.every((ch, i) => sameChord(ch, a.defaults[i]!));
    if (!same) out[a.id] = keys.map(chordCode);
  }
  return out;
}

/** 2 つの操作のキーを受ける場所が重なるか。 */
export function areasOverlap(a: string, b: string): boolean {
  const x = keyAction(a).areas;
  return keyAction(b).areas.some((area) => x.includes(area));
}

/** `id` に `chord` を決めたとき、重なるほかの操作（無ければ null）。 */
export function conflictOf(map: Keymap, id: string, chord: KeyChord): string | null {
  for (const a of KEY_ACTIONS) {
    if (a.id === id || !areasOverlap(id, a.id)) continue;
    if ((map[a.id] ?? []).some((ch) => sameChord(ch, chord))) return a.id;
  }
  return null;
}

/** 表の中の重なりを全部（同じキーで、受ける場所が重なる操作の組）。 */
export function findConflicts(map: Keymap): { chord: string; ids: [string, string] }[] {
  const out: { chord: string; ids: [string, string] }[] = [];
  KEY_ACTIONS.forEach((a, i) => {
    for (const b of KEY_ACTIONS.slice(i + 1)) {
      if (!areasOverlap(a.id, b.id)) continue;
      for (const ch of map[a.id] ?? []) {
        if ((map[b.id] ?? []).some((x) => sameChord(x, ch))) out.push({ chord: chordText(ch), ids: [a.id, b.id] });
      }
    }
  });
  return out;
}

// ---- 今のキー（このウィンドウの分） ----

let current: Keymap = defaultKeymap();
const listeners = new Set<() => void>();

/** 個人設定 `shortcuts` を当てる（メインは起動時と変えたとき、別ウィンドウはメインからの知らせで呼ぶ）。 */
export function applyKeyOverrides(overrides: unknown): void {
  current = resolveKeymap(overrides);
  for (const l of listeners) l();
}

/** キーが変わったとき（表示の文字を作り直す用）。 */
export function onKeymapChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 今のキーの全部。 */
export function currentKeymap(): Keymap {
  return current;
}

/** 操作の今のキー。 */
export function keysOf(id: string): readonly KeyChord[] {
  return current[id] ?? [];
}

/** 操作の今のキーの表記（2 つなら「、」で区切る。無ければ空）。 */
export function keyText(id: string): string {
  return keysOf(id).map(chordText).join("、");
}

/** 押されたキーが操作のキーか（修飾キーも同じとき）。 */
export function matchesKey(id: string, e: KeyLike): boolean {
  const ch = chordOf(e);
  return !!ch && keysOf(id).some((x) => sameChord(x, ch));
}

/** 離したキーが操作のキーの本体か（押している間だけの操作で、修飾キーは見ない）。 */
export function releasesKey(id: string, e: Pick<KeyLike, "key">): boolean {
  const key = eventKeyName(e);
  return keysOf(id).some((x) => x.key === key);
}
