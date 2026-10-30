// Reads the HTML backup that Raindrop.io exports (the Netscape bookmark format):
// folders are nested <DL> lists headed by an <H3>, links are <A> elements with
// ADD_DATE (Unix seconds) and TAGS (comma separated).

export interface ImportEntry {
  url: string;
  title: string;
  tags: string[];
  /** Folder path such as "Coding/Python", without the Unsorted folder. */
  folder: string | null;
  addedAt: string | null;
}

export interface ParsedImport {
  entries: ImportEntry[];
  /** Links that are not http(s), such as mailto: or javascript:. */
  skipped: number;
  folders: string[];
}

const UNSORTED = 'unsorted';

const folderNameOf = (list: Element): string | null => {
  const before = list.previousElementSibling;
  const heading = before?.tagName === 'H3' ? before : before?.querySelector(':scope > h3');
  return heading?.textContent?.trim() || null;
};

const toIsoDate = (seconds: string | null): string | null => {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  // Guards against garbage and dates far in the future.
  return date.getTime() <= Date.now() + 24 * 60 * 60 * 1000 ? date.toISOString() : null;
};

export const parseRaindropExport = (html: string): ParsedImport => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const entries: ImportEntry[] = [];
  const folders = new Set<string>();
  let skipped = 0;

  for (const link of doc.querySelectorAll('a[href]')) {
    const url = (link.getAttribute('href') ?? '').trim();
    if (!/^https?:\/\//i.test(url)) {
      skipped++;
      continue;
    }

    const path: string[] = [];
    for (let el = link.parentElement; el; el = el.parentElement) {
      if (el.tagName !== 'DL') continue;
      const name = folderNameOf(el);
      if (name) path.unshift(name);
    }
    const folder = path.length > 0 && path[0]!.toLowerCase() !== UNSORTED ? path.join('/') : null;
    if (folder) folders.add(folder);

    entries.push({
      url,
      title: link.textContent?.trim() ?? '',
      tags: (link.getAttribute('tags') ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      folder,
      addedAt: toIsoDate(link.getAttribute('add_date')),
    });
  }

  return { entries, skipped, folders: [...folders] };
};
