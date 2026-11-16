import {
  isNightSection,
  isTintedMapType,
  litTilesFor,
  readDnsConfig,
  spritePaletteTint,
  tilesetPairPalettes,
  tintOf,
  tintTilesetPalettes,
  type DnsConfig,
  type DnsConfigResult,
  type PaletteTint,
  type ProjectFs,
  type TimeOfDay,
} from "@zigzagumap/core";
import type { ActiveTint } from "./activeTint";

/**
 * 時間帯の色の部品（Phase6 #434）。`TimeOfDayView` が、初めて昼以外にしたときに動的 import で読み込む
 * （core の dns の部品もこのとき初めて読み込まれる）。
 */

/** プロジェクトフォルダから設定を読む。 */
export function loadDnsConfig(fs: ProjectFs): Promise<DnsConfigResult> {
  return readDnsConfig(fs);
}

/** 時間帯の色（`activeTint` に入れるもの）。人物の絵に使う OBJ の関数 `sprite` も持つ（#435）。 */
export interface DnsActiveTint extends ActiveTint {
  readonly sprite: PaletteTint;
  readonly fade: { readonly color: number; readonly amount: number; readonly halve: boolean };
}

/** 区分 `time` の色を作る。 */
export function makeActiveTint(config: DnsConfig, time: TimeOfDay, generation: number): DnsActiveTint {
  const tint = tintOf(config, time);
  const night = isNightSection(config, time);
  return {
    generation,
    tintsMapType: isTintedMapType,
    palettes: (primaryPointer, secondaryPointer, primary, secondary) =>
      tintTilesetPalettes(
        tilesetPairPalettes(primary.palettes, secondary.palettes),
        tint,
        config.bgPalettes,
        night ? litTilesFor(config, primaryPointer, secondaryPointer) : [],
      ),
    sprite: spritePaletteTint(config, tint),
    fade: { color: tint.fade.color, amount: tint.fade.amount, halve: tint.halveCoefficient !== null && tint.fade.amount === tint.halveCoefficient },
  };
}
