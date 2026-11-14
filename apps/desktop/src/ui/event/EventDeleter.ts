import {
  AddRomEraseRangesCommand,
  CommandGroup,
  EVENT_HEADER_SIZE,
  MAP_HEADER_SIZE,
  ROM_BASE,
  ROM_HEADER_SIZE,
  RemoveEventCommand,
  eventHeaderCodec,
  eventScriptLabel,
  formatRomEraseAddress,
  keepStringsInPlan,
  listProjectFiles,
  mapHeaderCodec,
  parseWidthRegistryListing,
  planRomErase,
  planScriptRemoval,
  projectOverwriteRegions,
  readTextIfExists,
  type Command,
  type MapDocument,
  type MapId,
  type RomEraseBlocked,
  type RomEraseSpan,
  type ScriptRemovalPlan,
} from "@zigzagumap/core";
import type { App } from "../../app/App";
import type { ProjectSession } from "../../app/ProjectSession";
import { ProcessRunner } from "../../util/processRunner";
import { disasmTools } from "../script/disasmTools";
import type { UiKind } from "./eventModel";

/** 消すイベントの種類（フライトポジションは消せない）。 */
export type DeletableKind = Exclude<UiKind, "fly">;

const LABEL_TARGET = { person: "person", sign: "sign", trap: "tile" } as const;
const ENTRY_SIZE = { person: 0x18, sign: 0x0c, warp: 0x08, trap: 0x10 } as const;
/** ラベルを探すほかのファイル（プロジェクトフォルダ直下。CFRU がシンボルの名前で読むもの）。 */
const OTHER_ROOT_FILES = ["repoints", "routinepointers", "hooks", "functionrewrites", "special_inserts.asm"];
/** プロジェクトが ROM に上書きする領域を書いたファイル。 */
const OVERWRITE_FILES = ["bytereplacement", "hooks", "repoints", "generatedrepoints", "routinepointers", "functionrewrites", "special_inserts.asm"];

/** 消す計画（確認のダイアログに出し、そのまま実行する）。 */
export interface EventDeletePlan {
  readonly map: MapId;
  readonly kind: DeletableKind;
  readonly index: number;
  /** イベントのラベル（無ければ null）。 */
  readonly label: string | null;
  /** ラベルの無いイベントのスクリプトのポインタ（無ければ null）。 */
  readonly pointer: number | null;
  /** プロジェクトフォルダを開いているか。 */
  readonly project: boolean;
  /** 隠しアイテムの看板か。 */
  readonly hiddenItem: boolean;
  /** `.s` と `.string` から除く計画（ラベルのイベントだけ）。 */
  readonly script: ScriptRemovalPlan | null;
  /** 幅検査の登録ファイルの書き換え（除いた `#org` の分）。 */
  readonly registry: { readonly path: string; readonly removed: readonly string[] } | null;
  /** ROM の埋める範囲（ラベルの無いイベントで、プロジェクトを開いているとき）。 */
  readonly rom: { readonly erase: readonly RomEraseSpan[]; readonly keep: readonly RomEraseBlocked[]; readonly problems: readonly string[] } | null;
  /** ROM の範囲を記録しなかった理由（ROM の外、プロジェクトが無い、rom_erase.json が読めない）。 */
  readonly romNote: "outside" | "noProject" | "broken" | null;
  /** 書き換えるファイル（`.s`・`.string`・幅検査の登録）。 */
  readonly files: readonly { readonly path: string; readonly before: string; readonly after: string }[];
}

/**
 * イベントの削除（#220）。右クリックの「イベントを削除」、Delete キー、「イベントの削除」ボタンは、どれもここを通る。
 *
 * - オブジェクト（イベントの項目）は `removeEvent` で消す（番号は詰まり、ラベルの対応も一緒に詰まる）。
 * - ラベルのイベント: そのスクリプトの記述を `.s` から、そのスクリプトだけが使う文字列を `.string` から除く（core の planScriptRemoval）。
 *   Chronos は幅検査の登録ファイル（text_width_registry.json）からも除く。REGISTRY（Python）に登録のある文字列は残す。
 * - 素の ROM のスクリプトのイベント: 埋める範囲を `maps\rom_erase.json` に記録する（core の planRomErase。ビルドで 0xFF にする）。
 * - オブジェクトの削除と範囲の記録は 1 つのコマンド、本文の書き換えはそのコマンドに結び付ける（1 回の元に戻すで全部戻る）。
 */
