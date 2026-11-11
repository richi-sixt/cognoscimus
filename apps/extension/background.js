// Saves a page or a link by opening /later/add on the user's own server. That
// page does the saving and asks for a sign-in if needed, so the extension holds
// no token. For the page in the clicked tab the extension also reads the HTML
// as the browser shows it and hands it to /later/add, so that pages behind a
// login keep their text. Nothing is read without a click, and the HTML goes
// nowhere but to that server.

const api = globalThis.browser ?? globalThis.chrome;

const MENU_ID = 'save-to-later';
const HANDOVER_ID = 'handover';
const CAPTURE_PREFIX = 'capture:';
// The server accepts no more; larger pages are fetched by the server instead.
const CAPTURE_MAX = 2 * 1024 * 1024;
const CAPTURE_MAX_AGE_MS = 10 * 60 * 1000;

const getServer = async () => {
  const { server } = await api.storage.sync.get('server');
  return typeof server === 'string' ? server : '';
};

const isWebUrl = (value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

// Marks the toolbar button for a moment when a page cannot be saved.
const flagTab = async (tabId) => {
  if (tabId === undefined) return;
  await api.action.setBadgeText({ text: '!', tabId });
  setTimeout(() => void api.action.setBadgeText({ text: '', tabId }), 3000);
};

// Match patterns carry no port, so the patterns cover the host.
const hostBase = (server) => {
  const { protocol, hostname } = new URL(server);
  return `${protocol}//${hostname}`;
};

// Keeps the content script on /later/add in step with the server address and
// reports whether the hand-over can work (the user granted access to the server).
const syncHandover = async (server) => {
  try {
    const base = hostBase(server);
    const matches = [`${base}/later/add*`];
    const granted = await api.permissions.contains({ origins: [`${base}/*`] });
    const [current] = await api.scripting.getRegisteredContentScripts({ ids: [HANDOVER_ID] });
    if (current && (!granted || current.matches?.join() !== matches.join())) {
      await api.scripting.unregisterContentScripts({ ids: [HANDOVER_ID] });
    } else if (current) {
      return true;
    }
    if (!granted) return false;
    await api.scripting.registerContentScripts([
      { id: HANDOVER_ID, matches, js: ['handover.js'], runAt: 'document_start' },
    ]);
    return true;
  } catch {
    return false;
  }
};

// Runs inside the page. Scripts, styles and embedded frames are of no use to
// the reader and are left out to keep the size down; structured data stays
// because it carries title and author.
const readPage = () => {
  const copy = document.documentElement.cloneNode(true);
  const drop =
    'script:not([type="application/ld+json"]), style, svg, iframe, noscript, link, template';
  for (const node of copy.querySelectorAll(drop)) node.remove();
  return { url: location.href, html: `<!doctype html>${copy.outerHTML}` };
};

// The HTML of the tab, or null when it cannot be read, is too large or the tab
// has moved on to another page.
const capture = async (tabId, url) => {
  try {
    const [injection] = await api.scripting.executeScript({ target: { tabId }, func: readPage });
    const page = injection?.result;
    if (!page || page.url !== url || typeof page.html !== 'string') return null;
    return page.html.length <= CAPTURE_MAX ? page.html : null;
  } catch {
    return null;
  }
};

// Captures wait in session storage, which survives a sleeping background script
// and is cleared when the browser closes. Ones that were never fetched are
// dropped on the next save.
const storeCapture = async (html) => {
  const all = await api.storage.session.get(null);
  const stale = Object.keys(all).filter(
    (name) =>
      name.startsWith(CAPTURE_PREFIX) && Date.now() - (all[name]?.at ?? 0) > CAPTURE_MAX_AGE_MS,
  );
  if (stale.length) await api.storage.session.remove(stale);
  const key = crypto.randomUUID();
  await api.storage.session.set({ [CAPTURE_PREFIX + key]: { html, at: Date.now() } });
  return key;
};

// `tab` is given when the page in that tab is being saved, not a link on it.
const save = async (url, tab, ownPage) => {
  const server = await getServer();
  if (!server) {
    await api.runtime.openOptionsPage();
    return;
  }
  if (!url || !isWebUrl(url)) {
    await flagTab(tab?.id);
    return;
  }
  let target = `${server}/later/add?url=${encodeURIComponent(url)}`;
  if (ownPage && tab?.id !== undefined && (await syncHandover(server))) {
    const html = await capture(tab.id, url);
    if (html) {
      try {
        target += `&ext=${await storeCapture(html)}`;
      } catch {
        // Saved as a link when the capture cannot be stored.
      }
    }
  }
  try {
    await api.windows.create({ url: target, type: 'popup', width: 440, height: 360 });
  } catch {
    // Browsers without popup windows get a tab instead.
    await api.tabs.create({ url: target });
  }
};

// Hands a capture to the content script on /later/add, once.
const takeCapture = async (key, sender) => {
  const server = await getServer();
  if (!server || !sender.url) return null;
  const page = new URL(sender.url);
  if (page.origin !== server || !page.pathname.startsWith('/later/add')) return null;
  if (typeof key !== 'string' || !/^[0-9a-f-]{36}$/.test(key)) return null;
  const name = CAPTURE_PREFIX + key;
  const stored = (await api.storage.session.get(name))[name];
  await api.storage.session.remove(name);
  return typeof stored?.html === 'string' ? stored.html : null;
};

api.runtime.onInstalled.addListener(async () => {
  await api.contextMenus.removeAll();
  api.contextMenus.create({
    id: MENU_ID,
    title: api.i18n.getMessage('save'),
    contexts: ['page', 'link'],
  });
  if (!(await getServer())) await api.runtime.openOptionsPage();
});

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (info.linkUrl) void save(info.linkUrl, tab, false);
  else void save(tab?.url || info.pageUrl, tab, true);
});

api.action.onClicked.addListener((tab) => void save(tab.url, tab, true));

api.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-page') return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  await save(tab?.url, tab, true);
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'take-capture' || sender.id !== api.runtime.id) return undefined;
  takeCapture(message.key, sender).then(sendResponse, () => sendResponse(null));
  return true;
});
