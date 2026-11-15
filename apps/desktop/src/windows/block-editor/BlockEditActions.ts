import { BLOCK_TILE_COUNT, THIRD_LAYER_TILE_COUNT, isTripleLayer } from "@zigzagumap/core";
import { jaBlockTools as tt } from "../../i18n/ja.blockTools";
import { askYesNo, messageBox, showError } from "../../ui/MessageBox";
import { errorText } from "../../util/errors";
import type { ToolClient } from "../ToolClient";
import type { TilesetModel } from "../TilesetModel";

/** コピーしたブロック（8 タイルと属性。3 層なら 3 層目の 4 タイルも）。 */
export interface CopiedBlock {
  readonly tiles: readonly number[];
  readonly attribute: number;
  readonly third: readonly number[] | null;
}

/** 編集の操作が使う窓口（ブロックエディタの窓）。 */
export interface BlockEditActionsHost {
  readonly client: ToolClient;
  readonly model: TilesetModel;
  /** 選んでいるブロック（3 層の次の番号を押したときは親。選んでいなければ null）。 */
  readonly block: number | null;
  /** 選んでいるブロックの、手元で編集中の中身（画面に見えているもの）。 */
  current(): CopiedBlock | null;
  /** 窓の下の案内。 */
  status(message: string): void;
}

/**
 * ブロックエディタの 編集 メニュー（#394）: ブロックのコピー・切り取り・貼り付けと、ブロックの入れ替え。
 *
 * - コピーは手元で編集中の中身（見えているもの）を窓の中に持つ。別のマップへ切り替えて、別のタイルセットへも貼れる（タイル番号はそのまま）。
 * - 切り取りは、コピーしてから選んでいるブロックを空（タイル 0、属性 0）にする。3 層のブロックは次の番号（3 層目）も空にする。
 * - 貼り付けは、選んでいるブロックへすぐ確定する（メインの履歴に 1 回で入る）。3 層のブロックは次の番号の下層に 3 層目を書く。
 * - 入れ替えは、オンにしてから 2 つのブロックを順に押す。そのタイルセットを使うマップの数を出して、番号も付け替えるかを聞く。
 */
export class BlockEditActions {
  private clipboard: CopiedBlock | null = null;
  /** 入れ替えのオン・オフと、1 つ目に押したブロック。 */
  private swapFirst: number | null = null;
  private swapping = false;

  constructor(private readonly host: BlockEditActionsHost) {}

  /** 入れ替えがオンか。 */
  get swapActive(): boolean {
    return this.swapping;
  }

  /** 自動操作の `state` に出す値。 */
  describe(): unknown {
    return { clipboard: this.clipboard, swap: { active: this.swapping, first: this.swapFirst } };
  }

  copy(): void {
    const c = this.host.current();
    if (!c || this.host.block === null) return;
    this.clipboard = { tiles: [...c.tiles], attribute: c.attribute, third: c.third ? [...c.third] : null };
    this.host.status(tt.copied(this.host.block));
  }

  async cut(): Promise<void> {
    const block = this.host.block;
    if (block === null) return;
    const owner = this.host.model.owner(block);
    if (!owner) return;
    this.copy();
    const base = { tileset: owner.data.pointer, secondary: owner.data.secondary };
    const empty = new Array<number>(BLOCK_TILE_COUNT).fill(0);
    const commands = [{ name: "setBlock", args: { ...base, block: owner.local, tiles: empty, attribute: 0 } }];
    // 3 層なら次の番号（3 層目に使っていた）も空にする
    if (isTripleLayer(this.host.model.attribute(block)) && this.sameTable(block)) {
      commands.push({ name: "setBlock", args: { ...base, block: owner.local + 1, tiles: empty, attribute: 0 } });
    }
    await this.run(commands);
    this.host.status(tt.cutDone(block));
  }

  async paste(): Promise<void> {
    const block = this.host.block;
    const c = this.clipboard;
    if (block === null || !c) return;
    const owner = this.host.model.owner(block);
    if (!owner) return;
    const base = { tileset: owner.data.pointer, secondary: owner.data.secondary, block: owner.local, tiles: [...c.tiles], attribute: c.attribute };
    if (isTripleLayer(c.attribute) && c.third) {
      if (!this.sameTable(block)) {
        await showError(tt.pasteTripleNoNext);
        return;
      }
      if (isTripleLayer(this.host.model.attribute(block + 1))) {
        await showError(tt.pasteTripleNextIsTriple(block + 1));
        return;
      }
      if (this.nextHasData(block) && !(await askYesNo(tt.pasteTripleCleanup(block + 1)))) return;
      await this.run([{ name: "setTripleLayer", args: { ...base, third: [...c.third] } }]);
    } else {
      // 3 層の属性で 3 層目が無いコピーは無い（コピーは 3 層なら必ず 3 層目を持つ）
      await this.run([{ name: "setBlock", args: base }]);
    }
    this.host.status(tt.pasted(block));
  }

  /** 入れ替えのオン・オフ。 */
  toggleSwap(): void {
    this.swapping = !this.swapping;
    this.swapFirst = null;
    this.host.status(this.swapping ? tt.swapStart : tt.swapOff);
  }

  /** ブロック一覧で押した（入れ替えがオンのときだけ呼ぶ。3 層の次の番号は親にしてから渡す）。 */
  async pick(block: number): Promise<void> {
    if (this.swapFirst === null) {
      this.swapFirst = block;
      this.host.status(tt.swapSecond(block));
      return;
    }
    const a = this.swapFirst;
    this.swapFirst = null;
    if (a === block) {
      this.host.status(tt.swapStart);
      return;
    }
    const oa = this.host.model.owner(a);
    const ob = this.host.model.owner(block);
    if (!oa || !ob) return;
    if (oa.data.secondary !== ob.data.secondary) {
      await showError(tt.swapOtherTileset);
      this.host.status(tt.swapStart);
      return;
    }
    const ref = { tileset: oa.data.pointer, secondary: oa.data.secondary };
    try {
      const users = (await this.host.client.request({ op: "tilesetUsers", ...ref })) as { maps: unknown[] };
      const answer = await messageBox(tt.swapTitle, tt.swapConfirm(a, block, users.maps.length, !ref.secondary), "question", "yesNoCancel");
      if (answer === "cancel") {
        this.host.status(tt.swapStart);
        return;
      }
      const r = (await this.host.client.request({ op: "swapBlocks", ...ref, a: oa.local, b: ob.local, remap: answer === "yes" })) as { maps: number; ms: number };
      this.host.status(tt.swapped(a, block, r.maps));
    } catch (e) {
      await showError(errorText(e));
      this.host.status(tt.swapStart);
    }
  }

  /** `block + 1` が同じタイルセットにあるか（3 層目に使える）。 */
  private sameTable(block: number): boolean {
    const m = this.host.model;
    return m.owner(block + 1)?.data === m.owner(block)?.data;
  }

  /** N+1 に、3 層にすると消える値（属性か上層）があるか。 */
  private nextHasData(block: number): boolean {
    const m = this.host.model;
    const next = m.blockTiles(block + 1);
    return m.attribute(block + 1) !== 0 || (next?.slice(THIRD_LAYER_TILE_COUNT).some((v) => v !== 0) ?? false);
  }

  private async run(commands: { name: string; args: Record<string, unknown> }[]): Promise<void> {
    try {
      if (commands.length === 1) await this.host.client.execute(commands[0]!.name, commands[0]!.args);
      else await this.host.client.execute("group", { commands });
    } catch (e) {
      await showError(errorText(e));
    }
  }
}

