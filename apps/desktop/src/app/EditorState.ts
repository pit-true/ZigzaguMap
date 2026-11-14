import { MapHistory } from "./MapHistory";
import type { MapId } from "@zigzagumap/core";
import type { MapImage } from "../ui/map/MapImage";
import type { OpenMap, ProjectSession } from "./ProjectSession";
import type { Settings } from "./Settings";

/** タブ。 */
export type TabId = "map" | "movement" | "event" | "wild" | "header";

/** タブの並び。 */
export const TAB_ORDER: readonly TabId[] = ["map", "movement", "event", "wild", "header"];

/** 選択中のブロック（1×1 か、複数ブロックのスタンプ）。`blocks` は左上から横へ並べた番号。 */
export interface BlockSelection {
  readonly width: number;
  readonly height: number;
  readonly blocks: readonly number[];
}

/** ステータスバーの 2 欄。 */
export interface StatusText {
  readonly left: string;
  readonly right: string;
  readonly error: boolean;
}

/**
 * 状態の変化の種類。
 * - session: ROM・プロジェクトを開いた／閉じた
 * - map: 表示するマップが変わった
 * - cells: 表示中のマップの配置・ボーダーが変わった（操作・アンドゥ）
 * - tiles: 表示中のマップのタイルセット（ブロック・タイル・パレット）が変わった（ブロックエディタ）
 * - tab / selection / movement / view: タブ、選択中のブロック、選択中の移動許可、表示設定
 * - stamp: Ctrl＋右ドラッグで矩形を選んだ（Grosser Block ウィンドウを出す）
 * - dirty: 未出力の印が変わった
 * - status: ステータスバー
 * - recent: 最近開いたもの
 * - opacity: 移動エリアの透明度（スライダーを動かしている間も出る）
 */
export type StateTopic =
  | "session"
  | "map"
  | "cells"
  | "tiles"
  | "tab"
  | "selection"
  | "stamp"
  | "movement"
  | "view"
  | "dirty"
  | "status"
  | "recent"
  | "opacity"
  /** 表示中でないマップが操作で変わった（`changedMaps` に一覧。隣の帯の描き直し用） */
  | "otherMaps"
  /** 隣のマップの帯を作り直した（NeighborService.frame） */
  | "neighbors";

type Listener = () => void;

/**
 * 画面全体の状態。画面の部品はここから読んで描き、変化は `on` で受け取る。
 * 状態を変えるのは App とアクション（操作コマンドは ProjectSession.bus を通す）。
 */
export class EditorState {
  session: ProjectSession | null = null;
  map: OpenMap | null = null;
  /** 表示中のマップのブロック画像（各タブで共有する）。 */
  mapImage: MapImage | null = null;
  tab: TabId = "map";
  selection: BlockSelection = { width: 1, height: 1, blocks: [0] };
  movement = 0;
  status: StatusText;
  /** 開いたマップの履歴（#237。戻る・進む。以前開いたマップを開くも戻るになった）。 */
  readonly history = new MapHistory();
  /** 未出力のマップ（"バンク.マップ"）。 */
  dirty = new Set<string>();
  /** 直前の操作で変わった、表示中でないマップ（"otherMaps" の知らせのとき）。 */
  changedMaps: readonly MapId[] = [];
  private readonly listeners = new Map<StateTopic, Set<Listener>>();

  /** 1 つ前に開いていたマップ（戻る先。無ければ null）。 */
  get previousMap(): MapId | null {
    return this.history.previous;
  }

  constructor(
    readonly settings: Settings,
    initialStatus: string,
  ) {
    this.status = { left: initialStatus, right: "", error: false };
  }

  /** 変化を購読する。戻り値で解除。 */
  on(topic: StateTopic, listener: Listener): () => void {
    let set = this.listeners.get(topic);
    if (!set) this.listeners.set(topic, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  /** 変化を知らせる。 */
  emit(topic: StateTopic): void {
    for (const l of this.listeners.get(topic) ?? []) l();
  }

  /** ステータスバーの左欄（と、指定があれば右欄）を変える。 */
  setStatus(left: string, right?: string, error = false): void {
    this.status = { left, right: right ?? this.status.right, error };
    this.emit("status");
  }

  /** ステータスバーの右欄だけを変える。 */
  setStatusRight(right: string): void {
    this.status = { ...this.status, right };
    this.emit("status");
  }

  /** 選択中のブロックを変える。 */
  select(selection: BlockSelection): void {
    this.selection = selection;
    this.emit("selection");
  }

  /** Ctrl＋右ドラッグで選んだ矩形（スタンプ）を選ぶ。 */
  selectStamp(selection: BlockSelection): void {
    this.select(selection);
    this.emit("stamp");
  }

  /** 選択中のブロックを 1 つにする。 */
  selectBlock(block: number): void {
    this.select({ width: 1, height: 1, blocks: [block] });
  }

  /** 選択中の移動許可を変える。 */
  selectMovement(value: number): void {
    this.movement = value;
    this.emit("movement");
  }

  /** タブを切り替える。 */
  setTab(tab: TabId): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.emit("tab");
  }

  /** そのマップが未出力か。 */
  isDirty(id: MapId): boolean {
    return this.dirty.has(`${id.bank}.${id.map}`);
  }
}