export class EventDeleter {
  constructor(private readonly app: App) {}

  /** 計画を作る（何も変えない）。 */
  async plan(map: MapId, kind: DeletableKind, index: number): Promise<EventDeletePlan> {
    const session = this.app.state.session;
    const doc = session?.project.loaded(map);
    if (!session || !doc?.events) throw new Error("マップが開かれていません");
    const project = !!session.projectDir;
    const { label, pointer, hiddenItem } = scriptOf(session, doc, map, kind, index);
    const base = { map, kind, index, label, pointer, project, hiddenItem };
    if (kind === "warp" || hiddenItem) return { ...base, script: null, registry: null, rom: null, romNote: null, files: [] };
    if (label && project) {
      const { script, registry, files } = await this.planScript(session, map, kind, index, label);
      return { ...base, script, registry, rom: null, romNote: null, files };
    }
    if (pointer === null) return { ...base, script: null, registry: null, rom: null, romNote: null, files: [] };
    const offset = (pointer >>> 0) - ROM_BASE;
    if (!session.project.rom.inRange(offset) || offset < ROM_HEADER_SIZE) return { ...base, script: null, registry: null, rom: null, romNote: "outside", files: [] };
    if (!project) return { ...base, script: null, registry: null, rom: null, romNote: "noProject", files: [] };
    if (session.romErase.loadError !== null) return { ...base, script: null, registry: null, rom: null, romNote: "broken", files: [] };
    const rom = await this.planRom(session, map, kind, index, offset);
    return { ...base, script: null, registry: null, rom, romNote: null, files: [] };
  }

  /** 実行する。成功したら書き換えたファイルのパスを返す。 */
  async run(plan: EventDeletePlan): Promise<string[]> {
    const commands: Command[] = [new RemoveEventCommand({ ...plan.map, kind: plan.kind, index: plan.index })];
    if (plan.rom && plan.rom.erase.length > 0) {
      const event = plan.kind === "warp" ? "person" : plan.kind;
      commands.push(
        new AddRomEraseRangesCommand({
          ranges: plan.rom.erase.map((s) => ({ address: s.offset + ROM_BASE, length: s.length, type: s.type, bank: plan.map.bank, map: plan.map.map, event, index: plan.index })),
        }),
      );
    }
    const command = CommandGroup.of(commands);
    if (!this.app.scripts.execute(command)) throw new Error(this.app.state.status.left);
    if (plan.files.length === 0) return [];
    const kept = await this.app.scripts.replaceTexts(plan.files);
    const done = plan.files.filter((f) => !kept.includes(f.path));
    this.app.scripts.attachReplacements(command, done);
    return done.map((f) => f.path);
  }

  // ---- ラベルのスクリプト ----

  private async planScript(session: ProjectSession, map: MapId, kind: DeletableKind, index: number, label: string) {
    const fs = session.files;
    const read = async (path: string) => ({ path, text: (await this.app.scripts.files.read(path))?.text ?? "" });
    const asm = await Promise.all((await listProjectFiles(fs, "assembly", /\.s$/i).catch(() => [] as string[])).map(read));
    const strings = await Promise.all((await listProjectFiles(fs, "strings", /\.string$/i).catch(() => [] as string[])).map(read));
    const others = [
      ...(await Promise.all((await listProjectFiles(fs, "src", /\.(c|h|s)$/i).catch(() => [] as string[])).map(read))),
      ...(await Promise.all(OTHER_ROOT_FILES.map(async (p) => ({ path: p, text: (await readTextIfExists(fs, p)) ?? "" })))),
    ];
    const input = { entry: label, asm, strings, external: externalLabels(session, map, kind, index, label), others };
    let script = planScriptRemoval(input);
    let registry: EventDeletePlan["registry"] = null;
    const extra: { path: string; before: string; after: string }[] = [];
    const config = (await this.app.scripts.scriptConfig())?.config;
    const reg = config?.widthRegistry;
    if (reg && script.removedStrings.length > 0) {
      const registryText = (await readTextIfExists(fs, reg.path)) ?? "";
      const json = registryText.trim() ? (JSON.parse(registryText) as { files?: Record<string, Record<string, unknown>> }) : { files: {} };
      // Python の REGISTRY に登録のある文字列は残す（消すと検査が「登録した名前がファイルに無い」で止まる）
      const listed = config.widthCheck ? await registeredNames(config.widthCheck) : null;
      const keep = new Map<string, string>();
      for (const s of script.removedStrings) {
        const key = reg.prefix + s.path;
        const inJson = !!json.files?.[key] && s.label in json.files[key]!;
        if (listed?.[key]?.includes(s.label) && !inJson) keep.set(s.label, "registry");
      }
      if (keep.size > 0) script = keepStringsInPlan(input, script, new Map([...keep.keys()].map((k) => [k, "registry"])));
      const removed: string[] = [];
      for (const s of script.removedStrings) {
        const key = reg.prefix + s.path;
        const entries = json.files?.[key];
        if (entries && s.label in entries) {
          delete entries[s.label];
          if (Object.keys(entries).length === 0) delete json.files![key];
          removed.push(s.label);
        }
      }
      if (removed.length > 0) {
        extra.push({ path: reg.path, before: registryText, after: `${JSON.stringify(json, null, 2)}\n` });
        registry = { path: reg.path, removed };
      }
    }
    return { script, registry, files: [...script.files, ...extra] };
  }

