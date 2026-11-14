import {
  buildScriptIndex,
  eventScriptLabel,
  isEventScriptEntryActive,
  isScriptSourcePath,
  loadEventScripts,
  loadScriptsJson,
  parseEventScriptDefines,
  reloadScriptIndexFile,
  resolveScriptsJson,
  type EventLabelStore,
  type EventScriptTarget,
  type ProjectFs,
  type ScriptIndex,
} from "@zigzagumap/core";
import type { App } from "../../app/App";
import { jaScriptEditor as t } from "../../i18n/ja.scriptEditor";
import { isEditableScriptPath, normalizeScriptPath } from "../../windows/script-editor/fileText";
import type { ScriptTarget } from "./ScriptEntry";

/** イベントのスクリプトの場所（解決の結果）。 */
export interface ScriptLocation {
  readonly path: string;
  /** 行（1 から）。 */
  readonly line: number;
  /** eventscripts で見つけたラベル（無ければ null）。 */
  readonly label: string | null;
  /** どこから求めたか（`label`: ラベルの定義、`scriptsJson`: マップの .s の先頭）。 */
  readonly from: "label" | "scriptsJson";
}

const TARGET_OF: Readonly<Record<ScriptTarget["kind"], EventScriptTarget>> = { person: "person", sign: "sign", trap: "tile", map: "map" };

/**
 * イベント（マップ・種別・番号）からスクリプトの `.s` と行を求める。eventscripts のラベル → ラベルの索引（ScriptIndex）で引き、
 * 見つからなければ maps\scripts.json のマップの `.s` の先頭。
 *
 * ラベルの索引（名前・ファイル・行だけ）は初めて使うときに作り、保存したファイルの分だけ読み直す。
 * `reset` で捨てると、次に使うときに作り直す（メインウィンドウが前面に戻ったとき・別のプロジェクトを開いたとき）。
 */
export class ScriptLocator {
  private index: Promise<ScriptIndex> | null = null;

  constructor(
    private readonly app: App,
    private readonly fs: ProjectFs,
  ) {}

  /** 索引を捨てる（次に使うときに作り直す）。 */
  reset(): void {
    this.index = null;
  }

  /** ラベルの索引（無ければ作る。作れなければ次に使うときにもう一度作る）。 */
  scriptIndex(): Promise<ScriptIndex> {
    const building = (this.index ??= buildScriptIndex(this.fs));
    building.catch(() => {
      if (this.index === building) this.index = null;
    });
    return building;
  }

  /** ディスクのファイルが変わった（作ってあれば、索引のそのファイルの分を読み直す）。 */
  async fileChanged(rawPath: string): Promise<void> {
    const path = normalizeScriptPath(rawPath);
    if (this.index && isScriptSourcePath(path)) await reloadScriptIndexFile(await this.index, this.fs, path);
  }

  /**
   * イベントのスクリプトの場所を求める。eventscripts の行（`#ifdef` で複数あれば、条件が成り立つもの）のラベルを
   * 索引で引き、見つからなければ scripts.json のマップの `.s` の 1 行目。どちらも無ければ null。
   */
  async resolve(target: ScriptTarget): Promise<ScriptLocation | null> {
    if (!this.app.state.session?.projectDir) throw new Error(t.noProject);
    const { bank, map } = target.map;
    // ZigzaguMap のラベル（scripts_MM.json か eventscripts の #ifdef の外の行。編集中の値）を先に使う
    let label = this.labelOf(target);
    if (label === null) {
      const scripts = await loadEventScripts(this.fs);
      const defines = new Map<string, string | true>();
      for (const include of scripts.includes()) {
        try {
          parseEventScriptDefines(await this.fs.readText(include), defines);
        } catch {
          // 読めない #include は飛ばす（insert.py もビルドの前に止まる）
        }
      }
      const entries = scripts.entriesFor(bank, map, TARGET_OF[target.kind], target.kind === "map" ? undefined : (target.index ?? 0));
      const entry = entries.find((e) => isEventScriptEntryActive(e, defines)) ?? entries[0];
      label = entry ? eventScriptLabel(entry.kind, entry.symbol, defines) : null;
    }
    if (label) {
      const found = (await this.scriptIndex()).findLabel(label);
      if (found && isEditableScriptPath(found.path)) return { path: found.path, line: found.line, label, from: "label" };
    }
    const json = await loadScriptsJson(this.fs);
    const resolved = json ? resolveScriptsJson(json, bank, map) : null;
    if (resolved && isEditableScriptPath(resolved.script)) return { path: normalizeScriptPath(resolved.script), line: 1, label, from: "scriptsJson" };
    return null;
  }

  /** 編集中のラベル（ZigzaguMap のラベルの持ち方で付いているもの）。無ければ null。 */
  labelOf(target: ScriptTarget): string | null {
    const store = this.app.state.session?.labels.store;
    if (!store) return null;
    const { bank, map } = target.map;
    if (target.kind === "map") return store.get(bank, map).mapScripts;
    return store.label(bank, map, TARGET_OF[target.kind] as "person" | "sign" | "tile", target.index ?? 0)?.label ?? null;
  }
}

/** そのラベルを使っているイベントとマップスクリプト（表の行き先も）の数。 */
export function labelUseCount(store: EventLabelStore, label: string): number {
  return store.usesOf(label).length + tableUses(store, label);
}

/** マップスクリプトの表の行き先にそのラベルがある数。 */
function tableUses(store: EventLabelStore, label: string): number {
  let n = 0;
  for (const { bank, map } of store.tableMaps()) {
    const table = store.get(bank, map).table;
    for (const i of table?.items ?? []) {
      if (i.script === label) n++;
      for (const c of i.conditions) if (c.script === label) n++;
    }
  }
  return n;
}
