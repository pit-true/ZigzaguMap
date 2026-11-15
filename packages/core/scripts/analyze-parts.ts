/**
 * オートペンのパーツの候補（#313 の自動解析）を JSON で書く確認用ツール。既定のパーツを作るときに使う。
 *
 *   pnpm --filter @zigzagumap/core analyze-parts -- <rom> <主タイルセットのポインタ（16 進）> <out.json> [--project <CFRU-JP のフォルダ>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { CfruProject, MemoryProjectFs, analyzeParts, collectLayouts } from "@zigzagumap/core";
import { NodeProjectFs } from "@zigzagumap/core/node";

const args = process.argv.slice(2).filter((a) => a !== "--");
const pi = args.indexOf("--project");
const projectDir = pi >= 0 ? args.splice(pi, 2)[1]! : null;
const [romPath, pointerText, out] = args;
if (!romPath || !pointerText || !out) {
  console.error("使い方: analyze-parts <rom> <主タイルセットのポインタ> <out.json> [--project <dir>]");
  process.exit(2);
}
const primary = Number.parseInt(pointerText.replace(/^0x/i, ""), 16) >>> 0;
const project = await CfruProject.open(readFileSync(romPath), projectDir ? new NodeProjectFs(projectDir) : new MemoryProjectFs());
const layouts = await collectLayouts(project, primary);
let attrs: Uint32Array | null = null;
for (const id of project.mapIds()) {
  const doc = await project.peek(id);
  if (doc && doc.primaryTileset >>> 0 === primary) {
    attrs = (await project.peekTilesets(doc)).primary.attributes;
    break;
  }
}
const t0 = performance.now();
const parts = analyzeParts({ layouts, behavior: (b) => attrs?.[b] ?? 0, blockLimit: 0x280 });
console.log(`${layouts.length} 枚から ${parts.length} 個（${(performance.now() - t0).toFixed(0)}ms）`);
writeFileSync(out, JSON.stringify(parts, null, 1));
