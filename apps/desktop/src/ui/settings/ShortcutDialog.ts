import { ja } from "../../i18n/ja";
import { jaShortcutEdit } from "../../i18n/ja.shortcutEdit";
import { MAX_KEYS, chordOf, chordText, conflictOf, currentKeymap, defaultKeymap, keymapOverrides, sameChord, type KeyChord, type Keymap } from "../../app/keymap";
import { keyActionNames } from "../../app/shortcutList";
import { createDialog, dialogButton, dialogButtonRow, handleDialogKeys, pressable } from "../Dialog";
import { autoId } from "../form/controls";
import "../../styles/shortcutEdit.css";

/**
 * 設定 > ショートカットの変更… の窓（Phase5 #392）。表（`app/keymap.ts`）の操作ごとに、キーを 2 つまで決める。
 * キーの欄を押してから決めたいキーを押す。ほかの操作と重なったら、どちらに残すか聞く。「既定に戻す」で全部を既定のキーにする。
 * OK で `commit` に個人設定の形（既定と違うものだけ）を渡す。キャンセルでは何も変えない。
 * 部品の ID: キーの欄 `shortcuts.<操作の ID>.0`・`.1`（押してから `key` 命令をこの ID へ送る）、外す `shortcuts.<操作の ID>.<n>.clear`、
 * 既定に戻す `shortcuts.reset`。重なりを聞く窓のボタンは `new`（新しく決めた方に残す）・`old`（前からの方に残す）で押せる。
 */
export function openShortcutDialog(commit: (overrides: Record<string, string[]>) => void): void {
  const t = jaShortcutEdit;
  const names = keyActionNames();
  const nameOf = new Map(names.map((n) => [n.id, n.action]));
  const draft: Record<string, KeyChord[]> = copy(currentKeymap());
  let done = false;
  let asking = false;
  const cancel = (): void => {
    if (done || asking) return;
    done = true;
    frame.remove();
  };
  const frame = createDialog({ title: t.title, width: 720, className: "shortcut-edit", onClose: cancel });
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = t.note;

  const table = document.createElement("table");
  table.className = "shortcut-table";
  const head = document.createElement("tr");
  for (const h of [t.headerAction, t.headerWhere, t.headerKey1, t.headerKey2]) {
    const th = document.createElement("th");
    th.textContent = h;
    head.append(th);
  }
  const thead = document.createElement("thead");
  thead.append(head);
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  const scroll = document.createElement("div");
  scroll.className = "shortcut-scroll";
  scroll.append(table);

  /** 欄ごとの表示を作り直す。 */
  const slots = new Map<string, HTMLButtonElement>();
  let capturing: HTMLButtonElement | null = null;
  const render = (): void => {
    for (const [key, b] of slots) {
      const [id, n] = splitSlot(key);
      const ch = draft[id]?.[n];
      b.textContent = b === capturing ? t.waiting : ch ? chordText(ch) : t.none;
      b.classList.toggle("empty", !ch);
      b.classList.toggle("capturing", b === capturing);
    }
  };
  const stopCapture = (): void => {
    capturing = null;
    render();
  };

  const assign = async (id: string, n: number, ch: KeyChord): Promise<void> => {
    const keys = draft[id] ?? [];
    if (keys.some((x) => sameChord(x, ch))) return;
    const other = conflictOf(draft, id, ch);
    if (other) {
      asking = true;
      const keepNew = await askConflict(chordText(ch), nameOf.get(id) ?? id, nameOf.get(other) ?? other);
      asking = false;
      if (!keepNew) return;
      draft[other] = (draft[other] ?? []).filter((x) => !sameChord(x, ch));
    }
    const next = keys.slice();
    if (n < next.length) next[n] = ch;
    else next.push(ch);
    draft[id] = next.slice(0, MAX_KEYS);
  };

  for (const row of names) {
    const tr = document.createElement("tr");
    const action = document.createElement("td");
    action.textContent = row.action;
    const where = document.createElement("td");
    where.className = "where";
    where.textContent = row.where;
    tr.append(action, where);
    for (let n = 0; n < MAX_KEYS; n++) {
      const td = document.createElement("td");
      td.className = "slot";
      const slotId = `shortcuts.${row.id}.${n}`;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "key-slot";
      b.dataset["autoId"] = slotId;
      b.addEventListener("click", () => {
        capturing = b;
        b.focus();
        render();
      });
      b.addEventListener("blur", () => {
        if (capturing === b) stopCapture();
      });
      b.addEventListener("keydown", (e) => {
        if (capturing !== b) return;
        // 決めたいキーそのものなので、ダイアログやメインのショートカットへ渡さない
        e.preventDefault();
        e.stopPropagation();
        const ch = chordOf(e);
        if (!ch) return;
        void assign(row.id, n, ch).then(stopCapture);
      });
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "key-clear";
      clear.textContent = "×";
      clear.title = t.clear;
      clear.dataset["autoId"] = `${slotId}.clear`;
      clear.addEventListener("click", () => {
        draft[row.id] = (draft[row.id] ?? []).filter((_, i) => i !== n);
        stopCapture();
      });
      slots.set(slotId, b);
      td.append(b, clear);
      tr.append(td);
    }
    tbody.append(tr);
  }

  const reset = (): void => {
    Object.assign(draft, copy(defaultKeymap()));
    stopCapture();
  };
  const ok = (): void => {
    if (done || asking) return;
    done = true;
    commit(keymapOverrides(draft));
    frame.remove();
  };
  const resetButton = autoId(dialogButton(t.reset, reset), "shortcuts.reset");
  resetButton.classList.add("wide");
  const buttons = dialogButtonRow(resetButton, dialogButton(ja.ok, ok), dialogButton(ja.cancel, cancel));
  frame.body.append(note, scroll, buttons);
  handleDialogKeys(frame, cancel);
  frame.register({
    title: t.title,
    text: t.note,
    ...pressable([
      { label: ja.ok, aliases: ["ok"], run: ok },
      { label: ja.cancel, aliases: ["cancel"], run: cancel },
      { label: t.reset, aliases: ["reset"], run: reset },
    ]),
  });
  render();
}

