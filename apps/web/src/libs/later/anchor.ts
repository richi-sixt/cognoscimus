// Highlights are located by their text and the text around it, so the stored
// article HTML never changes. All offsets count characters of `root.textContent`.

export const CONTEXT_CHARS = 32;

export interface Anchor {
  quote: string;
  prefix: string;
  suffix: string;
}

/** Start and end of a selection as offsets into the article's text, or null. */
export const rangeOffsets = (root: HTMLElement, range: Range): [number, number] | null => {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const measure = document.createRange();
  measure.selectNodeContents(root);
  measure.setEnd(range.startContainer, range.startOffset);
  const start = measure.toString().length;
  measure.setEnd(range.endContainer, range.endOffset);
  const end = measure.toString().length;
  return end > start ? [start, end] : null;
};

export const buildAnchor = (text: string, start: number, end: number): Anchor => ({
  quote: text.slice(start, end),
  prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
  suffix: text.slice(end, end + CONTEXT_CHARS),
});

const commonSuffixLength = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};

const commonPrefixLength = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/**
 * Where the quote sits in the text now. A quote that occurs several times is
 * placed by how well the surrounding text still matches. Null when it is gone.
 */
export const findAnchor = (text: string, anchor: Anchor): [number, number] | null => {
  const { quote, prefix, suffix } = anchor;
  if (!quote) return null;
  const hits: number[] = [];
  for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) hits.push(i);
  if (hits.length === 0) return null;

  let best = hits[0]!;
  let bestScore = -1;
  for (const hit of hits) {
    const before = text.slice(Math.max(0, hit - prefix.length), hit);
    const after = text.slice(hit + quote.length, hit + quote.length + suffix.length);
    const score = commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix);
    if (score > bestScore) {
      best = hit;
      bestScore = score;
    }
  }
  return [best, best + quote.length];
};

/** Wraps the text between two offsets in <mark> elements, one per text node. */
export const wrapOffsets = (
  root: HTMLElement,
  start: number,
  end: number,
  attrs: { id: string; className: string },
) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: { node: Text; from: number; to: number }[] = [];
  let pos = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const length = node.data.length;
    const from = Math.max(start, pos) - pos;
    const to = Math.min(end, pos + length) - pos;
    if (to > from && node.data.slice(from, to).trim()) segments.push({ node, from, to });
    pos += length;
    if (pos >= end) break;
  }

  for (const { node, from, to } of segments) {
    let target = node;
    if (from > 0) target = node.splitText(from);
    if (to - from < target.data.length) target.splitText(to - from);
    const mark = document.createElement('mark');
    mark.dataset['highlightId'] = attrs.id;
    mark.className = attrs.className;
    target.parentNode?.insertBefore(mark, target);
    mark.appendChild(target);
  }
};

/** Removes every highlight mark again, leaving the original text in place. */
export const clearMarks = (root: HTMLElement) => {
  root.querySelectorAll('mark[data-highlight-id]').forEach((mark) => {
    while (mark.firstChild) mark.parentNode?.insertBefore(mark.firstChild, mark);
    mark.remove();
  });
  root.normalize();
};
