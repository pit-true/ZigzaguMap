import type { EditorContext } from "../command/Command.js";
import type { RegionMapDocument } from "./RegionMapDocument.js";

/** タウンマップを編集するコマンドが使う入口。 */
export interface RegionMapContext extends EditorContext {
  /** 編集中のタウンマップ。読み込んでいなければ Error。 */
  regionMap(): RegionMapDocument;
}

/** EditorContext が RegionMapContext か。 */
export function isRegionMapContext(context: EditorContext): context is RegionMapContext {
  return typeof (context as Partial<RegionMapContext>).regionMap === "function";
}

/** EditorContext を RegionMapContext として使う。違えば Error。 */
export function regionMapContext(context: EditorContext): RegionMapContext {
  if (!isRegionMapContext(context)) throw new Error("このコマンドにはタウンマップ（regionMap()）が必要です");
  return context;
}

/**
 * 既存の入口（DocumentStore など）に `regionMap()` を足したものを作る。ほかの呼び出しはそのまま元へ渡す。
 * `get` はコマンドを実行するときに呼ばれる（タウンマップを開くまでは読まないため）。
 */
export function withRegionMap<T extends EditorContext>(base: T, get: () => RegionMapDocument): T & RegionMapContext {
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "regionMap") return get;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
    has(target, prop) {
      return prop === "regionMap" || Reflect.has(target, prop);
    },
  }) as T & RegionMapContext;
}
