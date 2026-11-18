import type { FileDialogs } from "../../app/FileDialogs";
import { jaMapScriptFile as t } from "../../i18n/ja.mapScriptFile";
import { errorText } from "../../util/errors";
import { showError } from "../MessageBox";
import { chooseMapScript, mapScriptLink, unlinkMapScript } from "../script/MapScriptFileLink";
import type { HeaderContext } from "./HeaderContext";

/**
 * 場所の設定タブ「かんたん（CFRU）」の「このマップの .s」の行（#555）。今の紐づけ（プロジェクトフォルダからの相対パス）を出し、
 * 「選ぶ…」でファイルを選ぶ画面を開いて紐づけ、「外す」で紐づけを消す。どちらも対応表のコマンドなので元に戻せ、出力で書く。
 * プロジェクトフォルダが無いとき（素の ROM だけ）と、scripts.json が読めなかったときは出さない。
 */
export class MapScriptFileRow {
  readonly element: HTMLElement;
  private readonly path: HTMLElement;
  private readonly note: HTMLElement;
  private readonly clear: HTMLButtonElement;
  private ctx: HeaderContext | null = null;

  constructor(private readonly files: FileDialogs) {
    this.element = document.createElement("div");
    this.element.className = "header-simple-row";
    this.element.dataset["autoId"] = "easy.mapScript";
    const label = document.createElement("span");
    label.className = "header-simple-label";
    label.textContent = t.caption;
    const body = document.createElement("div");
    body.className = "header-simple-control";
    this.path = document.createElement("span");
    this.path.className = "header-simple-path";
    this.path.dataset["autoId"] = "easy.mapScript.path";
    const choose = button("easy.mapScript.choose", t.choose, t.chooseHint, () => void this.choose());
    this.clear = button("easy.mapScript.clear", t.clear, t.clearHint, () => this.unlink());
    const line = document.createElement("span");
    line.className = "header-simple-inline";
    line.append(this.path, choose, this.clear);
    this.note = document.createElement("div");
    this.note.className = "header-simple-note";
    this.note.dataset["autoId"] = "easy.mapScript.note";
    body.append(line, this.note);
    this.element.append(label, body);
  }

  render(ctx: HeaderContext): void {
    this.ctx = ctx;
    const link = mapScriptLink(ctx.state, ctx.map.id);
    this.element.hidden = link === null;
    if (!link) return;
    this.path.textContent = link.script ?? t.none;
    this.path.title = link.script ?? "";
    this.note.textContent = link.from === "map" ? t.fromMap : link.from === "bank" ? t.fromBank(ctx.map.id.bank) : t.noneNote;
    this.clear.disabled = link.row < 0;
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
