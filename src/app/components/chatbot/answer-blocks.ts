import { Segment, Source } from '../../api/chat';
import { ChatImageItem, toImageItem } from './chat-images';
import { renderAnswer } from './render-answer';

// One piece of an answer in display order
export type AnswerBlock =
  | { kind: 'markdown'; html: string }
  | { kind: 'image'; item: ChatImageItem };

// A segment that opens with a citation-only line ("[1]  \n2. Next step") carries the marker of the
// step *before* the image. Left there it also stops "2." from starting a list, so move it back.
const LEADING_CITATION_RE = /^\s*((?:\[\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*\]\s*)+)(?:\n|$)/;

function reattachCitations(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  let lastMarkdown: { type: 'markdown'; text: string } | null = null;

  for (const seg of segments) {
    if (seg.type !== 'markdown') {
      out.push(seg);
      continue;
    }
    let text = seg.text ?? '';
    const match = lastMarkdown ? LEADING_CITATION_RE.exec(text) : null;
    if (match && lastMarkdown) {
      lastMarkdown.text = `${lastMarkdown.text.trimEnd()} ${match[1].trim()}`;
      text = text.slice(match[0].length);
    }
    if (text.trim()) {
      lastMarkdown = { type: 'markdown', text };
      out.push(lastMarkdown);
    }
  }
  return out;
}

export function buildAnswerBlocks(segments: Segment[], citations: Source[], sources: Source[]): AnswerBlock[] {
  const byIndex = new Map<number, Source>();
  for (const s of sources) byIndex.set(s.index, s);
  for (const s of citations) byIndex.set(s.index, s);

  const blocks: AnswerBlock[] = [];
  for (const seg of reattachCitations(segments)) {
    if (seg.type === 'markdown') {
      blocks.push({ kind: 'markdown', html: renderAnswer(seg.text, citations, sources) });
    } else if (seg.type === 'image') {
      const item = toImageItem(seg, seg.source_index, byIndex.get(seg.source_index));
      if (item) {
        blocks.push({ kind: 'image', item });
      }
    }
  }
  return blocks;
}
