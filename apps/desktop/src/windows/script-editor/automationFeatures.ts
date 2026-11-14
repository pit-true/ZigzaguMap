import { startCompletion } from "@codemirror/autocomplete";
import {
  copyLineDown,
  copyLineUp,
  moveLineDown,
  moveLineUp,
  redo,
  toggleComment,
  undo,
  addCursorAbove,
  addCursorBelow,
} from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  searchPanelOpen,
  selectMatches,
  selectNextOccurrence,
  selectSelectionMatches,
  setSearchQuery,
} from "@codemirror/search";
import { EditorSelection, type EditorState, type SelectionRange } from "@codemirror/state";
import type { Command } from "@codemirror/view";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { asmSemanticTokens, parseAsmLine } from "@zigzagumap/core";
import { settle, str } from "../../app/automation/registry";
import { completionAt } from "./extensions/completion";
import { definitionAt, goToDefinition } from "./extensions/definition";
import { BlockCommentTracker, SEMANTIC_CLASS } from "./extensions/highlight";
import { hoverAt, showPinnedHover } from "./extensions/hover";
import { currentDiagnostics, externalDiagnosticsOf, relint } from "./extensions/lint";
import { closePinnedTooltip } from "./extensions/pinned";
import { openStringEditor } from "./extensions/stringEdit";
import { EDITOR_THEMES, PALETTES, currentEditorTheme, isEditorTheme } from "./extensions/themes";
import { hoverPlainText } from "./hoverContent";
import type { ScriptEditorWindow } from "./ScriptEditorWindow";

/**
 * スクリプトエディタの機能（#191〜#197）の自動操作の命令。automation.ts の `COMMANDS` の後ろに足す（同じ名前は上書き。
 * `editor.select` は範囲・複数の範囲・矩形を受けるように広げる）。行と桁は 1 から。
 */

type Req = Record<string, unknown>;
type Handler = (w: ScriptEditorWindow, req: Req) => unknown;

function requireActive(w: ScriptEditorWindow): void {
  if (!w.active) throw new Error("開いているファイルがありません");
}

function lc(state: EditorState, pos: number): { line: number; column: number; offset: number } {
  const line = state.doc.lineAt(pos);
  return { line: line.number, column: pos - line.from + 1, offset: pos };
}

/** `line`・`column`（1 から）か `offset` を位置にする。無ければ null。`prefix` が `to` なら `toLine` など。 */
function pos(state: EditorState, req: Req, prefix: "" | "to" = ""): number | null {
  const key = (n: string) => (prefix ? prefix + n[0]!.toUpperCase() + n.slice(1) : n);
  const offset = req[key("offset")];
  if (typeof offset === "number") return Math.max(0, Math.min(state.doc.length, offset));
  const line = req[key("line")];
  if (typeof line !== "number") return null;
  const l = state.doc.line(Math.max(1, Math.min(state.doc.lines, line)));
  const column = typeof req[key("column")] === "number" ? (req[key("column")] as number) : 1;
  return Math.min(l.to, l.from + Math.max(0, column - 1));
}

function needPos(w: ScriptEditorWindow, req: Req): number {
  requireActive(w);
  const p = pos(w.view.state, req);
  if (p === null) throw new Error("line（と column）か offset を指定してください");
  return p;
}

function ctxOf(w: ScriptEditorWindow) {
  requireActive(w);
  return w.fileContext(w.active!);
}

function describeSelection(state: EditorState): unknown[] {
  return state.selection.ranges.map((r: SelectionRange) => ({ anchor: lc(state, r.anchor), head: lc(state, r.head), text: state.sliceDoc(r.from, r.to) }));
}

/** 字句の種類の名前（`editor.tokens` で返す）。 */
const SYNTAX = tagHighlighter([
  { tag: [tags.lineComment, tags.blockComment, tags.comment], class: "comment" },
  { tag: tags.labelName, class: "labelDef" },
  { tag: tags.keyword, class: "directive" },
  { tag: tags.number, class: "number" },
  { tag: tags.string, class: "string" },
  { tag: tags.macroName, class: "macroArg" },
  { tag: tags.escape, class: "escape" },
  { tag: tags.special(tags.variableName), class: "placeholder" },
  { tag: tags.atom, class: "special" },
  { tag: tags.processingInstruction, class: "rawBytes" },
  { tag: tags.meta, class: "meta" },
]);

