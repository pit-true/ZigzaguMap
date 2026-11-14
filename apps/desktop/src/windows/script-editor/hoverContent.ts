import { formatStringText, type AsmHover } from "@zigzagumap/core";
import { jaScriptEditorAssist as t } from "../../i18n/ja.scriptEditorAssist";
import { escapeHtml, renderInline } from "../../ui/help/markdown";

/**
 * ホバーの中身を Markdown にする（拡張のホバーと同じ並び）。文字列の本文は `\p` を空行、`\n` `\l` を改行にして、
 * 700 字で切る（拡張と同じ）。
 */
export function hoverMarkdown(h: AsmHover): string {
  switch (h.type) {
    case "command":
      return h.markdown;
    case "string": {
      const parts: string[] = [];
      for (const ref of h.refs) {
        if (ref.label === null) {
          parts.push(`**${ref.role}**  \n${t.hover.omitted}`);
          continue;
        }
        const e = ref.entries[0];
        let md = `**${ref.label}**  \n${ref.role}`;
        if (!e) {
          parts.push(`${md}  \n${t.hover.stringMissing}`);
          continue;
        }
        const body = formatStringText(e.text).replace(/```/g, "'''").trim();
        const clipped = body.length > 700 ? `${body.slice(0, 700)}...` : body;
        md += `\n\n\`\`\`text\n${clipped}\n\`\`\`\n\n${t.hover.source(e.path, e.line)}`;
        parts.push(md);
      }
      return parts.join("\n\n");
    }
    case "stringEqu":
      return `**${h.name}** = \`${h.equ.value}\`  \n${h.role}  \n${t.hover.stringEquNote}\n\n${t.hover.source(h.equ.path, h.equ.line)}`;
    case "label": {
      let md = `**${h.name}**  \n${h.role}`;
      for (const l of h.labels) {
        md += `\n\n${t.hover.source(l.path, l.line)}`;
        if (l.preview.length > 0) md += `\n\`\`\`asm\n${l.preview.join("\n")}\n\`\`\``;
      }
      return md;
    }
    case "value": {
      let md = `**${h.name}**  \n${h.role}`;
      if (h.defaultValue !== null) md += `  \n${t.hover.defaultValue(h.defaultValue)}`;
      else if (h.required) md += `  \n${t.hover.required}`;
      if (h.equ) {
        md += `  \n${t.hover.equValue(h.equ.value)}`;
        if (h.equ.description) md += `  \n${h.equ.description}`;
      }
      if (h.known) md += `  \n${h.known}`;
      if (h.value !== null) {
        md += `  \n${t.hover.number(h.value, `0x${(h.value >>> 0).toString(16).toUpperCase()}`)}`;
        if (h.variable) md += `  \n${h.variable}`;
      }
      if (h.aliases.length > 0) md += `  \n${t.hover.aliases(h.aliases)}`;
      if (h.equ) md += `\n\n${t.hover.source(h.equ.path, h.equ.line)}`;
      return md;
    }
  }
}

/**
 * ホバー用の小さな Markdown → HTML。段落（空行で区切る）、改行（行末の 2 つの空白と、ただの改行の両方を `<br>` にする）、
 * ```` ``` ```` のコードブロック。行の中の書き方（太字・コード）はヘルプの renderInline を使う。
 * ヘルプの renderMarkdown は段落の中の改行を空白にするので、CSV の hover（行ごとに意味がある）には使わない。
 */
export function hoverHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) out.push(`<p>${para.map((l) => renderInline(l.replace(/\s+$/, ""), "")).join("<br>")}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*```/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.trim() === "") flush();
    else para.push(line);
  }
  flush();
  return out.join("");
}

/** Markdown を、記号を外した文字だけにする（自動操作の返事用）。 */
export function hoverPlainText(md: string): string {
  return md
    .replace(/```\w*\n?/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/ {2}\n/g, "\n")
    .trim();
}
