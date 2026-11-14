import type { EditorState } from "../../app/EditorState";
import { MovementPainter, movementName } from "../../input/MovementPainter";
import { ja } from "../../i18n/ja";
import { MapView } from "../map/MapView";
import { MovementLayer } from "../map/MovementLayer";
import { MovementPaletteView } from "../map/MovementPaletteView";

/** 移動エリアタブ（左にマップと移動許可の重ね描き、右に値のパレット）。 */
export class MovementTab {
  readonly element: HTMLElement;
  readonly view: MapView;
  private readonly layer: MovementLayer;
  private readonly palette: MovementPaletteView;

  constructor(private readonly state: EditorState) {
    this.element = document.createElement("div");
    this.element.className = "movement-tab";
    this.view = new MapView("movement-tab-view");
    this.layer = new MovementLayer(this.view.layer);
    new MovementPainter(this.view, state, () => this.palette.showSelection(state.movement, true));
    this.palette = new MovementPaletteView({
      select: (value) => {
        state.selectMovement(value);
        state.setStatus(ja.statusMovementPalette(value, movementName(value)));
      },
      hover: (value) => {
        if (value !== null) state.setStatus(ja.statusMovementPalette(value, movementName(value)));
      },
    });
    this.element.append(this.view.element, this.palette.element);

    state.on("map", () => {
      this.view.setImage(state.mapImage);
      this.resetLayer();
    });
    state.on("cells", () => {
      this.view.sync();
      this.layer.update();
    });
    state.on("movement", () => this.palette.showSelection(state.movement, false));
    state.on("view", () => this.configure());
    state.on("opacity", () => this.resetLayer());
    this.configure();
    this.palette.showSelection(state.movement, false);
  }

  private configure(): void {
    const s = this.state.settings.data;
    this.view.configure(s.zoomMovement ? 2 : 1, s.grid);
    this.palette.configure(s.zoomMovementPalette ? 2 : 1);
    this.resetLayer();
  }

  private resetLayer(): void {
    this.layer.reset(this.state.map?.doc.grid ?? null, this.view.cellSize, this.state.settings.data.movementOpacity);
  }
}
