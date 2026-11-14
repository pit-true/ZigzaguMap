/**
 * マクロ本文の式（`.byte` などの値）を数に直す小さな計算器。
 * 数（`0x1F`・`0b101`・`12`・`'A'`）、`.equ` の名前、`+ - * / % << >> & | ^ ~ !` と括弧を扱う。
 * 読めない式や知らない名前は null を返す（例外は投げない）。
 */

type Token = { type: "num"; value: number } | { type: "name"; text: string } | { type: "op"; text: string };

const OPERATORS = ["<<", ">>", "+", "-", "*", "/", "%", "&", "|", "^", "~", "!", "(", ")"];

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    const rest = text.slice(i);
    const num = /^(0x[0-9a-f]+|0b[01]+|\d+)/i.exec(rest);
    if (num) {
      const raw = num[1]!.toLowerCase();
      const value = raw.startsWith("0x")
        ? Number.parseInt(raw.slice(2), 16)
        : raw.startsWith("0b")
          ? Number.parseInt(raw.slice(2), 2)
          : Number.parseInt(raw, 10);
      tokens.push({ type: "num", value });
      i += num[1]!.length;
      continue;
    }
    const chr = /^'(.)'?/.exec(rest);
    if (chr) {
      tokens.push({ type: "num", value: chr[1]!.charCodeAt(0) });
      i += chr[0].length;
      continue;
    }
    const name = /^[A-Za-z_.$][A-Za-z0-9_.$]*/.exec(rest);
    if (name) {
      tokens.push({ type: "name", text: name[0] });
      i += name[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => rest.startsWith(o));
    if (!op) return null;
    tokens.push({ type: "op", text: op });
    i += op.length;
  }
  return tokens;
}

/** 2 項演算子の優先順位（大きいほど先）。 */
const BINARY: Record<string, number> = {
  "|": 1,
  "^": 2,
  "&": 3,
  "<<": 4,
  ">>": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

/**
 * 式を数にする。`resolve` は名前を数に直す（知らなければ null）。
 * 結果は 32 ビットの符号なし整数に丸める。
 */
export function evaluateMacroExpression(text: string, resolve: (name: string) => number | null): number | null {
  const tokens = tokenize(text.trim());
  if (!tokens || tokens.length === 0) return null;
  let pos = 0;
  let failed = false;

  const primary = (): number => {
    const t = tokens[pos++];
    if (!t) {
      failed = true;
      return 0;
    }
    if (t.type === "num") return t.value;
    if (t.type === "name") {
      const v = resolve(t.text);
      if (v === null) failed = true;
      return v ?? 0;
    }
    if (t.text === "(") {
      const v = binary(0);
      const close = tokens[pos++];
      if (!close || close.type !== "op" || close.text !== ")") failed = true;
      return v;
    }
    if (t.text === "-") return -primary();
    if (t.text === "+") return primary();
    if (t.text === "~") return ~primary();
    if (t.text === "!") return primary() === 0 ? 1 : 0;
    failed = true;
    return 0;
  };

  const binary = (minPrec: number): number => {
    let left = primary();
    for (;;) {
      const t = tokens[pos];
      if (!t || t.type !== "op") break;
      const prec = BINARY[t.text];
      if (prec === undefined || prec < minPrec) break;
      pos++;
      const right = binary(prec + 1);
      switch (t.text) {
        case "|": left = left | right; break;
        case "^": left = left ^ right; break;
        case "&": left = left & right; break;
        case "<<": left = left << right; break;
        case ">>": left = left >>> right; break;
        case "+": left = left + right; break;
        case "-": left = left - right; break;
        case "*": left = left * right; break;
        case "/": if (right === 0) failed = true; else left = Math.trunc(left / right); break;
        case "%": if (right === 0) failed = true; else left = left % right; break;
      }
    }
    return left;
  };

  const value = binary(0);
  if (failed || pos !== tokens.length) return null;
  return value >>> 0;
}
