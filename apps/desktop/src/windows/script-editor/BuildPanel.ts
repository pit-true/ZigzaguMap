import { SCRIPT_COPY_COMMAND, loadScriptConfig, parseBuildLog, type BuildProblem, type ScriptCommandStep } from "@zigzagumap/core";
import { TauriProjectFs } from "../../app/TauriProjectFs";
import { ja } from "../../i18n/ja";
import { jaBuild as t } from "../../i18n/ja.build";
import { messageBox } from "../../ui/MessageBox";
import { errorText } from "../../util/errors";
import { ProcessRunner, type ProcessExit, type RunningProcess } from "../../util/processRunner";
import { isEditableScriptPath } from "./fileText";

/** 読み足したログの行の手順の番号（プロジェクトフォルダで動いた出力として読む）。 */
const INCLUDED_STEP = 1000;
/** ビルドの外の出力（保存時の幅検査）の手順の番号。エラーの拾い出しには使わない。 */
const OUTSIDE_STEP = -2;

/** ログに残す行の数（古い行から捨てる）。 */
const MAX_LOG_LINES = 20_000;

/** ログの 1 行。 */
export interface BuildLogLine {
  readonly stream: "stdout" | "stderr" | "info";
  readonly line: string;
  /** 何番目の手順の出力か（0 から。ZigzaguMap のお知らせは -1、保存時の幅検査は -2）。 */
  readonly step: number;
}

/** ビルドの状態（自動操作の `build.state`）。 */
export interface BuildState {
  readonly running: boolean;
  /** 今の手順（0 から。動いていなければ null）。 */
  readonly step: number | null;
  readonly steps: readonly ScriptCommandStep[];
  /** 終わったとき（`ok` は全部の手順が終了コード 0 で終わった）。 */
  readonly result: { readonly ok: boolean; readonly code: number | null; readonly killed: boolean; readonly failedStep: number | null; readonly ms: number } | null;
  readonly problems: readonly BuildProblem[];
  readonly lines: number;
  readonly outputRom: string | null;
}

/** ビルドの前に確かめること（エディタのウィンドウが渡す）。 */
export interface BuildPanelHost {
  /** 未保存のタブを保存するか聞き、続けてよければ true。 */
  confirmSave(): Promise<boolean>;
  /** メインの未出力の変更の数。 */
  mainDirty(): Promise<number>;
  /** メインで出力する。 */
  exportMain(): Promise<boolean>;
  /** プロジェクトフォルダ（絶対パス）。 */
  projectDir(): string | null;
  /** エラーの行を開く。 */
  openFile(path: string, line: number): void;
}

/**
 * ビルドの欄（エディタのウィンドウの下。#198）。設定（zigzagumap.json）のビルドの手順を上から順に動かし、ログを逐次出す。
 * 終わったらログからエラーの行を拾って一覧にし、押すとその行を開く。止めるボタンで子プロセスごと止める。
 * ND の既定は CFRU のビルド → test.gba を DPE の BPRJ0.gba へ写す → DPE のビルド。
 */
export class BuildPanel {
  readonly element: HTMLElement;
  private readonly runButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly statusText: HTMLElement;
  private readonly logView: HTMLElement;
  private readonly problemList: HTMLElement;
  private log: BuildLogLine[] = [];
  private current: RunningProcess | null = null;
  private stopped = false;
  private state: BuildState = { running: false, step: null, steps: [], result: null, problems: [], lines: 0, outputRom: null };
  private pendingRender = false;

  constructor(private readonly host: BuildPanelHost) {
    this.element = document.createElement("div");
    this.element.className = "se-build";
    this.element.dataset["autoId"] = "build.panel";
    this.element.hidden = true;
    const bar = document.createElement("div");
    bar.className = "se-build-bar";
    this.runButton = button("build.run", t.run, () => void this.run());
    this.stopButton = button("build.stop", t.stop, () => void this.stop());
    this.stopButton.disabled = true;
    const clear = button("build.clear", t.clear, () => this.clear());
    const close = button("build.close", t.close, () => (this.element.hidden = true));
    this.statusText = document.createElement("span");
    this.statusText.className = "se-build-status";
    this.statusText.dataset["autoId"] = "build.status";
    bar.append(this.runButton, this.stopButton, clear, this.statusText, close);
    const body = document.createElement("div");
    body.className = "se-build-body";
    this.problemList = document.createElement("div");
    this.problemList.className = "se-build-problems";
    this.problemList.dataset["autoId"] = "build.problems";
    this.logView = document.createElement("pre");
    this.logView.className = "se-build-log";
    this.logView.dataset["autoId"] = "build.log";
    body.append(this.problemList, this.logView);
    this.element.append(bar, body);
  }

