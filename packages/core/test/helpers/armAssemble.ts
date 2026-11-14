/**
 * 逆アセンブルの結果を arm-none-eabi-as でアセンブルし直して、元の ROM と比べるための道具（ローカルの確かめ用）。
 * as と同じフォルダの ld と objcopy も使う。インクルードのファイルは一時フォルダに写してから使う。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { type Disassembly, renderDisassembly, ROM_BASE } from "../../src/index.js";

/** アセンブルし直した 1 まとまりと、元と合ったか。 */
export interface ReassembledChunk {
  offset: number;
  size: number;
  equal: boolean;
}

/** as のパスから、同じフォルダの別のツールのパスを作る。 */
function sibling(asPath: string, tool: string): string {
  return join(dirname(asPath), basename(asPath).replace(/as(\.exe)?$/i, `${tool}$1`));
}

/**
 * 結果の `.s` を、まとまり（空行で区切った塊）ごとに元の位置へ `.org` で置いてアセンブルする。
 * 文字列のラベルは元の位置の `.equ` にする。includeDir の xse_commands.s・xse_defines.s・asm_defines.s を使う。
 */
export function reassemble(d: Disassembly, rom: Uint8Array, asPath: string, includeDir: string): ReassembledChunk[] {
  const rendered = renderDisassembly(d).script;
  const chunks: { offset: number; lines: string[] }[] = [];
  let current: { offset: number; lines: string[] } | null = null;
  for (const line of rendered.lines) {
    if (line.text === "") {
      current = null;
      continue;
    }
    if (!current) {
      current = { offset: line.offset!, lines: [] };
      chunks.push(current);
    }
    current.lines.push(line.text);
  }
  chunks.sort((a, b) => a.offset - b.offset);

  const sizes = new Map<number, number>();
  for (const b of d.blocks) sizes.set(b.offset, b.end - b.offset);
  for (const m of d.movements) sizes.set(m.offset, m.steps.length);
  for (const m of d.marts) sizes.set(m.offset, m.items.length * 2);

  const work = mkdtempSync(join(tmpdir(), "zigzagu-disasm-"));
  try {
    for (const f of ["xse_commands.s", "xse_defines.s", "asm_defines.s"]) copyFileSync(join(includeDir, f), join(work, f));
    const source = [
      ".text",
      ".thumb",
      '.include "xse_commands.s"',
      '.include "xse_defines.s"',
      '.include "asm_defines.s"',
      ...d.strings.map((s) => `.equ ${s.label}, 0x${(s.offset + ROM_BASE).toString(16)}`),
      ...chunks.flatMap((c) => [`.org 0x${c.offset.toString(16)}`, ...c.lines]),
      "",
    ].join("\n");
    writeFileSync(join(work, "test.s"), source, "utf8");
    const run = (tool: string, args: string[]) => execFileSync(tool, args, { cwd: work, stdio: "pipe" });
    run(asPath, ["-o", "test.o", "test.s"]);
    run(sibling(asPath, "ld"), ["-Ttext=0x08000000", "-e", "0x08000000", "-o", "test.elf", "test.o"]);
    run(sibling(asPath, "objcopy"), ["-O", "binary", "test.elf", "test.bin"]);
    const bin = new Uint8Array(readFileSync(join(work, "test.bin")));
    return chunks.map((c) => {
      const size = sizes.get(c.offset) ?? 0;
      let equal = size > 0 && c.offset + size <= bin.length;
      for (let i = 0; equal && i < size; i++) if (bin[c.offset + i] !== rom[c.offset + i]) equal = false;
      return { offset: c.offset, size, equal };
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
