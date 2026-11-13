import type { EditorState } from "../../app/EditorState";
import { watchCommands } from "../form/commit";
import { panel } from "../form/controls";
import { FooterGroups } from "./FooterGroups";
import type { HeaderContext } from "./HeaderContext";
import { SizeGroup, TilesetGroup } from "./LayoutGroups";
import { MapScriptGroup } from "./MapScriptGroup";
import { NameGroup } from "./NameGroup";
import { OptionsGroup } from "./OptionsGroup";
import { BankGroup, MapSettingsGroup, TilesetDataGroup } from "./ProHeaderGroups";

/** 表示の一方（通常・高度）。 */
interface HeaderView {
  readonly element: HTMLElement;
  render(ctx: HeaderContext): void;
}

/** 部品の枠をまとめた表示。 */
function view(className: string, height: number, parts: readonly { element: HTMLElement; render(ctx: HeaderContext): void }[], extra: HTMLElement[] = []): HeaderView {
  const element = panel(className, 481, height);
  element.append(...parts.map((p) => p.element), ...extra);
  return { element, render: (ctx) => parts.forEach((p) => p.render(ctx)) };
}

/**
 * 場所の設定タブ。設定メニュー「高度なヘッダーを表示」（Ctrl+H、個人設定 advancedHeader）で通常表示と高度な表示を切り替える。
 * 表示中のタブ・表示中の側だけを描き、隠れている側は切り替えたときに読み直す。
 * 操作（アンドゥ・リドゥを含む）があれば読み直す。
 */
export class HeaderTab {
  readonly element: HTMLElement;
  private readonly normal: HeaderView;
  private readonly pro: HeaderView;
  private stale = true;

  constructor(private readonly state: EditorState) {
    this.element = document.createElement("div");
    this.element.className = "header-tab am-scroll";
    const footer = new FooterGroups();
    this.normal = view("header-normal", 641, [new NameGroup(), new OptionsGroup(), new MapScriptGroup(), new TilesetGroup(), new SizeGroup()]);
    this.pro = view("header-pro", 873, [new BankGroup(), new MapSettingsGroup(), footer, new TilesetDataGroup()], [footer.borderElement]);
    this.element.append(this.normal.element, this.pro.element);
    const refresh = (): void => {
      this.stale = true;
      this.render();
    };
    state.on("map", refresh);
    state.on("view", refresh);
    state.on("tab", () => this.render());
    watchCommands(state, refresh);
  }

  private render(): void {
    if (!this.stale || this.state.tab !== "header") return;
    this.stale = false;
    const pro = this.state.settings.data.advancedHeader;
    const s = this.state;
    this.normal.element.hidden = pro || !s.map;
    this.pro.element.hidden = !pro || !s.map;
    if (!s.map || !s.session) return;
    (pro ? this.pro : this.normal).render({ state: s, session: s.session, map: s.map, doc: s.map.doc });
  }
}
