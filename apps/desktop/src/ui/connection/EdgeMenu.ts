import {
  ConnectMapsCommand,
  ConnectionDirection,
  DisconnectMapsCommand,
  MAX_MAPS_PER_BANK,
  centeredOffset,
  chooseSlot,
  createConnectedMap,
  directionOf,
  edgeLength,
  isVertical,
  newConnectedMapSize,
  sideOf,
  type MapDocument,
  type MapId,
  type MapSize,
  type Side,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaNeighbors } from "../../i18n/ja.neighbors";
import { showContextMenu, type ContextMenuItem } from "../ContextMenu";
import { showEditError } from "../form/inputErrors";
import { inputDialog } from "../InputDialog";
import { askYesNo, showError } from "../MessageBox";
import { pickMap } from "./MapPickerDialog";

/** ダイブ・浮上の向き。 */
const DIVE = ConnectionDirection.Dive;
const EMERGE = ConnectionDirection.Emerge;

/**
 * 辺のつまみの右クリックのメニュー（#230）: 新しいマップを作ってつなぐ・既存のマップとつなぐ・接続を消す、
 * ダイブ先・浮上先をつなぐ／作る。どれも両側の接続を 1 回の操作で変える（1 回の取り消しで戻る）。
 */
export class EdgeMenu {
  constructor(private readonly state: EditorState) {}

  /** 辺 `side` のメニューを (x, y) に出す。 */
  open(side: Side, x: number, y: number): void {
    const main = this.state.map;
    if (!main) return;
    const doc = main.doc;
    const conns = doc.connections ?? [];
    const has = (d: number) => conns.some((c) => c.direction === d);
    const name = (id: MapId) => `${id.bank}.${id.map} ${this.state.session?.catalog.get(id)?.name ?? ""}`.trim();
    const items: ContextMenuItem[] = [
      { id: "newMap", label: jaNeighbors.menuNewMap, run: () => void this.run(() => this.newMap(side, directionOf(side))) },
      { id: "connect", label: jaNeighbors.menuConnect, run: () => void this.run(() => this.connect(side, directionOf(side))) },
    ];
    conns.forEach((c, index) => {
      const s = sideOf(c.direction);
      const label = s === side ? jaNeighbors.menuRemove(name(c)) : c.direction === DIVE ? jaNeighbors.menuRemoveDive(name(c)) : c.direction === EMERGE ? jaNeighbors.menuRemoveEmerge(name(c)) : null;
      if (label) items.push({ id: `remove:${index}`, label, run: () => void this.run(() => this.remove(index)) });
    });
    items.push(
      { id: "diveNew", label: jaNeighbors.menuDiveNew, enabled: !has(DIVE), run: () => void this.run(() => this.newMap(side, DIVE)) },
      { id: "diveConnect", label: jaNeighbors.menuDiveConnect, enabled: !has(DIVE), run: () => void this.run(() => this.connect(side, DIVE)) },
      { id: "emergeNew", label: jaNeighbors.menuEmergeNew, enabled: !has(EMERGE), run: () => void this.run(() => this.newMap(side, EMERGE)) },
      { id: "emergeConnect", label: jaNeighbors.menuEmergeConnect, enabled: !has(EMERGE), run: () => void this.run(() => this.connect(side, EMERGE)) },
    );
    showContextMenu(x, y, items);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (e) {
      await showEditError(e);
    }
  }

  /** 辺のずれの計算に使う、相手のマップの大きさ（読めなければ null）。 */
  private async sizes(doc: MapDocument): Promise<(id: MapId) => MapSize | null> {
    const session = this.state.session!;
    const map = new Map<string, MapSize>();
    for (const c of doc.connections ?? []) {
      const d = await session.project.peek({ bank: c.bank, map: c.map });
      if (d) map.set(`${c.bank}.${c.map}`, { width: d.width, height: d.height });
    }
    return (id) => map.get(`${id.bank}.${id.map}`) ?? null;
  }

  /** 新しいマップを置くバンクを聞く（既定は今のマップのバンク。満杯なら新しいバンク）。キャンセルなら null。 */
  private async askSlot(): Promise<MapId | null> {
    const session = this.state.session!;
    const main = this.state.map!;
    const counts = session.project.bankCounts();
    const initial = (counts[main.id.bank] ?? MAX_MAPS_PER_BANK) < MAX_MAPS_PER_BANK ? main.id.bank : counts.length;
    const text = await inputDialog(jaNeighbors.bankTitle, jaNeighbors.bankPrompt(counts.length), String(initial));
    if (text === null) return null;
    const bank = Number(text.trim());
    if (!Number.isInteger(bank) || bank < 0 || bank > counts.length) {
      await showError(jaNeighbors.bankInvalid(counts.length));
      return null;
    }
    if (bank < counts.length && counts[bank]! >= MAX_MAPS_PER_BANK) {
      await showError(jaNeighbors.bankFull(bank));
      return null;
    }
    return { bank, map: bank < counts.length ? counts[bank]! : 0 };
  }

  /** 「新しいマップを作ってつなぐ」（ダイブ・浮上なら主マップと同じ大きさ、ずれ 0）。 */
  private async newMap(side: Side, direction: number): Promise<void> {
    const session = this.state.session;
    const main = this.state.map;
    if (!session || !main) return;
    const doc = main.doc;
    let offset = 0;
    let size: MapSize = { width: doc.width, height: doc.height };
    if (direction !== DIVE && direction !== EMERGE) {
      const slot = chooseSlot({ width: doc.width, height: doc.height, connections: doc.connections }, side, await this.sizes(doc));
      offset = slot.start;
      size = newConnectedMapSize(side, slot);
    }
    const target = await this.askSlot();
    if (!target) return;
    session.bus.execute(createConnectedMap(session.project.editorContext(), { from: main.id, target, direction, offset, width: size.width, height: size.height }));
    this.state.setStatus(jaNeighbors.created(target.bank, target.map, size.width, size.height));
  }

  /** 「既存のマップとつなぐ」（ずれは長さの差の半分で中央にそろえる。ダイブ・浮上は 0）。 */
  private async connect(side: Side, direction: number): Promise<void> {
    const session = this.state.session;
    const main = this.state.map;
    if (!session || !main) return;
    const dive = direction === DIVE || direction === EMERGE;
    const id = await pickMap(dive ? jaNeighbors.pickDiveTitle : jaNeighbors.pickTitle, jaNeighbors.pickPrompt, session.catalog.maps, main.id);
    if (!id || this.state.map !== main) return;
    const other = await session.project.load(id);
    const along = isVertical(direction) ? other.width : other.height;
    const offset = dive ? 0 : centeredOffset(edgeLength(main.doc, side), along);
    session.bus.execute(ConnectMapsCommand.of(main.id, direction, offset, id));
    this.state.setStatus(jaNeighbors.connected(id.bank, id.map, offset));
  }

  /** 「接続を消す」（相手の逆の接続も。確認つき）。 */
  private async remove(index: number): Promise<void> {
    const session = this.state.session;
    const main = this.state.map;
    const c = main?.doc.connections?.[index];
    if (!session || !main || !c) return;
    const id = { bank: c.bank, map: c.map };
    if (!(await askYesNo(jaNeighbors.confirmRemove(id.bank, id.map)))) return;
    // 相手のマップがあれば読み込んで、逆の接続も消す
    const partner = session.catalog.has(id) ? await session.project.load(id).then(() => id).catch(() => null) : null;
    session.bus.execute(DisconnectMapsCommand.of(main.id, index, partner));
    this.state.setStatus(jaNeighbors.removed(id.bank, id.map));
  }
}
