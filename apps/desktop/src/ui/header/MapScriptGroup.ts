import { invoke } from "@tauri-apps/api/core";
import { isTableType } from "@zigzagumap/core";
import { hex, ja } from "../../i18n/ja";
import { messageBox } from "../MessageBox";
import { commit } from "../form/commit";
import { button, combo, edit, group, label, selectIndex, setEnabled, spin } from "../form/controls";
import type { DraftList } from "../form/DraftList";
import { offsetText } from "../form/inputErrors";
import { checkOnInput, tryInteger } from "../form/integerInput";
import { scriptTypeChoices, type HeaderContext } from "./HeaderContext";
import { newScriptDraftList, offsetToPointer, scriptDrafts, pointerToOffset, scriptOps, type ScriptDraft } from "./MapScriptDraft";

/**
 * 「マップスクリプト」の枠（GroupBox11）と、その下の「スクリプト追加」「マップスクリプトの保存」。
 * AdvanceMap と同じく、選択・種類・オフセット・フラグの変更、追加、削除（確認なし）はメモリ上の表（下書き）に対して行い、
 * 「マップスクリプトの保存」で編集中の状態へ反映する。
 */
export class MapScriptGroup {
  readonly element: HTMLElement;
  private readonly number: { root: HTMLElement; input: HTMLInputElement };
  private readonly type: HTMLSelectElement;
  private readonly offset: HTMLInputElement;
  private readonly flag: HTMLInputElement;
  private readonly flagValue: HTMLInputElement;
  private readonly flagOffset: HTMLInputElement;
  private readonly remove: HTMLButtonElement;
  private readonly open: HTMLButtonElement;
  private draft: DraftList<ScriptDraft> | null = null;
  private draftMap = "";
  private index = 0;
  private ctx: HeaderContext | null = null;

  constructor() {
    const h = ja.header;
    this.element = group(h.scripts, 8, 352, 465, 153);
    this.number = spin("header.scriptNo", 16, 32, 57, (d) => this.select(this.index + d));
    this.type = combo("header.scriptType", scriptTypeChoices(), 80, 32, 265);
    this.offset = edit("header.scriptOffset", 352, 32, 97);
    this.flag = edit("header.flag", 152, 72, 97);
    this.flagValue = edit("header.flagValue", 256, 72, 89);
    this.flagOffset = edit("header.flagOffset", 352, 72, 97);
    this.remove = button("header.removeScript", h.removeScript, 16, 64, 129, 17, () => this.removeSelected());
    this.open = button("header.openScript", h.openScript, 16, 104, 193, 33, () => this.openScript());
    const add = button("header.addScript", h.addScript, 16, 80, 129, 17, () => this.add());
    const save = button("header.saveScripts", h.saveScripts, 256, 104, 193, 33, () => this.save());
    this.element.append(
      label(h.scriptNo, 16, 16),
      this.number.root,
      label(h.scriptType, 80, 16),
      this.type,
      label(h.scriptOffset, 352, 16),
      this.offset,
      this.remove,
      label(h.flag, 152, 56),
      this.flag,
      label(h.flagValue, 256, 56),
      this.flagValue,
      label(h.flagOffset, 352, 56),
      this.flagOffset,
      this.open,
      add,
      save,
    );

    this.number.input.addEventListener("change", () => {
      // テキストで入れた番号は検査しない（AdvanceMap と同じ。範囲外なら表示は変えない）。
      const n = Number(this.number.input.value);
      if (Number.isInteger(n) && n >= 0 && n < this.count) this.select(n);
    });
    this.type.addEventListener("change", () => this.changeType());
    // AdvanceMap は入力のたびに読む（オフセットの欄は `$` を含めた文字のまま、フラグと値は `$` を付けて読む）。
    checkOnInput(this.offset, "int");
    checkOnInput(this.flag, "hex");
    checkOnInput(this.flagValue, "hex");
    checkOnInput(this.flagOffset, "int");
    for (const el of [this.offset, this.flag, this.flagValue, this.flagOffset]) el.addEventListener("change", () => this.store());
  }

  private get count(): number {
    return this.draft?.items.length ?? 0;
  }

  private get current(): ScriptDraft | null {
    return this.draft?.items[this.index]?.value ?? null;
  }

  render(ctx: HeaderContext): void {
    this.ctx = ctx;
    const list = ctx.doc.mapScripts ?? [];
    const key = `${ctx.map.id.bank}.${ctx.map.id.map}`;
    if (!this.draft || this.draftMap !== key || this.draft.isStale(scriptDrafts(list))) {
      const otherMap = this.draftMap !== key;
      this.draft = newScriptDraftList(list);
      this.draftMap = key;
      if (otherMap || this.index >= this.count) this.index = 0;
    }
    this.show();
  }

