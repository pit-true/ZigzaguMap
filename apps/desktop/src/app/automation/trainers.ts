import type { App } from "../App";
import { int, type CommandTable } from "./registry";

/**
 * トレーナー（#244・#245）。`trainer.list`（ROM の表に trainers.json を重ねた一覧）、`trainer.get`（1 件の全部）、
 * `trainer.generate`（チームの自動生成。`seed` を決めると同じ結果）、`trainer.json`（trainers.json の中身と状態）。
 * trainers.json の編集は `command` の `setTrainer` / `removeTrainer`（元に戻せる）か、`template.place` の `values.newTrainer`。
 */
export const trainerCommands: CommandTable = {
  "trainer.list": async (app: App, req) => {
    const list = await app.trainers.list();
    const from = typeof req["from"] === "number" ? req["from"] : 0;
    const to = typeof req["to"] === "number" ? req["to"] : Infinity;
    return list.filter((t) => t.id >= from && t.id <= to);
  },
  "trainer.get": (app: App, req) => app.trainers.get(int(req, "id")),
  "trainer.generate": async (app: App, req) => {
    const map = typeof req["bank"] === "number" && typeof req["map"] === "number" ? { bank: req["bank"], map: req["map"] } : app.state.map?.id;
    if (!map) throw new Error("マップを開くか bank と map を指定してください");
    return app.trainers.generate(map, int(req, "seed"));
  },
  "trainer.json": (app: App) => {
    const t = app.state.session?.trainers;
    return t ? { trainers: t.trainers, modified: t.isModified(), loadError: t.loadError } : null;
  },
};
