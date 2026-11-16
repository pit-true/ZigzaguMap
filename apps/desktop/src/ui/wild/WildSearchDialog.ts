import { NameSuggest, searchSpecies, rateGroup, type MapId, type WildEncounters, type WildSearchRow } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { jaWildTime as tt } from "../../i18n/ja.wildTime";
import { jaWildTools as wt } from "../../i18n/ja.wildTools";
import { createDialog, dialogButton, dialogButtonRow, handleDialogKeys, pressable } from "../Dialog";
import { autoId } from "../form/controls";
import { SuggestInput } from "../form/SuggestInput";
import { FR_SPECIES_COUNT, speciesLabel, speciesNameProvider } from "./SpeciesNames";
import { shownWild } from "./WildTab";

/** 表の列（並べ替えの鍵）。 */
type Column = 0 | 1 | 2 | 3 | 4 | 5;

/** 検索の窓に渡すもの。 */
export interface WildSearchHost {
  readonly state: EditorState;
  /** マップを開いて野生タブにする。 */
  openWild(id: MapId, time: number): Promise<void>;
}

/**
 * ツール > 野生ポケモンの検索…（#398）。種族を打って選び（#447。カタカナ・ひらがな・ローマ字・番号）、「検索」か Enter を押すと、全マップ（ROM と maps\ の両方）から
 * その種族が出る枠を表にする（マップ・種類・枠・レベル・割合）。列の見出しで並べ替え、行のダブルクリックでそのマップの野生タブを開く。
 * 全マップの野生は押したときに読み、窓を閉じたら捨てる。種族の読みの表も窓を開いたときに作る。時間帯の表をまとめて検索し、時間帯でも絞れます。
 */
export async function openWildSearch(host: WildSearchHost): Promise<void> {
  const session = host.state.session;
  if (!session) return;
  await session.openSpeciesNames();
  if (host.state.session !== session) return;
  const finish = (): void => frame.remove();
  const frame = createDialog({ title: wt.searchTitle, width: 520, className: "wild-search", modal: false, onClose: finish });
  // 浮いた窓は位置を決める（マップを開き直しても検索の結果を見続けられるように、後ろを覆わない）
  frame.box.style.left = `${Math.max(0, Math.round((window.innerWidth - 520) / 2))}px`;
  frame.box.style.top = `${Math.max(0, Math.round((window.innerHeight - 420) / 2))}px`;
  // 種族の欄（1 番から。名前が読めなければ番号だけで当てる）
  const provider = speciesNameProvider(session);
  const suggest = new NameSuggest(Array.from({ length: Math.max(FR_SPECIES_COUNT, session.speciesCount) - 1 }, (_, i) => ({ value: i + 1, name: provider?.name(i + 1) ?? null })));
  const species = new SuggestInput({
    autoId: "wild.search.species",
    suggest,
    label: (h) => speciesLabel(provider, h.value),
    detail: (h) => (h.name === null ? "" : wt.searchNumber(h.value)),
    noneText: wt.searchNoMatch,
  });
  species.setValue(1);
  species.input.placeholder = wt.searchPlaceholder;
  const info = document.createElement("div");
  info.className = "wild-search-info";
  info.dataset["autoId"] = "wild.search.info";
  const table = document.createElement("table");
  table.className = "wild-search-table";
  table.dataset["autoId"] = "wild.search.table";
  const wrap = document.createElement("div");
  wrap.className = "wild-search-wrap";
  wrap.append(table);
  const time = autoId(document.createElement("select"), "wild.search.time");
  time.append(new Option(tt.allTimes), ...tt.names.map((n) => new Option(n)));
  time.hidden = !session.projectDir;
  let rows: (WildSearchRow & { name: string })[] = [];
  let sort: { column: Column; desc: boolean } = { column: 0, desc: false };

  const key = (r: (typeof rows)[number], c: Column): number | string =>
    c === 0 ? r.map.bank * 1000 + r.map.map : c === 1 ? r.kind : c === 2 ? r.slot : c === 3 ? r.minLevel * 1000 + r.maxLevel : c === 4 ? r.rate : r.time;
  const render = (): void => {
    const sorted = rows.filter((r) => time.selectedIndex === 0 || r.time === time.selectedIndex - 1).sort((a, b) => {
      const x = key(a, sort.column);
      const y = key(b, sort.column);
      const d = x < y ? -1 : x > y ? 1 : key(a, 0) < key(b, 0) ? -1 : key(a, 0) > key(b, 0) ? 1 : a.slot - b.slot;
      return sort.desc ? -d : d;
    });
    const head = document.createElement("tr");
    [...wt.searchColumns, tt.timeColumn].forEach((title, i) => {
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
      const cells = [r.name, ja.wild.areas[r.kind] ?? String(r.kind), wt.slot(r.slot + 1), wt.level(r.minLevel, r.maxLevel), wt.slotRate(r.rate, r.kind === 3 ? rod : null), tt.names[r.time] ?? String(r.time)];
      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c;
        tr.append(td);
      }
      tr.addEventListener("click", () => {
        for (const s of table.querySelectorAll("tr.selected")) s.classList.remove("selected");
        tr.classList.add("selected");
      });
      tr.addEventListener("dblclick", () => void host.openWild(r.map, r.time));
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
    const maps: { id: MapId; wild: WildEncounters | readonly WildEncounters[] | null; name: string }[] = [];
    for (const id of project.mapIds()) {
      const doc = project.loaded(id) ?? (await project.peek(id));
      if (!doc) continue;
      maps.push({ id, wild: s.projectDir ? doc.wild : shownWild(doc.wild), name: `${id.bank}.${id.map} ${doc.mapNameText() ?? ""}`.trim() });
    }
    const names = new Map(maps.map((m) => [`${m.id.bank}.${m.id.map}`, m.name]));
    const target = species.value;
    if (target === null) {
      info.textContent = wt.searchChoose;
      rows = [];
      render();
      return;
    }
    rows = searchSpecies(maps, target, time.selectedIndex === 0 ? null : time.selectedIndex - 1).map((r) => ({ ...r, name: names.get(`${r.map.bank}.${r.map.map}`) ?? "" }));
    info.textContent = rows.length === 0 ? wt.searchNone : wt.searchCount(rows.length, new Set(rows.map((r) => `${r.map.bank}.${r.map.map}`)).size, Math.round(performance.now() - t0));
    render();
  };

  const top = document.createElement("div");
  top.className = "wild-search-top";
  const caption = document.createElement("span");
  caption.textContent = wt.searchSpecies;
  const go = autoId(dialogButton(wt.searchRun, () => void run()), "wild.search.run");
  time.addEventListener("change", () => void run());
  top.append(caption, species.element, time, go);
  const buttons = dialogButtonRow(dialogButton(wt.close, finish));
  frame.body.append(top, info, wrap, buttons);
  // 種族の欄で Enter（候補の一覧を閉じているとき）を押すと検索する
  handleDialogKeys(frame, finish, (e) => {
    if (e.key === "Enter" && e.target === species.input) void run();
  });
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
