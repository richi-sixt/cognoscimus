// The popup under the toolbar button. Opening it saves the page in the current
// tab at once; note, collection and labels can be added afterwards.

const { api, t, getServer, getToken, hasAccess, isWebUrl, capture, request, startConnect } =
  globalThis.later;

const $ = (id) => document.getElementById(id);
const SECTIONS = ['setup', 'connect', 'blocked', 'saving', 'failed', 'form'];

const show = (id) => {
  for (const name of SECTIONS) $(name).hidden = name !== id;
};

for (const node of document.querySelectorAll('[data-i18n]')) {
  node.textContent = t(node.dataset.i18n);
}
$('label-input').placeholder = t('addLabel');

let server = '';
let itemId = null;
// Label names on the item, in the order they were added.
let labels = [];

const sameLabel = (a, b) => a.toLowerCase() === b.toLowerCase();

const renderChips = () => {
  $('chips').replaceChildren(
    ...labels.map((name) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = `${name} ×`;
      chip.title = t('removeLabel');
      chip.addEventListener('click', () => {
        labels = labels.filter((other) => other !== name);
        renderChips();
      });
      return chip;
    }),
  );
};

const addLabel = () => {
  const input = $('label-input');
  const name = input.value.replace(/,/g, ' ').trim();
  input.value = '';
  if (!name || labels.some((other) => sameLabel(other, name))) return;
  labels.push(name);
  renderChips();
};

// Collections as an indented list, siblings sorted by name; a collection whose
// parent is missing counts as a top-level one.
const collectionOptions = (collections) => {
  const ids = new Set(collections.map((c) => c.id));
  const children = new Map();
  for (const c of collections) {
    const parent = c.parent_id && ids.has(c.parent_id) ? c.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), c]);
  }
  const options = [];
  const visit = (parent, depth, seen) => {
    const list = (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (const c of list) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      options.push({ id: c.id, text: `${'  '.repeat(depth)}${c.name}` });
      visit(c.id, depth + 1, seen);
    }
  };
  visit(null, 0, new Set());
  return options;
};

const fillPickers = async (collectionId) => {
  const select = $('collection');
  const option = (value, text) => {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = text;
    return node;
  };
  select.replaceChildren(option('', t('unsorted')));
  try {
    const meta = await request('/ext/meta');
    for (const c of collectionOptions(meta.collections ?? [])) select.append(option(c.id, c.text));
    $('label-list').replaceChildren(...(meta.labels ?? []).map((l) => option(l.name, '')));
  } catch {
    // The item is saved; without the lists only the note can be set.
  }
  select.value = collectionId ?? '';
};

const fail = (text) => {
  $('failed-text').textContent = text;
  show('failed');
};

const start = async () => {
  server = await getServer();
  if (!server || !(await hasAccess(server))) return show('setup');
  if (!(await getToken())) return show('connect');

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !isWebUrl(tab.url)) return show('blocked');

  show('saving');
  try {
    const html = tab.id !== undefined ? await capture(tab.id, tab.url) : null;
    const saved = await request('/save', {
      method: 'POST',
      body: { url: tab.url, html: html ?? undefined },
    });
    itemId = saved.id;
    labels = Array.isArray(saved.labels) ? saved.labels : [];
    $('title').textContent = saved.title || tab.title || tab.url;
    $('note').value = saved.note ?? '';
    renderChips();
    show('form');
    await fillPickers(saved.collectionId);
  } catch (error) {
    if (error?.status === 401) return show('connect');
    fail(error?.status ? t('saveFailed') : t('serverUnreachable'));
  }
};

$('open-options').addEventListener('click', () => void api.runtime.openOptionsPage());

$('start-connect').addEventListener('click', async () => {
  if (await startConnect()) window.close();
  else show('setup');
});

$('retry').addEventListener('click', () => void start());

$('label-input').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ',') return;
  event.preventDefault();
  addLabel();
});
$('label-input').addEventListener('change', addLabel);

$('read').addEventListener('click', async () => {
  if (!itemId) return;
  await api.tabs.create({ url: `${server}/later/read?id=${encodeURIComponent(itemId)}` });
  window.close();
});

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!itemId) return;
  addLabel();
  const submit = $('form').querySelector('button[type="submit"]');
  submit.disabled = true;
  $('form-error').textContent = '';
  try {
    await request('/ext/item', {
      method: 'POST',
      body: {
        id: itemId,
        note: $('note').value,
        collectionId: $('collection').value || null,
        labels,
      },
    });
    $('state').textContent = t('detailsSaved');
    setTimeout(() => window.close(), 700);
  } catch (error) {
    if (error?.status === 401) return show('connect');
    $('form-error').textContent = t('detailsFailed');
    submit.disabled = false;
  }
});

void start();
