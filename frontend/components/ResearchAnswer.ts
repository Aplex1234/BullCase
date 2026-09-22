import { createElement as h, Fragment } from "react";
import type { ReactNode } from "react";

// A deliberately small Markdown subset. React escapes all model-supplied text.
function inline(text: string): ReactNode[] {
  const pattern = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\*([^*\n]+)\*/g;
  const nodes: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    nodes.push(text.slice(offset, match.index));
    const tag = match[1] || match[2] ? "strong" : match[3] ? "code" : "em";
    nodes.push(h(tag, { key: match.index }, match[1] ?? match[2] ?? match[3] ?? match[4]));
    offset = match.index! + match[0].length;
  }
  nodes.push(text.slice(offset));
  return nodes;
}

export function ResearchAnswer({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const list = line.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
    if (list) {
      const ordered = !!list[2];
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
        if (!item || !!item[2] !== ordered) break;
        items.push(h("li", { key: i }, inline(item[3])));
        i++;
      }
      blocks.push(h(ordered ? "ol" : "ul", { key: i, ...(ordered ? { start: Number(list[2]) } : {}) }, items));
    } else if (/^#{1,6}\s+/.test(line)) {
      blocks.push(h("h4", { key: i }, inline(line.replace(/^#{1,6}\s+/, ""))));
      i++;
    } else {
      const paragraph = [line];
      const key = i++;
      while (i < lines.length && lines[i].trim() && !/^\s*(?:[-+*]|\d+[.)]|#{1,6})\s+/.test(lines[i])) paragraph.push(lines[i++]);
      blocks.push(h("p", { key }, inline(paragraph.join("\n"))));
    }
  }
  return h(Fragment, null, blocks);
}
