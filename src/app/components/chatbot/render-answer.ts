import { Marked } from 'marked';
import createDOMPurify from 'dompurify';
import { Source } from '../../api/chat';

// Converts an answer (Markdown with [n] citation markers) into sanitised HTML.
// Browser only: DOMPurify needs `window`.

let purifier: ReturnType<typeof createDOMPurify> | null = null;

function getPurifier() {
  if (!purifier) {
    purifier = createDOMPurify(window as any);
    // Links inside answers open in a new tab
    purifier.addHook('afterSanitizeAttributes', node => {
      if (node.tagName === 'A' && node.getAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }
  return purifier;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Raw HTML in the answer is shown as text, never rendered
const markdown = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text)
  }
});

// Matches [1], [1, 3], [2-4], [1, 3-5] — but not markdown links like [1](...)
const CITATION_RE = /\[(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)\](?!\()/g;
// Private-use chars so the placeholder survives Markdown and sanitising untouched
const PLACEHOLDER_RE = /\uE000([\d,]+)\uE001/g;

function expandCitation(spec: string): number[] {
  const numbers: number[] = [];
  for (const part of spec.split(',')) {
    const [from, to] = part.split(/[-–]/).map(n => parseInt(n.trim(), 10));
    if (to === undefined || isNaN(to)) {
      numbers.push(from);
    } else {
      for (let n = Math.min(from, to); n <= Math.max(from, to) && numbers.length < 50; n++) {
        numbers.push(n);
      }
    }
  }
  return numbers.filter(n => !isNaN(n));
}

function isSafeUrl(url: string | null | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

function citationLink(n: number, byIndex: Map<number, Source>): string {
  const source = byIndex.get(n);
  if (!source) {
    return `<span class="cite-ref" data-cite="${n}">${n}</span>`;
  }
  const tooltip = escapeHtml([source.title, source.section].filter(Boolean).join(' — '));
  if (!isSafeUrl(source.url)) {
    return `<span class="cite-ref" data-cite="${n}" title="${tooltip}">${n}</span>`;
  }
  return `<a class="cite-ref" data-cite="${n}" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" title="${tooltip}">${n}</a>`;
}

export function renderAnswer(answer: string, citations: Source[] = [], sources: Source[] = []): string {
  const byIndex = new Map<number, Source>();
  for (const s of sources) byIndex.set(s.index, s);
  for (const s of citations) byIndex.set(s.index, s); // citations take precedence

  const withPlaceholders = (answer ?? '').replace(
    CITATION_RE,
    (_, spec: string) => `\uE000${expandCitation(spec).join(',')}\uE001`
  );

  const html = markdown.parse(withPlaceholders, { async: false }) as string;
  const clean = getPurifier().sanitize(html);

  // Citation markup is built from escaped values after sanitising
  return clean.replace(PLACEHOLDER_RE, (_, list: string) => {
    const links = list.split(',').map(n => citationLink(Number(n), byIndex)).join('');
    return `<sup class="cite">${links}</sup>`;
  });
}

export { isSafeUrl };
