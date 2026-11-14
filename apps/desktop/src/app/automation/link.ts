import { EVENT_LABEL_TARGETS, RealignEventLabelsCommand, SetEventLabelCommand, readTable, type EventLabelTarget, type JsonValue } from "@zigzagumap/core";
import { MapScriptPanel } from "../../ui/script/MapScriptPanel";
import type { App } from "../App";
import type { ScriptTarget } from "../../ui/script/ScriptEntry";
import { int, type AutomationRequest, type CommandTable } from "./registry";

/**
 * イベントのラベル（#200・#202・#204。`script.labels` / `script.setLabel` / `script.realign` / `script.settle`）。
 * 編集はメインの CommandBus で実行するので、アンドゥ・出力は画面からの編集と同じ。
 */

function session(app: App): NonNullable<App["state"]["session"]> {
  const s = app.state.session;
  if (!s) throw new Error("ROM を開いていません");
  return s;
}

/** `bank`・`map`（省略で表示中のマップ）。 */
function mapOf(app: App, req: AutomationRequest): { bank: number; map: number } {
  if (req["bank"] !== undefined) return { bank: int(req, "bank"), map: int(req, "map") };
  const id = app.state.map?.id;
  if (!id) throw new Error("マップを開いていません（bank と map を指定してください）");
  return { bank: id.bank, map: id.map };
}

/** マップのラベルの一覧（`.s` にあるか、#ifdef の中の行、座標の食い違いも）。 */
export async function describeLabels(app: App, bank: number, map: number): Promise<unknown> {
  const s = session(app);
  const store = s.labels.store;
  const m = store.get(bank, map);
  const resolved = s.scriptsTable.document.resolve(bank, map);
  const candidates = resolved ? await app.scripts.files.labelsOf(resolved.script) : [];
  const list = (target: EventLabelTarget) =>
    m[target].flatMap((l, index) => (l ? [{ index, label: l.label, kind: l.kind, inScript: candidates.includes(l.label) }] : []));
  const positions = s.eventPositions(bank, map);
  return {
    bank,
    map,
    script: resolved?.script ?? null,
    strings: resolved?.strings ?? null,
    person: list("person"),
    sign: list("sign"),
    tile: list("tile"),
    mapScripts: m.mapScripts,
    table: m.table,
    candidates,
    hasFile: store.hasFile(bank, map),
    conditional: EVENT_LABEL_TARGETS.flatMap((t) => store.conditionalEntries(bank, map, t).map((e) => ({ target: t, index: e.index, symbol: e.symbol, line: e.line }))),
    mismatches: positions ? store.mismatches(bank, map, positions) : [],
    modified: store.modifiedMaps().some((x) => x.bank === bank && x.map === map),
  };
}

/** イベントと、そのスクリプトのポインタ（`pointer` を渡せばそれを使う）。 */
function romTarget(app: App, req: AutomationRequest): { pointer: number; target: ScriptTarget | null } {
  const kind = req["kind"] === undefined ? null : (String(req["kind"]) as ScriptTarget["kind"]);
  const { bank, map } = kind === null && req["bank"] === undefined ? { bank: -1, map: -1 } : mapOf(app, req);
  const index = typeof req["index"] === "number" ? req["index"] : 0;
  const target: ScriptTarget | null = kind === null ? null : { map: { bank, map }, kind, index };
  if (typeof req["pointer"] === "number") return { pointer: req["pointer"], target };
  if (!target) throw new Error("pointer か、bank・map・kind・index を指定してください");
  const doc = session(app).project.loaded({ bank, map });
  const events = doc?.events;
  if (!events) throw new Error(`マップ ${bank}.${map} を開いていません`);
  const pointer =
    kind === "person"
      ? events.persons[index]?.script
      : kind === "trap"
        ? events.traps[index]?.script
        : kind === "sign"
          ? (() => {
              const c = events.signs[index]?.content;
              return c?.type === "script" ? c.script : undefined;
            })()
          : doc.mapScripts?.[index]?.pointer;
  if (pointer === undefined) throw new Error("そのイベントのスクリプトがありません");
  return { pointer, target };
}

export const linkCommands: CommandTable = {
  "script.mapScripts": async (app, req) => {
    // マップスクリプトのパネル（#208。場所の設定タブのかんたん表示）。表示中のマップの表を変える
    const panel = MapScriptPanel.current;
    if (!panel) throw new Error("マップスクリプトのパネルがありません");
    const action = String(req["action"] ?? "get");
    let ok = true;
    if (action === "create") ok = panel.create();
    else if (action === "add") ok = await panel.addItem(int(req, "type"));
    else if (action === "addCondition") ok = await panel.addCondition(int(req, "index"));
    else if (action === "set") ok = panel.commit(readTable((req["table"] ?? null) as JsonValue));
    else if (action === "remove") ok = panel.commit(null);
    else if (action !== "get") throw new Error(`知らない action です: ${action}`);
    await app.scripts.settle();
    const id = app.state.map?.id;
    return { ok, table: panel.table, status: app.state.status, labels: id ? await describeLabels(app, id.bank, id.map) : null };
  },
  "script.rom": async (app, req) => {
    // ROM のスクリプトを読み取り専用で開く（#206）。返事はタブの名前と本文
    const { pointer, target } = romTarget(app, req);
    const request = await (await app.scriptHost()).openRom(pointer, target);
    return { opened: request !== null, tab: request?.key ?? null, text: request?.text ?? null, importable: request?.importable ?? false, items: request?.items ?? [], status: app.state.status };
  },
  "script.import": async (app, req) => {
    // ROM のスクリプトを .s に取り込む（#207）。`rename` は自動で付けた名前 → 新しい名前。返事は取り込みの計画
    const { pointer, target } = romTarget(app, req);
    if (!target) throw new Error("取り込むイベント（bank・map・kind・index）を指定してください");
    const rename = req["rename"] && typeof req["rename"] === "object" ? new Map(Object.entries(req["rename"] as Record<string, string>)) : new Map<string, string>();
    const plan = await (await app.scriptHost()).importRom(pointer, target, rename);
    await app.scripts.settle();
    return { ...plan, status: app.state.status };
  },
  "script.labels": async (app, req) => {
    const { bank, map } = mapOf(app, req);
    return describeLabels(app, bank, map);
  },
  "script.setLabel": async (app, req) => {
    const { bank, map } = mapOf(app, req);
    const target = String(req["target"] ?? "person") as EventLabelTarget | "map";
    const label = req["label"] === null || req["label"] === undefined ? null : String(req["label"]);
    const args: ConstructorParameters<typeof SetEventLabelCommand>[0] = { bank, map, target, label };
    if (typeof req["index"] === "number") args.index = req["index"];
    if (typeof req["kind"] === "string") args.kind = req["kind"] as "npc";
    session(app).bus.execute(new SetEventLabelCommand(args));
    return describeLabels(app, bank, map);
  },
  "script.realign": async (app, req) => {
    const { bank, map } = mapOf(app, req);
    session(app).bus.execute(new RealignEventLabelsCommand({ bank, map }));
    return describeLabels(app, bank, map);
  },
  "script.settle": async (app) => {
    // ひな形などの書き足しが済むまで待つ
    await app.scripts.settle();
    return { ok: true, status: app.state.status };
  },
};
