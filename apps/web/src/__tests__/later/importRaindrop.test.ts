import { describe, expect, it } from 'vitest';
import { parseRaindropExport } from '@/libs/later/importRaindrop';

const SAMPLE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Raindrop.io Bookmarks</TITLE>
<H1>Raindrop.io Bookmarks</H1>
<DL><p>
  <DT><H3 ADD_DATE="0">Unsorted</H3>
  <DL><p>
    <DT><A HREF="https://a.example/one" ADD_DATE="1700000000" TAGS="x,y">One</A>
  </DL><p>
  <DT><H3 ADD_DATE="0">Coding</H3>
  <DL><p>
    <DT><A HREF="https://b.example/two" ADD_DATE="1700000100" TAGS="">Two</A>
    <DT><H3 ADD_DATE="0">Python</H3>
    <DL><p>
      <DT><A HREF="https://c.example/three" ADD_DATE="0" TAGS="py, web ">Three</A>
      <DT><A HREF="mailto:me@example.com">Mail</A>
    </DL><p>
  </DL><p>
</DL><p>`;

describe('parseRaindropExport', () => {
  const result = parseRaindropExport(SAMPLE);
  const byUrl = (u: string) => result.entries.find((e) => e.url === u)!;

  it('reads every http link and skips the rest', () => {
    expect(result.entries).toHaveLength(3);
    expect(result.skipped).toBe(1);
  });

  it('builds the folder path and ignores the Unsorted folder', () => {
    expect(byUrl('https://a.example/one').folder).toBeNull();
    expect(byUrl('https://b.example/two').folder).toBe('Coding');
    expect(byUrl('https://c.example/three').folder).toBe('Coding/Python');
    expect(byUrl('https://c.example/three').folderPath).toEqual(['Coding', 'Python']);
    expect(byUrl('https://a.example/one').folderPath).toEqual([]);
    expect(result.folders.sort()).toEqual(['Coding', 'Coding/Python']);
  });

  it('reads tags, title and date', () => {
    expect(byUrl('https://a.example/one').tags).toEqual(['x', 'y']);
    expect(byUrl('https://c.example/three').tags).toEqual(['py', 'web']);
    expect(byUrl('https://a.example/one').title).toBe('One');
    expect(byUrl('https://a.example/one').addedAt).toBe(new Date(1700000000 * 1000).toISOString());
    expect(byUrl('https://c.example/three').addedAt).toBeNull();
  });
});
