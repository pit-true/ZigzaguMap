import {
  EMPTY_TOWN_LINKS,
  loadTownMapConfig,
  readTownLinks,
  saveTownMapConfig,
  writeTownLinks,
  type TownLinks,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import type { ProjectSession } from "../../app/ProjectSession";

/** 紐づけの保存先（`project` = プロジェクトの zigzagumap.json、`personal` = 個人設定の ROM ごとの値）。 */
export type TownLinkPlace = "project" | "personal";

/**
 * タウンマップの小窓の紐づけ（#386）の読み書き。プロジェクトフォルダを開いていれば `zigzagumap.json` の `"townMap"` の節、
 * ROM だけなら個人設定の `townLinks`（ROM の小文字のパスが鍵）。形式の読み書きは core の TownMapConfig だけで行う。
 * 変えたらすぐ保存する（取り消しの対象にせず、未出力の印も付けない。ROM・maps\regionmap.json には書かない）。
 */
export class TownLinkStore {
  private value: TownLinks = EMPTY_TOWN_LINKS;
  private loadedFor: ProjectSession | null = null;
  private loading: Promise<void> | null = null;
  /** zigzagumap.json を読めなかったときの理由（読めなければ書かない。ファイルを壊さない）。 */
  error: string | null = null;

  constructor(private readonly state: EditorState) {
    state.on("session", () => {
      this.value = EMPTY_TOWN_LINKS;
      this.loadedFor = null;
      this.error = null;
    });
  }

  /** 今の紐づけ（読み込む前は空）。 */
  get links(): TownLinks {
    return this.value;
  }

  /** 保存先（ROM を開いていなければ null）。 */
  get place(): TownLinkPlace | null {
    const session = this.state.session;
    return !session ? null : session.projectDir ? "project" : "personal";
  }

  /** 今の ROM の紐づけを読む（読み込み済みなら何もしない）。 */
  async load(): Promise<void> {
    const session = this.state.session;
    if (!session || this.loadedFor === session) return;
    if (this.loading) {
      // 前の ROM の読み込みの途中なら、終わってから今の ROM を読む
      await this.loading;
      return this.load();
    }
    this.loading = (async () => {
      let links = EMPTY_TOWN_LINKS;
      let error: string | null = null;
      try {
        links = session.projectDir ? await loadTownMapConfig(session.files) : readTownLinks(this.state.settings.data.townLinks[session.romPath.toLowerCase()]);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      if (this.state.session === session) {
        this.value = links;
        this.error = error;
        this.loadedFor = session;
      }
    })().finally(() => (this.loading = null));
    await this.loading;
  }

  /** 紐づけを変えて保存する。保存できなければ例外（変えない）。 */
  async save(next: TownLinks): Promise<void> {
    const session = this.state.session;
    if (!session) throw new Error("ROM を開いていません");
    await this.load();
    if (session.projectDir) {
      if (this.error !== null) throw new Error(this.error);
      await saveTownMapConfig(session.files, next);
    } else {
      const key = session.romPath.toLowerCase();
      const all = { ...this.state.settings.data.townLinks };
      if (next.sections.size === 0 && next.maps.size === 0) delete all[key];
      else all[key] = writeTownLinks(next, all[key] ?? null);
      this.state.settings.update({ townLinks: all });
      await this.state.settings.flush();
    }
    if (this.state.session === session) this.value = next;
  }
}
