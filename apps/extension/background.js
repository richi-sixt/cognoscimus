// Saves a page or a link by opening /later/add on the user's own server. That
// page does the saving and asks for a sign-in if needed, so the extension holds
// no token and needs no access to any site.

const api = globalThis.browser ?? globalThis.chrome;

const MENU_ID = 'save-to-later';

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

const save = async (url, tab) => {
  const server = await getServer();
  if (!server) {
    await api.runtime.openOptionsPage();
    return;
  }
  if (!url || !isWebUrl(url)) {
    await flagTab(tab?.id);
    return;
  }
  const target = `${server}/later/add?url=${encodeURIComponent(url)}`;
  try {
    await api.windows.create({ url: target, type: 'popup', width: 440, height: 360 });
  } catch {
    // Browsers without popup windows get a tab instead.
    await api.tabs.create({ url: target });
  }
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
  if (info.menuItemId === MENU_ID) void save(info.linkUrl || info.pageUrl || tab?.url, tab);
});

api.action.onClicked.addListener((tab) => void save(tab.url, tab));

api.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-page') return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  await save(tab?.url, tab);
});