  // ---- 素の ROM のスクリプト ----

  private async planRom(session: ProjectSession, map: MapId, kind: DeletableKind, index: number, offset: number) {
    const fs = session.files;
    const tools = await disasmTools(session);
    const references: { address: number; where: string }[] = [];
    // 開いている・JSON のあるマップのイベントとマップスクリプト（このイベントは除く）
    const docs = new Map<string, { id: MapId; doc: MapDocument }>();
    for (const id of session.project.mapIds()) {
      const loaded = session.project.loaded(id);
      if (loaded) docs.set(`${id.bank}.${id.map}`, { id, doc: loaded });
      else if (session.project.hasJson(id)) {
        const d = await session.project.load(id).catch(() => null);
        if (d) docs.set(`${id.bank}.${id.map}`, { id, doc: d });
      }
    }
    for (const { id, doc: d } of docs.values()) {
      const where = (what: string) => `マップ ${id.bank}.${id.map} の${what}`;
      const same = id.bank === map.bank && id.map === map.map;
      d.events?.persons.forEach((p, i) => !(same && kind === "person" && i === index) && references.push({ address: p.script >>> 0, where: where(`人 ${i}`) }));
      d.events?.signs.forEach((s, i) => s.content.type === "script" && !(same && kind === "sign" && i === index) && references.push({ address: s.content.script >>> 0, where: where(`看板 ${i}`) }));
      d.events?.traps.forEach((t, i) => !(same && kind === "trap" && i === index) && references.push({ address: t.script >>> 0, where: where(`スクリプト ${i}`) }));
      for (const m of d.mapScripts ?? []) {
        references.push({ address: m.pointer >>> 0, where: where("マップスクリプト") });
        for (const e of m.table?.entries ?? []) references.push({ address: e.script >>> 0, where: where("マップスクリプトの条件表") });
      }
    }
    // マップスクリプトの表（scripts_MM.json）にアドレスで書いた行き先
    for (const t of session.labels.store.tableMaps()) {
      const table = session.labels.store.get(t.bank, t.map).table;
      for (const item of table?.items ?? []) {
        for (const s of [item.script, ...item.conditions.map((c) => c.script)]) {
          if (/^0x[0-9A-Fa-f]+$/.test(s)) references.push({ address: Number.parseInt(s.slice(2), 16), where: `maps/${t.bank}/scripts_${t.map}.json` });
        }
      }
    }
    // .s に直接書いたアドレス（goto 0x0816F58D など）
    for (const path of await listProjectFiles(fs, "assembly", /\.s$/i).catch(() => [] as string[])) {
      const text = (await this.app.scripts.files.read(path))?.text ?? "";
      for (const [n, line] of text.split(/\r\n|\n|\r/).entries()) {
        for (const m of line.replace(/@.*$/, "").matchAll(/\b0x0?([89][0-9A-Fa-f]{6})\b/g)) {
          references.push({ address: Number.parseInt(m[1]!, 16), where: `${path}:${n + 1}` });
        }
      }
    }
    const overwrite = await Promise.all(OVERWRITE_FILES.map(async (name) => ({ name, text: (await readTextIfExists(fs, name)) ?? "" })));
    const make = (await readTextIfExists(fs, "scripts/make.py")) ?? (await readTextIfExists(fs, "scripts/insert.py")) ?? "";
    const insert = /OFFSET_TO_PUT\s*=\s*(0x[0-9A-Fa-f]+)/.exec(make);
    const protect = projectOverwriteRegions(overwrite, insert ? Number.parseInt(insert[1]!.slice(2), 16) : 0x1000000);
    const plan = planRomErase(session.project.rom, offset, {
      ...tools,
      ignore: originalEventTable(session, map),
      references,
      protect,
      recorded: session.romErase.ranges,
    });
    return { erase: plan.erase, keep: plan.keep, problems: plan.problems };
  }
}

