import { codeAt, decodeBase64, type CfruProject } from "@zigzagumap/core";
import type { TransplantCodeProbe, TransplantProbeResult } from "../protocol";

/**
 * 移植の窓（別ウィンドウ）からの問い合わせに、メインのプロジェクトで答える（#314）。
 * - 新しいタイルセットに使うヘッダーの位置（`count` 個）。
 * - アニメ処理の機械語が、取り込み先のベース ROM の同じアドレスにあるか（#319 の Q11）。
 */
export function probeTransplant(project: CfruProject, count: number, code: readonly TransplantCodeProbe[]): TransplantProbeResult {
  const context = project.editorContext();
  const addresses = Array.from({ length: Math.max(0, Math.min(2, count)) }, (_, i) => context.newTilesetAddress(i));
  const codeMatches = code.map((c) => {
    const want = decodeBase64(c.bytes);
    const have = codeAt(project.rom, c.address, want.length);
    return have !== null && want.length > 0 && have.every((b, i) => b === want[i]);
  });
  return { addresses, codeMatches };
}
