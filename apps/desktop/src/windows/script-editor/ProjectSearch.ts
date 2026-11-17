import { listProjectFiles, listScriptSourcePaths, searchProject, PROJECT_SEARCH_LIMIT, type ProjectSearchQuery, type ProjectSearchResult } from "@zigzagumap/core";
import type { TauriProjectFs } from "../../app/TauriProjectFs";
import { jaProjectSearch as t } from "../../i18n/ja.scriptEditor";
import { isEditableScriptPath, normalizeScriptText } from "./fileText";

/** 探す範囲。 */
export type ProjectSearchScope = "all" | "asm" | "string";

/** 窓の側（エディタのウィンドウが渡す）。 */
export interface ProjectSearchHost {
  readonly fs: TauriProjectFs;
  /** プロジェクトフォルダを開いているか。 */
  hasProject(): boolean;
  /** 開いているタブの今の本文（未保存の変更を含む。パス → 本文）。 */
  openTexts(): ReadonlyMap<string, string>;
  /** ファイルをタブで開いてその行（1 から）へ移り、範囲（行の中の桁）を選ぶ。 */
  open(path: string, line: number, range: readonly [number, number] | null): Promise<void>;
}

/** 自動操作に返す結果。 */
export interface ProjectSearchState extends ProjectSearchResult {
  readonly ms: number;
  readonly scanned: number;
}

/**
 * スクリプトエディタの全ファイル検索の欄（Phase7 #520。Ctrl+Shift+F）。ビルドの欄と同じ下の場所に出す（タブで切り替え）。
 * 探すたびにファイルをディスクから読み、開いているタブの未保存の本文はタブの本文で探す。ファイルを 1 つ読むごとに画面へ返すので、
 * 探している間も画面は止まらない。置換はしない。初めて開いたときに読み込む（エディタのウィンドウが動的 import する）。
 */
export class ProjectSearchPanel {
  readonly element = document.createElement("div");
  private readonly input = document.createElement("input");
  private readonly caseBox = document.createElement("input");
  private readonly regexpBox = document.createElement("input");
  private readonly wordBox = document.createElement("input");
  private readonly scope = document.createElement("select");
  private readonly statusText = document.createElement("span");
  private readonly results = document.createElement("div");
  private generation = 0;
  private last: ProjectSearchState | null = null;
  private running: Promise<ProjectSearchState | null> = Promise.resolve(null);

