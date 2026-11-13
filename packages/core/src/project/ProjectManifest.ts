import { writeCompactJson } from "./BochiJson.js";
import { ProjectFormatError } from "./ProjectFormatError.js";
import { parseJsonObject, readArray, readInt } from "./jsonRead.js";

/** maps\project.json の Format の値。 */
export const PROJECT_MANIFEST_FORMAT = 1;

/** maps\project.json（Bochi の CfruMapManifest）。 */
export interface ProjectManifest {
  format: number;
  /** ベース ROM のバンクごとのマップ数。これより後ろの番号は JSON だけにある新しいマップ。 */
  baseBankCounts: number[];
}

/** maps\project.json の読み書き。 */
export class ProjectManifestJson {
  /** 読む。形式が不正なら ProjectFormatError。 */
  static parse(text: string, path: string | null = null): ProjectManifest {
    const o = parseJsonObject(text, path);
    const format = readInt(o, "Format", path, PROJECT_MANIFEST_FORMAT);
    if (format !== PROJECT_MANIFEST_FORMAT) throw new ProjectFormatError(`対応していない Format です: ${format}`, path);
    const counts = readArray(o, "BaseBankCounts", path);
    if (counts.length === 0) throw new ProjectFormatError("BaseBankCounts が空です", path);
    const baseBankCounts = counts.map((c) => {
      if (typeof c !== "number" || !Number.isInteger(c) || c < 0 || c > 255) {
        throw new ProjectFormatError("BaseBankCounts の値は 0〜255 の整数でなければなりません", path);
      }
      return c;
    });
    return { format, baseBankCounts };
  }

  /** Bochi と同じ形（字下げなし、CRLF で終わる）で書く。 */
  static stringify(manifest: ProjectManifest): string {
    return writeCompactJson({ Format: manifest.format, BaseBankCounts: manifest.baseBankCounts });
  }
}
