import type { Command } from "../command/Command.js";
import { CommandGroup } from "../command/CommandGroup.js";
import type { DocumentContext } from "../command/DocumentContext.js";
import { SetLayoutCommand } from "../command/commands/layout/SetLayoutCommand.js";
import { SetTilesetsCommand } from "../command/commands/layout/SetTilesetsCommand.js";
import { AddTilesetCommand, addTilesetArgs } from "../command/commands/tileset/AddTilesetCommand.js";
import type { MapId } from "../map/types.js";
import { ROM_BASE } from "../rom/Rom.js";
import type { TransplantConversion } from "./TilesetConverter.js";
import type { SourceLayout } from "./TransplantSource.js";

/** 取り込みのコマンドの指定。 */
export interface TransplantPlan {
  /** 取り込み先のマップ（読み込んでおくこと）。 */
  readonly target: MapId;
  readonly conversion: TransplantConversion;
  /** 配置とボーダーも写すなら、元のマップの配置（conversion.cell でブロック番号を直す）。 */
  readonly layout: SourceLayout | null;
}

/**
 * 取り込みを 1 回の操作にする（#319 の Q10 の推奨: 新しいタイルセットとして加え、今のマップの組を付け替える。今のタイルセットは上書きしない）。
 * 1 回の取り消しで、加えたタイルセットも組の付け替えも配置も戻る。
 */
export function transplantCommand(context: DocumentContext, plan: TransplantPlan): Command {
  const { conversion, target, layout } = plan;
  const commands: Command[] = [];
  let skip = 0;
  let primary: number | undefined;
  let secondary: number | undefined;
  if (conversion.primary) {
    const at = context.newTilesetAddress(skip++);
    commands.push(new AddTilesetCommand(addTilesetArgs(at, conversion.primary)));
    primary = (ROM_BASE + at) >>> 0;
  }
  if (conversion.secondary) {
    const at = context.newTilesetAddress(skip++);
    commands.push(new AddTilesetCommand(addTilesetArgs(at, conversion.secondary)));
    secondary = (ROM_BASE + at) >>> 0;
  }
  const map = { bank: target.bank, map: target.map };
  if (layout) {
    commands.push(
      new SetLayoutCommand({
        ...map,
        width: layout.width,
        height: layout.height,
        cells: [...layout.blocks].map(conversion.cell),
        borderWidth: layout.borderWidth,
        borderHeight: layout.borderHeight,
        border: [...layout.border].map(conversion.cell),
        ...(primary === undefined ? {} : { primary }),
        ...(secondary === undefined ? {} : { secondary }),
      }),
    );
  } else {
    commands.push(new SetTilesetsCommand({ ...map, ...(primary === undefined ? {} : { primary }), ...(secondary === undefined ? {} : { secondary }) }));
  }
  return CommandGroup.of(commands);
}