  constructor(private readonly host: ProjectSearchHost) {
    this.element.className = "se-search";
    this.element.dataset["autoId"] = "search.panel";
    this.element.hidden = true;
    const bar = document.createElement("div");
    bar.className = "se-build-bar se-search-bar";
    this.input.type = "text"; this.input.className = "se-search-input"; this.input.placeholder = t.placeholder; this.input.spellcheck = false;
    this.input.dataset["autoId"] = "search.input";
    this.input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); void this.run(); }
      else if (e.key === "Escape") { e.preventDefault(); this.hide(); }
    });
    this.input.addEventListener("input", () => this.input.classList.remove("invalid"));
    const option = (box: HTMLInputElement, id: string, label: string): HTMLLabelElement => {
      box.type = "checkbox"; box.dataset["autoId"] = `search.${id}`;
      box.addEventListener("change", () => { if (this.input.value) void this.run(); });
      const l = document.createElement("label"); l.className = "se-search-option"; l.append(box, label); return l;
    };
    for (const [value, label] of [["all", t.scopeAll], ["asm", t.scopeAsm], ["string", t.scopeString]] as const) this.scope.add(new Option(label, value));
    this.scope.dataset["autoId"] = "search.scope";
    this.scope.addEventListener("change", () => { if (this.input.value) void this.run(); });
    const runButton = button("search.run", t.run, () => void this.run());
    const close = button("search.close", t.close, () => this.hide());
    this.statusText.className = "se-build-status"; this.statusText.dataset["autoId"] = "search.status";
    bar.append(this.input, option(this.caseBox, "case", t.caseSensitive), option(this.regexpBox, "regexp", t.regexp), option(this.wordBox, "word", t.wholeWord), this.scope, runButton, this.statusText, close);
    this.results.className = "se-search-results"; this.results.dataset["autoId"] = "search.results";
    this.element.append(bar, this.results);
  }

  get visible(): boolean { return !this.element.hidden; }
  /** 欄を閉じたとき（下のタブを外す）。 */
  onHide: (() => void) | null = null;

  /** 欄を出して入力欄へ移る。text があれば入れる（選んでいる文字）。 */
  show(text?: string): void {
    this.element.hidden = false;
    if (text) this.input.value = text;
    this.input.focus(); this.input.select();
  }
  hide(): void { this.element.hidden = true; this.onHide?.(); }

  /** 条件を入れて探す（自動操作）。省いたものは欄の値。 */
  async search(query: Partial<ProjectSearchQuery> & { scope?: ProjectSearchScope } = {}): Promise<ProjectSearchState | null> {
    if (query.text !== undefined) this.input.value = query.text;
    if (query.caseSensitive !== undefined) this.caseBox.checked = query.caseSensitive;
    if (query.regexp !== undefined) this.regexpBox.checked = query.regexp;
    if (query.wholeWord !== undefined) this.wordBox.checked = query.wholeWord;
    if (query.scope !== undefined) this.scope.value = query.scope;
    return this.run();
  }

  /** 結果の行（自動操作）。押すと開く行の ID は `search.result.<n>`。 */
  get state(): ProjectSearchState | null { return this.last; }

  /** 探す（前の検索は捨てる）。 */
  run(): Promise<ProjectSearchState | null> {
    const token = ++this.generation;
    this.running = this.scan(token);
    return this.running;
  }

  private async scan(token: number): Promise<ProjectSearchState | null> {
    const query: ProjectSearchQuery = { text: this.input.value, caseSensitive: this.caseBox.checked, regexp: this.regexpBox.checked, wholeWord: this.wordBox.checked };
    if (!this.host.hasProject()) { this.statusText.textContent = t.noProject; return null; }
    if (query.text === "") { this.results.replaceChildren(); this.statusText.textContent = ""; this.last = null; return null; }
    const t0 = performance.now();
    this.statusText.textContent = t.searching;
    const scope = this.scope.value as ProjectSearchScope;
    const paths = await this.paths(scope);
    if (token !== this.generation) return null;
    const open = this.host.openTexts();
    const files: { path: string; text: string }[] = [];
    for (const path of paths) {
      // 開いているタブは未保存の本文で探す
      const text = open.get(path) ?? (await this.host.fs.readText(path).then(normalizeScriptText).catch(() => null));
      if (token !== this.generation) return null;
      if (text !== null) files.push({ path, text });
    }
    const result = searchProject(files, query);
    const state: ProjectSearchState = { ...result, ms: Math.round(performance.now() - t0), scanned: files.length };
    if (token !== this.generation) return null;
    this.last = state;
    this.render(state);
    return state;
  }

  private async paths(scope: ProjectSearchScope): Promise<string[]> {
    const fs = this.host.fs;
    const asm = scope === "string" ? [] : (await listScriptSourcePaths(fs).catch(() => [] as string[])).filter(isEditableScriptPath);
    const strings = scope === "asm" ? [] : await listProjectFiles(fs, "strings", /\.string$/i).catch(() => [] as string[]);
    // 開いているタブ（まだディスクに無い新しいファイルも）を足す
    const open = [...this.host.openTexts().keys()].filter(p => (scope !== "string" && /\.s$/i.test(p)) || (scope !== "asm" && /\.string$/i.test(p)));
    return [...new Set([...asm, ...strings, ...open])].sort();
  }

  private render(state: ProjectSearchState): void {
    this.input.classList.toggle("invalid", state.error !== null);
    if (state.error !== null) {
      this.statusText.textContent = t.badRegexp(state.error);
      this.results.replaceChildren();
      return;
    }
    this.statusText.textContent = state.count === 0 ? t.none : t.result(state.count, state.files.length, state.ms) + (state.truncated ? t.truncated(PROJECT_SEARCH_LIMIT) : "");
    const out: HTMLElement[] = [];
    let n = 0;
    for (const file of state.files) {
      const head = document.createElement("div");
      head.className = "se-search-file"; head.textContent = `${file.path}（${file.lines.length}）`;
      out.push(head);
      for (const line of file.lines) {
        const row = document.createElement("div");
        row.className = "se-search-line"; row.dataset["autoId"] = `search.result.${n++}`;
        const no = document.createElement("span"); no.className = "se-search-no"; no.textContent = String(line.line);
        const text = document.createElement("span"); text.className = "se-search-text";
        let at = 0;
        for (const [from, to] of line.ranges) {
          if (from > at) text.append(line.text.slice(at, from));
          const mark = document.createElement("mark"); mark.textContent = line.text.slice(from, to); text.append(mark);
          at = to;
        }
        text.append(line.text.slice(at));
        row.append(no, text);
        const range = line.ranges[0] ?? null;
        row.addEventListener("click", () => void this.host.open(file.path, line.line, range));
        out.push(row);
      }
    }
    this.results.replaceChildren(...out);
    this.results.scrollTop = 0;
  }
}

function button(id: string, text: string, run: () => void): HTMLButtonElement {
  const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.dataset["autoId"] = id; b.addEventListener("click", run); return b;
}
