/** Just enough Markdown for chat replies: paragraphs, bullet lists and **bold**. Never HTML. */

export interface Span { text: string; bold: boolean }
export type TextBlock = { kind: 'p'; spans: Span[] } | { kind: 'list'; ordered: boolean; items: Span[][] };

function spans(line: string): Span[] {
  return line.split(/(\*\*[^*]+\*\*)/).filter(Boolean)
    .map(part => part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? { text: part.slice(2, -2), bold: true } : { text: part.replace(/^#{1,6}\s+/, ''), bold: false });
}

export function richText(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const chunk of text.split(/\n{2,}/)) {
    let paragraph: string[] = [];
    let list: { ordered: boolean; items: Span[][] } | null = null;
    const flushParagraph = () => { if (paragraph.length) blocks.push({ kind: 'p', spans: spans(paragraph.join(' ')) }); paragraph = []; };
    const flushList = () => { if (list) blocks.push({ kind: 'list', ...list }); list = null; };
    for (const raw of chunk.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const bullet = /^[-*•]\s+(.*)$/.exec(line), numbered = /^\d+[.)]\s+(.*)$/.exec(line);
      const item = bullet ?? numbered;
      if (item) {
        flushParagraph();
        if (!list || list.ordered !== !!numbered) { flushList(); list = { ordered: !!numbered, items: [] }; }
        list.items.push(spans(item[1]));
      } else {
        flushList();
        paragraph.push(line);
      }
    }
    flushParagraph();
    flushList();
  }
  return blocks;
}