  /** 下書きの選んでいる件を欄に出す。 */
  private show(): void {
    const d = this.current;
    const count = this.count;
    this.number.input.value = String(this.index);
    setEnabled(count > 1, this.number.input, ...this.number.root.querySelectorAll("button"));
    setEnabled(d !== null, this.type, this.offset, this.remove, this.open);
    if (!d) {
      this.type.selectedIndex = -1;
      this.offset.value = "";
      for (const el of [this.flag, this.flagValue, this.flagOffset]) el.value = "";
      setEnabled(false, this.flag, this.flagValue, this.flagOffset);
      return;
    }
    selectIndex(this.type, d.type);
    const table = isTableType(d.type);
    this.offset.disabled = table;
    this.offset.value = offsetText(table ? 0 : pointerToOffset(d.pointer));
    setEnabled(table, this.flag, this.flagValue, this.flagOffset);
    this.flag.value = table ? hex(d.flag, 4) : "";
    this.flagValue.value = table ? hex(d.value, 4) : "";
    this.flagOffset.value = table ? offsetText(pointerToOffset(d.flagOffset)) : "";
  }

  private select(index: number): void {
    if (index < 0 || index >= this.count) return;
    this.store();
    this.index = index;
    this.show();
  }

  /** 欄の値を下書きに入れる。読めない欄は（入力のときにエラーを出してあるので）黙って元の値のままにする。 */
  private store(): void {
    const d = this.current;
    if (!d) return;
    if (!isTableType(d.type)) {
      const offset = tryInteger(this.offset.value, "int");
      if (offset !== null) d.pointer = offsetToPointer(offset);
      return;
    }
    const flag = tryInteger(this.flag.value, "hex");
    const value = tryInteger(this.flagValue.value, "hex");
    const offset = tryInteger(this.flagOffset.value, "int");
    if (flag !== null) d.flag = flag & 0xffff;
    if (value !== null) d.value = value & 0xffff;
    if (offset !== null) d.flagOffset = offsetToPointer(offset);
  }

  /** 種類を変える。条件表の種類にするとフラグ欄が使え、フラグのオフセットに元のオフセットが入る（AdvanceMap と同じ）。 */
  private changeType(): void {
    const d = this.current;
    if (!d || this.type.selectedIndex < 0) return;
    if (!isTableType(d.type)) this.store();
    const next = this.type.selectedIndex;
    if (isTableType(next) && !isTableType(d.type) && !d.hasRow) {
      d.flag = 0;
      d.value = 0;
      d.flagOffset = d.pointer;
    }
    d.type = next;
    this.show();
  }

  private add(): void {
    if (!this.draft || !this.ctx) return;
    this.store();
    this.index = this.draft.add({ type: 0, pointer: 0, flag: 0, value: 0, flagOffset: 0, hasRow: false });
    this.show();
  }

  private removeSelected(): void {
    if (!this.draft || !this.current) return;
    this.draft.remove(this.index);
    this.index = Math.max(0, Math.min(this.index, this.count - 1));
    this.show();
  }

  private save(): void {
    const c = this.ctx;
    const draft = this.draft;
    if (!c || !draft) return;
    this.store();
    const unset = draft.items.findIndex((d) => d.value.type === 0);
    if (unset >= 0) {
      void messageBox(ja.errorTitle, ja.header.scriptTypeUnset(unset), "error");
      return;
    }
    const list = c.doc.mapScripts ?? [];
    const keepIndex = this.index;
    const saved = commit(c.state, draft.plan(newScriptDraftList(list).items.map((d) => d.value), scriptOps(c.map.id)));
    if (saved) {
      this.draft = newScriptDraftList(c.doc.mapScripts ?? []);
      this.index = Math.min(keepIndex, Math.max(0, this.count - 1));
      this.show();
    }
  }

  /**
   * 「スクリプトを開く」: 設定 > スクリプトエディターの選択 で選んだ exe に、ベース ROM のパスとオフセット（16 進）を渡して起動する
   * （AdvanceMap と同じく、区切りは空白か「:」）。エディターを選んでいなければステータスバーに出す。
   */
  private openScript(): void {
    const d = this.current;
    const c = this.ctx;
    if (!d || !c) return;
    const pointer = isTableType(d.type) ? d.flagOffset : d.pointer;
    const offset = hex(pointerToOffset(pointer), 6);
    const s = c.state.settings.data;
    if (!s.scriptEditor) {
      c.state.setStatus(ja.header.noScriptEditor(offset));
      return;
    }
    const args = s.scriptSpaceSeparator ? [c.session.romPath, offset] : [`${c.session.romPath}:${offset}`];
    invoke("launch_program", { program: s.scriptEditor, args }).catch((e: unknown) => c.state.setStatus(ja.error(String(e)), undefined, true));
  }
}
