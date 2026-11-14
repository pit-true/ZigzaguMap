import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/** 外部コマンドの指定（zigzagumap.json のビルドの手順など）。`cwd` はプロジェクトフォルダからの相対パス（`..` も可）か絶対パス。 */
export interface ProcessSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string | null;
}

/** 出力の 1 行。 */
export interface ProcessLine {
  readonly stream: "stdout" | "stderr";
  readonly line: string;
}

/** 終わったとき。 */
export interface ProcessExit {
  /** 終了コード（止めたときなど、無ければ null）。 */
  readonly code: number | null;
  /** 止めたか。 */
  readonly killed: boolean;
}

/** 動いているコマンド 1 つ。 */
export interface RunningProcess {
  readonly id: string;
  /** 作業フォルダ（絶対パス）。 */
  readonly cwd: string;
  /** 届いた行（古い順）。 */
  readonly lines: ProcessLine[];
  /** 終わったら決まる。 */
  readonly done: Promise<ProcessExit>;
  /** 止める。 */
  kill(): Promise<boolean>;
}

interface OutputEvent {
  readonly id: string;
  readonly stream: "stdout" | "stderr";
  readonly line: string;
}

interface ExitEvent {
  readonly id: string;
  readonly code: number | null;
  readonly killed: boolean;
}

interface Pending {
  readonly lines: ProcessLine[];
  readonly onLine: ((line: ProcessLine) => void) | undefined;
  resolve(exit: ProcessExit): void;
}

/**
 * 外部コマンドの実行（Rust の process.rs）。出力はこのウィンドウへイベントで 1 行ずつ届く。
 * ビルドのボタン（#198）・保存時の幅検査（#197）・自動操作の確認（`process.*`）で使う。ウィンドウごとに 1 つ作る。
 */
export class ProcessRunner {
  private static instance: Promise<ProcessRunner> | null = null;
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;

  private constructor() {}

  /** このウィンドウの ProcessRunner（初めて呼ばれたときにイベントの購読を始める）。 */
  static get(): Promise<ProcessRunner> {
    return (ProcessRunner.instance ??= (async () => {
      const runner = new ProcessRunner();
      const win = getCurrentWebviewWindow();
      await win.listen<OutputEvent>("process-output", (e) => runner.onOutput(e.payload));
      await win.listen<ExitEvent>("process-exit", (e) => runner.onExit(e.payload));
      return runner;
    })());
  }

  /** コマンドを起動する。`onLine` は行が届くたびに呼ぶ。 */
  async spawn(spec: ProcessSpec, onLine?: (line: ProcessLine) => void): Promise<RunningProcess> {
    const id = `${getCurrentWebviewWindow().label}-${this.nextId++}`;
    const lines: ProcessLine[] = [];
    let resolve!: (exit: ProcessExit) => void;
    const done = new Promise<ProcessExit>((r) => (resolve = r));
    // 起動の返事より先に出力が届くことがあるので、先に受け口を作る。
    this.pending.set(id, { lines, onLine, resolve });
    let cwd: string;
    try {
      cwd = await invoke<string>("process_spawn", { id, command: spec.command, args: [...spec.args], cwd: spec.cwd ?? null });
    } catch (e) {
      this.pending.delete(id);
      throw e instanceof Error ? e : new Error(String(e));
    }
    return { id, cwd, lines, done, kill: () => invoke<boolean>("process_kill", { id }) };
  }

  private onOutput(e: OutputEvent): void {
    const p = this.pending.get(e.id);
    if (!p) return;
    const line = { stream: e.stream, line: e.line };
    p.lines.push(line);
    p.onLine?.(line);
  }

  private onExit(e: ExitEvent): void {
    const p = this.pending.get(e.id);
    if (!p) return;
    this.pending.delete(e.id);
    p.resolve({ code: e.code, killed: e.killed });
  }
}
