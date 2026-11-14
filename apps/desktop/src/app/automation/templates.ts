import { EVENT_TEMPLATES, templateDefaults, type EventTemplateId, type TemplateValues } from "@zigzagumap/core";
import type { App } from "../App";
import { int, settle, str, type AutomationRequest, type CommandTable } from "./registry";

/**
 * イベントのひな形（#243・#244）。`template.list`（種類・入力・既定値）、`template.place`（窓を出さずに置く）、
 * `template.picker`（「ここにひな形を置く」の窓を出す。答えを待たずに返す）。
 */

function kindOf(req: AutomationRequest): EventTemplateId {
  const v = str(req, "kind");
  if (!EVENT_TEMPLATES.some((t) => t.id === v)) throw new Error(`kind は ${EVENT_TEMPLATES.map((t) => t.id).join(" / ")} のどれかです`);
  return v as EventTemplateId;
}

async function selectMap(app: App, req: AutomationRequest): Promise<void> {
  if (typeof req["bank"] === "number" && typeof req["map"] === "number") {
    const cur = app.state.map?.id;
    if (!cur || cur.bank !== req["bank"] || cur.map !== req["map"]) await app.openMap({ bank: req["bank"], map: req["map"] });
  }
}

export const templateCommands: CommandTable = {
  "template.list": async (app: App) => {
    const auto = { flag: await app.usage.next("flag"), variable: await app.usage.next("var"), hiddenId: await app.usage.next("hiddenItem"), trainerId: await app.usage.next("trainer") };
    return EVENT_TEMPLATES.map((t) => ({
      id: t.id,
      kind: t.kind,
      needs: t.needs,
      texts: t.texts,
      labelKind: t.labelKind,
      nameKind: t.nameKind,
      defaults: templateDefaults(t.id, auto),
    }));
  },
  "template.place": async (app: App, req) => {
    await selectMap(app, req);
    const kind = kindOf(req);
    const given = (req["values"] ?? {}) as TemplateValues;
    const auto: { flag?: number | null; variable?: number | null; hiddenId?: number | null; trainerId?: number | null } = {};
    if (given.flag === undefined) auto.flag = await app.usage.next("flag");
    if (given.variable === undefined) auto.variable = await app.usage.next("var");
    if (given.hiddenId === undefined) auto.hiddenId = await app.usage.next("hiddenItem");
    const values: TemplateValues = { ...templateDefaults(kind, auto), ...given };
    const result = await (await app.templatePlacer()).place({ kind, x: int(req, "x"), y: int(req, "y"), values });
    const { command: _command, ...rest } = result;
    return { ...rest, values, status: app.state.status };
  },
  "template.picker": async (app: App, req) => {
    await selectMap(app, req);
    void app.placeTemplate(int(req, "x"), int(req, "y"));
    await settle(200);
    return { opened: true };
  },
};