/** 行ごとの字句の種類と、命令表で決めた種類。 */
function tokensOf(w: ScriptEditorWindow, from: number, to: number): unknown[] {
  const state = w.view.state;
  const doc = state.doc;
  const end = doc.line(to).to;
  const tree = ensureSyntaxTree(state, end, 2000) ?? syntaxTree(state);
  const tracker = new BlockCommentTracker();
  const ctx = ctxOf(w);
  const out: unknown[] = [];
  for (let n = from; n <= to; n++) {
    const line = doc.line(n);
    const syntax: { text: string; column: number; kind: string }[] = [];
    highlightTree(tree, SYNTAX, (a, b, cls) => syntax.push({ text: doc.sliceString(a, b), column: a - line.from + 1, kind: cls }), line.from, line.to);
    const semantic =
      ctx.kind === "asm"
        ? asmSemanticTokens(ctx.project.assist.analyzeParsed(parseAsmLine(line.text, tracker.before(doc, n)))).map((t) => ({
            text: line.text.slice(t.start, t.end),
            column: t.start + 1,
            kind: t.kind,
            class: SEMANTIC_CLASS[t.kind],
          }))
        : [];
    out.push({ line: n, text: line.text, syntax, semantic });
  }
  return out;
}

/** 表示中の印の、実際の色（テーマが種類ごとに違う色を付けているか）。 */
function renderedColors(w: ScriptEditorWindow): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const pick = (selector: string) => {
    const el = w.view.contentDOM.querySelector(selector);
    return el ? getComputedStyle(el).color : null;
  };
  for (const [kind, cls] of Object.entries(SEMANTIC_CLASS)) out[kind] = pick(`.${cls}`);
  // コメントとラベル定義の色（字句の色。見えている行から探す）
  const state = w.view.state;
  const colorAt = (p: number): string | null => {
    const { node } = w.view.domAtPos(p + 1);
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
    return el ? getComputedStyle(el).color : null;
  };
  out["comment"] = null;
  out["labelDef"] = null;
  for (const { from, to } of w.view.visibleRanges) {
    for (let p = from; p <= to && (out["comment"] === null || out["labelDef"] === null); ) {
      const line = state.doc.lineAt(p);
      const at = line.text.indexOf("@");
      if (out["comment"] === null && at >= 0 && !line.text.slice(0, at).includes('"')) out["comment"] = colorAt(line.from + at);
      if (out["labelDef"] === null && /^[A-Za-z_]\w*:/.test(line.text)) out["labelDef"] = colorAt(line.from);
      p = line.to + 1;
    }
  }
  out["background"] = getComputedStyle(w.view.dom).backgroundColor;
  return out;
}

/** 1 字ずつ打ったときの、画面の更新までの時間（ms）。打った字は最後に消す（履歴にも残さない）。 */
async function measureTyping(w: ScriptEditorWindow, at: number, count: number): Promise<{ count: number; averageMs: number; maxMs: number; lines: number }> {
  const view = w.view;
  const before = view.state;
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = Math.min(at + i, view.state.doc.length);
    const t0 = performance.now();
    view.dispatch({ changes: { from: p, insert: "a" }, selection: { anchor: p + 1 }, userEvent: "input.type" });
    // 画面の測りと描き直しを済ませる（次のフレームまで待つ）
    view.dom.getBoundingClientRect();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    times.push(performance.now() - t0);
  }
  view.setState(before);
  w.active!.state = before;
  w.project.updateBuffer(w.active!.path, before.doc);
  const sum = times.reduce((a, b) => a + b, 0);
  return { count, averageMs: Math.round((sum / Math.max(1, count)) * 10) / 10, maxMs: Math.round(Math.max(...times) * 10) / 10, lines: before.doc.lines };
}

