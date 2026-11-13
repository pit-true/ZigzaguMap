import type { TilesetDocument, TilesetRef } from "../../../tileset/TilesetDocument.js";
import type { JsonObject } from "../../Command.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { argBool, argInt, type Args } from "../../jsonArgs.js";
import { SnapshotCommand } from "./SnapshotCommand.js";

/** タイルセット 1 つを対象にするコマンドの引数（ヘッダーのポインタ値と、どちら側か）。 */
export type TilesetArgs = JsonObject & { tileset: number; secondary: boolean };

/** タイルセットの控えを取る部分。 */
export type TilesetPart = "header" | "tiles" | "palettes" | "blocks" | "attributes";

type TilesetSnapshot = Partial<Pick<TilesetDocument, "header" | "tiles" | "palettes" | "blocks" | "attributes">> & { compressed: boolean };

/** JSON の引数からタイルセットの指し方を読む。 */
export function argTileset(args: Args): { tileset: number; secondary: boolean } {
  return { tileset: argInt(args, "tileset") >>> 0, secondary: argBool(args, "secondary") };
}

/**
 * タイルセットを変えるコマンドの土台。`parts` に挙げた部分だけを控える（配列ごとコピー）。
 * 派生クラスは `edit(tileset)` を書く。配列は書き換えても差し替えてもよい。
 */
export abstract class TilesetCommand<A extends TilesetArgs> extends SnapshotCommand<A, TilesetSnapshot> {
  /** 控える部分。 */
  protected abstract readonly parts: readonly TilesetPart[];

  /** 対象のタイルセット。 */
  get ref(): TilesetRef {
    return { pointer: this.args.tileset, secondary: this.args.secondary };
  }

  protected capture(context: DocumentContext): TilesetSnapshot {
    const t = context.tileset(this.ref);
    const saved: TilesetSnapshot = { compressed: t.compressed };
    for (const part of this.parts) (saved as Record<TilesetPart, unknown>)[part] = t[part].slice();
    return saved;
  }

  protected apply(context: DocumentContext): void {
    this.edit(context.tileset(this.ref));
  }

  protected restore(context: DocumentContext, saved: TilesetSnapshot): void {
    const t = context.tileset(this.ref);
    t.compressed = saved.compressed;
    for (const part of this.parts) {
      const value = saved[part] as Uint8Array | Uint16Array | Uint32Array;
      const current = t[part] as Uint8Array | Uint16Array | Uint32Array;
      // 長さが同じなら同じ配列に書き戻す（描画側が持っている参照を保つ）。
      if (current.length === value.length) current.set(value as never);
      else (t as unknown as Record<TilesetPart, unknown>)[part] = value.slice();
    }
  }

  /** 変える（入力の確認を先に行う）。 */
  protected abstract edit(tileset: TilesetDocument): void;
}
