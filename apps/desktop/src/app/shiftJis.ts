/** 文字 → Shift_JIS のバイト（初めて使うときに TextDecoder の逆引きで作る）。 */
let table: Map<string, number> | null = null;

function build(): Map<string, number> {
  const map = new Map<string, number>();
  const decoder = new TextDecoder("shift_jis");
  for (let b = 0xa1; b <= 0xdf; b++) map.set(decoder.decode(Uint8Array.of(b)), b);
  const leads = [...range(0x81, 0x9f), ...range(0xe0, 0xfc)];
  for (const lead of leads) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      const ch = decoder.decode(Uint8Array.of(lead, trail));
      if (ch.length === 1 && ch !== "�" && !map.has(ch)) map.set(ch, (lead << 8) | trail);
    }
  }
  return map;
}

function* range(from: number, to: number): Generator<number> {
  for (let i = from; i <= to; i++) yield i;
}

/** 文字列を Shift_JIS にする（AdvanceMap の ini と同じ文字コード）。表に無い文字は「?」。 */
export function encodeShiftJis(text: string): Uint8Array {
  table ??= build();
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    const sj = table.get(ch);
    if (sj === undefined) out.push(0x3f);
    else if (sj > 0xff) out.push(sj >> 8, sj & 0xff);
    else out.push(sj);
  }
  return Uint8Array.from(out);
}
