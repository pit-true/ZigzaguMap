import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ScriptAssist,
  ScriptCommandTable,
  asmCompletionAt,
  asmHoverAt,
  buildScriptIndex,
  lintAsmText,
  lintStringText,
} from "../src/index.js";
import { NodeProjectFs } from "../src/node/index.js";

/** ND と Chronos の CFRU-JP のフォルダ（写しでよい。読むだけ）。設定されていなければ飛ばす。 */
const dirs = { nd: process.env.ZIGZAGU_ND_DIR, chronos: process.env.ZIGZAGU_CHRONOS_DIR };

async function load(dir: string): Promise<ScriptAssist> {
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  const defines = ["xse_defines.s", "asm_defines.s"].filter((n) => existsSync(join(dir, n))).map(read);
  const commands = ScriptCommandTable.build({ xseCommands: read("xse_commands.s"), defines });
  const index = await buildScriptIndex(new NodeProjectFs(dir));
  const assist = new ScriptAssist({ commands, index });
  if (existsSync(join(dir, "BPRJ.ld"))) assist.setLinkerSymbols(read("BPRJ.ld"));
  for (const name of readdirSync(join(dir, "strings")).filter((n) => n.endsWith(".string"))) {
    assist.updateString(`strings/${name}`, read(`strings/${name}`).replace(/\r\n?/g, "\n"));
  }
  return assist;
}

for (const [dialect, dir] of Object.entries(dirs)) {
  describe.skipIf(!dir)(`実フォルダ（${dialect}）の補助`, () => {
    it("overworld_scripts の .s をすべて調べて、波線が出ない", async () => {
      const assist = await load(dir!);
      const folder = join(dir!, "assembly/overworld_scripts");
      const found: string[] = [];
      for (const name of readdirSync(folder).filter((n) => n.endsWith(".s"))) {
        const text = readFileSync(join(folder, name), "utf8").replace(/\r\n?/g, "\n");
        for (const d of lintAsmText(assist, text)) {
          const line = text.slice(0, d.from).split("\n").length;
          found.push(`${name}:${line} ${d.code} ${JSON.stringify(d.params)} ${text.slice(d.from, d.to)}`);
        }
      }
      expect(found).toEqual([]);
    });

    it(".string をすべて調べて、重複のラベルの波線が出ない", async () => {
      const assist = await load(dir!);
      const found: string[] = [];
      const stray: string[] = [];
      for (const path of assist.strings.paths()) {
        const text = readFileSync(join(dir!, path), "utf8").replace(/\r\n?/g, "\n");
        for (const d of lintStringText(text, { path, strings: assist.strings, width: null })) {
          // 続きにならない本文の行（#221）は、実ファイルにもともとある書き方なので数だけ出す
          if (d.code === "strayStringLine") stray.push(`${path} ${String(d.params["label"])}`);
          else found.push(`${path} ${d.code} ${JSON.stringify(d.params)}`);
        }
      }
      expect(found).toEqual([]);
      console.info(`続きにならない本文の行: ${stray.length} 件 ${stray.join(", ")}`);
    });

    it("msgbox の文字列の引数の役割が方言で違う", async () => {
      const assist = await load(dir!);
      const a = assist.analyze("\tmsgbox gText_A MSG_FACE gText_A_k");
      const hover = asmHoverAt(assist, a, a.args[0]!.token.start);
      expect(hover?.type === "string" || hover?.type === "value").toBe(true);
      const roles = assist.command("msgbox")!.args.map((x) => x.role);
      if (dialect === "nd") expect(roles[2]).toBe("漢字テキスト");
      else expect(roles.length).toBe(2);
      const c = asmCompletionAt(assist, assist.analyze("\tmsgbox gText_A "), 16);
      expect(c?.kind).toBe("msgType");
    });
  });
}
