/**
 * ヘルプの Read me 用の小さな Markdown → HTML 変換（依存を増やさない自前の実装）。
 * 扱うのは README と docs/ で使っている書き方だけ: 見出し、段落、箇条書き（入れ子・番号つき）、表、コードブロック、
 * 引用、横線、インラインのコード・強調・リンク。
 *
 * 安全のため、本文の HTML はすべて文字として出す（`<script>` などのタグは効かない）。
 * リンクは `href` を直接書かず、`data-link` に行き先の種類と値を入れて、画面側のクリックの処理に任せる。
 */

/** リンクの行き先。 */
export type LinkTarget =
  | { readonly kind: "anchor"; readonly id: string }
  | { readonly kind: "doc"; readonly path: string; readonly id: string | null }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "none" };

/** 見出しの 1 件（目次・アンカー用）。 */
export interface Heading {
  readonly level: number;
  readonly text: string;
  readonly id: string;
}

/** 変換の結果。 */
export interface RenderedMarkdown {
  readonly html: string;
  readonly headings: readonly Heading[];
}

/** HTML の特殊文字を文字として出す。 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * 見出しのアンカー名（GitHub と同じ規則: 小文字にし、文字・数字・空白・`-`・`_` 以外を消し、空白を `-` にする）。
 * README の目次のリンク（`#advancemap-と違う点` など）がそのまま使える。
 */
