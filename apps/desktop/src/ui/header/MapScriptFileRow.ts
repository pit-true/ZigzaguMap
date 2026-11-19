import type { FileDialogs } from "../../app/FileDialogs";
import { jaMapScriptFile as t } from "../../i18n/ja.mapScriptFile";
import { errorText } from "../../util/errors";
import { showError } from "../MessageBox";
import { chooseMapScript, mapScriptLink, unlinkMapScript } from "../script/MapScriptFileLink";
import type { ScriptFiles } from "../script/ScriptFiles";
import type { HeaderContext } from "./HeaderContext";

/**
 * 場所の設定タブ「かんたん（CFRU）」の「スクリプトのファイル（.s）」のまとまり（#555・#562）。マップスクリプトの表とは別のまとまりにし、
 * 今の「このマップの .s」（プロジェクトフォルダからの相対パス）を出す。「選ぶ…」でファイルを選ぶ画面を開いて紐づけ、「外す」で消す
 * （どちらも対応表のコマンドなので元に戻せ、出力で書く）。紐づけが無ければ、マップのラベルから自動で決めた `.s` を「自動（ラベルから）」の
 * 印つきで出す（保存はしない。索引を作るのは、このまとまりを描くときだけ）。
 * プロジェクトフォルダが無いとき（素の ROM だけ）と、scripts.json が読めなかったときは出さない。
 */
export class MapScriptFileRow {
  readonly element: HTMLElement;
  private readonly path: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly note: HTMLElement;
  private readonly clear: HTMLButtonElement;
  private ctx: HeaderContext | null = null;
  private version = 0;

  constructor(
    private readonly files: FileDialogs,
    private readonly scripts: ScriptFiles,
  ) {
    this.element = document.createElement("fieldset");
    this.element.className = "header-simple-section";
    this.element.dataset["autoId"] = "easy.mapScript";
    const legend = document.createElement("legend");
    legend.textContent = t.section;
    const intro = document.createElement("div");
    intro.className = "header-simple-note header-simple-intro";
    intro.textContent = t.intro;
    const row = document.createElement("div");
    row.className = "header-simple-row";
    const label = document.createElement("span");
    label.className = "header-simple-label";
    label.textContent = t.caption;
    const body = document.createElement("div");
    body.className = "header-simple-control";
    this.path = document.createElement("span");
    this.path.className = "header-simple-path";
    this.path.dataset["autoId"] = "easy.mapScript.path";
    this.mark = document.createElement("span");
    this.mark.className = "header-simple-auto";
    this.mark.textContent = t.autoMark;
    this.mark.dataset["autoId"] = "easy.mapScript.auto";
    const choose = button("easy.mapScript.choose", t.choose, t.chooseHint, () => void this.choose());
    this.clear = button("easy.mapScript.clear", t.clear, t.clearHint, () => this.unlink());
    const line = document.createElement("span");
    line.className = "header-simple-inline";
    line.append(this.path, this.mark, choose, this.clear);
    this.note = document.createElement("div");
    this.note.className = "header-simple-note";
    this.note.dataset["autoId"] = "easy.mapScript.note";
    body.append(line, this.note);
    row.append(label, body);
    this.element.append(legend, intro, row);
  }

  render(ctx: HeaderContext): void {
    this.ctx = ctx;
    const v = ++this.version;
    const link = mapScriptLink(ctx.state, ctx.map.id);
    this.element.hidden = link === null;
    if (!link) return;
    this.clear.disabled = link.row < 0;
    if (link.script) return this.show(link.script, false, link.from === "map" ? t.fromMap : t.fromBank(ctx.map.id.bank));
    // 紐づけが無い: ラベルから自動で決める（索引ができるまでは「決まっていません」のまま）
    const now = this.scripts.mapScriptNow(ctx.map.id.bank, ctx.map.id.map);
    this.showAuto(ctx, now?.from === "auto" ? now.script : null);
    void this.scripts
      .mapScriptOf(ctx.map.id.bank, ctx.map.id.map)
      .then((found) => {
        if (v === this.version) this.showAuto(ctx, found?.from === "auto" ? found.script : null);
      })
      .catch(() => undefined);
  }

  private showAuto(ctx: HeaderContext, script: string | null): void {
    if (!script) return this.show(null, false, t.noneNote);
    const own = new Set(ctx.session.labels.store.labelsOfMap(ctx.map.id.bank, ctx.map.id.map));
    const count = (this.scripts.cachedLabels(script) ?? []).filter((n) => own.has(n)).length;
    this.show(script, true, t.autoNote(count || own.size));
    if (this.scripts.cachedLabels(script) === null) {
      const v = this.version;
      void this.scripts.labelsOf(script).then(() => {
        if (v === this.version) this.showAuto(ctx, script);
      });
    }
  }

  private show(script: string | null, auto: boolean, note: string): void {
    this.path.textContent = script ?? t.none;
    this.path.title = script ?? "";
    this.mark.hidden = !auto;
    this.note.textContent = note;
  }

  private async choose(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      await chooseMapScript(ctx.state, this.files, ctx.map.id);
    } catch (e) {
      await showError(errorText(e));
    }
  }

  private unlink(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      unlinkMapScript(ctx.state, ctx.map.id);
    } catch (e) {
      void showError(errorText(e));
    }
  }
}

function button(id: string, text: string, hint: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.title = hint;
  b.dataset["autoId"] = id;
  b.addEventListener("click", onClick);
  return b;
}
