import {
  ItemNameTable,
  SPECIES_COUNT,
  ScriptStringIndex,
  listProjectFiles,
  parseAsmNumber,
  summarizeAsmScript,
  summarizeRomScript,
  type ScriptSummary,
  type SummaryNames,
} from "@zigzagumap/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { App } from "../../app/App";
import { watchCommands } from "../form/commit";
import { disasmTools } from "../script/disasmTools";
import type { ScriptTarget } from "../script/ScriptEntry";
import { ScriptLocator } from "../script/ScriptLocator";

/** 要約の答え。 */
export type SummaryResult =
  | {
      readonly kind: "summary";
      readonly summary: ScriptSummary;
      readonly label: string | null;
      readonly from: "asm" | "rom";
      /** ラベルは付いているが .s に見つからず、ROM のスクリプトを出したとき、そのラベル。 */
      readonly missingLabel?: string;
    }
  | { readonly kind: "none" }
  | { readonly kind: "missingLabel"; readonly label: string };

/** 要約の覚えておく数。 */
const CACHE_SIZE = 64;

/**
 * イベントのスクリプトの要約（#226。ホバーの吹き出し）。ラベルが付いていれば `.s` をたどり、無ければ素の ROM のスクリプトを
 * 逆アセンブルしてたどる。ラベルの索引・文字列の索引（strings/ の .string）は初めて使うときに作り、ウィンドウが前面に戻ったとき・
 * 編集したとき・別のプロジェクトを開いたときに捨てる（次に使うときに作り直す）。答えは最近の 64 件を覚える。
 */
export class ScriptSummaries {
  private locator: ScriptLocator | null = null;
  private strings: Promise<ScriptStringIndex> | null = null;
  private items: ItemNameTable | null | undefined;
  private readonly cache = new Map<string, Promise<SummaryResult>>();

  constructor(private readonly app: App) {
    app.state.on("session", () => this.reset(true));
    // 編集（ラベルの付け替え・ひな形の書き足しなど）のあとは答えを作り直す。.s と .string はエディタで保存したときも
    // メインが前面に戻ったときに読み直す（ScriptHost の索引と同じ）。
    watchCommands(app.state, () => this.reset());
    void getCurrentWindow()
      .listen("tauri://focus", () => this.reset())
      .catch(() => undefined);
  }

  /** 索引と覚えた答えを捨てる（`all` なら名前の表も）。 */
  reset(all = false): void {
    this.locator?.reset();
    this.strings = null;
    this.cache.clear();
    if (all) {
      this.locator = null;
      this.items = undefined;
    }
  }

  private names(): SummaryNames {
    const session = this.app.state.session;
    if (!session) return {};
    if (this.items === undefined) {
      const p = session.project;
      try {
        this.items = ItemNameTable.read(p.rom, p.game.offsets.itemTablePointer, p.game.offsets.itemCount, p.textCodec);
      } catch {
        this.items = null;
      }
    }
    const items = this.items;
    return {
      item: (id) => items?.names[id] ?? null,
      // 素の FR の数（412）を超える番号は、CFRU で増やした種族で、ベース ROM の表では引けない（番号のまま出す）
      species: (id) => (id < SPECIES_COUNT ? (session.speciesNames?.name(id) ?? null) : null),
    };
  }

  private stringIndex(): Promise<ScriptStringIndex> {
    const fs = this.app.state.session?.files;
    if (!fs) return Promise.resolve(new ScriptStringIndex());
    const building = (this.strings ??= (async () => {
      const index = new ScriptStringIndex();
      for (const path of await listProjectFiles(fs, "strings", /\.string$/i)) {
        try {
          index.updateFile(path, await fs.readText(path));
        } catch {
          // 読めない .string は飛ばす（エディタの波線で分かる）
        }
      }
      return index;
    })());
    building.catch(() => {
      if (this.strings === building) this.strings = null;
    });
    return building;
  }

  /** イベントのスクリプトの要約。`pointer` は ROM のポインタ（無ければ 0）。 */
  summarize(target: ScriptTarget, pointer: number): Promise<SummaryResult> {
    const key = `${target.map.bank}.${target.map.map}.${target.kind}.${target.index ?? 0}.${pointer >>> 0}`;
    let found = this.cache.get(key);
    if (!found) {
      found = this.compute(target, pointer).catch((e: unknown) => {
        this.cache.delete(key);
        throw e;
      });
      this.cache.set(key, found);
      while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    }
    return found;
  }

  private async compute(target: ScriptTarget, pointer: number): Promise<SummaryResult> {
    const session = this.app.state.session;
    if (!session) return { kind: "none" };
    const names = this.names();
    if (session.projectDir) {
      const locator = (this.locator ??= new ScriptLocator(this.app, session.files));
      const label = locator.labelOf(target);
      const location = await locator.resolve(target).catch(() => null);
      const name = location?.label ?? label;
      if (location && location.from === "label" && name) {
        const [text, strings, index] = await Promise.all([session.files.readText(location.path), this.stringIndex(), locator.scriptIndex()]);
        const summary = summarizeAsmScript(
          text,
          name,
          {
            stringText: (l) => strings.find(l)[0]?.text ?? null,
            constant: (n) => {
              const equ = index.findEqu(n);
              return equ ? parseAsmNumber(equ.value) : null;
            },
          },
          names,
        );
        return { kind: "summary", summary, label: name, from: "asm" };
      }
      // ラベルは付いているが .s に見つからない（ROM のポインタがあればそちらを出す）
      if (name && !(pointer && session.project.rom.isPointer(pointer >>> 0))) return { kind: "missingLabel", label: name };
    }
    if (!pointer || !session.project.rom.isPointer(pointer >>> 0)) return { kind: "none" };
    const tools = await disasmTools(session);
    const missing = session.projectDir && this.locator ? this.locator.labelOf(target) : null;
    const summary = summarizeRomScript(session.project.rom, pointer, tools, names);
    return { kind: "summary", summary, label: null, from: "rom", ...(missing ? { missingLabel: missing } : {}) };
  }

  /** 道具の名前（隠しアイテムの吹き出し用）。 */
  itemName(id: number): string | null {
    return this.names().item?.(id) ?? null;
  }
}
