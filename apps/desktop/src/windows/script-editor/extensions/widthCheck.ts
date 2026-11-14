import type { EditorView } from "@codemirror/view";
import { parseWidthCheckOutput, parseWidthRegistryListing, planWidthRegistry, type ScriptCommandStep, type WidthCheckError } from "@zigzagumap/core";
import { jaScriptEditorAssist as t } from "../../../i18n/ja.scriptEditorAssist";
import { errorText } from "../../../util/errors";
import { ProcessRunner, type ProcessLine } from "../../../util/processRunner";
import type { ScriptProject } from "../ScriptProject";
import { clearExternalDiagnostics, relint, setExternalDiagnostics, type ExternalDiagnostic } from "./lint";

/** 外から足す波線の出どころの名前。 */
export const WIDTH_CHECK_SOURCE = "widthCheck";
/** 覚えておく出力の行の数（新しいほう）。 */
const LOG_LIMIT = 1000;

/** 幅検査が使うウィンドウの窓口。 */
export interface WidthCheckHost {
  readonly project: ScriptProject;
  /** 表示中のビュー。 */
  view(): EditorView;
  /** 表示中のタブのパス。 */
  activePath(): string | null;
  setMessage(text: string): void;
}

/** 最後の実行の結果（自動操作の `editor.widthCheck` で返す）。 */
export interface WidthCheckRun {
  readonly path: string;
  readonly exit: number | null;
  readonly errors: readonly WidthCheckError[];
  readonly registry: { readonly path: string; readonly added: readonly string[]; readonly unresolved: readonly string[]; readonly removed: readonly string[]; readonly notChecked: boolean } | null;
  readonly failed: string | null;
}

/**
 * 保存時の幅検査（#197）。`.string` を保存したとき、zigzagumap.json に幅検査のコマンド（`widthCheck`）があれば動かす。
 * Chronos は `python tools/check_text_width.py --source`（作業フォルダは 1 つ上）。ND は既定で無いので何もしない。
 *
 * 1. 追加の登録ファイル（`widthRegistry`。Chronos は `strings/text_width_registry.json`）があれば、先に登録の一覧
 *    （同じスクリプトに `--list-registry`）を取り、保存した `.string` の新しい `#org` を書き足す（登録のあるファイルだけ）。
 * 2. 検査を動かし、出力の `TEXT WIDTH ERROR: ファイル:行 ...` を拾って、その行に波線を出す（前の結果の波線は消す）。
 *    出力はウィンドウに覚えておく（ビルドのログの欄ができたらそこに出す）。
 * 動いている間にもう一度保存したら、終わってからもう 1 回だけ動かす。
 */
export class WidthCheck {
  /** 出力の行（新しいほう）。 */
  readonly log: string[] = [];
  last: WidthCheckRun | null = null;
  runs = 0;
  private running: Promise<void> | null = null;
  private again: { path: string; text: string } | null = null;

  constructor(private readonly host: WidthCheckHost) {}

  /** 動いているか。 */
  get busy(): boolean {
    return this.running !== null;
  }

  /** 動いていれば、終わるまで待つ。 */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  /** `.string` を保存したあとに呼ぶ（`text` は保存した本文）。設定に幅検査が無ければ何もしない。 */
  afterSave(path: string, text: string): void {
    const config = this.host.project.config;
    if (!config?.widthCheck || !/\.string$/i.test(path)) return;
    if (this.running) {
      this.again = { path, text };
      return;
    }
    this.running = this.run(path, text, config.widthCheck).finally(() => {
      this.running = null;
      const next = this.again;
      this.again = null;
      if (next) this.afterSave(next.path, next.text);
    });
  }

  private async run(path: string, text: string, step: ScriptCommandStep): Promise<void> {
    this.runs++;
    this.host.setMessage(t.widthCheck.running);
    const config = this.host.project.config!;
    let registry: WidthCheckRun["registry"] = null;
    try {
      const reg = config.widthRegistry;
      if (reg && step.args.length > 0) {
        const listing = parseWidthRegistryListing((await this.exec({ ...step, args: [step.args[0]!, "--list-registry"] })).stdout);
        const fs = this.host.project.fs;
        const registryText = (await fs.exists(reg.path)) ? await fs.readText(reg.path) : null;
        const plan = planWidthRegistry({
          registryText,
          listing,
          fileKey: reg.prefix + path,
          stringText: text,
          window: reg.window,
          unresolvedReason: (buffers) => t.widthCheck.unresolvedReason(buffers),
        });
        if (plan.text !== null) await fs.writeText(reg.path, plan.text);
        registry = { path: reg.path, added: plan.added, unresolved: plan.unresolved, removed: plan.removed, notChecked: plan.notChecked };
      }
      const { exit, lines } = await this.exec(step);
      const errors = parseWidthCheckOutput(lines);
      this.show(errors, reg?.prefix ?? "", path);
      this.last = { path, exit, errors, registry, failed: null };
      const notes: string[] = [exit === 0 && errors.length === 0 ? t.widthCheck.ok : t.widthCheck.errors(Math.max(errors.length, 1))];
      if (registry && registry.added.length > 0) notes.push(t.widthCheck.registered(registry.added.length, registry.path));
      if (registry && registry.removed.length > 0) notes.push(t.widthCheck.removed(registry.removed.length, registry.path));
      this.host.setMessage(notes.join("　"));
    } catch (e) {
      this.last = { path, exit: null, errors: [], registry, failed: errorText(e) };
      this.host.setMessage(t.widthCheck.failed(errorText(e)));
    }
  }

  /** コマンドを動かして、終わるまで待つ。 */
  private async exec(step: ScriptCommandStep): Promise<{ exit: number | null; lines: string[]; stdout: string }> {
    const runner = await ProcessRunner.get();
    const proc = await runner.spawn({ command: step.command, args: step.args, cwd: step.cwd }, (l: ProcessLine) => this.push(l.line));
    this.push(`> ${step.command} ${step.args.join(" ")}`);
    const done = await proc.done;
    const lines = proc.lines.map((l) => l.line);
    return { exit: done.code, lines, stdout: proc.lines.filter((l) => l.stream === "stdout").map((l) => l.line).join("\n") };
  }

  private push(line: string): void {
    this.log.push(line);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }

  /** 誤りを波線にする（`prefix` を外したパスのファイルの行に。パスや行の分からないものは保存したファイルの 1 行目）。 */
  private show(errors: readonly WidthCheckError[], prefix: string, saved: string): void {
    const touched = new Set(clearExternalDiagnostics(WIDTH_CHECK_SOURCE));
    const byPath = new Map<string, ExternalDiagnostic[]>();
    for (const e of errors) {
      const rel = e.path && e.path.startsWith(prefix) && /\.string$/i.test(e.path) ? e.path.slice(prefix.length) : null;
      const path = rel ?? saved;
      const list = byPath.get(path) ?? [];
      list.push({ line: rel && e.line ? e.line : 1, severity: "error", message: `TEXT WIDTH: ${e.message}` });
      byPath.set(path, list);
    }
    for (const [path, list] of byPath) {
      setExternalDiagnostics(path, WIDTH_CHECK_SOURCE, list);
      touched.add(path);
    }
    const active = this.host.activePath();
    if (active && touched.has(active)) relint(this.host.view());
  }
}
