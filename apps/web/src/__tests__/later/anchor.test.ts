import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildAnchor,
  clearMarks,
  findAnchor,
  rangeOffsets,
  wrapOffsets,
} from '@/libs/later/anchor';

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML =
    '<div id="r"><p>The cat sat on the mat.</p><p>Later the <b>cat</b> sat on the sofa.</p></div>';
  root = document.getElementById('r')!;
});

describe('findAnchor', () => {
  it('finds a unique quote', () => {
    const text = root.textContent!;
    const [s, e] = findAnchor(text, { quote: 'mat', prefix: '', suffix: '' })!;
    expect(text.slice(s, e)).toBe('mat');
  });

  it('picks the right one of several matches by the text around it', () => {
    const text = root.textContent!;
    const second = text.lastIndexOf('cat sat');
    const anchor = buildAnchor(text, second, second + 7);
    expect(findAnchor(text, anchor)![0]).toBe(second);
    const first = text.indexOf('cat sat');
    expect(findAnchor(text, buildAnchor(text, first, first + 7))![0]).toBe(first);
  });

  it('still finds it when the article text shifted a little', () => {
    const text = root.textContent!;
    const at = text.lastIndexOf('cat sat');
    const anchor = buildAnchor(text, at, at + 7);
    const shifted = `NEW INTRO. ${text}`;
    expect(findAnchor(shifted, anchor)![0]).toBe(at + 'NEW INTRO. '.length);
  });

  it('returns null when the quote is gone', () => {
    expect(findAnchor(root.textContent!, { quote: 'dog', prefix: '', suffix: '' })).toBeNull();
  });
});

describe('wrapOffsets and clearMarks', () => {
  it('wraps text across elements and removes the marks again', () => {
    const before = root.innerHTML;
    const text = root.textContent!;
    const start = text.indexOf('the mat');
    const end = text.indexOf('Later') + 'Later the cat'.length;
    wrapOffsets(root, start, end, { id: 'h1', className: 'hl' });
    const marked = [...root.querySelectorAll('mark[data-highlight-id="h1"]')].map(
      (m) => m.textContent,
    );
    expect(marked.join('')).toBe(text.slice(start, end).replace(/\s+$/, '').replace(/^\s+/, ''));
    expect(root.textContent).toBe(text);
    clearMarks(root);
    expect(root.innerHTML).toBe(before);
  });
});

describe('rangeOffsets', () => {
  it('measures a selection in text characters', () => {
    const textNode = root.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 4);
    range.setEnd(textNode, 7);
    const [s, e] = rangeOffsets(root, range)!;
    expect(root.textContent!.slice(s, e)).toBe('cat');
  });

  it('ignores a selection outside the article', () => {
    document.body.insertAdjacentHTML('beforeend', '<p id="o">outside</p>');
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('o')!);
    expect(rangeOffsets(root, range)).toBeNull();
  });
});
