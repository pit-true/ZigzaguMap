import { SetFlyPositionCommand, eventsOutsideMap, moveEventsInsideCommands, nearestInside, type Command } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { commit, watchCommands } from "../form/commit";
import { mapFly } from "./eventModel";

/**
 * マップの外にイベントがあるときに、画面の上（ツールバーの下）に出す帯。
 * 「ノート:イベントがマップの外に配置されています」と「マップの内側に戻す」ボタン。押すと、外にある全イベント
 * （フライトポジションを含む）をいちばん近いマップの内側へ寄せる（1 回の操作。1 回のアンドゥで全部戻る）。
 * マップを開いたとき・操作（アンドゥを含む）のたびに調べ直し、外のイベントが無くなれば消える。
 */
export class OutsideEventsBar {
  readonly element: HTMLElement;

  constructor(private readonly state: EditorState) {
    this.element = document.createElement("div");
    this.element.className = "outside-bar";
    this.element.dataset["autoId"] = "outside.bar";
    this.element.setAttribute("role", "status");
    this.element.hidden = true;
    const text = document.createElement("span");
    text.textContent = ja.event.noteOutside;
    const fix = document.createElement("button");
    fix.type = "button";
    fix.textContent = ja.event.moveInside;
    fix.dataset["autoId"] = "outside.fix";
    fix.addEventListener("click", () => this.fix());
    this.element.append(text, fix);
    state.on("map", () => this.refresh());
    watchCommands(state, () => this.refresh());
  }

  /** 外にイベントがあるか調べ直して、帯を出す・消す。 */
  refresh(): void {
    this.element.hidden = this.commands().length === 0;
  }

  /** 「マップの内側に戻す」。 */
  fix(): void {
    const commands = this.commands();
    if (commands.length > 0) commit(this.state, commands);
    this.refresh();
  }

  /** 外にあるイベントを内側へ寄せるコマンド（無ければ空）。 */
  private commands(): Command[] {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session) return [];
    const doc = map.doc;
    const out: Command[] = eventsOutsideMap(doc).length > 0 ? moveEventsInsideCommands(doc, map.id) : [];
    const fly = mapFly(session.project.editorContext().flyPositions, map.id);
    if (fly && (fly.x >= doc.width || fly.y >= doc.height)) {
      out.push(new SetFlyPositionCommand({ index: fly.index, fields: { x: nearestInside(fly.x, doc.width), y: nearestInside(fly.y, doc.height) } }));
    }
    return out;
  }
}