export function slugify(text: string): string {
  return plainText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** 行き先を決める。`base` は今の文書のパス（`README.md`、`docs/automation.md`）。 */
export function resolveLink(href: string, base: string): LinkTarget {
  const h = href.trim();
  if (/^https?:\/\//i.test(h)) return /^https?:\/\/[^\s"]+$/i.test(h) ? { kind: "external", url: h } : { kind: "none" };
  if (h.startsWith("#")) return { kind: "anchor", id: decodeAnchor(h.slice(1)) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return { kind: "none" }; // javascript: や file: などは開かない
  const [pathPart, anchor] = splitOnce(h, "#");
  const path = joinPath(base, pathPart);
  if (path === null) return { kind: "none" };
  return { kind: "doc", path, id: anchor === null ? null : decodeAnchor(anchor) };
}

/** Markdown を HTML にする。`base` はリンクの相対パスの基準（今の文書のパス）。 */
export function renderMarkdown(source: string, base: string): RenderedMarkdown {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  const out: string[] = [];
  const inline = (text: string): string => renderInline(text, base);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    // コードブロック
    const fence = /^(\s*)(```+|~~~+)\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const close = fence[2]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(close)) body.push(lines[i++]!);
      i++;
      const lang = fence[3] ? ` data-lang="${escapeHtml(fence[3])}"` : "";
      out.push(`<pre class="md-code"${lang}><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    // 見出し
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!;
      let id = slugify(text);
      const n = used.get(id) ?? 0;
      used.set(id, n + 1);
      if (n > 0) id = `${id}-${n}`;
      headings.push({ level, text: plainText(text), id });
      out.push(`<h${level} id="${escapeHtml(id)}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    // 横線
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    // 表（見出しの行の次が区切りの行）
    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableDivider(lines[i + 1]!)) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]!).map(alignOf);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(splitRow(lines[i++]!));
      const cell = (tag: string, text: string, col: number): string => {
        const a = align[col];
        return `<${tag}${a ? ` style="text-align:${a}"` : ""}>${inline(text)}</${tag}>`;
      };
      out.push(
        `<table class="md-table"><thead><tr>${head.map((c, k) => cell("th", c, k)).join("")}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${head.map((_, k) => cell("td", r[k] ?? "", k)).join("")}</tr>`).join("")}</tbody></table>`,
      );
      continue;
    }
    // 引用
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${renderMarkdown(body.join("\n"), base).html}</blockquote>`);
      continue;
    }
    // 箇条書き
    const first = listMarker(line);
    if (first) {
      const block: string[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        // 同じ深さで番号つきと番号なしが入れ替わったら、別の箇条書き
        const m = listMarker(l);
        if (block.length > 0 && m && m.indent <= first.indent + 1 && m.ordered !== first.ordered) break;
        if (l.trim() === "") {
          // 空行のあとも、字下げした続きか次の項目なら同じ箇条書き
          const next = lines[i + 1];
          if (next !== undefined && (listMarker(next) || /^\s{2,}\S/.test(next))) {
            i++;
            continue;
          }
          break;
        }
        if (block.length > 0 && !listMarker(l) && !/^\s+\S/.test(l) && startsBlock(l)) break;
        block.push(l);
        i++;
      }
      out.push(renderList(block, inline));
      continue;
    }
    // 段落（次の空行か、別の種類の塊の手前まで）
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && (para.length === 0 || !startsBlock(lines[i]!))) para.push(lines[i++]!.trim());
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return { html: out.join("\n"), headings };
}

// ---- 箇条書き ----

interface ListItem {
  readonly ordered: boolean;
  readonly lines: string[];
}

function listMarker(line: string): { indent: number; ordered: boolean; rest: string } | null {
  const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
  if (!m) return null;
  return { indent: m[1]!.length, ordered: /\d/.test(m[2]!), rest: m[3]! };
}

/** 字下げで入れ子を作る。 */
function renderList(block: readonly string[], inline: (text: string) => string): string {
  const baseIndent = listMarker(block[0] ?? "")?.indent ?? 0;
  const items: ListItem[] = [];
  for (const line of block) {
    const m = listMarker(line);
    if (m && m.indent <= baseIndent + 1) items.push({ ordered: m.ordered, lines: [m.rest] });
    // 子の行（字下げした項目や続きの行）は直前の項目に入れる
    else items[items.length - 1]?.lines.push(line);
  }
  if (items.length === 0) return "";
  const tag = items[0]!.ordered ? "ol" : "ul";
  const body = items
    .map((item) => {
      const [first, ...rest] = item.lines;
      const children = rest.filter((l) => l.trim() !== "");
      if (children.length === 0) return `<li>${inline(first!)}</li>`;
      const minIndent = Math.min(...children.map((l) => /^\s*/.exec(l)![0].length));
      const nested = children.map((l) => l.slice(minIndent));
      if (listMarker(nested[0]!)) return `<li>${inline(first!)}${renderList(nested, inline)}</li>`;
      // 続きの行（段落の続き）は同じ項目の中で改行する
      const subList = nested.findIndex((l) => listMarker(l));
      const text = (subList < 0 ? nested : nested.slice(0, subList)).map((l) => inline(l.trim())).join("<br>");
      const sub = subList < 0 ? "" : renderList(nested.slice(subList), inline);
      return `<li>${inline(first!)}<br>${text}${sub}</li>`;
    })
    .join("");
  return `<${tag}>${body}</${tag}>`;
}

// ---- 表 ----

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
}

/** 表の行をセルに分ける（`\|` は区切りではなく文字の `|`）。 */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let k = 0; k < s.length; k++) {
    const c = s[k]!;
    if (c === "\\" && s[k + 1] === "|") {
      cur += "|";
      k++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function alignOf(cell: string): string | null {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return null;
}

/** 段落を区切る行（ほかの種類の塊の始まり）。 */
function startsBlock(line: string): boolean {
  return /^(#{1,6}\s|```|~~~|\s*>|\s*\|)/.test(line) || listMarker(line) !== null;
}

// ---- インライン ----

/** インラインの書き方（コード・リンク・強調）を HTML にする。 */
export function renderInline(text: string, base: string): string {
  let out = "";
  let k = 0;
  while (k < text.length) {
    const c = text[k]!;
    // エスケープ（\* \` \[ など）
    if (c === "\\" && k + 1 < text.length && /[\\`*_[\]()#+\-.!|<>{}]/.test(text[k + 1]!)) {
      out += escapeHtml(text[k + 1]!);
      k += 2;
      continue;
    }
    // コード
    if (c === "`") {
      const ticks = /^`+/.exec(text.slice(k))![0];
      const end = text.indexOf(ticks, k + ticks.length);
      if (end > 0) {
        out += `<code>${escapeHtml(text.slice(k + ticks.length, end).trim())}</code>`;
        k = end + ticks.length;
        continue;
      }
    }
    // リンク [文字](行き先)
    if (c === "[") {
      const link = parseLink(text, k);
      if (link) {
        out += linkHtml(renderInline(link.label, base), resolveLink(link.href, base), link.href);
        k = link.end;
        continue;
      }
    }
    // 強調 **太字** / *斜体*
    if (c === "*" || c === "_") {
      const strong = text.startsWith(c + c, k);
      const mark = strong ? c + c : c;
      const end = text.indexOf(mark, k + mark.length);
      const inner = end > 0 ? text.slice(k + mark.length, end) : "";
      // 単語の中の _（ファイル名など）と、空白で始まるものは強調にしない
      const wordInside = c === "_" && /\w/.test(text[k - 1] ?? "");
      if (end > 0 && inner.trim() === inner && inner !== "" && !wordInside) {
        const tag = strong ? "strong" : "em";
        out += `<${tag}>${renderInline(inner, base)}</${tag}>`;
        k = end + mark.length;
        continue;
      }
    }
    out += escapeHtml(c);
    k++;
  }
  return out;
}

function parseLink(text: string, start: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let k = start;
  for (; k < text.length; k++) {
    if (text[k] === "\\") {
      k++;
      continue;
    }
    if (text[k] === "[") depth++;
    else if (text[k] === "]" && --depth === 0) break;
  }
  if (k >= text.length || text[k + 1] !== "(") return null;
  const close = text.indexOf(")", k + 2);
  if (close < 0) return null;
  return { label: text.slice(start + 1, k), href: text.slice(k + 2, close).trim().split(/\s+/)[0] ?? "", end: close + 1 };
}

function linkHtml(label: string, target: LinkTarget, href: string): string {
  if (target.kind === "none") return label;
  const value = target.kind === "anchor" ? `#${target.id}` : target.kind === "doc" ? target.path + (target.id ? `#${target.id}` : "") : target.url;
  const title = target.kind === "external" ? ` title="${escapeHtml(target.url)}"` : "";
  return `<a class="md-link md-${target.kind}" href="#" data-link="${escapeHtml(value)}" data-href="${escapeHtml(href)}"${title}>${label}</a>`;
}

// ---- 小さな補助 ----

/** 見出しの文字から、書き方の記号を外した文字。 */
function plainText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\\(.)/g, "$1");
}

function decodeAnchor(anchor: string): string {
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
}

function splitOnce(text: string, sep: string): [string, string | null] {
  const i = text.indexOf(sep);
  return i < 0 ? [text, null] : [text.slice(0, i), text.slice(i + 1)];
}

/** `base` の文書から見た相対パスを、リポジトリの根からのパスにする（根の外は null）。 */
function joinPath(base: string, relative: string): string | null {
  if (relative === "") return base;
  const parts = relative.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const p of relative.replace(/^\//, "").split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(p);
  }
  return parts.join("/");
}