  /** 欄を見せる。 */
  show(): void {
    this.element.hidden = false;
  }

  /** 今の状態。 */
  get status(): BuildState {
    return { ...this.state, lines: this.log.length };
  }

  /** ログの行（`from` から）。 */
  lines(from = 0): BuildLogLine[] {
    return this.log.slice(from);
  }

  /** ビルドする（動いていれば何もしない）。全部の手順が成功したら true。 */
  async run(options: { skipConfirm?: boolean } = {}): Promise<boolean> {
    if (this.state.running) return false;
    this.show();
    if (!options.skipConfirm) {
      if (!(await this.host.confirmSave())) return false;
      const dirty = await this.host.mainDirty().catch(() => 0);
      if (dirty > 0) {
        const answer = await messageBox(ja.question, t.mainDirty(dirty), "warning", "yesNoCancel");
        if (answer === "cancel") return false;
        if (answer === "yes" && !(await this.host.exportMain())) return false;
      }
    }
    let steps: ScriptCommandStep[];
    let outputRom: string | null;
    try {
      const loaded = await loadScriptConfig(new TauriProjectFs());
      steps = loaded.config.build;
      outputRom = loaded.config.outputRom;
    } catch (e) {
      await messageBox(ja.errorTitle, t.configFailed(errorText(e)), "error");
      return false;
    }
    this.clear();
    this.stopped = false;
    const start = performance.now();
    this.state = { running: true, step: 0, steps, result: null, problems: [], lines: 0, outputRom };
    this.setRunning(true);
    let exit: ProcessExit = { code: 0, killed: false };
    let failed: number | null = null;
    const runner = await ProcessRunner.get();
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      this.state = { ...this.state, step: i };
      this.push({ stream: "info", line: t.stepStart(i + 1, steps.length, describe(step)), step: -1 });
      try {
        if (step.command === SCRIPT_COPY_COMMAND) {
          const [from, to] = step.args;
          if (!from || !to) throw new Error(t.copyArgs);
          const bytes = await ProcessRunner.copy(from, to, step.cwd);
          this.push({ stream: "info", line: t.copied(from, to, bytes), step: i });
          exit = { code: 0, killed: false };
        } else {
          this.current = await runner.spawn({ command: step.command, args: step.args, cwd: step.cwd }, (l) => this.push({ ...l, step: i }));
          exit = await this.current.done;
          this.current = null;
        }
      } catch (e) {
        this.current = null;
        this.push({ stream: "stderr", line: errorText(e), step: i });
        exit = { code: null, killed: false };
      }
      if (this.stopped || exit.killed || exit.code !== 0) {
        failed = i;
        if (!this.stopped) await this.includeLogs(i, step);
        break;
      }
    }
    const ms = Math.round(performance.now() - start);
    const problems = this.findProblems(steps);
    const ok = failed === null && !problems.some((p) => p.severity === "error");
    this.state = { ...this.state, running: false, step: null, problems, result: { ok, code: exit.code, killed: exit.killed || this.stopped, failedStep: failed, ms } };
    this.push({ stream: "info", line: ok ? t.succeeded(ms, outputRom) : t.failed(ms, failed === null ? null : failed + 1, exit.code), step: -1 });
    this.setRunning(false);
    this.renderProblems();
    document.dispatchEvent(new CustomEvent("build-problems", { detail: problems }));
    return ok;
  }

  /**
   * 失敗した手順が「(see ...log)」でログのファイルだけを出していれば（Chronos の build.py）、そのログを読んで欄に足す。
   * 足した行は、プロジェクトフォルダで動いた出力として読む（CFRU の段のログは cfru のフォルダからのパスで書かれる）。
   */
  private async includeLogs(i: number, step: ScriptCommandStep): Promise<void> {
    const paths = new Set<string>();
    for (const l of this.log) {
      if (l.step !== i) continue;
      const m = /\(see ([^()]+?\.log)\)/.exec(l.line);
      if (m) paths.add(m[1]!.trim());
    }
    for (const path of paths) {
      let text: string;
      try {
        text = await ProcessRunner.readText(path, step.cwd);
      } catch {
        continue;
      }
      this.push({ stream: "info", line: t.includedLog(path), step: -1 });
      for (const line of text.split(/\r?\n/)) if (line !== "") this.push({ stream: "stdout", line, step: INCLUDED_STEP });
    }
  }

  /**
   * ビルドの外の出力（保存時の幅検査）をログに足す。見出しの行のあとに `lines` を並べる。`show` なら欄を出す。
   * 次のビルドを始めると、ほかのログと一緒に消える。
   */
  appendOutside(title: string, lines: readonly string[], show: boolean): void {
    this.push({ stream: "info", line: title, step: OUTSIDE_STEP });
    for (const line of lines) this.push({ stream: "stdout", line, step: OUTSIDE_STEP });
    if (show) this.show();
  }

  /** 止める（子プロセスごと）。 */
  async stop(): Promise<void> {
    if (!this.state.running) return;
    this.stopped = true;
    await this.current?.kill();
  }

  private clear(): void {
    this.log = [];
    this.logView.textContent = "";
    this.problemList.replaceChildren();
    this.problemList.hidden = true;
  }

  private setRunning(running: boolean): void {
    this.runButton.disabled = running;
    this.stopButton.disabled = !running;
    const r = this.state.result;
    this.statusText.textContent = running
      ? t.running((this.state.step ?? 0) + 1, this.state.steps.length)
      : r
        ? r.ok
          ? t.okShort(r.ms)
          : t.ngShort(this.state.problems.filter((p) => p.severity === "error").length)
        : "";
  }

  private push(line: BuildLogLine): void {
    this.log.push(line);
    if (this.log.length > MAX_LOG_LINES) this.log.splice(0, this.log.length - MAX_LOG_LINES);
    if (this.state.running) this.statusText.textContent = t.running((this.state.step ?? 0) + 1, this.state.steps.length);
    if (this.pendingRender) return;
    this.pendingRender = true;
    requestAnimationFrame(() => {
      this.pendingRender = false;
      this.renderLog();
    });
  }

  private renderLog(): void {
    const atEnd = this.logView.scrollTop + this.logView.clientHeight >= this.logView.scrollHeight - 4;
    // 多いときは後ろの 2000 行だけを描く（全部はログの配列と build.log にある）
    const shown = this.log.slice(-2000);
    this.logView.textContent = shown.map((l) => (l.stream === "info" ? `▶ ${l.line}` : l.line)).join("\n");
    if (atEnd) this.logView.scrollTop = this.logView.scrollHeight;
  }

  private findProblems(steps: readonly ScriptCommandStep[]): BuildProblem[] {
    const dir = this.host.projectDir() ?? "";
    const projectName = dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
    const out: BuildProblem[] = [];
    steps.forEach((step, i) => {
      const lines = this.log.filter((l) => l.step === i).map((l) => l.line);
      out.push(...parseBuildLog(lines, { cwd: step.cwd, projectName }));
    });
    const included = this.log.filter((l) => l.step === INCLUDED_STEP).map((l) => l.line);
    out.push(...parseBuildLog(included, { cwd: ".", projectName }));
    return out;
  }

  private renderProblems(): void {
    const problems = this.state.problems;
    this.problemList.hidden = problems.length === 0;
    this.problemList.replaceChildren(
      ...problems.map((p, i) => {
        const el = document.createElement("div");
        el.className = `se-build-problem ${p.severity}`;
        el.dataset["autoId"] = `build.problem:${i}`;
        const where = p.path ? `${p.path}${p.line !== null ? `:${p.line}` : ""}` : t.noFile;
        el.textContent = `${p.severity === "error" ? "✕" : "!"} ${where}  ${p.message}`;
        const openable = p.path !== null && p.line !== null && isEditableScriptPath(p.path);
        el.classList.toggle("openable", openable);
        el.title = openable ? t.openProblem : p.message;
        if (openable) el.addEventListener("click", () => this.host.openFile(p.path!, p.line!));
        return el;
      }),
    );
  }
}

function describe(step: ScriptCommandStep): string {
  return `${[step.command, ...step.args].join(" ")}（${step.cwd}）`;
}

function button(id: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.dataset["autoId"] = id;
  b.addEventListener("click", onClick);
  return b;
}
