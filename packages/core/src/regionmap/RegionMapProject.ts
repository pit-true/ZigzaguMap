import { MAPS_DIR } from "../project/paths.js";
import type { ProjectFs } from "../project/ProjectFs.js";
import type { Rom } from "../rom/Rom.js";
import type { RegionMapDocument } from "./RegionMapDocument.js";
import type { RegionMapGraphics } from "./RegionMapGraphics.js";
import { RegionMapJson } from "./RegionMapJson.js";
import { RegionMapReader, type RegionMapTableAddresses } from "./RegionMapReader.js";

/** maps\regionmap.json のパス。 */
export const REGION_MAP_PATH = `${MAPS_DIR}/regionmap.json`;

/**
 * プロジェクトのタウンマップ（ベース ROM + maps\regionmap.json）。
 * ワールドマップエディターを開いたときに初めて読む。書き出しはベース ROM と違う表だけ。
 */
export class RegionMapProject {
  /** 書き出し（か読み込み）の時点の内容。 */
  private savedJson: string | null;

  private constructor(
    /** ベース ROM の内容（変えない）。 */
    readonly base: RegionMapDocument,
    /** 編集中の内容。 */
    readonly document: RegionMapDocument,
    readonly graphics: RegionMapGraphics,
    readonly addresses: RegionMapTableAddresses,
  ) {
    this.savedJson = RegionMapJson.stringify(document, base);
  }

  /** ベース ROM を読み、maps\regionmap.json があれば重ねる。`fs` が null なら ROM だけ。 */
  static async open(rom: Rom, gameCode: string, fs: ProjectFs | null): Promise<RegionMapProject> {
    const data = RegionMapReader.read(rom, gameCode);
    let doc = data.document.clone();
    if (fs && (await fs.exists(REGION_MAP_PATH))) doc = RegionMapJson.parse(await fs.readText(REGION_MAP_PATH), data.document, REGION_MAP_PATH);
    return new RegionMapProject(data.document, doc, data.graphics, data.addresses);
  }

  /** 書き出してから変わったか。 */
  isModified(): boolean {
    return RegionMapJson.stringify(this.document, this.base) !== this.savedJson;
  }

  /**
   * maps\regionmap.json を書く。ベース ROM と同じならファイルを消す。中身が同じなら書かない。
   * 戻り値は書いた・消したパス。
   */
  async save(fs: ProjectFs): Promise<{ written: string[]; removed: string[] }> {
    const json = RegionMapJson.stringify(this.document, this.base);
    const exists = await fs.exists(REGION_MAP_PATH);
    const out = { written: [] as string[], removed: [] as string[] };
    if (json === null) {
      if (exists) {
        await fs.remove(REGION_MAP_PATH);
        out.removed.push(REGION_MAP_PATH);
      }
    } else if (!exists || (await fs.readText(REGION_MAP_PATH)) !== json) {
      await fs.writeText(REGION_MAP_PATH, json);
      out.written.push(REGION_MAP_PATH);
    }
    this.savedJson = json;
    return out;
  }
}
