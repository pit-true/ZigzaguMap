import { searchSpecies, rateGroup, type MapId, type WildEncounters, type WildSearchRow } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { jaWildTools as wt } from "../../i18n/ja.wildTools";
import { createDialog, dialogButton, handleDialogKeys, pressable } from "../Dialog";
import { FR_SPECIES_COUNT, SpeciesOptions } from "./SpeciesNames";
import { shownWild } from "./WildTab";

/** 表の列（並べ替えの鍵）。 */
type Column = 0 | 1 | 2 | 3 | 4;

/** 検索の窓に渡すもの。 */
export interface WildSearchHost {
  readonly state: EditorState;
  /** マップを開いて野生タブにする。 */
  openWild(id: MapId): Promise<void>;
}

/**
 * ツール > 野生ポケモンの検索…（#398）。種族を選んで「検索」を押すと、全マップ（ROM と maps\ の両方）から
 * その種族が出る枠を表にする（マップ・種類・枠・レベル・割合）。列の見出しで並べ替え、行のダブルクリックでそのマップの野生タブを開く。
 * 全マップの野生は押したときに読み、窓を閉じたら捨てる。今の表は昼だけ（時間帯は Phase6）。
 */
export function openWildSearch(host: WildSearchHost): void {
  const session = host.state.session;
  if (!session) return;
  const finish = (): void => frame.remove();
  const frame = createDialog({ title: wt.searchTitle, width: 520, className: "wild-search", modal: false, onClose: finish });
  // 浮いた窓は位置を決める（マップを開き直しても検索の結果を見続けられるように、後ろを覆わない）
  frame.box.style.left = `${Math.max(0, Math.round((window.innerWidth - 520) / 2))}px`;
  frame.box.style.top = `${Math.max(0, Math.round((window.innerHeight - 420) / 2))}px`;
  const species = new SpeciesOptions(() => host.state.session).options(FR_SPECIES_COUNT).cloneNode(true) as HTMLSelectElement;
  species.dataset["autoId"] = "wild.search.species";
  species.selectedIndex = 1;
  const info = document.createElement("div");
  info.className = "wild-search-info";
  info.dataset["autoId"] = "wild.search.info";
  const table = document.createElement("table");
  table.className = "wild-search-table";
  table.dataset["autoId"] = "wild.search.table";
  const wrap = document.createElement("div");
  wrap.className = "wild-search-wrap";
  wrap.append(table);
  let rows: (WildSearchRow & { name: string })[] = [];
  let sort: { column: Column; desc: boolean } = { column: 0, desc: false };

  const key = (r: (typeof rows)[number], c: Column): number | string =>
    c === 0 ? r.map.bank * 1000 + r.map.map : c === 1 ? r.kind : c === 2 ? r.slot : c === 3 ? r.minLevel * 1000 + r.maxLevel : r.rate;
  const render = (): void => {
    const sorted = [...rows].sort((a, b) => {
      const x = key(a, sort.column);
      const y = key(b, sort.column);
      const d = x < y ? -1 : x > y ? 1 : key(a, 0) < key(b, 0) ? -1 : key(a, 0) > key(b, 0) ? 1 : a.slot - b.slot;
      return sort.desc ? -d : d;
    });
    const head = document.createElement("tr");
    wt.searchColumns.forEach((title, i) => {
      const th = document.createElement("th");
      th.dataset["autoId"] = `wild.search.col.${i}`;
      th.textContent = title + (sort.column === i ? (sort.desc ? " ▼" : " ▲") : "");
      th.addEventListener("click", () => {
        sort = { column: i as Column, desc: sort.column === i ? !sort.desc : false };
        render();
      });
      head.append(th);
    });
    const body = sorted.map((r, i) => {
      const tr = document.createElement("tr");
      tr.dataset["autoId"] = `wild.search.row.${i}`;
      const rod = rateGroup(r.kind, r.slot);
      const cells = [r.name, ja.wild.areas[r.kind] ?? String(r.kind), wt.slot(r.slot + 1), wt.level(r.minLevel, r.maxLevel), wt.slotRate(r.rate, r.kind === 3 ? rod : null)];
      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c;
        tr.append(td);
      }
      tr.addEventListener("click", () => {
        for (const s of table.querySelectorAll("tr.selected")) s.classList.remove("selected");
        tr.classList.add("selected");
      });
      tr.addEventListener("dblclick", () => void host.openWild(r.map));
      return tr;
    });
    table.replaceChildren(head, ...body);
  };

  const run = async (): Promise<void> => {
    const s = host.state.session;
    if (!s) return;
    info.textContent = wt.searchBusy;
    const t0 = performance.now();
    const project = s.project;
    const maps: { id: MapId; wild: WildEncounters | null; name: string }[] = [];
    for (const id of project.mapIds()) {
      const doc = project.loaded(id) ?? (await project.peek(id));
      if (!doc) continue;
      maps.push({ id, wild: shownWild(doc.wild), name: `${id.bank}.${id.map} ${doc.mapNameText() ?? ""}`.trim() });
    }
    const names = new Map(maps.map((m) => [`${m.id.bank}.${m.id.map}`, m.name]));
    rows = searchSpecies(maps, species.selectedIndex).map((r) => ({ ...r, name: names.get(`${r.map.bank}.${r.map.map}`) ?? "" }));
    info.textContent = rows.length === 0 ? wt.searchNone : wt.searchCount(rows.length, new Set(rows.map((r) => `${r.map.bank}.${r.map.map}`)).size, Math.round(performance.now() - t0));
    render();
  };

  const top = document.createElement("div");
  top.className = "wild-search-top";
  const caption = document.createElement("span");
  caption.textContent = wt.searchSpecies;
  const go = dialogButton(wt.searchRun, () => void run());
  go.dataset["autoId"] = "wild.search.run";
  top.append(caption, species, go);
  const buttons = document.createElement("div");
  buttons.className = "dialog-buttons";
  buttons.append(dialogButton(wt.close, finish));
  frame.body.append(top, info, wrap, buttons);
  handleDialogKeys(frame, finish);
  frame.register({
    title: wt.searchTitle,
    text: "",
    ...pressable([
      { label: wt.searchRun, aliases: ["search", "run"], run: () => void run() },
      { label: wt.close, aliases: ["close", "cancel"], run: finish },
    ]),
  });
  render();
}
