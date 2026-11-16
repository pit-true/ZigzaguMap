/// <reference lib="webworker" />
import { ImportError, planImport, prepareImportLayers, type ImportLayers, type ImportPlan, type ImportSource, type ImportTable, type ImportTarget } from "@zigzagumap/core";
import { importOptionsFromJson, type ImportOptionsJson } from "./importOptions";

/**
 * 取り込みの計画を、ウィザードの窓とは別の糸で作る Worker（Phase6 #444。512×512 の減色で 0.6 秒ほどかかるため、画面を止めない）。
 * 窓を閉じると WebView ごと消える。
 */

/** 窓 → Worker。 */
export interface PlanRequest {
  readonly seq: number;
  /** 画像（変わったときだけ送る。null なら前のものを使う）。 */
  readonly sources: readonly ImportSource[] | null;
  readonly transparent: number | null | undefined;
  readonly target: ImportTarget;
  readonly primary: ImportTable;
  readonly secondary: ImportTable;
  /** 一覧の並び（主の 640 個のあとに副）での使用回数。 */
  readonly counts: readonly number[];
  readonly otherSecondaryBlocks: readonly Uint16Array[];
  readonly options: ImportOptionsJson;
}

/** Worker → 窓。 */
export type PlanResponse =
  | { readonly seq: number; readonly ok: true; readonly layers: ImportLayers; readonly plan: ImportPlan }
  | { readonly seq: number; readonly ok: false; readonly error: string; readonly code: string | null };

let sources: readonly ImportSource[] = [];
const post = (m: PlanResponse): void => postMessage(m);

onmessage = (e: MessageEvent<PlanRequest>) => {
  const req = e.data;
  try {
    if (req.sources) sources = req.sources;
    const layers = prepareImportLayers(sources, req.transparent === undefined ? {} : { transparent: req.transparent });
    const plan = planImport({
      layers,
      target: req.target,
      primary: req.primary,
      secondary: req.secondary,
      blockUsed: (b) => req.counts[b] ?? 0,
      otherSecondaryBlocks: req.otherSecondaryBlocks,
      options: importOptionsFromJson(req.options),
    });
    post({ seq: req.seq, ok: true, layers, plan });
  } catch (err) {
    post({ seq: req.seq, ok: false, error: err instanceof Error ? err.message : String(err), code: err instanceof ImportError ? err.code : null });
  }
};
