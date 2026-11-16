import {
  PRIMARY_BLOCK_COUNT,
  decodeRgbaPng,
  encodeBase64,
  importStamp,
  prepareImport,
  prepareImportLayers,
  type BlockUsage,
  type CfruProject,
  type ImportPlan,
  type ImportTarget,
} from "@zigzagumap/core";
import type { App } from "../../app/App";
import { MapTab } from "../../ui/tabs/MapTab";
import { tilesetPairs } from "../block-editor/blockSwapHost";
import { importOptionsFromJson, planSummary, targetOf, type ImportOptionsJson, type ImportTargetName, type PlanSummary } from "./importOptions";

/** 取り込みの頼み（画像は PNG のバイト列）。 */
export interface TileImportRequest {
  readonly images: readonly Uint8Array[];
  readonly target: ImportTargetName;
  /** 透明色（BGR555）。省略で 1 枚目の左上、null で使わない。 */
  readonly transparent?: number | null;
  readonly options?: ImportOptionsJson;
  /** スタンプの名前（空か省略で作らない）。 */
  readonly stamp?: string | null;
}

/** 取り込みの結果。 */
export interface TileImportOutcome {
  /** 書き込んだか（計画に問題があれば false で、何も変えない）。 */
  readonly done: boolean;
  readonly plan: PlanSummary;
  /** 書いたタイルセットのポインタ値。 */
  readonly pointer: number | null;
  /** 作ったスタンプの名前。 */
  readonly stamp: string | null;
  /** 読み込みから書き込みまでの時間（ミリ秒）。 */
  readonly ms: number;
}

/** 計画に要る、メインだけが持つもの（ブロックの使用回数と、同じ主を使うほかの組の副のブロック）。 */
export interface ImportContextData {
  /** 一覧の並び（主の 640 個のあとに副）での使用回数。 */
  readonly counts: number[];
  /** 同じ主を使うほかの組の副のブロック（u16 リトルエンディアンの base64）。 */
  readonly otherSecondaryBlocks: string[];
}

async function otherSecondaries(project: CfruProject, primary: number, secondary: number): Promise<Uint16Array[]> {
  const others = new Set<number>();
  for (const pair of await tilesetPairs(project)) if (pair.primary === primary >>> 0 && pair.secondary !== secondary >>> 0) others.add(pair.secondary);
  const out: Uint16Array[] = [];
  for (const pointer of others) {
    try {
      out.push((await project.peekTileset({ pointer, secondary: true })).blocks);
    } catch {
      // 読めない副タイルセットは数えない
    }
  }
  return out;
}

/** ウィザードの窓が計画を作るための材料（頼み `importContext`）。 */
export async function importContextData(project: CfruProject, usage: BlockUsage, primary: number, secondary: number): Promise<ImportContextData> {
  const counts = new Array<number>(PRIMARY_BLOCK_COUNT + 384).fill(0);
  for (let b = 0; b < counts.length; b++) counts[b] = usage.count(b, primary, secondary);
  const others = await otherSecondaries(project, primary, secondary);
  return { counts, otherSecondaryBlocks: others.map((b) => encodeBase64(new Uint8Array(b.buffer, b.byteOffset, b.byteLength).slice())) };
}

/**
 * 画像からタイルとブロックを作る（Phase6 #443）のメインのウィンドウ側。ToolWindowHost と自動操作の `tileset.importImage` が
 * 初めて使うときに読み込む。表示中のマップの組で計画を作り直し（窓の写しが古くても今の中身に書く）、書けるなら 1 回のコマンドで
 * 書く。書いた後は最初のブロックを選び（最近使ったブロックにも入る）、選べば画像の並びのスタンプを作る。
 */
export async function runTileImport(app: App, req: TileImportRequest): Promise<TileImportOutcome> {
  const t0 = performance.now();
  const session = app.state.session;
  const map = app.state.map;
  if (!session || !map) throw new Error("マップが開かれていません");
  const project = session.project;
  const context = project.editorContext();
  const doc = context.document(map.doc.id);
  const primaryPointer = doc.primaryTileset >>> 0;
  const secondaryPointer = doc.secondaryTileset >>> 0;
  const target: ImportTarget = targetOf(req.target);
  const layers = prepareImportLayers(
    req.images.map((png) => decodeRgbaPng(png)),
    req.transparent === undefined ? {} : { transparent: req.transparent },
  );
  const usage = target.isNew ? null : await app.extras.blockUsage.build();
  const others = target.isNew || target.secondary ? [] : await otherSecondaries(project, primaryPointer, secondaryPointer);
  const ctx = {
    map: doc.id,
    primary: context.tileset({ pointer: primaryPointer, secondary: false }),
    secondary: context.tileset({ pointer: secondaryPointer, secondary: true }),
  };
  const { plan, result } = prepareImport(context, ctx, {
    layers,
    target,
    options: importOptionsFromJson(req.options ?? {}),
    ...(usage ? { blockUsed: (b: number) => usage.count(b, primaryPointer, secondaryPointer) } : {}),
    otherSecondaryBlocks: others,
  });
  if (!result) return { done: false, plan: planSummary(plan), pointer: null, stamp: null, ms: Math.round(performance.now() - t0) };
  session.bus.execute(result.command);
  if (plan.firstBlock !== null) app.state.select({ width: 1, height: 1, blocks: [plan.firstBlock] });
  const stamp = req.stamp ? await saveStamp(app, req.stamp, plan, result.primaryPointer, result.secondaryPointer) : null;
  return { done: true, plan: planSummary(plan), pointer: result.pointer, stamp, ms: Math.round(performance.now() - t0) };
}

/** スタンプを作る（同じ名前があれば「名前 (2)」のように番号を付ける）。 */
async function saveStamp(app: App, name: string, plan: ImportPlan, primary: number, secondary: number): Promise<string | null> {
  const lib = await app.state.session!.stamps();
  let unique = name.trim();
  for (let n = 2; lib.get(unique); n++) unique = `${name.trim()} (${n})`;
  const stamp = importStamp(unique, plan, { primary, secondary });
  if (!stamp) return null;
  await lib.save(stamp);
  const tab = (app.tabs as unknown as Record<string, unknown>)["map"];
  if (tab instanceof MapTab) await tab.stamps.refresh();
  return unique;
}
