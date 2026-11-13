import { SetWildAreasCommand, toOffset, type MapId } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import type { ProjectSession } from "../../app/ProjectSession";
import { ja } from "../../i18n/ja";
import { createDialog } from "../Dialog";
import { messageBox } from "../MessageBox";
import { commit } from "../form/commit";
import { button, check, label, panel } from "../form/controls";
import { offsetText } from "../form/inputErrors";
import { shownWild } from "./WildTab";

/** ベース ROM の野生のエリア情報の位置（ROM 上に無ければ 0）。 */
function areaOffsets(session: ProjectSession, id: MapId): number[] {
  const project = session.project;
  if (!project.inBase(id) || project.hasJson(id)) return [0, 0, 0, 0];
  const entry = project.base.wildTable.find(id.bank, id.map);
  return [0, 1, 2, 3].map((i) => toOffset(entry?.header.areas[i] ?? 0) ?? 0);
}

/**
 * 「野生ポケモンの追加」ダイアログ（TCreateWildePokemonForm）。使うタイプにチェックを入れて OK。
 * 既にデータのあるタイプは最初からチェックが入る。オフセットはベース ROM 上のエリア情報の位置（無ければ $000000）。
 * 何もチェックせずに OK を押すと「…中止しました！」を出し、ダイアログは開いたまま。
 * OK で反映したら、最初にチェックしたタイプの番号を返す。キャンセルなら null。
 */
export function openWildAddDialog(state: EditorState, session: ProjectSession, id: MapId): Promise<number | null> {
  return new Promise((resolve) => {
    const w = ja.wild;
    const finish = (value: number | null): void => {
      frame.remove();
      resolve(value);
    };
    const frame = createDialog({ title: w.dialogTitle, width: 287, className: "wild-add-dialog", onClose: () => finish(null) });
    const body = panel("wild-add", 281, 201);
    const head = label(w.dialogHead, 8, 8);
    head.style.fontWeight = "bold";
    const doc = session.project.loaded(id);
    const areas = shownWild(doc?.wild ?? [])?.areas ?? [];
    const offsets = areaOffsets(session, id);
    const checks = w.areas.map((name, i) => {
      const c = check(`wildAdd.${i}`, name, 8, 56 + i * 24, 120);
      c.input.checked = (areas[i]?.slots.length ?? 0) > 0;
      return c;
    });
    const ok = async (): Promise<void> => {
      const selected = checks.map((c) => c.input.checked);
      if (!selected.some((v) => v)) {
        await messageBox(ja.information, w.canceled, "info");
        return;
      }
      if (commit(state, [new SetWildAreasCommand({ bank: id.bank, map: id.map, areas: selected })])) finish(selected.indexOf(true));
    };
    body.append(
      head,
      label(w.dialogType, 8, 32),
      label(w.dialogOffset, 152, 32),
      ...checks.map((c) => c.root),
      ...offsets.map((o, i) => label(offsetText(o), 152, 58 + i * 24)),
      button("wildAdd.cancel", w.cancel, 8, 160, 121, 33, () => finish(null)),
      button("wildAdd.ok", w.ok, 152, 160, 121, 33, () => void ok()),
    );
    frame.body.append(body);
    frame.box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") finish(null);
    });
    frame.register({
      title: w.dialogTitle,
      text: w.dialogHead,
      buttons: [w.cancel, w.ok],
      press: (b) => {
        if (b === w.ok) void ok();
        else if (b === w.cancel) finish(null);
        else throw new Error(`ボタンがありません: ${b}`);
      },
    });
  });
}
