import { CloneSyncCommand, ConnectionDirection, mapTargets, type CloneChange, type MapId } from "@zigzagumap/core";
import { jaClone as t } from "../i18n/ja.clone";
import type { EditorState } from "./EditorState";

/**
 * クローンの自動作成（#242）で合わせる隣のマップ（上下左右の接続の相手で、一覧にあるもの）。表示 > クローン（設定 `showClones`）が
 * オフか、隣が無ければ null。相手のマップは読み込んでおく（クローンを書くため）。
 */
export async function cloneTargets(state: EditorState, id: MapId): Promise<MapId[] | null> {
  const session = state.session;
  if (!session || !state.settings.data.showClones) return null;
  const doc = session.project.loaded(id);
  if (!doc) return null;
  const out: MapId[] = [];
  for (const c of doc.connections ?? []) {
    if (c.direction < ConnectionDirection.Down || c.direction > ConnectionDirection.Right) continue;
    const target = { bank: c.bank, map: c.map };
    if (!session.catalog.has(target) || out.some((o) => o.bank === target.bank && o.map === target.map)) continue;
    try {
      await session.project.load(target);
      out.push(target);
    } catch {
      // 読めない相手は飛ばす
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * 人を置く・動かす・消す・欄を変えるコマンドといっしょに実行する「クローンを合わせる」コマンド（#242）。
 * 合わせる相手が無い（設定がオフ、隣が無い）ときは null。どの操作からもこれを使い、同じ規則で合わせる。
 */
export async function cloneSyncFor(state: EditorState, id: MapId): Promise<CloneSyncCommand | null> {
  const targets = await cloneTargets(state, id);
  return targets ? new CloneSyncCommand({ ...id, targets: mapTargets(targets) }) : null;
}

/** 人の欄のうち、クローンに写すもの（位置・見た目・フラグ）と、クローンかどうか・番号を変えるもの。 */
const CLONE_FIELDS = new Set(["x", "y", "graphicsId", "flag", "localId", "kind"]);

/** 人の欄の変更がクローンに関わるか。 */
export function touchesClones(fields: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(fields).some((k) => CLONE_FIELDS.has(k));
}

/** 変えたことをステータスバーで知らせる（何も変えていなければ知らせない）。 */
export function reportClones(state: EditorState, changes: readonly CloneChange[]): void {
  const last = changes.at(-1);
  if (!last) return;
  const text = last.action === "add" ? t.added : last.action === "move" ? t.moved : t.removed;
  state.setStatusInfo(text(last.map.bank, last.map.map));
}
