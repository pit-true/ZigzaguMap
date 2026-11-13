import {
  CommandBus,
  GridStore,
  MapLoader,
  MapRenderer,
  Rom,
  requireSupportedGame,
  type GameInfo,
  type LoadedMap,
  type MapId,
  type RgbaImage,
} from "@zigzagumap/core";

/** 開いている ROM と編集中の状態。画面の操作は `bus` を通す。 */
export class EditorState {
  readonly game: GameInfo;
  readonly loader: MapLoader;
  readonly grids: GridStore;
  readonly bus: CommandBus;
  private current: { map: LoadedMap; renderer: MapRenderer } | null = null;

  constructor(bytes: Uint8Array) {
    const rom = new Rom(bytes);
    const game = requireSupportedGame(rom);
    this.game = game;
    this.loader = new MapLoader(rom, game.offsets);
    this.grids = new GridStore(this.loader);
    this.bus = new CommandBus(this.grids);
  }

  /** マップの総数。 */
  get mapCount(): number {
    let count = 0;
    for (let bank = 0; bank < this.loader.bankTable.bankCount; bank++) count += this.loader.bankTable.mapCount(bank);
    return count;
  }

  /** 表示中のマップ。 */
  get currentMap(): LoadedMap | null {
    return this.current?.map ?? null;
  }

  /** マップを選ぶ。 */
  select(id: MapId): LoadedMap {
    const map = this.loader.load(id);
    this.current = { map, renderer: new MapRenderer(map) };
    return map;
  }

  /** 表示中のマップを、編集中の配置で描く。 */
  render(): RgbaImage | null {
    if (!this.current) return null;
    return this.current.renderer.render(this.grids.grid(this.current.map.id).cells);
  }
}
