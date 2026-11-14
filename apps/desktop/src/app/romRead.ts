import { invoke } from "@tauri-apps/api/core";

/** ROM を分けて頼む数（画面へ渡すのは 1 本より何本か同時のほうが速い。16MB で 1 本 約 150ms、4 本同時で約 100ms）。 */
const PARTS = 4;

/**
 * ROM のバイト列を読む（Phase4 #318。Rust の read_rom_part で 4 つに分けて同時に頼み、つなぐ）。
 * 分けた長さがそろわないとき（読む間にファイルが変わったなど）は、1 本で読み直す。
 */
export async function readRomBytes(path: string): Promise<Uint8Array> {
  const parts = await Promise.all(
    Array.from({ length: PARTS }, (_, part) => invoke<ArrayBuffer>("read_rom_part", { path, part, parts: PARTS }).then((b) => new Uint8Array(b))),
  );
  const head = parts[0]!.length;
  const consistent = parts.every((p, i) => (i < PARTS - 1 ? p.length === head : p.length <= head));
  if (!consistent) return new Uint8Array(await invoke<ArrayBuffer>("read_rom", { path }));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