/** 重なったとき、どちらに残すか聞く（新しく決めた方なら true）。 */
function askConflict(key: string, mine: string, other: string): Promise<boolean> {
  const t = jaShortcutEdit;
  return new Promise((resolve) => {
    let answered = false;
    const answer = (keepNew: boolean): void => {
      if (answered) return;
      answered = true;
      frame.remove();
      resolve(keepNew);
    };
    const frame = createDialog({ title: t.conflictTitle, width: 420, className: "shortcut-conflict", onClose: () => answer(false) });
    const text = document.createElement("p");
    text.textContent = t.conflict(key, other);
    const keepNew = dialogButton(t.keepNew(mine), () => answer(true));
    const keepOld = dialogButton(t.keepOld(other), () => answer(false));
    for (const b of [keepNew, keepOld]) b.classList.add("wide");
    const buttons = dialogButtonRow(keepNew, keepOld);
    frame.body.append(text, buttons);
    handleDialogKeys(frame, () => answer(false));
    frame.register({
      title: t.conflictTitle,
      text: text.textContent,
      ...pressable([
        { label: t.keepNew(mine), aliases: ["new"], run: () => answer(true) },
        { label: t.keepOld(other), aliases: ["old"], run: () => answer(false) },
      ]),
    });
    keepNew.focus();
  });
}

function copy(map: Keymap): Record<string, KeyChord[]> {
  return Object.fromEntries(Object.entries(map).map(([id, keys]) => [id, keys.slice()]));
}

/** 欄の ID（`shortcuts.<操作>.<n>`）を操作と番号に分ける。 */
function splitSlot(slotId: string): [string, number] {
  const rest = slotId.slice("shortcuts.".length);
  const dot = rest.lastIndexOf(".");
  return [rest.slice(0, dot), Number(rest.slice(dot + 1))];
}
