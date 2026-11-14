import { affectedMaps, flattenCommandRecords, type Command, type CommandEvent, type MapId } from "@zigzagumap/core";
import { tilesetRefsOf } from "../windows/tilesetRefs";
import type { EditorState } from "./EditorState";

/** 未出力の印を確かめるまでの待ち時間（ドラッグ中に何度も調べないため）。 */
const DIRTY_CHECK_DELAY = 150;

/** ChangeTracker が呼ぶ App の操作。 */
export interface ChangeHost {
  readonly state: EditorState;
  openMap(id: MapId): Promise<void>;
  /** マップ一覧を作り直す。 */
  refreshMapList(): Promise<void>;
}

/** 操作のあとの後始末。表示中のマップの描き直し、マップ一覧の作り直し、未出力の印の付け直しを受け持つ。 */
export class ChangeTracker {
  private dirtyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingDirty = new Map<string, MapId>();

  constructor(private readonly host: ChangeHost) {}

  /** 操作の後: 表示中のマップなら描き直し、未出力の印を確かめる予約をする。 */
  onCommand(e: CommandEvent): void {
    const state = this.host.state;
    if (e.command && changesMapList(e.command)) void this.afterMapListChange();
    // 名前表を書き換えたら（取り消し・やり直しも）、AdvanceMap と同じく一覧の名前も変える
    else if (e.command && commandNames(e.command).includes(SET_MAP_NAME)) void this.host.refreshMapList();
    if (this.onTilesetCommand(e)) return;
    // 変わったマップ（group の中と targets も見る。2 枚のマップにまたがる操作でも両方に印を付ける）
    const ids = affectedMaps(e.command);
    if (ids.length === 0) return;
    const current = state.map;
    const others: MapId[] = [];
    for (const id of ids) {
      if (current && current.id.bank === id.bank && current.id.map === id.map) {
        const doc = current.doc;
        // 大きさ・タイルセットが変わったら（場所の設定タブなど）マップを読み直す。
        if (doc.grid !== state.mapImage?.grid || current.tiles.key !== `${doc.primaryTileset >>> 0}:${doc.secondaryTileset >>> 0}`) {
          void this.host.openMap(id);
        } else {
          state.mapImage?.update();
          state.emit("cells");
        }
      } else others.push(id);
      this.pendingDirty.set(`${id.bank}.${id.map}`, id);
    }
    // 表示中でないマップが変わったことを知らせる（隣の帯の描き直し用）
    if (others.length > 0) {
      state.changedMaps = others;
      state.emit("otherMaps");
    }
    if (this.dirtyTimer) clearTimeout(this.dirtyTimer);
    this.dirtyTimer = setTimeout(() => this.checkDirty(), DIRTY_CHECK_DELAY);
  }

  /** タイルセットを変える操作なら、それを使う組を作り直して描き直す（ブロックエディタの保存など）。 */
  private onTilesetCommand(e: CommandEvent): boolean {
    const state = this.host.state;
    const refs = tilesetRefsOf(e.command);
    if (refs.length === 0) return false;
    const changed = refs.flatMap((ref) => state.session?.refreshTilesets(ref) ?? []);
    if (state.map && changed.includes(state.map.tiles)) {
      state.mapImage?.redrawAll();
      state.emit("cells");
      state.emit("tiles");
    }
    return true;
  }

  /** 未出力の印を付け直す。 */
  checkDirty(all = false): void {
    const state = this.host.state;
    if (this.dirtyTimer) clearTimeout(this.dirtyTimer);
    this.dirtyTimer = null;
    const session = state.session;
    if (!session) return;
    const ids = all ? session.modifiedMaps() : [...this.pendingDirty.values()];
    if (all) state.dirty = new Set(ids.map((id) => `${id.bank}.${id.map}`));
    else {
      for (const id of ids) {
        const key = `${id.bank}.${id.map}`;
        if (session.isModified(id)) state.dirty.add(key);
        else state.dirty.delete(key);
      }
    }
    this.pendingDirty.clear();
    state.emit("dirty");
  }

  /** マップの追加・作業用のマップの作成を取り消したら、表示中のマップが無くなっていれば前のマップへ戻る。一覧も作り直す。 */
  private async afterMapListChange(): Promise<void> {
    const state = this.host.state;
    const session = state.session;
    const current = state.map;
    if (session && current && session.project.loaded(current.id) !== current.doc) {
      const back = state.previousMap;
      if (back && session.project.loaded(back)) await this.host.openMap(back);
      else {
        state.map = null;
        state.mapImage = null;
        state.emit("map");
      }
    }
    await this.host.refreshMapList();
  }
}

const SET_MAP_NAME = "setMapName";
/** マップ一覧が変わるコマンド（マップ・バンクの追加、中身の差し替え、作業用のマップ）。 */
const MAP_LIST_COMMANDS = new Set(["createMap", "insertMap", "replaceMap", "createWorkMap", "openMapFile"]);

/** コマンドとその中のコマンド（まとめたもの）の名前。 */
function commandNames(command: Command): string[] {
  return flattenCommandRecords(command).map((r) => r.name);
}

function changesMapList(command: Command): boolean {
  return commandNames(command).some((name) => MAP_LIST_COMMANDS.has(name));
}
