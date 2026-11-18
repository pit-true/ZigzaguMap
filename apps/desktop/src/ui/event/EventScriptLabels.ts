import { RealignEventLabelsCommand, SetEventLabelCommand } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import type { ScriptFiles } from "../script/ScriptFiles";
import type { ScriptLabelSource } from "../script/ScriptLabelField";
import type { EventEditor } from "./EventEditor";
import type { ScriptEventKind } from "./panels/KindPanel";

/** スクリプトのラベルの並び（スクリプトタイルは eventscripts の `tile`）。 */
const LABEL_TARGET: Readonly<Record<ScriptEventKind, "person" | "sign" | "tile">> = { person: "person", sign: "sign", trap: "tile" };

/**
 * イベントタブのスクリプトのラベル（scripts_MM.json と eventscripts。Phase2）。各パネルのラベルの欄の中身と、
 * 座標の合わないラベルの知らせ（#204。Bochi などでイベントの順を変えたとき）を受け持つ。
 */
export class EventScriptLabels {
  /** 座標の合わないラベルの知らせ（付け直すボタンつき）。 */
  readonly warn: HTMLElement;

  constructor(
    private readonly state: EditorState,
    private readonly editor: EventEditor,
    private readonly files: ScriptFiles,
  ) {
    this.warn = document.createElement("div");
    this.warn.className = "event-label-warn";
    this.warn.dataset["autoId"] = "event.labelWarn";
    this.warn.hidden = true;
  }

  /** scripts_MM.json に書いた座標と、今のイベントの座標が合わないラベルを知らせる。 */
  showWarn(): void {
    const session = this.state.session;
    const id = this.state.map?.id;
    const positions = id && session?.projectDir ? session.eventPositions(id.bank, id.map) : null;
    const found = id && positions ? session!.labels.store.mismatches(id.bank, id.map, positions) : [];
    this.warn.hidden = found.length === 0;
    if (found.length === 0) return;
    const text = document.createElement("span");
    text.textContent = ja.event.labelMismatch(found.length, found.filter((x) => x.candidate !== null).length);
    text.title = found.map((x) => ja.event.labelMismatchItem(x.label, x.target, x.index, x.expected.x, x.expected.y, x.candidate)).join(String.fromCharCode(10));
    const fix = document.createElement("button");
    fix.type = "button";
    fix.textContent = ja.event.labelRealign;
    fix.dataset["autoId"] = "event.labelRealign";
    fix.disabled = !found.some((x) => x.candidate !== null);
    fix.addEventListener("click", () => this.editor.run(new RealignEventLabelsCommand({ ...id! })));
    this.warn.replaceChildren(text, fix);
  }

  /** スクリプトのラベルの欄の中身。 */
  source(kind: ScriptEventKind, index: () => number | null): ScriptLabelSource {
    const files = this.files;
    const target = LABEL_TARGET[kind];
    return {
      available: () => !!this.state.session?.projectDir,
      current: () => {
        const id = this.state.map?.id;
        const i = index();
        if (!id || i === null) return null;
        return this.state.session?.labels.store.label(id.bank, id.map, target, i)?.label ?? null;
      },
      candidates: async () => {
        const id = this.state.map?.id;
        return id ? files.labelCandidates(id.bank, id.map) : [];
      },
      place: async (label) => {
        const id = this.state.map?.id;
        return id ? files.labelPlace(id.bank, id.map, label) : { kind: "missing" };
      },
      commit: (label) => {
        const id = this.state.map?.id;
        const i = index();
        if (!id || i === null) return;
        this.editor.run(new SetEventLabelCommand({ ...id, target, index: i, label }));
      },
      onCandidatesChanged: (listener) => files.onChange(listener),
    };
  }
}
