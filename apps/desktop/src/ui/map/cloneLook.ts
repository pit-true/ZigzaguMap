import { cloneTargetOf, type MapId, type PersonEvent } from "@zigzagumap/core";
import type { ProjectSession } from "../../app/ProjectSession";

/** クローンの元の人（#298）。`index` は元のマップでの人の番号（イベントタブの「人 N」）。元のマップを読んでいなければ null。 */
export interface CloneOrigin {
  readonly map: MapId;
  /** 参照先の人の番号（クローンの高さの欄。元の人の `localId`）。 */
  readonly localId: number;
  readonly index: number | null;
  readonly person: PersonEvent | null;
}

/**
 * 読み込みを頼んだ元のマップと、読めたら呼ぶ関数（セッションごと。読めないマップを何度も読みに行かない）。
 * 呼ぶ関数は同じものを 1 回だけ呼ぶので、描き直すたびに同じ関数を渡す。
 */
const requested = new WeakMap<ProjectSession, Map<string, Set<() => void>>>();

/**
 * クローン（種類 1 の人）の元の人を引く（#298）。クローンでなければ null。
 * 元のマップを読んでいなければ `person` は null にし、一覧にあるマップなら読み込みを頼む（読めたら `loaded` を呼ぶ）。
 */
export function cloneOrigin(session: ProjectSession | null, p: PersonEvent, loaded?: () => void): CloneOrigin | null {
  const target = cloneTargetOf(p);
  if (!target) return null;
  const map = { bank: target.bank, map: target.map };
  const doc = session?.project.loaded(map);
  if (doc) {
    const persons = doc.events?.persons ?? [];
    const index = persons.findIndex((q) => q.localId === target.localId);
    return { map, localId: target.localId, index: index >= 0 ? index : null, person: persons[index] ?? null };
  }
  if (session && loaded && session.catalog.has(map)) request(session, map, loaded);
  return { map, localId: target.localId, index: null, person: null };
}

/**
 * 人を描くときの画像番号（#298）。クローンなら元の人の画像番号（ゲームの中でもクローンは元の人の見た目になる）、
 * 元の人が分からなければクローン自身の欄の値。
 */
export function personGraphicsId(session: ProjectSession | null, p: PersonEvent, loaded?: () => void): number {
  return cloneOrigin(session, p, loaded)?.person?.graphicsId ?? p.graphicsId;
}

function request(session: ProjectSession, map: MapId, loaded: () => void): void {
  let maps = requested.get(session);
  if (!maps) requested.set(session, (maps = new Map()));
  const key = `${map.bank}.${map.map}`;
  const waiting = maps.get(key);
  if (waiting) {
    waiting.add(loaded);
    return;
  }
  const callbacks = new Set([loaded]);
  maps.set(key, callbacks);
  session.project.load(map).then(
    () => {
      for (const f of callbacks) f();
      callbacks.clear();
    },
    () => callbacks.clear(), // 読めないマップは、クローン自身の欄の値で描く（もう読みに行かない）
  );
}