/** イベントのラベルとスクリプトのポインタ。 */
function scriptOf(session: ProjectSession, doc: MapDocument, map: MapId, kind: DeletableKind, index: number) {
  const events = doc.events!;
  const store = session.projectDir ? session.labels.store : null;
  let pointer: number | null = null;
  let hiddenItem = false;
  if (kind === "person") pointer = events.persons[index]?.script ?? null;
  else if (kind === "trap") pointer = events.traps[index]?.script ?? null;
  else if (kind === "sign") {
    const c = events.signs[index]?.content;
    if (c?.type === "script") pointer = c.script ?? null;
    else hiddenItem = true;
  }
  const label = kind === "warp" || hiddenItem || !store ? null : (store.label(map.bank, map.map, LABEL_TARGET[kind], index)?.label ?? null);
  return { label, pointer: label ? null : pointer, hiddenItem };
}

/** ほかから使われているラベル（消すイベントの分を除く）。 */
function externalLabels(session: ProjectSession, map: MapId, kind: DeletableKind, index: number, label: string): Set<string> {
  const store = session.labels.store;
  const out = store.usedLabels();
  const target = kind === "warp" ? "person" : LABEL_TARGET[kind];
  const others = store.usesOf(label).filter((u) => !(u.bank === map.bank && u.map === map.map && u.target === target && u.index === index));
  if (others.length === 0) out.delete(label);
  for (const t of store.tableMaps()) {
    const table = store.get(t.bank, t.map).table;
    for (const item of table?.items ?? []) for (const s of [item.script, ...item.conditions.map((c) => c.script)]) out.add(s);
  }
  // #ifdef の中の eventscripts の行（ZigzaguMap は変えないので、別の条件のビルドで使う）
  for (const e of store.eventScripts.entries()) if (e.conditions.length > 0) out.add(eventScriptLabel(e.kind, e.symbol));
  return out;
}

/** 消すイベントのマップの、ROM の元のイベント表（人・看板・スクリプト）の位置。そこにあるポインタは数えない。 */
function originalEventTable(session: ProjectSession, map: MapId): { from: number; to: number }[] {
  const p = session.project;
  if (!p.base.has(map)) return [];
  try {
    const rom = p.rom;
    const header = mapHeaderCodec.decode(rom.slice(p.base.bankTable.headerOffset(map), MAP_HEADER_SIZE));
    if (!rom.isPointer(header.events)) return [];
    const h = eventHeaderCodec.decode(rom.slice(header.events - ROM_BASE, EVENT_HEADER_SIZE));
    const out = [
      { from: h.persons - ROM_BASE, to: h.persons - ROM_BASE + h.personCount * ENTRY_SIZE.person },
      { from: h.signs - ROM_BASE, to: h.signs - ROM_BASE + h.signCount * ENTRY_SIZE.sign },
      { from: h.traps - ROM_BASE, to: h.traps - ROM_BASE + h.trapCount * ENTRY_SIZE.trap },
    ];
    return out.filter((r) => r.from >= 0 && r.to > r.from);
  } catch {
    return [];
  }
}

/** Chronos の幅検査の `--list-registry` で、登録のある名前を取る（動かせなければ null）。 */
async function registeredNames(step: { command: string; args: readonly string[]; cwd: string }): Promise<Readonly<Record<string, readonly string[]>> | null> {
  if (step.args.length === 0) return null;
  try {
    const runner = await ProcessRunner.get();
    const proc = await runner.spawn({ command: step.command, args: [step.args[0]!, "--list-registry"], cwd: step.cwd }, () => {});
    await proc.done;
    return parseWidthRegistryListing(proc.lines.filter((l) => l.stream === "stdout").map((l) => l.line).join("\n")).files;
  } catch {
    return null;
  }
}

/** ROM のアドレスの書き方（`0x0816A2B4`）。 */
export function romAddress(offset: number): string {
  return formatRomEraseAddress(offset + ROM_BASE);
}