function heapMb(): number | null {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round((m.usedJSHeapSize / 1048576) * 10) / 10 : null;
}

const COMMAND_BY_NAME: Readonly<Record<string, Command>> = {
  moveLineUp,
  moveLineDown,
  copyLineUp,
  copyLineDown,
  toggleComment,
  selectNextOccurrence,
  selectSelectionMatches,
  addCursorAbove,
  addCursorBelow,
  undo,
  redo,
  startCompletion,
};

export const FEATURE_COMMANDS: Readonly<Record<string, Handler>> = {
  "editor.project": async (w, req) => {
    if (req["wait"] !== false) await w.project.load();
    const a = w.project.assist;
    return {
      loaded: w.project.loaded,
      loadMs: w.project.loadMs,
      problems: w.project.problems,
      dialect: w.project.config?.dialect ?? null,
      commands: a.commands?.commands.length ?? 0,
      labels: a.index.labelNames().length,
      equs: a.index.equNames().length,
      strings: a.strings.labels().length,
      stringFiles: a.strings.paths().length,
      /** このウィンドウの JavaScript のヒープ（MB。Chromium の performance.memory。GC の前の値）。 */
      heapMb: heapMb(),
    };
  },

  "editor.tokens": (w, req) => {
    requireActive(w);
    const doc = w.view.state.doc;
    const from = Math.max(1, typeof req["line"] === "number" ? req["line"] : typeof req["fromLine"] === "number" ? req["fromLine"] : 1);
    const to = Math.min(doc.lines, typeof req["toLine"] === "number" ? req["toLine"] : typeof req["line"] === "number" ? from : doc.lines);
    return { path: w.active!.path, lines: tokensOf(w, from, to) };
  },

  "editor.theme": async (w, req) => {
    if (req["theme"] !== undefined) {
      if (!isEditorTheme(req["theme"])) throw new Error(`テーマは ${EDITOR_THEMES.join(" / ")} のどれかです`);
      w.setTheme(req["theme"]);
      await settle(150);
    }
    const id = currentEditorTheme();
    return { theme: id, themes: EDITOR_THEMES, palette: PALETTES[id], rendered: w.active ? renderedColors(w) : null };
  },

  "editor.hover": async (w, req) => {
    const p = needPos(w, req);
    const ctx = ctxOf(w);
    const info = req["show"] === true ? showPinnedHover(w.view, ctx, p) : hoverAt(ctx, w.view.state, p);
    if (req["show"] === true) await settle(200);
    if (!info) return null;
    return {
      type: info.hover.type,
      from: lc(w.view.state, info.from),
      to: lc(w.view.state, info.to),
      text: w.view.state.sliceDoc(info.from, info.to),
      markdown: info.markdown,
      plain: hoverPlainText(info.markdown),
      shown: req["show"] === true ? document.querySelector('[data-auto-id="se.hover"]') !== null : false,
    };
  },

  "editor.closeHover": (w) => ({ closed: w.active ? closePinnedTooltip(w.view) : false }),

  "editor.complete": async (w, req) => {
    const p = needPos(w, req);
    const ctx = ctxOf(w);
    const c = completionAt(ctx, w.view.state, p);
    if (req["show"] === true) {
      w.view.dispatch({ selection: EditorSelection.cursor(p) });
      w.view.focus();
      startCompletion(w.view);
      await settle(400);
    }
    if (!c) return null;
    const word = w.view.state.sliceDoc(c.lineFrom + c.from, p);
    const filter = typeof req["filter"] === "string" ? req["filter"] : word;
    const items = c.items.filter((i) => i.label.toLowerCase().startsWith(filter.toLowerCase()));
    const limit = typeof req["limit"] === "number" ? req["limit"] : 50;
    return {
      context: c.context,
      argIndex: c.argIndex,
      kind: c.kind,
      from: lc(w.view.state, c.lineFrom + c.from),
      to: lc(w.view.state, c.lineFrom + c.to),
      word,
      total: c.items.length,
      count: items.length,
      items: items.slice(0, limit).map((i) => ({ label: i.label, type: i.type, detail: i.detail ?? null })),
      shown: req["show"] === true ? document.querySelector(".cm-tooltip-autocomplete") !== null : false,
    };
  },

  "editor.definition": async (w, req) => {
    const p = needPos(w, req);
    const ctx = ctxOf(w);
    const d = definitionAt(ctx, w.view.state, p);
    let moved = false;
    if (req["go"] === true) moved = await goToDefinition(ctx, w.view, p);
    await settle(100);
    return {
      definition: d ? { kind: d.kind, name: d.name, targets: d.targets } : null,
      moved,
      active: w.active?.path ?? null,
      cursor: w.active ? lc(w.view.state, w.view.state.selection.main.head) : null,
      back: w.backDepth,
      message: document.querySelector('[data-auto-id="se.message"]')?.textContent ?? "",
    };
  },

  "editor.back": async (w) => {
    const ok = await w.back();
    return { moved: ok, active: w.active?.path ?? null, cursor: w.active ? lc(w.view.state, w.view.state.selection.main.head) : null, back: w.backDepth };
  },

  "editor.search": async (w, req) => {
    requireActive(w);
    const view = w.view;
    const action = typeof req["action"] === "string" ? req["action"] : "find";
    if (action === "close") {
      closeSearchPanel(view);
      return { open: searchPanelOpen(view.state) };
    }
    if (!searchPanelOpen(view.state)) openSearchPanel(view);
    const old = getSearchQuery(view.state);
    const query = new SearchQuery({
      search: typeof req["query"] === "string" ? req["query"] : old.search,
      replace: typeof req["replace"] === "string" ? req["replace"] : old.replace,
      regexp: typeof req["regexp"] === "boolean" ? req["regexp"] : old.regexp,
      caseSensitive: typeof req["caseSensitive"] === "boolean" ? req["caseSensitive"] : old.caseSensitive,
      wholeWord: typeof req["wholeWord"] === "boolean" ? req["wholeWord"] : old.wholeWord,
    });
    view.dispatch({ effects: setSearchQuery.of(query) });
    const run: Record<string, Command> = { next: findNext, previous: findPrevious, replace: replaceNext, replaceAll, selectAll: selectMatches };
    if (action !== "find" && action !== "open") {
      const cmd = run[action];
      if (!cmd) throw new Error(`知らない action です: ${action}`);
      cmd(view);
    }
    await settle(100);
    const matches: unknown[] = [];
    if (query.valid) {
      const cursor = query.getCursor(view.state);
      for (let m = cursor.next(); !m.done && matches.length < 500; m = cursor.next()) {
        matches.push({ ...lc(view.state, m.value.from), text: view.state.sliceDoc(m.value.from, m.value.to) });
      }
    }
    return { open: searchPanelOpen(view.state), valid: query.valid, count: matches.length, matches, selection: describeSelection(view.state), dirty: w.active!.dirty };
  },

  "editor.select": (w, req) => {
    // 範囲 1 つ（line/column〜toLine/toColumn）、複数の範囲（ranges）、矩形（rect: { line, column, toLine, toColumn }）
    requireActive(w);
    const state = w.view.state;
    let ranges: SelectionRange[] = [];
    if (Array.isArray(req["ranges"])) {
      for (const r of req["ranges"] as Req[]) {
        const a = pos(state, r);
        if (a === null) throw new Error("ranges の要素には line（と column）か offset が要ります");
        ranges.push(EditorSelection.range(a, pos(state, r, "to") ?? a));
      }
    } else if (typeof req["rect"] === "object" && req["rect"] !== null) {
      const r = req["rect"] as Req;
      const l1 = Number(r["line"]);
      const l2 = Number(r["toLine"]);
      const c1 = Number(r["column"] ?? 1);
      const c2 = Number(r["toColumn"] ?? c1);
      for (let n = Math.min(l1, l2); n <= Math.max(l1, l2); n++) {
        const line = state.doc.line(Math.max(1, Math.min(state.doc.lines, n)));
        const a = Math.min(line.to, line.from + Math.min(c1, c2) - 1);
        const b = Math.min(line.to, line.from + Math.max(c1, c2) - 1);
        ranges.push(EditorSelection.range(a, b));
      }
    } else {
      const a = pos(state, req);
      if (a === null) throw new Error("line（と column）か offset、ranges、rect のどれかを指定してください");
      ranges = [EditorSelection.range(a, pos(state, req, "to") ?? a)];
      if (req["add"] === true) ranges = [...state.selection.ranges, ...ranges];
    }
    w.view.dispatch({ selection: EditorSelection.create(ranges, ranges.length - 1), scrollIntoView: true });
    w.view.focus();
    return { selection: describeSelection(w.view.state) };
  },

  "editor.command": async (w, req) => {
    requireActive(w);
    const name = str(req, "name");
    const cmd = COMMAND_BY_NAME[name];
    if (!cmd) throw new Error(`知らない name です: ${name}（${Object.keys(COMMAND_BY_NAME).join(", ")}）`);
    w.view.focus();
    const done = cmd(w.view);
    await settle(100);
    return { done, text: w.view.state.doc.toString(), selection: describeSelection(w.view.state) };
  },

  "editor.mouse": async (w, req) => {
    // 本文の位置でマウスを押す（Ctrl+クリックの定義へ移動・カーソルを足す、Alt+ドラッグの矩形選択）。toLine があればドラッグ
    const p = needPos(w, req);
    const view = w.view;
    view.dispatch({ effects: [] });
    const at = (q: number) => {
      const c = view.coordsAtPos(q);
      if (!c) throw new Error("その位置は画面に出ていません");
      return { x: c.left + 1, y: (c.top + c.bottom) / 2 };
    };
    const start = at(p);
    const mods = { ctrlKey: req["ctrl"] === true, altKey: req["alt"] === true, shiftKey: req["shift"] === true };
    const init = (x: number, y: number, buttons: number) => ({ clientX: x, clientY: y, button: 0, buttons, bubbles: true, cancelable: true, view: window, detail: 1, ...mods });
    view.contentDOM.dispatchEvent(new MouseEvent("mousedown", init(start.x, start.y, 1)));
    const to = pos(view.state, req, "to");
    if (to !== null) {
      const end = at(to);
      for (let i = 1; i <= 4; i++) {
        const x = start.x + ((end.x - start.x) * i) / 4;
        const y = start.y + ((end.y - start.y) * i) / 4;
        document.dispatchEvent(new MouseEvent("mousemove", init(x, y, 1)));
        await settle(30);
      }
    }
    const last = to !== null ? at(to) : start;
    document.dispatchEvent(new MouseEvent("mouseup", init(last.x, last.y, 0)));
    await settle(250);
    return { active: w.active?.path ?? null, selection: w.active ? describeSelection(w.view.state) : [], back: w.backDepth };
  },

  "editor.perf": async (w, req) => {
    // 打鍵から描画までの時間（line・column の位置に count 字打って測る。打った字は消す）
    const p = needPos(w, req);
    return measureTyping(w, p, typeof req["count"] === "number" ? req["count"] : 30);
  },

  "editor.diagnostics": async (w) => {
    requireActive(w);
    await w.project.load();
    w.project.flushBuffers();
    relint(w.view);
    await settle(200);
    return { path: w.active!.path, diagnostics: currentDiagnostics(w.view.state), external: externalDiagnosticsOf(w.active!.path) };
  },

  "editor.stringEdit": async (w, req) => {
    await w.project.load();
    if (req["open"] === true) {
      const p = needPos(w, req);
      openStringEditor(w.view, ctxOf(w), str(req, "label"), p);
      await settle(200);
      return { shown: document.querySelector('[data-auto-id="se.stringEdit"]') !== null };
    }
    const path = await w.editStringBody(str(req, "label"), str(req, "text"));
    const tab = path ? w.tabs.find((x) => x.path === path) : null;
    return { path, dirty: tab?.dirty ?? false, active: w.active?.path ?? null, tabs: w.tabs.map((x) => ({ path: x.path, dirty: x.dirty })) };
  },
};
