import type { EditorState } from "../../app/EditorState";
import type { HeaderView as HeaderViewMode } from "../../app/Settings";
import { ja } from "../../i18n/ja";
import { watchCommands } from "../form/commit";
import { panel } from "../form/controls";
import { FooterGroups } from "./FooterGroups";
import { LayoutSharedNote } from "./LayoutSharedNote";
import type { HeaderContext } from "./HeaderContext";
import { SizeGroup, TilesetGroup } from "./LayoutGroups";
import { MapScriptGroup } from "./MapScriptGroup";
import { NameGroup } from "./NameGroup";
import { OptionsGroup } from "./OptionsGroup";
import { BankGroup, MapSettingsGroup, TilesetDataGroup } from "./ProHeaderGroups";
import { SimpleHeaderView, type SimpleHeaderHost } from "./SimpleHeaderView";

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
 * 場所の設定タブ。上のラジオボタンで「かんたん（CFRU）」（初期）と「くわしく（従来）」を切り替える（個人設定 headerView）。
 * くわしくの中は、「高度なヘッダーを表示」（表示メニューと Ctrl+H、個人設定 advancedHeader）で通常表示と高度な表示を切り替える。
 * 表示中のタブ・表示中の側だけを描き、隠れている側は切り替えたときに読み直す。
 * 操作（アンドゥ・リドゥを含む）があれば読み直す。
 */
export class HeaderTab {
  readonly element: HTMLElement;
  private readonly simple: SimpleHeaderView;
  private readonly normal: HeaderView;
  private readonly pro: HeaderView;
  private readonly modes: Record<HeaderViewMode, HTMLInputElement>;
  private readonly advanced: HTMLInputElement;
  private readonly advancedLabel: HTMLElement;
  /** くわしく表示の下の「配置の共有」（#228。AdvanceMap の部品の枠の外に置く）。 */
  private readonly layoutShared: LayoutSharedNote;
  private stale = true;

  constructor(
    private readonly state: EditorState,
    host: SimpleHeaderHost,
  ) {
    this.element = document.createElement("div");
    this.element.className = "header-tab am-scroll";
    const footer = new FooterGroups();
    this.simple = new SimpleHeaderView(host);
    this.normal = view("header-normal", 641, [new NameGroup(), new OptionsGroup(), new MapScriptGroup(), new TilesetGroup(), new SizeGroup()]);
    this.pro = view("header-pro", 873, [new BankGroup(), new MapSettingsGroup(), footer, new TilesetDataGroup()], [footer.borderElement]);

    // 表示の切り替え
    const bar = document.createElement("div");
    bar.className = "header-mode";
    const t = ja.headerSimple;
    this.modes = { simple: radio("header.mode.simple", t.modeSimple), classic: radio("header.mode.classic", t.modeClassic) };
    for (const [mode, input] of Object.entries(this.modes) as [HeaderViewMode, HTMLInputElement][]) {
      input.addEventListener("change", () => {
        if (input.checked) this.setMode(mode);
      });
    }
    this.advanced = document.createElement("input");
    this.advanced.type = "checkbox";
    this.advanced.dataset["autoId"] = "header.advanced";
    this.advanced.addEventListener("change", () => {
      state.settings.update({ advancedHeader: this.advanced.checked });
      state.emit("view");
    });
    this.advancedLabel = document.createElement("label");
    this.advancedLabel.className = "header-mode-advanced";
    this.advancedLabel.append(this.advanced, t.advanced);
    bar.append(this.modes.simple.parentElement!, this.modes.classic.parentElement!, this.advancedLabel);

    this.layoutShared = new LayoutSharedNote("header", (id) => host.openMap(id), false);
    this.element.append(bar, this.simple.element, this.normal.element, this.pro.element, this.layoutShared.element);
    const refresh = (): void => {
      this.stale = true;
      this.render();
    };
    state.on("map", refresh);
    state.on("view", refresh);
    state.on("tab", () => this.render());
    watchCommands(state, refresh);
    this.showMode();
  }

  /** 表示を切り替えて個人設定に残す。 */
  setMode(mode: HeaderViewMode): void {
    if (this.state.settings.data.headerView === mode) return;
    this.state.settings.update({ headerView: mode });
    this.state.emit("view");
  }

  private showMode(): void {
    const s = this.state.settings.data;
    this.modes.simple.checked = s.headerView !== "classic";
    this.modes.classic.checked = s.headerView === "classic";
    this.advanced.checked = s.advancedHeader;
    this.advancedLabel.hidden = s.headerView !== "classic";
  }

  private render(): void {
    this.showMode();
    if (!this.stale || this.state.tab !== "header") return;
    this.stale = false;
    const s = this.state;
    const simple = s.settings.data.headerView !== "classic";
    const pro = !simple && s.settings.data.advancedHeader;
    this.simple.element.hidden = !simple || !s.map;
    this.normal.element.hidden = simple || pro || !s.map;
    this.pro.element.hidden = !pro || !s.map;
    if (!s.map || !s.session) {
      this.layoutShared.element.hidden = true;
      return;
    }
    const ctx = { state: s, session: s.session, map: s.map, doc: s.map.doc };
    if (simple) this.simple.render(ctx);
    else (pro ? this.pro : this.normal).render(ctx);
    if (simple) this.layoutShared.element.hidden = true;
    else this.layoutShared.render(ctx);
  }
}

/** ラジオボタン（同じ name で 1 つだけ選ぶ）。ラベルの中に入れて返す。 */
function radio(id: string, text: string): HTMLInputElement {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "header-mode";
  input.dataset["autoId"] = id;
  label.append(input, text);
  return input;
}
